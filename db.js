const { Pool } = require('pg');

// Railway provides DATABASE_URL automatically
const connectionString = process.env.DATABASE_URL;

let pool = null;
let dbReady = false;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Railway requires SSL
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
} else {
  console.warn('[DB] No DATABASE_URL found — running in memory-only mode');
}

async function testConnection() {
  if (!pool) {
    console.warn('[DB] No pool available — skipping connection test');
    return false;
  }
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    console.log('[DB] PostgreSQL connected successfully at:', result.rows[0].current_time);
    dbReady = true;
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    dbReady = false;
    return false;
  }
}

function isReady() {
  return dbReady;
}

function getPool() {
  return pool;
}

async function query(text, params) {
  if (!pool) throw new Error('Database not available');
  return pool.query(text, params);
}

module.exports = { testConnection, isReady, getPool, query };
