// db.js
// PostgreSQL connection pool via @neondatabase/serverless

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('Unexpected pool idle error:', err.message);
});

// Schema initialization — embedded directly (Vercel bundler can't resolve fs.readFileSync)
let schemaReady = false;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  preferred_time TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'tour',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  tier_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS membership_tiers (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price_monthly INTEGER,
  billing_label TEXT NOT NULL,
  tagline TEXT NOT NULL,
  features_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  published BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  cover_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess JSONB NOT NULL,
  expired TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions (expired);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
`;

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(SCHEMA_SQL);
  schemaReady = true;
}

// Query helper: pool.query with text + params
async function query(text, params) {
  return pool.query(text, params);
}

// Get a single row
async function get(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

// Get all rows
async function all(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Run an insert/update/delete and return info
async function run(text, params) {
  const res = await pool.query(text, params);
  return { changes: res.rowCount, lastInsertRowid: res.rows[0] ? res.rows[0].id : null };
}

// Transaction helper
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, get, all, run, transaction, ensureSchema };
