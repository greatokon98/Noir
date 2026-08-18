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

// Schema initialization — runs once on cold start
let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  const fs = require('fs');
  const path = require('path');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
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
