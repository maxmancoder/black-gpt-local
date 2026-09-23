const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, logSystem } = require('../database/database');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = config.sessionTtlDays;
  db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', ?))").run(
    userId,
    token,
    `+${ttl} days`
  );
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ttl * 24 * 60 * 60 * 1000
  });
  return token;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    theme: u.theme,
    max_new_chats: u.max_new_chats,
    max_messages: u.max_messages,
    default_model: u.default_model
  };
}

router.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'نام کاربری باید ۳ تا ۲۰ حرف انگلیسی/عدد باشد' });
  if (password.length < 4) return res.status(400).json({ error: 'رمز عبور حداقل ۴ کاراکتر باشد' });

  const regMode = getRegMode();
  if (regMode === 'false') {
    return res.status(403).json({ error: 'ثبت‌نام آزاد غیرفعال است. با ادمین تماس بگیرید.', code: 'REG_DISABLED' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (exists) return res.status(409).json({ error: 'این نام کاربری قبلاً ثبت شده است' });

  const hash = bcrypt.hashSync(password, 10);

  if (regMode === 'pending') {
    const pending = db.prepare('SELECT * FROM register_requests WHERE lower(username) = lower(?)').get(username);
    if (pending && pending.status === 'pending') {
      return res.status(409).json({ error: 'درخواست شما قبلاً ثبت شده و در انتظار تایید ادمین است.', code: 'ALREADY_PENDING' });
    }
    if (pending && pending.status === 'approved') {
      return res.status(409).json({ error: 'این نام کاربری قبلاً تایید شده است. وارد شوید.', code: 'ALREADY_APPROVED' });
    }
    if (pending) {
      db.prepare("UPDATE register_requests SET password_hash = ?, status = 'pending', created_at = datetime('now'), reviewed_at = NULL, reviewed_by = NULL WHERE lower(username) = lower(?)").run(hash, username);
    } else {
      db.prepare('INSERT INTO register_requests (username, password_hash) VALUES (?, ?)').run(username, hash);
    }
    logSystem(null, 'register_request', username);
    return res.json({
      pending: true,
      message: 'درخواست ثبت نام شما به ادمین فرستاده شد! منتظر بمانید و بعدا با این اطلاعات، روی ورود بزنید.'
    });
  }

  const info = db
    .prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'active')")
    .run(username, hash);
  const userId = info.lastInsertRowid;
  logSystem(userId, 'register', username);
  createSession(userId, res);
  res.json({ user: publicUser({ id: userId, username, role: 'user', status: 'active', theme: 'dark' }) });
});

function getRegMode() {
  const { getSetting } = require('../database/database');
  const v = getSetting('allow_registration', 'true');
  return v === 'false' || v === 'pending' ? v : 'true';
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username || '');
  if (!user) {
    // check register_requests for pending/rejected messages
    const regReq = db.prepare('SELECT * FROM register_requests WHERE lower(username) = lower(?)').get(username || '');
    if (regReq && regReq.status === 'pending') {
      return res.status(403).json({ error: 'درخواست ثبت نام شما در انتظار تایید ادمین است.', code: 'PENDING_APPROVAL' });
    }
    if (regReq && regReq.status === 'rejected') {
      return res.status(403).json({ error: 'درخواست ثبت نام شما توسط ادمین رد شده است.', code: 'REJECTED' });
    }
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  if (!bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  logSystem(user.id, 'login', user.username);
  createSession(user.id, res);
  res.json({ user: publicUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE token = ?').get(req.user.sessionToken);
  if (session) db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const messageCount = db
    .prepare("SELECT COUNT(*) c FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = ? AND m.role = 'user'")
    .get(user.id).c;
  res.json({ user: { ...publicUser(user), message_count: messageCount } });
});

router.patch('/me', requireAuth, (req, res) => {
  const { theme, default_model } = req.body || {};
  const sets = [];
  const vals = [];
  if (theme === 'dark' || theme === 'light') {
    sets.push('theme = ?');
    vals.push(theme);
  }
  if (typeof default_model === 'string' && default_model !== null) {
    sets.push('default_model = ?');
    vals.push(default_model);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'مقدار نامعتبر' });
  vals.push(req.user.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next || next.length < 4)
    return res.status(400).json({ error: 'پسورد فعلی و جدید (حداقل ۴ کاراکتر) را وارد کنید' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash))
    return res.status(400).json({ error: 'پسورد فعلی اشتباه است' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

module.exports = router;