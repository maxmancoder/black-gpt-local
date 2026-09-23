const config = require('../config');

const hits = new Map();

function cleanup() {
  const now = Date.now();
  for (const [key, bucket] of hits) {
    if (now - bucket.start > config.rateLimitWindowMs) hits.delete(key);
  }
}

function rateLimit(req, res, next) {
  cleanup();
  const key = req.user ? `u${req.user.id}` : `ip${req.ip}`;
  const now = Date.now();
  let bucket = hits.get(key);
  if (!bucket || now - bucket.start > config.rateLimitWindowMs) {
    bucket = { start: now, count: 0 };
    hits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > config.rateLimitMax) {
    const retry = Math.ceil((bucket.start + config.rateLimitWindowMs - now) / 1000);
    return res.status(429).json({ error: `درخواست زیاد است. ${retry} ثانیه دیگر دوباره تلاش کنید.` });
  }
  next();
}

module.exports = { rateLimit };