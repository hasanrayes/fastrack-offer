# PHASE 1 — PostgreSQL Database Connection

## CRITICAL SAFETY RULES — READ BEFORE DOING ANYTHING

1. **DO NOT** delete, rename, or remove ANY existing files
2. **DO NOT** modify dashboard.html or index.html at all
3. **DO NOT** change any existing API routes or their responses
4. **DO NOT** change any frontend-facing behavior
5. **DO NOT** remove any in-memory data stores yet — they stay as fallback
6. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
7. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
8. Before editing server.js, **save a backup**: `cp server.js server.js.backup`
9. After every change, test that `node server.js` starts without errors
10. After every change, test that the landing page loads at http://localhost:3000
11. After every change, test that the dashboard login works at http://localhost:3000/dashboard.html

## WHAT THIS PHASE DOES

This phase ONLY does 3 things:
1. Installs the `pg` npm package
2. Creates a new file `db.js` with a PostgreSQL connection pool
3. Adds a startup connection test in server.js (logs success/failure, does NOT break the app if DB is unavailable)

## STEP 1 — Install pg package

```bash
npm install pg
```

This will add `pg` to package.json dependencies.

## STEP 2 — Create db.js file

Create a NEW file called `db.js` in the project root with this exact content:

```javascript
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
```

## STEP 3 — Add connection test to server.js

At the TOP of server.js, after the existing require statements (after line 6), add:

```javascript
const db = require('./db');
```

Then find the `app.listen(PORT, ...)` at the bottom of server.js. It currently looks something like:

```javascript
app.listen(PORT, () => {
  console.log(`Fastrack server running on port ${PORT}`);
});
```

Change it to:

```javascript
app.listen(PORT, async () => {
  console.log(`Fastrack server running on port ${PORT}`);
  
  // Test database connection (non-blocking, app works without DB)
  const dbConnected = await db.testConnection();
  if (dbConnected) {
    console.log('[Server] Database ready — future phases will migrate data to PostgreSQL');
  } else {
    console.log('[Server] Running in memory-only mode — all data stored in RAM (resets on restart)');
  }
});
```

Also add a health check endpoint. Add this BEFORE the app.listen line:

```javascript
// Database health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: db.isReady() ? 'connected' : 'not connected (memory-only mode)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

## STEP 4 — Test everything

1. Run `node server.js` and confirm it starts without errors
2. Check the console output — it should say either:
   - `[DB] PostgreSQL connected successfully` (if DATABASE_URL is set)
   - `[DB] No DATABASE_URL found — running in memory-only mode` (if running locally)
3. Open http://localhost:3000 and confirm the landing page loads
4. Open http://localhost:3000/dashboard.html and confirm login works with admin@fastrack.ae / fastrack2024
5. Visit http://localhost:3000/api/health and confirm it returns JSON

## STEP 5 — Commit and push

```bash
rm -f .git/index.lock .git/HEAD.lock
git add db.js package.json package-lock.json server.js
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 1: Add PostgreSQL connection module (db.js) and health check endpoint"
git push origin main
```

## WHAT NOT TO DO

- DO NOT create any database tables yet (that is Phase 2)
- DO NOT migrate any data yet (that is Phase 3)
- DO NOT change any API endpoints behavior
- DO NOT modify dashboard.html or index.html
- DO NOT remove the in-memory data stores (let, cars, bookings, leads, etc.)
- DO NOT change the authentication system
- DO NOT install any other packages besides `pg`
