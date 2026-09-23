const path = require('path');
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

app.use(express.static(config.clientDir));

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