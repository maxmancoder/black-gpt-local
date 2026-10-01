$ErrorActionPreference = 'SilentlyContinue'
Set-Location -Path $PSScriptRoot

function Say([string]$msg, [string]$color = 'Gray') {
  Write-Host $msg -ForegroundColor $color
}

function Kill-Port([int]$port) {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  foreach ($l in $listeners) {
    $procId = $l.OwningProcess
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    Say "Port $port is used by $name (PID $procId) - killing..." 'Yellow'
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  if ($listeners.Count -gt 0) { Start-Sleep -Milliseconds 800 }
  else { Say "Port $port is free." }
}

function Stop-OldTunnels {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(cloudflare|cloudflared)\.exe$' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'localhost\.run' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Find-Cloudflared {
  $candidates = @(
    (Join-Path $PSScriptRoot 'bin\cloudflare.exe'),
    (Join-Path $PSScriptRoot 'bin\cloudflared.exe'),
    (Join-Path $PSScriptRoot 'cloudflare.exe'),
    (Join-Path $PSScriptRoot 'cloudflared.exe')
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Wait-Match([string]$file, [string]$pattern, [int]$timeoutSec, $proc = $null) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ($proc) {
      try { if ($proc.HasExited) { break } } catch {}
    }
    if (Test-Path $file) {
      $content = Get-Content -Path $file -Raw -ErrorAction SilentlyContinue
      if ($content) {
        $m = [regex]::Match($content, $pattern)
        if ($m.Success) { return $m.Value.TrimEnd('/|)>,.,;') }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  return $null
}

function Start-Chrome([string]$url) {
  $paths = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
  )
  $chrome = $paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList "`"$url`""
    return $true
  }
  return $false
}

# --- port ---
$port = 3000
if (Test-Path '.env') {
  $line = Select-String -Path '.env' -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
$localUrl = "http://localhost:$port"
Say "Black GPT Chat - port $port" 'Cyan'

Stop-OldTunnels
Kill-Port $port

# --- deps ---
if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
  Copy-Item '.env.example' '.env'
}
if (-not (Test-Path 'node_modules')) {
  Say 'Installing npm dependencies...' 'Yellow'
  npm install | Out-Null
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Say 'Node.js not found!' 'Red'
  exit 1
}

# --- server ---
Say 'Starting server...' 'Cyan'
Start-Process -FilePath $nodeCmd.Source -ArgumentList 'server/server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
$up = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $up = $true; break }
  } catch {}
}
if ($up) { Say "Server is up: $localUrl" 'Green' }
else { Say 'Server did not respond yet, keep waiting for tunnels...' 'Yellow' }

# --- cloudflare tunnel ---
$tunnelUrl = $null
$cfExe = Find-Cloudflared
if ($cfExe) {
  Say "Trying Cloudflare tunnel ($cfExe)..." 'Cyan'
  $cfLog = Join-Path $env:TEMP 'blackgpt_cf.log'
  Remove-Item $cfLog -Force -ErrorAction SilentlyContinue
  $cfProc = Start-Process -FilePath $cfExe -ArgumentList @('tunnel', '--url', $localUrl) `
    -RedirectStandardError $cfLog -WindowStyle Hidden -PassThru
  $tunnelUrl = Wait-Match $cfLog 'https://[a-z0-9-]+\.trycloudflare\.com' 25 $cfProc
  if ($tunnelUrl) {
    Say "Cloudflare tunnel OK: $tunnelUrl" 'Green'
  } else {
    Say 'Cloudflare tunnel failed.' 'Red'
    if ($cfProc) { Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue }
  }
} else {
  Say 'bin\cloudflare.exe not found - skipping Cloudflare.' 'Yellow'
}

# --- ssh tunnel (localhost.run) ---
if (-not $tunnelUrl) {
  $sshExe = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
  if (-not (Test-Path $sshExe)) {
    $sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
    if ($sshCmd) { $sshExe = $sshCmd.Source } else { $sshExe = $null }
  }
  if ($sshExe) {
    Say 'Trying SSH tunnel (localhost.run)...' 'Cyan'
    $sshLog = Join-Path $env:TEMP 'blackgpt_ssh.log'
    $sshErr = Join-Path $env:TEMP 'blackgpt_ssh.err.log'
    Remove-Item $sshLog, $sshErr -Force -ErrorAction SilentlyContinue
    $sshArgs = @(
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', "80:localhost:$port",
      'localhost.run'
    )
    $sshProc = Start-Process -FilePath $sshExe -ArgumentList $sshArgs `
      -RedirectStandardOutput $sshLog -RedirectStandardError $sshErr `
      -WindowStyle Hidden -PassThru
    $urlPattern = 'https://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[a-zA-Z0-9/_.-]*'
    $tunnelUrl = Wait-Match $sshLog $urlPattern 30 $sshProc
    if (-not $tunnelUrl) { $tunnelUrl = Wait-Match $sshErr $urlPattern 3 $sshProc }
    if ($tunnelUrl) {
      Say "SSH tunnel OK: $tunnelUrl" 'Green'
    } else {
      Say 'SSH tunnel failed.' 'Red'
      if ($sshProc) { Stop-Process -Id $sshProc.Id -Force -ErrorAction SilentlyContinue }
    }
  } else {
    Say 'ssh.exe not found - skipping SSH tunnel.' 'Yellow'
  }
}

# --- result ---
$finalUrl = if ($tunnelUrl) { $tunnelUrl } else { $localUrl }
$mode = if ($tunnelUrl -match 'trycloudflare') { 'Cloudflare' }
  elseif ($tunnelUrl) { 'SSH (localhost.run)' }
  else { 'Local only' }

if ($tunnelUrl) {
  try {
    Set-Clipboard -Value $tunnelUrl
    Say 'Public URL copied to clipboard.' 'Green'
  } catch {}
}

@"
Public URL: $finalUrl
Mode: $mode
Started: $(Get-Date -Format o)
Local: $localUrl
"@ | Set-Content -Path (Join-Path $PSScriptRoot 'TUNNEL_URL.txt') -Encoding UTF8

$sayMode = switch ($mode) { 'Local only' { 'Red' } default { 'Green' } }
Say "Mode: $mode" $sayMode
Say "Opening: $finalUrl" 'Cyan'

if (-not (Start-Chrome $finalUrl)) {
  Start-Process $finalUrl
}
