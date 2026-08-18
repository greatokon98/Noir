// auth.js
// Session auth, login middleware, and CSRF protection for the NOIR admin.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const expressSession = require('express-session');
const PgSession = require('connect-pg-simple')(expressSession);
const { pool } = require('./db');

// --- Session config ---------------------------------------------------------

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARN: SESSION_SECRET not set — using random fallback.');
}

if (process.env.NODE_ENV === 'production') {
  if (!process.env.SMTP_HOST) {
    console.warn('WARN: SMTP not configured — email alerts on new leads will be silent.');
  }
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn('WARN: ADMIN_EMAIL/ADMIN_PASSWORD not set — seed will use defaults.');
  }
}

const sessionConfig = {
  name: 'noir.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new PgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
};

// Generates a per-session CSRF token and exposes it to templates via res.locals.
sessionConfig.store.on('error', (err) => {
  console.error('Session store error:', err.message);
});

function ensureCsrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Rejects state-changing requests that do not carry the session CSRF token.
function csrfProtection(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(req.method) !== -1) {
    const token = req.body && req.body._csrf;
    const expected = req.session.csrfToken;
    if (!token || !expected || token.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return res.status(403).send('Invalid or missing CSRF token.');
    }
  }
  next();
}

// Blocks access to admin pages until a valid session exists.
async function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/admin/login');
  }
  const { get } = require('./db');
  const admin = await get(
    'SELECT id, email, name, role FROM admins WHERE id = $1',
    [req.session.userId]
  );
  if (!admin) {
    req.session.destroy();
    return res.redirect('/admin/login');
  }
  req.admin = admin;
  res.locals.admin = admin;
  next();
}

// Owner-only gate for admin account management.
function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== 'owner') {
    return res.status(403).send('Owner access required.');
  }
  next();
}

// Verifies an email/password pair against the admins table.
async function authenticate(email, password) {
  const { get } = require('./db');
  const admin = await get('SELECT * FROM admins WHERE email = $1', [
    String(email || '').trim().toLowerCase()
  ]);
  if (!admin) return null;
  const ok = await bcrypt.compare(String(password || ''), admin.password_hash);
  return ok ? admin : null;
}

module.exports = {
  sessionConfig,
  ensureCsrf,
  csrfProtection,
  requireLogin,
  requireOwner,
  authenticate
};
