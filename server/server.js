const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const { db, getSetting } = require('./database/database');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/models', require('./routes/models'));
app.use('/api/files', require('./routes/files'));
app.use('/api/admin', require('./routes/admin'));

function getSiteIconPath() {
  const stored = getSetting('site_icon', '');
  if (stored) {
    const p = path.join(config.uploadsDir, 'site', stored);
    if (fs.existsSync(p)) return p;
  }
  return path.join(config.clientDir, 'assets', 'icon.svg');
}

function getSiteIconType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

app.get('/site-icon', (req, res) => {
  const filePath = getSiteIconPath();
  res.setHeader('Content-Type', getSiteIconType(filePath));
  res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  res.sendFile(filePath);
});

app.get('/manifest.json', (req, res) => {
  const filePath = getSiteIconPath();
  const type = getSiteIconType(filePath);
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    name: 'Black GPT',
    short_name: 'Black GPT',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090A',
    theme_color: '#08090A',
    description: 'Local AI workspace powered by LM Studio',
    icons: [
      {
        src: '/site-icon',
        sizes: 'any',
        type,
        purpose: 'any'
      }
    ]
  });
});

app.use(express.static(config.clientDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else if (/\.(js|css|svg|png|jpg|jpeg|gif|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

app.get('/api/dashboard/config', (req, res) => {
  res.json({ siteName: getSetting('site_name', 'Black GPT') });
});

app.get('/admin', (req, res) => res.sendFile(path.join(config.clientDir, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(config.clientDir, 'login.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON نامعتبر' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم فایل بیش از ۲۰MB است' });
  console.error('[error]', err.message);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

app.listen(config.port, () => {
  console.log(`Black GPT Chat running on http://localhost:${config.port}`);
  console.log(`LM Studio API: ${config.lmstudioUrl}`);
  console.log(`DB: ${config.dbPath}`);
});