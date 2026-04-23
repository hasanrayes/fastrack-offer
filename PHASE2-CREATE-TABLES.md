# PHASE 2 — Create Database Tables

## PREREQUISITE
Phase 1 must be completed first. Verify by checking:
- `db.js` exists in project root
- `pg` is in package.json dependencies
- `node server.js` starts and shows `[DB] PostgreSQL connected successfully`
- If DB is NOT connected, STOP — do not proceed until Phase 1 is confirmed working

## CRITICAL SAFETY RULES — READ BEFORE DOING ANYTHING

1. **DO NOT** delete, rename, or remove ANY existing files
2. **DO NOT** modify dashboard.html or index.html at all
3. **DO NOT** change any existing API routes or their responses
4. **DO NOT** change any frontend-facing behavior
5. **DO NOT** remove any in-memory data stores — they stay as fallback
6. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
7. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
8. Before editing any file, **save a backup**: `cp filename filename.backup`
9. After every change, test that `node server.js` starts without errors

## WHAT THIS PHASE DOES

Creates a new file `schema.js` that defines and creates all PostgreSQL tables.
Runs the schema automatically on server startup (creates tables if they do not exist).

## THE TABLES TO CREATE

Based on the current in-memory data stores in server.js, we need these tables:

### 1. users
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  avatar TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. cars
```sql
CREATE TABLE IF NOT EXISTS cars (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cat TEXT,
  img TEXT,
  price NUMERIC,
  was NUMERIC,
  type TEXT,
  seats INT,
  doors INT,
  transmission TEXT,
  bags INT,
  viewers INT DEFAULT 0,
  spots INT DEFAULT 0,
  badge TEXT,
  feats JSONB DEFAULT '[]',
  includes TEXT,
  active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);
```

### 3. bookings
```sql
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  car_id INT,
  car_name TEXT,
  start_date TEXT,
  end_date TEXT,
  duration INT,
  price_per_month NUMERIC,
  total NUMERIC,
  deposit NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'unpaid',
  payment_method TEXT,
  notes TEXT,
  source TEXT DEFAULT 'website',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. leads
```sql
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  car TEXT,
  car_id INT,
  duration TEXT,
  message TEXT,
  status TEXT DEFAULT 'new',
  source TEXT DEFAULT 'website',
  assigned_to TEXT,
  notes TEXT,
  follow_up_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. promos
```sql
CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT DEFAULT 'percentage',
  value NUMERIC DEFAULT 0,
  min_months INT DEFAULT 1,
  max_uses INT,
  used_count INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6. templates (WhatsApp templates)
```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7. activity_log
```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  details TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
```

### 8. notifications
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT,
  body TEXT,
  read BOOLEAN DEFAULT false,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 9. customer_meta
```sql
CREATE TABLE IF NOT EXISTS customer_meta (
  phone TEXT PRIMARY KEY,
  notes TEXT,
  tags JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 10. site_config
```sql
CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## STEP 1 — Create schema.js

Create a NEW file `schema.js` in the project root. It should:
1. Import `db.js`
2. Export an `initSchema()` async function
3. The function runs all CREATE TABLE IF NOT EXISTS statements
4. Wrap everything in try/catch — if it fails, log the error but do NOT crash the app
5. Return true on success, false on failure

## STEP 2 — Call initSchema on startup

In server.js, after `const db = require('./db');` add:

```javascript
const { initSchema } = require('./schema');
```

Then in the app.listen callback, after `db.testConnection()` succeeds, call:

```javascript
if (dbConnected) {
  const schemaOk = await initSchema();
  if (schemaOk) {
    console.log('[Server] Database schema initialized — all tables ready');
  } else {
    console.error('[Server] Schema initialization failed — running in memory-only mode');
  }
}
```

## STEP 3 — Test

1. Run `node server.js`
2. Confirm you see: `[DB] PostgreSQL connected successfully` then `[Server] Database schema initialized`
3. Confirm landing page and dashboard still work exactly as before
4. Check Railway Postgres Data tab — you should now see all 10 tables (empty)

## STEP 4 — Commit and push

```bash
rm -f .git/index.lock .git/HEAD.lock
git add schema.js server.js
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 2: Create PostgreSQL schema with all tables (users, cars, bookings, leads, etc.)"
git push origin main
```

## WHAT NOT TO DO

- DO NOT insert any data into the tables yet (that is Phase 3)
- DO NOT change any API endpoints
- DO NOT modify dashboard.html or index.html
- DO NOT remove in-memory data stores
- DO NOT drop or alter tables — only CREATE IF NOT EXISTS
