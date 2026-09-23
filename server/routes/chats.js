const express = require('express');
const { db, getSetting, logSystem } = require('../database/database');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { inferenceQueue } = require('../services/queue');
const lmstudio = require('../services/lmstudio');
const config = require('../config');

const router = express.Router();

router.use(requireAuth);

const LIMITED_REPLY = 'با توجه به محدودیتی که برای شما گذاشته شده، نمیتوانم به شما جواب بدهم';

function checkUserAllowed(user) {
  if (user.status === 'blocked') {
    return { ok: false, error: 'این حساب مسدود شده است.', code: 'BLOCKED' };
  }
  if (user.status === 'limited') {
    return { ok: false, error: LIMITED_REPLY, code: 'LIMITED', limited: true };
  }
  return { ok: true };
}

function chatVisible(chat, user) {
  return chat.user_id === user.id || user.role === 'admin';
}

function getChat(id, user) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  if (!chat || !chatVisible(chat, user)) return null;
  return chat;
}

router.get('/', (req, res) => {
  const { q = '' } = req.query;
  let rows;
  const base = 'FROM chats c WHERE c.user_id = ?';
  let query;
  let params;
  if (String(q).trim()) {
    query = `SELECT DISTINCT c.* ${base} AND (c.title LIKE ? OR EXISTS (
      SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ?
    )) ORDER BY c.updated_at DESC`;
    const like = `%${String(q).trim()}%`;
    params = [req.user.id, like, like];
  } else {
    query = `SELECT * ${base} ORDER BY c.updated_at DESC`;
    params = [req.user.id];
  }
  rows = db.prepare(query).all(...params);
  res.json({
    chats: rows.map((c) => ({
      id: c.id,
      title: c.title,
      model: c.model,
      updated_at: c.updated_at,
      created_at: c.created_at,
      message_count: db.prepare('SELECT COUNT(*) c FROM messages WHERE chat_id = ?').get(c.id).c
    }))
  });
});

router.post('/', (req, res) => {
  if (req.user.status === 'blocked') {
    return res.status(403).json({ error: 'این حساب مسدود شده است.', code: 'BLOCKED' });
  }

  const { title = 'چت جدید', model = null, system_prompt = null, temperature, top_p, max_tokens } = req.body || {};

  const chatLimitReached = req.user.max_new_chats != null;
  if (chatLimitReached) {
    const count = db
      .prepare('SELECT COUNT(*) c FROM chats WHERE user_id = ?')
      .get(req.user.id).c;
    if (count >= req.user.max_new_chats) {
      return res.status(403).json({
        error: `سقف تعداد چت شما (${req.user.max_new_chats}) پر شده است.`,
        code: 'CHAT_LIMIT'
      });
    }
  }

  const info = db
    .prepare(
      `INSERT INTO chats (user_id, title, model, system_prompt, temperature, top_p, max_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      String(title).slice(0, 120),
      model,
      system_prompt,
      temperature ?? 0.7,
      top_p ?? 0.95,
      max_tokens ?? 2048
    );

  const chatId = Number(info.lastInsertRowid);
  logSystem(req.user.id, 'create_chat', `chat#${chatId}`);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  res.status(201).json({ chat });
});

router.get('/:id', (req, res) => {
  const chat = getChat(req.params.id, req.user);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  const messages = db
    .prepare('SELECT id, role, content, model, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC')
    .all(chat.id);
  const files = db
    .prepare('SELECT id, filename, mime_type, size, created_at FROM files WHERE chat_id = ? ORDER BY id ASC')
    .all(chat.id);
  res.json({ chat, messages, files });
});

router.patch('/:id', (req, res) => {
  const chat = getChat(req.params.id, req.user);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  const { title, model, system_prompt, temperature, top_p, max_tokens } = req.body || {};
  const sets = [];
  const vals = [];
  if (title !== undefined) {
    sets.push('title = ?');
    vals.push(String(title).slice(0, 120));
  }
  if (model !== undefined) {
    sets.push('model = ?');
    vals.push(model);
  }
  if (system_prompt !== undefined) {
    sets.push('system_prompt = ?');
    vals.push(system_prompt);
  }
  if (temperature !== undefined) {
    sets.push('temperature = ?');
    vals.push(Number(temperature));
  }
  if (top_p !== undefined) {
    sets.push('top_p = ?');
    vals.push(Number(top_p));
  }
  if (max_tokens !== undefined) {
    sets.push('max_tokens = ?');
    vals.push(Number(max_tokens));
  }
  if (!sets.length) return res.status(400).json({ error: 'چیزی برای تغییر ارسال نشد' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  logSystem(req.user.id, 'update_chat', `chat#${chat.id}`);
  res.json({ chat: db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id) });
});

router.delete('/:id', (req, res) => {
  const chat = getChat(req.params.id, req.user);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
  logSystem(req.user.id, 'delete_chat', `chat#${chat.id}`);
  res.json({ ok: true });
});

router.post('/:id/messages', rateLimit, async (req, res) => {
  const allowed = checkUserAllowed(req.user);
  if (allowed.limited) {
    // limited user: do not invoke AI; stream canned reply and auto-hide on client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    res.write(`event: delta\ndata: ${JSON.stringify({ delta: allowed.error })}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ limited: true, hideAfterMs: 5000 })}\n\n`);
    res.end();
    return;
  }
  if (!allowed.ok) {
    return res.status(403).json({ error: allowed.error, code: allowed.code });
  }

  const chat = getChat(req.params.id, req.user);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  if (chat.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'دسترسی به این چت را ندارید' });
  }

  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ error: 'پیام خالی است' });
  if (content.length > config.maxMessageChars) {
    return res.status(400).json({ error: `حداکثر طول پیام ${config.maxMessageChars} کاراکتر است` });
  }

  if (req.user.max_messages != null) {
    const count = db
      .prepare("SELECT COUNT(*) c FROM chats ch JOIN messages m ON m.chat_id = ch.id WHERE ch.user_id = ? AND m.role = 'user'")
      .get(req.user.id).c;
    if (count >= req.user.max_messages) {
      return res.status(403).json({ error: `سقف پیام شما (${req.user.max_messages}) پر شده است.`, code: 'MESSAGE_LIMIT' });
    }
  }

  const model = (req.body && req.body.model) || chat.model || req.user.default_model;
  if (!model) return res.status(400).json({ error: 'مدلی انتخاب نشده است' });

  const modelRow = db.prepare('SELECT * FROM models WHERE model_key = ?').get(model);
  if (modelRow && !modelRow.enabled) {
    return res.status(403).json({ error: 'این مدل توسط ادمین غیرفعال شده است.' });
  }
  if (req.user.role !== 'admin') {
    const perm = db
      .prepare('SELECT enabled FROM user_model_permissions WHERE user_id = ? AND model_key = ?')
      .get(req.user.id, model);
    if (perm && !perm.enabled) {
      return res.status(403).json({ error: 'دسترسی شما به این مدل غیرفعال است.' });
    }
  }

  const userMsg = db
    .prepare('INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)')
    .run(chat.id, 'user', content, model);
  const userMsgId = Number(userMsg.lastInsertRowid);
  db.prepare("UPDATE chats SET updated_at = datetime('now'), model = ? WHERE id = ?").run(model, chat.id);

  const history = db
    .prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC')
    .all(chat.id)
    .slice(-config.maxContextMessages);

  const systemPrompt = chat.system_prompt || getSetting('default_system_prompt', config.defaultSystemPrompt);

  const memoryRows = db
    .prepare('SELECT mem_key, mem_value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20')
    .all(req.user.id);
  const memoryText = memoryRows.map((m) => `${m.mem_key}: ${m.mem_value}`).join('\n');

  const files = db
    .prepare("SELECT id, filename, content_text FROM files WHERE chat_id = ? AND content_text IS NOT NULL")
    .all(chat.id);

  const pieces = [];
  if (systemPrompt) pieces.push({ role: 'system', content: systemPrompt });
  if (memoryText) pieces.push({ role: 'system', content: `Memory about user:\n${memoryText}` });
  for (const f of files) {
    pieces.push({
      role: 'system',
      content: `[Attached file: ${f.filename}]\n${String(f.content_text).slice(0, 20000)}`
    });
  }
  pieces.push(...history);

  const temperature = Number(chat.temperature ?? 0.7);
  const top_p = Number(chat.top_p ?? 0.95);
  const max_tokens = Number(chat.max_tokens ?? 2048);
  const startedAt = Date.now();
  const reqModel = model;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { ok: true });

  let assistantModel = reqModel;
  let full = '';
  let finished = false;
  let stopped = false;

  // abort LM Studio when the browser disconnects (stop button / closed tab)
  const genAbort = new AbortController();
  const onClientClose = () => {
    if (!finished) {
      stopped = true;
      genAbort.abort();
    }
  };
  res.on('close', onClientClose);
  req.on('aborted', onClientClose);

  const savePartial = (status) => {
    if (!full.trim()) return null;
    const msgInfo = db
      .prepare('INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)')
      .run(chat.id, 'assistant', full, assistantModel);
    db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);
    db.prepare('INSERT INTO usage_logs (user_id, chat_id, model, status, duration_ms) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id,
      chat.id,
      assistantModel,
      status,
      Date.now() - startedAt
    );
    return Number(msgInfo.lastInsertRowid);
  };

  const run = async () => {
    if (genAbort.signal.aborted) return;
    const completion = await lmstudio.createCompletion({
      model: reqModel,
      messages: pieces,
      temperature,
      top_p,
      max_tokens,
      stream: true,
      signal: genAbort.signal
    });
    let usedModel = reqModel;
    for await (const delta of lmstudio.streamChunks(completion, genAbort.signal)) {
      if (genAbort.signal.aborted) break;
      full += delta;
      assistantModel = usedModel;
      send('delta', { delta });
    }
    finished = true;
    if (stopped || genAbort.signal.aborted) {
      // user pressed stop: persist partial answer
      savePartial('stopped');
      return;
    }
    if (!full.trim()) throw new Error('پاسخی از LM Studio دریافت نشد');
    const msgInfo = db
      .prepare('INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)')
      .run(chat.id, 'assistant', full, assistantModel);
    const aiMsgId = Number(msgInfo.lastInsertRowid);
    db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);
    db.prepare('INSERT INTO usage_logs (user_id, chat_id, model, duration_ms) VALUES (?, ?, ?, ?)').run(
      req.user.id,
      chat.id,
      assistantModel,
      Date.now() - startedAt
    );
    send('done', { messageId: aiMsgId, model: assistantModel });
  };

  try {
    await inferenceQueue.add(run);
  } catch (e) {
    if (genAbort.signal.aborted || stopped) {
      finished = true;
      savePartial('stopped');
    } else {
      db.prepare('INSERT INTO usage_logs (user_id, chat_id, model, status, duration_ms) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id,
        chat.id,
        reqModel,
        'error',
        Date.now() - startedAt
      );
      logSystem(req.user.id, 'chat_error', String(e.message).slice(0, 300));
      send('error', { error: getFriendlyError(e) });
    }
  } finally {
    finished = true;
    res.removeListener('close', onClientClose);
    req.removeListener('aborted', onClientClose);
    if (!res.writableEnded) res.end();
  }
});

function getFriendlyError(e) {
  const m = String(e.message || '');
  if (/fetch failed|ECONNREFUSED|connect/i.test(m)) {
    return 'LM Studio در دسترس نیست. مطمئن شوید LM Studio باز است و سرور مدل اجرا شده.';
  }
  if (/model/i.test(m)) return `خطای مدل: ${m}`;
  return m;
}

module.exports = router;