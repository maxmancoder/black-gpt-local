const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, logSystem } = require('../database/database');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();
router.use(requireAuth);

fs.mkdirSync(config.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^\w.\-ا-ی\s]/g, '_').slice(0, 100);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }
});

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'json', 'css', 'html', 'htm',
  'xml', 'csv', 'yml', 'yaml', 'sql', 'sh', 'bat', 'ini', 'cfg', 'log', 'java', 'c', 'cpp',
  'h', 'rb', 'go', 'rs', 'php', 'vue', 'svelte'
]);

function extractText(filePath, ext, mime) {
  if (ext === 'pdf') return null;
  if (mime && mime.startsWith('image/')) {
    return null; // images: we cannot read text, CLI app passes binary metadata
  }
  if ((mime && mime.startsWith('text/')) || TEXT_EXTENSIONS.has(ext)) {
    try {
      return fs.readFileSync(filePath, 'utf8').slice(0, 40000);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function getChatOwned(chatId, userId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.user_id !== userId) return null;
  return chat;
}

router.get('/chat/:chatId', (req, res) => {
  const chat = getChatOwned(Number(req.params.chatId), req.user.id);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  const files = db
    .prepare('SELECT id, filename, mime_type, size, created_at FROM files WHERE chat_id = ? ORDER BY id')
    .all(chat.id);
  res.json({ files });
});

router.post('/chat/:chatId', upload.single('file'), (req, res) => {
  const chat = getChatOwned(Number(req.params.chatId), req.user.id);
  if (!chat) return res.status(404).json({ error: 'چت پیدا نشد' });
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد' });

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const contentText = extractText(req.file.path, ext, req.file.mimetype);

  if (req.file.mimetype && req.file.mimetype.startsWith('image/')) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'خواندن عکس بر روی این مدل فعلاً پشتیبانی نمیشود' });
  }
  if (!contentText && ext !== 'pdf') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'این نوع فایل قابل پردازش نیست. فقط فایل متنی/کدی پشتیبانی میشود' });
  }

  const info = db
    .prepare(
      'INSERT INTO files (user_id, chat_id, filename, path, mime_type, size, content_text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.user.id,
      chat.id,
      Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      req.file.path,
      req.file.mimetype || 'application/octet-stream',
      req.file.size,
      contentText
    );
  logSystem(req.user.id, 'upload_file', `chat#${chat.id} ${req.file.originalname}`);
  res.json({
    file: {
      id: Number(info.lastInsertRowid),
      filename: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      mime_type: req.file.mimetype,
      size: req.file.size,
      readable: !!contentText
    }
  });
});

router.delete('/:fileId', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.fileId));
  if (!file || file.user_id !== req.user.id) return res.status(404).json({ error: 'فایل پیدا نشد' });
  try {
    fs.unlinkSync(file.path);
  } catch (e) {}
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  res.json({ ok: true });
});

module.exports = router;