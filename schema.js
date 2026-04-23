const db = require('./db');

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    avatar TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS cars (
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
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
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
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
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
  )`,
  `CREATE TABLE IF NOT EXISTS promos (
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
  )`,
  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT,
    title TEXT,
    body TEXT,
    read BOOLEAN DEFAULT false,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS customer_meta (
    phone TEXT PRIMARY KEY,
    notes TEXT,
    tags JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS site_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`
];

async function initSchema() {
  try {
    for (const sql of statements) {
      await db.query(sql);
    }
    console.log('[Schema] All tables verified/created successfully');
    return true;
  } catch (err) {
    console.error('[Schema] Initialization error:', err.message);
    return false;
  }
}

module.exports = { initSchema };
