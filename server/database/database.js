const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function seed() {
  const admin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync(config.adminPass, 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'admin', 'active')"
    ).run(config.adminUser, hash);
    db.prepare("INSERT INTO system_logs (action, detail) VALUES ('seed', 'Default admin created')").run();
  }
  if (!getSetting('default_system_prompt')) {
    setSetting('default_system_prompt', config.defaultSystemPrompt);
  }
  if (!getSetting('site_name')) {
    setSetting('site_name', 'Black GPT');
  }
}

seed();

function logSystem(userId, action, detail = '') {
  db.prepare('INSERT INTO system_logs (user_id, action, detail) VALUES (?, ?, ?)').run(
    userId ?? null,
    action,
    detail
  );
}

module.exports = { db, getSetting, setSetting, logSystem };
