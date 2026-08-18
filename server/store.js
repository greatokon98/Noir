// store.js
// PostgreSQL-backed rate limiter for serverless environments.

const { pool } = require('./db');

// ---- Rate limiter ----------------------------------------------------------
// Atomic upsert: single round-trip, works in serverless.

async function checkRateLimit(key, windowMs, max) {
  const res = await pool.query(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES ($1, 1, NOW() + ($2 || ' ms')::INTERVAL)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.reset_at > NOW() THEN rate_limits.count + 1
         ELSE 1
       END,
       reset_at = CASE
         WHEN rate_limits.reset_at > NOW() THEN rate_limits.reset_at
         ELSE NOW() + ($2 || ' ms')::INTERVAL
       END
     RETURNING count, reset_at`,
    [key, String(windowMs)]
  );
  const row = res.rows[0];
  return { count: row.count, resetAt: row.reset_at };
}

// Rate limiter middleware factory
function createRateLimiter(opts) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max || 5;
  const onRejected = opts.onRejected || ((req, res) => {
    res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  });

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { count } = await checkRateLimit(ip, windowMs, max);
      if (count > max) {
        return onRejected(req, res);
      }
      next();
    } catch (err) {
      // If rate limiting DB fails, let the request through
      console.error('Rate limit error:', err.message);
      next();
    }
  };
}

// Cleanup old rate limit entries (run periodically or via cron)
async function cleanupRateLimits() {
  try {
    await pool.query('DELETE FROM rate_limits WHERE reset_at < NOW()');
  } catch (_) {}
}

module.exports = { createRateLimiter, checkRateLimit, cleanupRateLimits };
