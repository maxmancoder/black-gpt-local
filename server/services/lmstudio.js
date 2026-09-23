const config = require('../config');

const TIMEOUT_MS = 1000;

async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function listModels() {
  const data = await fetchJson(`${config.lmstudioUrl}/v1/models`, {}, 2000);
  const items = (data.data || []).map((m) => m.id);
  return [...new Set(items.filter(Boolean))];
}

async function getStatus() {
  try {
    const models = await listModels();
    return {
      online: true,
      modelCount: models.length,
      firstModel: models[0] || null,
      models
    };
  } catch (e) {
    return { online: false, modelCount: 0, firstModel: null, models: [], error: e.message };
  }
}

async function createCompletion({ model, messages, temperature = 0.7, top_p = 0.95, max_tokens = 2048, stream = false, signal = null }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(`${config.lmstudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p,
        max_tokens,
        stream
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LM Studio returned ${res.status}: ${text.slice(0, 300)}`);
    }
    if (stream) {
      // keep external abort wired to the body stream
      res._externalSignal = signal;
      return res;
    }
    return res.json();
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

async function* streamChunks(sseStream, signal = null) {
  const reader = sseStream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onAbort = () => {
    try { reader.cancel(); } catch (e) {}
  };
  if (signal) {
    if (signal.aborted) {
      try { reader.cancel(); } catch (e) {}
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    while (true) {
      if (signal && signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) yield delta;
        } catch (e) {
          // ignore parse errors on partial chunks
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = { listModels, getStatus, createCompletion, streamChunks };