// index.js
// Express app: public API + Luxury-styled server-rendered admin.

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { ensureSchema } = require('./db');

const { sessionConfig } = require('./auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Request logging (production) -------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: duration,
        ip: req.ip
      };
      if (res.statusCode >= 500) {
        console.error(JSON.stringify(entry));
      } else {
        console.log(JSON.stringify(entry));
      }
    });
    next();
  });
}

// --- CSP: per-route policies ------------------------------------------------
const adminCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});
const landingCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Session middleware — wrapped to survive store/DB failures on cold start
const sess = session(sessionConfig);
app.use((req, res, next) => {
  sess(req, res, (err) => {
    if (err) {
      console.error('Session middleware error:', err.message);
      req.session = {};
    }
    next();
  });
});

// Vercel serves static from public/ — express.static used for local dev only
app.use(express.static(path.join(__dirname, '../public')));

// --- Health check endpoints -------------------------------------------------
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/readyz', async (req, res) => {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', db: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'not ready', db: 'error', error: err.message });
  }
});

// --- CORS: configurable origins ---------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length > 0 && origin && allowedOrigins.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    return res.status(403).json({ error: 'Cross-origin requests not allowed.' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api', publicRoutes);

// Admin CSP applied per-route
app.use('/admin', adminCsp, adminRoutes);

// Landing page — served from public/ on Vercel, or from root in dev
app.get('/', landingCsp, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/luxury-gym-landing.html'));
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 404 for unknown admin pages
app.use((req, res) => {
  res.status(404).send('Not found.');
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Something went wrong on our side.');
});

// --- Schema init (idempotent — runs on all environments) ---------------------
ensureSchema().catch((err) => {
  console.error('Schema init failed:', err.message);
});

// --- Server startup ---------------------------------------------------------
// On Vercel: app is exported as a serverless function (no listen needed).
// Locally: app.listen for development.
if (!process.env.VERCEL) {
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  let server;
  let isShuttingDown = false;

  function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully...`);
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000).unref();
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  ensureSchema().then(() => {
    server = app.listen(PORT, () => {
      console.log(`NOIR admin + API running at http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to initialize database:', err.message);
  });
}

module.exports = app;
