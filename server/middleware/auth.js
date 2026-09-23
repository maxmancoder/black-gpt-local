const { db } = require('../database/database');
const config = require('../config');

function findUserByToken(token) {
  if (!token) return null;
  const session = db
    .prepare(
      `SELECT s.*, u.username, u.role, u.status, u.theme, u.max_new_chats, u.max_messages, u.default_model
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token);
  if (!session) return null;
  return {
    id: session.user_id,
    username: session.username,
    role: session.role,
    status: session.status,
    theme: session.theme,
    max_new_chats: session.max_new_chats,
    max_messages: session.max_messages,
    default_model: session.default_model,
    sessionToken: session.token
  };
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function cookieHeader(req) {
  return req.headers.cookie ? parseCookies(req.headers.cookie) : {};
}

function requireAuth(req, res, next) {
  const cookies = cookieHeader(req);
  const user = findUserByToken(cookies.session);
  if (!user) return res.status(401).json({ error: 'برای این کار باید وارد شوید', code: 'AUTH_REQUIRED' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'فقط ادمین اجازه دارد' });
    next();
  });
}

function renderUserPublic(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    theme: user.theme,
    max_new_chats: user.max_new_chats,
    max_messages: user.max_messages,
    default_model: user.default_model
  };
}

module.exports = { findUserByToken, parseCookies, cookieHeader, requireAuth, requireAdmin, renderUserPublic, config };