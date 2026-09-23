const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, logSystem } = require('../database/database');
const { requireAdmin } = require('../middleware/auth');
const lmstudio = require('../services/lmstudio');

const router = express.Router();
router.use(requireAdmin);

function stats() {
  return {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    chats: db.prepare('SELECT COUNT(*) c FROM chats').get().c,
    messages: db.prepare('SELECT COUNT(*) c FROM messages').get().c,
    files: db.prepare('SELECT COUNT(*) c FROM files').get().c,
    models: db.prepare('SELECT COUNT(*) c FROM models').get().c,
    messages_today: db
      .prepare("SELECT COUNT(*) c FROM messages WHERE date(created_at) = date('now')")
      .get().c,
    messages_yesterday: db
      .prepare("SELECT COUNT(*) c FROM messages WHERE date(created_at) = date('now', '-1 day')")
      .get().c,
    usage: db.prepare(
      `SELECT model, COUNT(*) as uses FROM usage_logs WHERE status = 'ok' GROUP BY model ORDER BY uses DESC`
    ).all()
  };
}

function isMainAdmin(user) {
  return user && (Number(user.id) === 1 || user.username === 'admin');
}

router.get('/stats', async (req, res) => {
  res.json({ ...stats(), lm: await lmstudio.getStatus() });
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const users = db
    .prepare(
      `SELECT u.*,
              (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) as chats,
              (SELECT COUNT(*) FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = u.id) as messages,
              (SELECT MAX(created_at) FROM chats c WHERE c.user_id = u.id) as last_activity
       FROM users u
       WHERE (? = '' OR u.username LIKE ? OR u.role LIKE ? OR u.status LIKE ? OR CAST(u.id AS TEXT) = ?)
       ORDER BY u.id`
    )
    .all(q, like, like, like, q);
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      max_new_chats: u.max_new_chats,
      max_messages: u.max_messages,
      theme: u.theme,
      default_model: u.default_model,
      chats: u.chats,
      messages: u.messages,
      last_activity: u.last_activity,
      created_at: u.created_at
    }))
  });
});

router.post('/users', (req, res) => {
  const { username, password, role = 'user', status = 'active', max_new_chats = null, max_messages = null } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
  const exists = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (exists) return res.status(409).json({ error: 'کاربر وجود دارد' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, role, status, max_new_chats, max_messages) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(String(username).trim(), hash, role === 'admin' ? 'admin' : 'user', status, max_new_chats ?? null, max_messages ?? null);
  logSystem(req.user.id, 'admin_create_user', String(username).trim());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  if (isMainAdmin(user) && req.user.id !== user.id) {
    return res.status(403).json({ error: 'اطلاعات ادمین اصلی فقط توسط خودش قابل تغییر است' });
  }

  const { username, role, status, max_new_chats, max_messages, password } = req.body || {};
  if (username || status || role || max_new_chats !== undefined || max_messages !== undefined || password) {
    const sets = [];
    const vals = [];
    if (username) {
      sets.push('username = ?');
      vals.push(String(username).trim());
    }
    if (role === 'admin' || role === 'user') {
      sets.push('role = ?');
      vals.push(role);
    }
    if (status === 'active' || status === 'limited' || status === 'blocked') {
      sets.push('status = ?');
      vals.push(status);
    }
    if (max_new_chats !== undefined) {
      sets.push('max_new_chats = ?');
      vals.push(max_new_chats === null ? null : Number(max_new_chats));
    }
    if (max_messages !== undefined) {
      sets.push('max_messages = ?');
      vals.push(max_messages === null ? null : Number(max_messages));
    }
    if (password) {
      sets.push('password_hash = ?');
      vals.push(bcrypt.hashSync(password, 10));
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      vals.push(id);
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      if (id === req.user.id && status && status !== 'active') {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', id);
      }
      logSystem(req.user.id, 'admin_update_user', `user#${id}`);
    }
  }
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'نمیتوانید خودتان را حذف کنید' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  if (isMainAdmin(user)) return res.status(403).json({ error: 'ادمین اصلی قابل حذف نیست' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logSystem(req.user.id, 'admin_delete_user', `user#${id} (${user.username})`);
  res.json({ ok: true });
});

router.get('/register-requests', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, username, status, created_at, reviewed_at FROM register_requests
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 200`
    )
    .all();
  res.json({ requests: rows });
});

router.post('/register-requests/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM register_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'درخواست پیدا نشد' });
  if (row.status === 'approved') return res.status(409).json({ error: 'قبلاً تایید شده است' });

  const exists = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(row.username);
  if (exists) {
    db.prepare(
      "UPDATE register_requests SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?"
    ).run(req.user.id, id);
    return res.status(409).json({ error: 'کاربر از قبل وجود دارد و درخواست بسته شد' });
  }

  db.prepare(
    "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'active')"
  ).run(row.username, row.password_hash);
  db.prepare(
    "UPDATE register_requests SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?"
  ).run(req.user.id, id);
  logSystem(req.user.id, 'register_approve', row.username);
  res.json({ ok: true, username: row.username });
});

router.post('/register-requests/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM register_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'درخواست پیدا نشد' });
  if (row.status === 'rejected') return res.status(409).json({ error: 'قبلاً رد شده است' });

  db.prepare(
    "UPDATE register_requests SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?"
  ).run(req.user.id, id);
  logSystem(req.user.id, 'register_reject', row.username);
  res.json({ ok: true });
});

router.get('/chats', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const chats = db
    .prepare(
      `SELECT c.id, c.user_id, u.username, c.title, c.model, c.updated_at, c.created_at,
              (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count
       FROM chats c JOIN users u ON u.id = c.user_id
       WHERE (? = '' OR c.title LIKE ? OR u.username LIKE ? OR c.model LIKE ?
              OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ?))
       ORDER BY c.updated_at DESC LIMIT 500`
    )
    .all(q, like, like, like, like);
  res.json({ chats });
});

router.get('/models', (req, res) => {
  const local = db.prepare('SELECT * FROM models ORDER BY display_name').all();
  const perms = db.prepare('SELECT * FROM user_model_permissions').all();
  res.json({
    models: local,
    perms: perms.reduce((acc, p) => {
      acc[p.model_key] = acc[p.model_key] || {};
      acc[p.model_key][p.user_id] = !!p.enabled;
      return acc;
    }, {})
  });
});

router.post('/models/refresh', async (req, res) => {
  const status = await lmstudio.getStatus();
  for (const id of status.models) {
    db.prepare('INSERT OR IGNORE INTO models (model_key, display_name, enabled) VALUES (?, ?, 1)').run(id, id);
  }
  res.json(status);
});

router.patch('/models/:key', (req, res) => {
  const key = req.params.key;
  const { enabled, display_name } = req.body || {};
  const row = db.prepare('SELECT * FROM models WHERE model_key = ?').get(key);
  if (!row) return res.status(404).json({ error: 'مدل در دیتابیس نیست. ابتدا از LM Studio رفرش کنید' });
  if (typeof enabled === 'boolean') {
    db.prepare("UPDATE models SET enabled = ?, updated_at = datetime('now') WHERE model_key = ?").run(enabled ? 1 : 0, key);
  }
  if (display_name) {
    db.prepare('UPDATE models SET display_name = ? WHERE model_key = ?').run(String(display_name), key);
  }
  logSystem(req.user.id, 'admin_update_model', key);
  res.json({ ok: true });
});

router.patch('/users/:id/models/:key', (req, res) => {
  const { enabled } = req.body || {};
  db.prepare(
    'INSERT INTO user_model_permissions (user_id, model_key, enabled) VALUES (?, ?, ?) ON CONFLICT(user_id, model_key) DO UPDATE SET enabled = excluded.enabled'
  ).run(Number(req.params.id), req.params.key, enabled ? 1 : 0);
  logSystem(req.user.id, 'admin_update_model_perm', `${req.params.key} for user#${req.params.id}`);
  res.json({ ok: true });
});

router.get('/usage', (req, res) => {
  const logs = db
    .prepare(
      `SELECT u.username, l.model, l.status, l.duration_ms, l.created_at FROM usage_logs l
       LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 500`
    )
    .all();
  res.json({ logs });
});

router.get('/logs', (req, res) => {
  const logs = db
    .prepare(
      `SELECT s.id, s.action, s.detail, s.created_at, u.username
       FROM system_logs s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 500`
    )
    .all();
  res.json({ logs });
});

router.get('/settings', (req, res) => {
  res.json({
    settings: {
      site_name: getSetting('site_name', 'Black GPT'),
      allow_registration: getSetting('allow_registration', 'true'),
      default_system_prompt: getSetting('default_system_prompt', ''),
      default_temperature: getSetting('default_temperature', '0.7'),
      default_max_tokens: getSetting('default_max_tokens', '2048'),
      max_context_messages: getSetting('max_context_messages', '40')
    }
  });
});

router.put('/settings', (req, res) => {
  const { site_name, allow_registration, default_system_prompt, default_temperature, default_max_tokens, max_context_messages } =
    req.body || {};
  if (site_name !== undefined) setSetting('site_name', String(site_name).slice(0, 80));
  if (allow_registration !== undefined) {
    const v = String(allow_registration);
    if (!['true', 'false', 'pending'].includes(v)) {
      return res.status(400).json({ error: 'مقدار ثبت‌نام نامعتبر است' });
    }
    setSetting('allow_registration', v);
  }
  if (default_system_prompt !== undefined) setSetting('default_system_prompt', String(default_system_prompt));
  if (default_temperature !== undefined) setSetting('default_temperature', String(default_temperature));
  if (default_max_tokens !== undefined) setSetting('default_max_tokens', String(default_max_tokens));
  if (max_context_messages !== undefined) setSetting('max_context_messages', String(max_context_messages));
  logSystem(req.user.id, 'admin_update_settings');
  res.json({ ok: true });
});

module.exports = router;