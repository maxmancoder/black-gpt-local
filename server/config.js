require('dotenv').config();
const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  lmstudioUrl: (process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, ''),
  sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS || '30', 10),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin1234',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '5', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000', 10),
  maxMessageChars: parseInt(process.env.MAX_MESSAGE_CHARS || '10000', 10),
  defaultSystemPrompt: process.env.DEFAULT_SYSTEM_PROMPT || 'تو یک دستیار هوش مصنوعی فارسی هستی.',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'chat.db'),
  uploadsDir: path.join(root, 'uploads'),
  clientDir: path.join(root, 'client'),
  maxContextMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '40', 10)
};
