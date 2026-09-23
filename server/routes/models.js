const express = require('express');
const { db } = require('../database/database');
const { requireAuth } = require('../middleware/auth');
const lmstudio = require('../services/lmstudio');

const router = express.Router();
router.use(requireAuth);

function syncLocalCache() {
  const rows = db.prepare('SELECT model_key FROM models').all();
  return new Set(rows.map((r) => r.model_key));
}

router.get('/status', async (req, res) => {
  const status = await lmstudio.getStatus();
  res.json(status);
});

router.get('/', async (req, res) => {
  const status = await lmstudio.getStatus();
  const cached = syncLocalCache();
  const jsModels = [];
  for (const id of status.models) {
    const row = db.prepare('SELECT * FROM models WHERE model_key = ?').get(id);
    let enabled = true;
    if (req.user.role !== 'admin') {
      const perm = db
        .prepare('SELECT enabled FROM user_model_permissions WHERE user_id = ? AND model_key = ?')
        .get(req.user.id, id);
      if (perm) enabled = !!perm.enabled;
    }
    if (row && !row.enabled) enabled = false;
    jsModels.push({
      id: id,
      name: (row && row.display_name) || id,
      enabled
    });
    if (!cached.has(id)) {
      db.prepare('INSERT OR IGNORE INTO models (model_key, display_name, enabled) VALUES (?, ?, 1)').run(id, id);
    }
  }
  res.json({
    online: status.online,
    models: jsModels
  });
});

module.exports = router;