const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
let helmet;
try { helmet = require('helmet'); } catch(e) { helmet = null; }
const db = require('./db');
const { initSchema } = require('./schema');
const { seedDefaults, DEFAULT_SITE_CONFIG } = require('./seed');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'fastrack2024';
const JWT_SECRET = process.env.JWT_SECRET || 'fastrack-jwt-secret-2024-prod';
const JWT_EXPIRY = '24h';
const JWT_REFRESH_EXPIRY = '7d';
const RAILWAY_URL = process.env.RAILWAY_STATIC_URL || '';

// ── Security middleware ──
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false
  }));
}

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = ['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT];
  if (RAILWAY_URL) allowed.push('https://' + RAILWAY_URL);
  if (!origin || allowed.some(a => origin.startsWith(a)) || origin.includes('railway.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-token');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ── Uploads directory ──
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ── Rate limiter (in-memory) ──
const rateLimitMap = new Map();
function rateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    let entry = rateLimitMap.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { count: 1, start: now };
      rateLimitMap.set(key, entry);
      return next();
    }
    entry.count++;
    if (entry.count > maxAttempts) {
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    next();
  };
}
// Cleanup stale entries every 5 min
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [k, v] of rateLimitMap) { if (v.start < cutoff) rateLimitMap.delete(k); }
}, 300000);

// ── Input sanitizer (deep recursive) ──
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<(?!\/?(?:strong|span|em|b|i|u|br|sub|sup)\b)[^>]*>/gi, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim();
}
function deepSanitize(obj) {
  if (typeof obj === 'string') return sanitize(obj);
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) { obj[key] = deepSanitize(obj[key]); }
  }
  return obj;
}
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = deepSanitize(req.body);
  next();
}
app.use(sanitizeBody);

// ── HTTPS redirect for production ──
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ── Utility ──
async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

// Verify a password against a stored hash. Supports both legacy SHA-256 (64 hex chars)
// and bcrypt hashes. When a SHA-256 match succeeds, returns an upgradedHash so the
// caller can persist the bcrypt version.
async function comparePassword(pw, hash) {
  if (!hash) return { match: false };
  if (typeof hash === 'string' && hash.length === 64 && /^[0-9a-f]+$/i.test(hash)) {
    const sha256 = crypto.createHash('sha256').update(pw).digest('hex');
    if (sha256 === hash) {
      const upgradedHash = await bcrypt.hash(pw, 12);
      return { match: true, upgradedHash };
    }
    return { match: false };
  }
  const match = await bcrypt.compare(pw, hash);
  return { match };
}

function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ── Ephemeral in-memory state (session/rate-limit only — not business data) ──
let refreshTokens = new Map();
let resetTokens = new Map();

// ── Status whitelists ──
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const VALID_BOOKING_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled'];

// Async user-name lookup for activity log (cached per call)
async function getUserForLog(userId) {
  if (!userId || userId === 'system' || !db.isReady()) return null;
  try {
    const { rows } = await db.query('SELECT id, name, role FROM users WHERE id = $1 LIMIT 1', [userId]);
    return rows[0] || null;
  } catch { return null; }
}

function addNotification(type, title, body, userId) {
  if (!db.isReady()) return;
  const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  db.query('INSERT INTO notifications (id, type, title, body, read, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, type, title, body, false, userId || null])
    .catch(err => console.error('[DB] notification insert failed:', err.message));
}

// ── Activity Logger (DB-only; fire-and-forget) ──
function logActivity(userId, action, details) {
  if (!db.isReady()) return;
  const id = generateId('act');
  getUserForLog(userId).then(user => {
    return db.query('INSERT INTO activity_log (id, user_id, user_name, user_role, action, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, userId || null, user ? user.name : 'System', user ? user.role : 'system', action, details]);
  }).catch(err => console.error('[DB] activity log write failed:', err.message));
}

// ── Row mappers (DB columns → API/memory shape) ──
function mapUserRow(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatar: u.avatar, createdAt: u.created_at, passwordHash: u.password_hash };
}
function mapCarRowFull(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, cat: r.cat || '', img: r.img || '',
    imgCard: r.img_card || '', imgBooking: r.img_booking || '',
    price: Number(r.price), was: Number(r.was),
    type: r.type || '', seats: r.seats || null, doors: r.doors || null,
    transmission: r.transmission || '', bags: r.bags || null,
    viewers: r.viewers || 0, spots: r.spots || 0,
    badge: r.badge || '', feats: Array.isArray(r.feats) ? r.feats : [],
    includes: r.includes || '',
    description: r.description || '', year: r.year || '', color: r.color || '',
    mileage: r.mileage || '', fuelType: r.fuel_type || 'Petrol',
    insuranceExpiry: r.insurance_expiry || '', registrationExpiry: r.registration_expiry || '',
    lastServiceDate: r.last_service_date || '', nextServiceDue: r.next_service_due || '',
    active: r.active, order: r.sort_order || 0,
    trans: r.transmission || 'Auto'
  };
}
function mapBookingRow(b) {
  if (!b) return null;
  return {
    id: b.id, ref: b.ref, carId: b.car_id, carName: b.car_name || '',
    startDate: b.start_date || '', endDate: b.end_date || '',
    duration: b.duration != null ? String(b.duration) : '',
    location: b.location || '',
    fullName: b.customer_name || '', phone: b.customer_phone || '',
    email: b.customer_email || '', whatsapp: b.whatsapp || '',
    totalAed: Number(b.total) || 0, savedAed: Number(b.saved_aed) || 0,
    promoCode: b.promo_code || '', promoDiscount: Number(b.promo_discount) || 0,
    paymentStatus: b.payment_status || 'unpaid',
    amountPaid: Number(b.amount_paid) || 0,
    paymentMethod: b.payment_method || '',
    paymentNotes: b.payment_notes || '',
    paymentHistory: Array.isArray(b.payment_history) ? b.payment_history : [],
    invoiceNumber: b.invoice_number || '',
    invoiceGeneratedAt: b.invoice_generated_at || null,
    status: b.status || 'pending',
    notes: Array.isArray(b.notes_data) ? b.notes_data : [],
    type: 'booking', createdAt: b.created_at
  };
}
function mapLeadRow(l) {
  if (!l) return null;
  return {
    id: l.id, fullName: l.name || '', phone: l.phone || '',
    whatsapp: l.whatsapp || l.phone || '', email: l.email || '',
    interest: l.car || '', address: l.address || '',
    source: l.source || 'website', status: l.status || 'new',
    notes: Array.isArray(l.notes_data) ? l.notes_data : [],
    convertedToBooking: !!l.converted_to_booking,
    createdAt: l.created_at
  };
}
function mapPromoRow(p) {
  if (!p) return null;
  return {
    id: p.id, code: p.code,
    discountType: p.type || 'percentage', value: Number(p.value) || 0,
    minDuration: p.min_months || 0, maxUses: p.max_uses || 0,
    usageCount: p.used_count || 0,
    expiryDate: p.expires_at || '',
    active: p.active !== false, createdAt: p.created_at
  };
}
function mapTemplateRow(t) {
  if (!t) return null;
  return { id: t.id, name: t.name, category: t.category || 'custom', body: t.body, createdAt: t.created_at };
}
function mapNotificationRow(n) {
  if (!n) return null;
  return { id: n.id, type: n.type, title: n.title, body: n.body, read: n.read, userId: n.user_id, createdAt: n.created_at };
}
function mapActivityRow(r) {
  return { id: r.id, userId: r.user_id, userName: r.user_name, userRole: r.user_role, action: r.action, details: r.details, timestamp: r.created_at };
}

// ── DB CRUD helpers ──
const CAR_COLS = `id, name, cat, img, img_card, img_booking, price, was, type, seats, doors, transmission, bags, viewers, spots, badge, feats, includes, description, year, color, mileage, fuel_type, insurance_expiry, registration_expiry, last_service_date, next_service_due, active, sort_order`;

async function insertCar(c) {
  const { rows } = await db.query(
    `INSERT INTO cars (name, cat, img, img_card, img_booking, price, was, type, seats, doors, transmission, bags, viewers, spots, badge, feats, includes, description, year, color, mileage, fuel_type, insurance_expiry, registration_expiry, last_service_date, next_service_due, active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING *`,
    [c.name, c.cat || '', c.img || '', c.imgCard || '', c.imgBooking || '', Number(c.price), Number(c.was) || Number(c.price), c.type || '', c.seats || null, c.doors || null, c.transmission || 'Automatic', c.bags || null, c.viewers || 0, c.spots || 0, c.badge || '', JSON.stringify(c.feats || []), c.includes || '', c.description || '', c.year || '', c.color || '', c.mileage || '', c.fuelType || 'Petrol', c.insuranceExpiry || '', c.registrationExpiry || '', c.lastServiceDate || '', c.nextServiceDue || '', c.active !== false, c.order || 0]
  );
  return mapCarRowFull(rows[0]);
}

async function updateCarById(id, patch) {
  const m = {
    name: 'name', cat: 'cat', img: 'img', imgCard: 'img_card', imgBooking: 'img_booking',
    price: 'price', was: 'was', type: 'type', seats: 'seats', doors: 'doors',
    transmission: 'transmission', bags: 'bags', viewers: 'viewers', spots: 'spots',
    badge: 'badge', feats: 'feats', includes: 'includes', description: 'description',
    year: 'year', color: 'color', mileage: 'mileage', fuelType: 'fuel_type',
    insuranceExpiry: 'insurance_expiry', registrationExpiry: 'registration_expiry',
    lastServiceDate: 'last_service_date', nextServiceDue: 'next_service_due',
    active: 'active', order: 'sort_order'
  };
  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(m)) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'feats') v = JSON.stringify(Array.isArray(v) ? v : []);
    else if (['price','was'].includes(k)) v = Number(v);
    else if (['seats','doors','bags','viewers','spots','order'].includes(k)) v = v === null || v === '' ? null : Number(v);
    sets.push(`${col} = $${i++}`); vals.push(v);
  }
  if (!sets.length) { const { rows } = await db.query('SELECT * FROM cars WHERE id = $1', [id]); return mapCarRowFull(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE cars SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapCarRowFull(rows[0]);
}

async function insertBooking(b) {
  const { rows } = await db.query(
    `INSERT INTO bookings (ref, customer_name, customer_email, customer_phone, whatsapp, car_id, car_name, start_date, end_date, duration, location, total, saved_aed, promo_code, promo_discount, status, payment_status, payment_method, source, notes_data, payment_history)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb) RETURNING *`,
    [b.ref, b.fullName || '', b.email || '', b.phone || '', b.whatsapp || '', b.carId || null, b.carName || '', b.startDate || '', b.endDate || '', parseInt(b.duration) || null, b.location || '', Number(b.totalAed) || 0, Number(b.savedAed) || 0, b.promoCode || '', Number(b.promoDiscount) || 0, b.status || 'pending', b.paymentStatus || 'unpaid', b.paymentMethod || '', b.source || 'website', JSON.stringify(b.notes || []), JSON.stringify(b.paymentHistory || [])]
  );
  return mapBookingRow(rows[0]);
}

async function updateBookingById(id, patch) {
  const m = {
    ref: 'ref', fullName: 'customer_name', email: 'customer_email', phone: 'customer_phone',
    whatsapp: 'whatsapp', carId: 'car_id', carName: 'car_name',
    startDate: 'start_date', endDate: 'end_date', duration: 'duration', location: 'location',
    totalAed: 'total', savedAed: 'saved_aed', promoCode: 'promo_code', promoDiscount: 'promo_discount',
    status: 'status', paymentStatus: 'payment_status', paymentMethod: 'payment_method',
    paymentNotes: 'payment_notes', amountPaid: 'amount_paid',
    invoiceNumber: 'invoice_number', invoiceGeneratedAt: 'invoice_generated_at'
  };
  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(m)) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (['totalAed','savedAed','promoDiscount','amountPaid'].includes(k)) v = Number(v) || 0;
    else if (k === 'duration') v = v === null || v === '' ? null : parseInt(v);
    else if (k === 'carId') v = v === null || v === '' ? null : Number(v);
    sets.push(`${col} = $${i++}`); vals.push(v);
  }
  if (patch.paymentHistory !== undefined) { sets.push(`payment_history = $${i++}::jsonb`); vals.push(JSON.stringify(patch.paymentHistory || [])); }
  if (patch.notes !== undefined) { sets.push(`notes_data = $${i++}::jsonb`); vals.push(JSON.stringify(patch.notes || [])); }
  sets.push('updated_at = NOW()');
  if (sets.length === 1) { const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]); return mapBookingRow(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE bookings SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapBookingRow(rows[0]);
}

async function insertLead(l) {
  const { rows } = await db.query(
    `INSERT INTO leads (name, email, phone, whatsapp, car, address, source, status, notes_data, converted_to_booking)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
    [l.fullName || '', l.email || '', l.phone || '', l.whatsapp || l.phone || '', l.interest || '', l.address || '', l.source || 'website', l.status || 'new', JSON.stringify(l.notes || []), !!l.convertedToBooking]
  );
  return mapLeadRow(rows[0]);
}

async function updateLeadById(id, patch) {
  const m = {
    fullName: 'name', email: 'email', phone: 'phone', whatsapp: 'whatsapp',
    interest: 'car', address: 'address', source: 'source', status: 'status',
    convertedToBooking: 'converted_to_booking'
  };
  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(m)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = $${i++}`); vals.push(patch[k]);
  }
  if (patch.notes !== undefined) { sets.push(`notes_data = $${i++}::jsonb`); vals.push(JSON.stringify(patch.notes || [])); }
  sets.push('updated_at = NOW()');
  if (sets.length === 1) { const { rows } = await db.query('SELECT * FROM leads WHERE id = $1', [id]); return mapLeadRow(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapLeadRow(rows[0]);
}

async function insertPromo(p) {
  const { rows } = await db.query(
    `INSERT INTO promos (id, code, type, value, min_months, max_uses, used_count, active, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [p.id || generateId('promo'), p.code.toUpperCase(), p.discountType || 'percentage', Number(p.value) || 0, Number(p.minDuration) || 0, Number(p.maxUses) || null, Number(p.usageCount) || 0, p.active !== false, p.expiryDate ? new Date(p.expiryDate) : null]
  );
  return mapPromoRow(rows[0]);
}

async function updatePromoById(id, patch) {
  const m = {
    code: 'code', discountType: 'type', value: 'value',
    minDuration: 'min_months', maxUses: 'max_uses', usageCount: 'used_count',
    active: 'active'
  };
  const sets = []; const vals = []; let i = 1;
  for (const [k, col] of Object.entries(m)) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'code') v = String(v).toUpperCase();
    if (['value','minDuration','maxUses','usageCount'].includes(k)) v = Number(v) || 0;
    sets.push(`${col} = $${i++}`); vals.push(v);
  }
  if (patch.expiryDate !== undefined) { sets.push(`expires_at = $${i++}`); vals.push(patch.expiryDate ? new Date(patch.expiryDate) : null); }
  if (!sets.length) { const { rows } = await db.query('SELECT * FROM promos WHERE id = $1', [id]); return mapPromoRow(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE promos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapPromoRow(rows[0]);
}

async function insertTemplate(t) {
  const { rows } = await db.query(
    `INSERT INTO templates (id, name, category, body) VALUES ($1,$2,$3,$4) RETURNING *`,
    [t.id || generateId('tpl'), t.name, t.category || 'custom', t.body]
  );
  return mapTemplateRow(rows[0]);
}

async function updateTemplateById(id, patch) {
  const sets = []; const vals = []; let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
  if (patch.category !== undefined) { sets.push(`category = $${i++}`); vals.push(patch.category); }
  if (patch.body !== undefined) { sets.push(`body = $${i++}`); vals.push(patch.body); }
  if (!sets.length) { const { rows } = await db.query('SELECT * FROM templates WHERE id = $1', [id]); return mapTemplateRow(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE templates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapTemplateRow(rows[0]);
}

async function insertUser(u) {
  const { rows } = await db.query(
    `INSERT INTO users (id, email, password_hash, name, role, avatar, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [u.id || generateId('usr'), u.email.toLowerCase(), u.passwordHash, u.name, u.role || 'viewer', u.avatar || null, u.active !== false]
  );
  return mapUserRow(rows[0]);
}

async function updateUserById(id, patch) {
  const sets = []; const vals = []; let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
  if (patch.email !== undefined) { sets.push(`email = $${i++}`); vals.push(String(patch.email).toLowerCase()); }
  if (patch.role !== undefined) { sets.push(`role = $${i++}`); vals.push(patch.role); }
  if (patch.active !== undefined) { sets.push(`active = $${i++}`); vals.push(patch.active); }
  if (patch.avatar !== undefined) { sets.push(`avatar = $${i++}`); vals.push(patch.avatar); }
  if (patch.passwordHash !== undefined) { sets.push(`password_hash = $${i++}`); vals.push(patch.passwordHash); }
  if (!sets.length) { const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]); return mapUserRow(rows[0]); }
  vals.push(id);
  const { rows } = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return mapUserRow(rows[0]);
}

async function syncSiteConfigToDb(cfg) {
  if (!db.isReady()) return;
  try {
    await db.query(
      `INSERT INTO site_config (key, value, updated_at) VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(cfg)]
    );
  } catch (err) { console.error('[DB] site_config sync failed:', err.message); }
}

async function loadSiteConfigFromDb() {
  if (!db.isReady()) return null;
  try {
    const { rows } = await db.query(`SELECT value FROM site_config WHERE key = 'main' LIMIT 1`);
    return rows[0] ? rows[0].value : null;
  } catch (err) { console.error('[DB] site_config load failed:', err.message); return null; }
}

// ── JWT Auth Middleware (DB-backed) ──
async function jwtAuth(req, res, next) {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-admin-token']) {
    if (req.headers['x-admin-token'] === ADMIN_PASS) {
      try {
        const { rows } = await db.query(`SELECT * FROM users WHERE id = 'usr_admin' OR role = 'superadmin' ORDER BY created_at LIMIT 1`);
        if (rows[0]) { req.user = mapUserRow(rows[0]); return next(); }
      } catch (err) { return res.status(503).json({ error: 'Database unavailable' }); }
      return res.status(401).json({ error: 'Admin user not found' });
    }
  }
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let decoded;
  try { decoded = jwt.verify(token, JWT_SECRET); }
  catch (err) { return res.status(401).json({ error: 'Invalid or expired token' }); }
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND active = true LIMIT 1', [decoded.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'User not found or deactivated' });
    req.user = mapUserRow(rows[0]);
    next();
  } catch (err) {
    console.error('[Auth] DB error:', err.message);
    return res.status(503).json({ error: 'Database unavailable' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function auth(req, res, next) {
  return jwtAuth(req, res, next);
}

// ══════════════════════════════
// PUBLIC API
// ══════════════════════════════

app.get('/api/cars', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const result = await db.query('SELECT * FROM cars WHERE active = true ORDER BY sort_order');
    res.json(result.rows.map(mapCarRowFull));
  } catch (err) {
    console.error('[API] GET /api/cars', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { fullName, phone, interest, source, whatsapp, email, address } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  try {
    const lead = await insertLead({
      fullName, phone, whatsapp: whatsapp || phone, email: email || '',
      interest: interest || '', address: address || '', source: source || 'popup',
      status: 'new', notes: [], convertedToBooking: false
    });
    logActivity('system', 'lead_created', `New lead: ${fullName} (${phone})`);
    addNotification('lead', 'New Lead', `${fullName} (${phone}) — ${interest || 'General'}`);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('[API] POST /api/leads', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/bookings', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { carId, carName, startDate, endDate, duration, location, fullName, phone, email, whatsapp, totalAed, savedAed, promoCode, promoDiscount } = req.body;
  if (!carName || !fullName || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ref = 'FT-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  try {
    const booking = await insertBooking({
      ref, carId: carId || null, carName,
      startDate: startDate || '', endDate: endDate || '', duration: duration || '3',
      location: location || '', fullName, phone, email: email || '', whatsapp: whatsapp || '',
      totalAed: totalAed || 0, savedAed: savedAed || 0,
      promoCode: promoCode || '', promoDiscount: promoDiscount || 0,
      paymentStatus: 'unpaid', paymentMethod: '', status: 'pending',
      notes: [], paymentHistory: [], source: 'website'
    });
    // Match lead by phone → mark converted
    try {
      await db.query(
        `UPDATE leads SET converted_to_booking = true, updated_at = NOW() WHERE phone = $1 AND converted_to_booking = false`,
        [phone]
      );
    } catch (err) { console.error('[API] lead convert update failed:', err.message); }
    // Increment promo used_count
    if (promoCode) {
      try {
        await db.query(
          `UPDATE promos SET used_count = COALESCE(used_count,0) + 1 WHERE UPPER(code) = UPPER($1) AND active = true`,
          [promoCode]
        );
      } catch (err) { console.error('[API] promo increment failed:', err.message); }
    }
    logActivity('system', 'booking_created', `New booking: ${ref} - ${fullName} for ${carName}`);
    addNotification('booking', 'New Booking', `${ref} — ${fullName} booked ${carName}`);
    res.json({ success: true, ref, booking });
  } catch (err) {
    console.error('[API] POST /api/bookings', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// AUTH API
// ══════════════════════════════

app.post('/api/auth/login', rateLimit(5, 60000), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND active = true LIMIT 1',
      [email]
    );
    const user = rows[0] ? mapUserRow(rows[0]) : null;
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const pwCheck = await comparePassword(password, user.passwordHash);
    if (!pwCheck.match) return res.status(401).json({ error: 'Invalid email or password' });
    if (pwCheck.upgradedHash) {
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [pwCheck.upgradedHash, user.id]);
      console.log('[Auth] Upgraded password hash to bcrypt for:', user.email);
    }
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: rememberMe ? '7d' : JWT_EXPIRY
    });
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpiry = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    refreshTokens.set(refreshToken, { userId: user.id, expiresAt: Date.now() + refreshExpiry });
    logActivity(user.id, 'login', `${user.name} logged in`);
    res.json({
      success: true, accessToken, refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar }
    });
  } catch (err) {
    console.error('[API] POST /api/auth/login', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { password } = req.body;
  if (password !== ADMIN_PASS) return res.status(401).json({ error: 'Invalid password' });
  try {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE id = 'usr_admin' OR role = 'superadmin' ORDER BY created_at LIMIT 1`
    );
    if (!rows[0]) return res.status(401).json({ error: 'Admin user not found' });
    const user = mapUserRow(rows[0]);
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ success: true, token: ADMIN_PASS, accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('[API] POST /api/auth', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', jwtAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) refreshTokens.delete(refreshToken);
  logActivity(req.user.id, 'logout', `${req.user.name} logged out`);
  res.json({ success: true });
});

app.post('/api/auth/refresh', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
  const tokenData = refreshTokens.get(refreshToken);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    refreshTokens.delete(refreshToken);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND active = true LIMIT 1', [tokenData.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'User not found' });
    const user = mapUserRow(rows[0]);
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ success: true, accessToken });
  } catch (err) {
    console.error('[API] POST /api/auth/refresh', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', jwtAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, avatar: req.user.avatar, active: req.user.active, createdAt: req.user.createdAt });
});

app.post('/api/auth/reset-request', rateLimit(3, 60000), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { email } = req.body;
  if (!email) return res.json({ success: true, message: 'If the email exists, a reset link has been generated' });
  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND active = true LIMIT 1',
      [email]
    );
    if (!rows[0]) return res.json({ success: true, message: 'If the email exists, a reset link has been generated' });
    const user = mapUserRow(rows[0]);
    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 3600000 });
    logActivity(user.id, 'password_reset_requested', `Password reset requested for ${user.email}`);
    res.json({ success: true, message: 'Reset token generated', resetToken: token });
  } catch (err) {
    console.error('[API] POST /api/auth/reset-request', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  const tokenData = resetTokens.get(token);
  if (!tokenData || tokenData.expiresAt < Date.now()) { resetTokens.delete(token); return res.status(400).json({ error: 'Invalid or expired reset token' }); }
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [tokenData.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const user = mapUserRow(rows[0]);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), user.id]);
    resetTokens.delete(token);
    logActivity(user.id, 'password_reset', `Password was reset for ${user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] POST /api/auth/reset-password', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// TEAM MANAGEMENT
// ══════════════════════════════

app.get('/api/team', jwtAuth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const result = await db.query('SELECT id, email, name, role, active, avatar, created_at FROM users ORDER BY created_at');
    res.json(result.rows.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatar: u.avatar, createdAt: u.created_at })));
  } catch (err) {
    console.error('[API] GET /api/team', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/team', jwtAuth, requireRole('superadmin'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password required' });
  if (role && !['superadmin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (dup.rows[0]) return res.status(400).json({ error: 'Email already exists' });
    const newUser = await insertUser({
      id: generateId('usr'),
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      name,
      role: role || 'viewer',
      avatar: null,
      active: true
    });
    logActivity(req.user.id, 'team_member_added', `${req.user.name} added ${name} (${role || 'viewer'})`);
    res.json({ success: true, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, active: newUser.active, createdAt: newUser.createdAt } });
  } catch (err) {
    console.error('[API] POST /api/team', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/team/:id', jwtAuth, requireRole('superadmin'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const cur = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'User not found' });
    const { name, email, role, active, password } = req.body;
    const patch = {};
    if (name) patch.name = name;
    if (email) {
      const dup = await db.query('SELECT id FROM users WHERE id != $1 AND LOWER(email) = LOWER($2) LIMIT 1', [req.params.id, email]);
      if (dup.rows[0]) return res.status(400).json({ error: 'Email already in use by another member' });
      patch.email = email.toLowerCase();
    }
    if (role) patch.role = role;
    if (active !== undefined) patch.active = active;
    if (password) patch.passwordHash = await hashPassword(password);
    const user = await updateUserById(req.params.id, patch);
    logActivity(req.user.id, 'team_member_updated', `${req.user.name} updated ${user.name}'s profile`);
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, createdAt: user.createdAt } });
  } catch (err) {
    console.error('[API] PUT /api/team/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/team/:id', jwtAuth, requireRole('superadmin'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    const cur = await db.query('SELECT id, name FROM users WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'User not found' });
    const deletedName = cur.rows[0].name;
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    logActivity(req.user.id, 'team_member_deleted', `${req.user.name} removed ${deletedName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/team/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════

app.get('/api/activity-log', jwtAuth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  try {
    const countR = await db.query('SELECT COUNT(*)::int AS c FROM activity_log');
    const items = await db.query('SELECT id, user_id, user_name, user_role, action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    res.json({
      items: items.rows.map(mapActivityRow),
      total: countR.rows[0].c
    });
  } catch (err) {
    console.error('[API] GET /api/activity-log', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// LEADS API (full CRUD + filters)
// ══════════════════════════════

app.get('/api/leads', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const r = await db.query('SELECT * FROM leads ORDER BY created_at DESC');
    let result = r.rows.map(mapLeadRow);
    // Filters
    if (req.query.status) result = result.filter(l => l.status === req.query.status);
    if (req.query.source) result = result.filter(l => l.source === req.query.source);
    if (req.query.search) {
      const s = req.query.search.toLowerCase();
      result = result.filter(l => `${l.fullName} ${l.phone} ${l.interest} ${l.email} ${l.whatsapp}`.toLowerCase().includes(s));
    }
    if (req.query.from) result = result.filter(l => new Date(l.createdAt) >= new Date(req.query.from + 'T00:00:00+04:00'));
    if (req.query.to) result = result.filter(l => new Date(l.createdAt) <= new Date(req.query.to + 'T23:59:59+04:00'));
    // Sorting
    if (req.query.sort) {
      const dir = req.query.dir === 'asc' ? 1 : -1;
      const field = req.query.sort;
      result.sort((a, b) => {
        const va = a[field] || '';
        const vb = b[field] || '';
        if (field === 'createdAt') return dir * (new Date(va) - new Date(vb));
        return dir * String(va).localeCompare(String(vb));
      });
    }
    // Pagination
    const total = result.length;
    if (req.query.page) {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      result = result.slice(offset, offset + limit);
      return res.json({ items: result, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    res.json(result);
  } catch (err) {
    console.error('[API] GET /api/leads', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk update leads
app.post('/api/leads/bulk', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { ids, action, status } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const intIds = ids.map(id => parseInt(id)).filter(n => !isNaN(n));
  try {
    if (action === 'delete') {
      const r = await db.query('DELETE FROM leads WHERE id = ANY($1::int[]) RETURNING id', [intIds]);
      logActivity(req.user.id, 'leads_bulk_deleted', `Deleted ${r.rowCount} leads`);
      return res.json({ success: true, affected: r.rowCount });
    }
    if (action === 'status' && status) {
      if (!VALID_LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const r = await db.query('UPDATE leads SET status = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [status, intIds]);
      logActivity(req.user.id, 'leads_bulk_status', `Changed ${r.rowCount} leads to ${status}`);
      return res.json({ success: true, affected: r.rowCount });
    }
    res.status(400).json({ error: 'Invalid bulk action' });
  } catch (err) {
    console.error('[API] POST /api/leads/bulk', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/leads/:id', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  if (req.body.status && !VALID_LEAD_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const id = parseInt(req.params.id);
    const cur = await db.query('SELECT id FROM leads WHERE id = $1 LIMIT 1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const allowed = ['status', 'fullName', 'phone', 'whatsapp', 'email', 'interest', 'address', 'source', 'convertedToBooking'];
    const patch = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) patch[f] = req.body[f]; });
    const l = await updateLeadById(id, patch);
    logActivity(req.user.id, 'lead_updated', `Updated lead ${l.fullName}`);
    res.json(l);
  } catch (err) {
    console.error('[API] PATCH /api/leads/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single lead
app.get('/api/leads/:id', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [parseInt(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapLeadRow(rows[0]));
  } catch (err) {
    console.error('[API] GET /api/leads/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/notes', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT notes_data, name FROM leads WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const note = { id: generateId('note'), text: req.body.text, author: req.user.name, createdAt: new Date().toISOString() };
    const existing = Array.isArray(rows[0].notes_data) ? rows[0].notes_data : [];
    const newNotes = [note, ...existing];
    await db.query('UPDATE leads SET notes_data = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(newNotes), id]);
    logActivity(req.user.id, 'lead_note_added', `Added note to lead ${rows[0].name || ''}`);
    res.json(note);
  } catch (err) {
    console.error('[API] POST /api/leads/:id/notes', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/leads/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const r = await db.query('DELETE FROM leads WHERE id = $1 RETURNING name', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'lead_deleted', `Deleted lead ${r.rows[0].name || ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/leads/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// BOOKINGS API (full CRUD + filters)
// ══════════════════════════════

app.get('/api/bookings', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const r = await db.query('SELECT * FROM bookings ORDER BY created_at DESC');
    let result = r.rows.map(mapBookingRow);
    if (req.query.status) result = result.filter(b => b.status === req.query.status);
    if (req.query.car) result = result.filter(b => b.carName.toLowerCase().includes(req.query.car.toLowerCase()));
    if (req.query.location) result = result.filter(b => b.location.toLowerCase().includes(req.query.location.toLowerCase()));
    if (req.query.search) {
      const s = req.query.search.toLowerCase();
      result = result.filter(b => `${b.fullName} ${b.phone} ${b.ref} ${b.carName} ${b.email} ${b.location}`.toLowerCase().includes(s));
    }
    if (req.query.from) result = result.filter(b => new Date(b.createdAt) >= new Date(req.query.from));
    if (req.query.to) result = result.filter(b => new Date(b.createdAt) <= new Date(req.query.to + 'T23:59:59'));
    if (req.query.sort) {
      const dir = req.query.dir === 'asc' ? 1 : -1;
      const field = req.query.sort;
      result.sort((a, b) => {
        const va = a[field] || '';
        const vb = b[field] || '';
        if (field === 'createdAt' || field === 'startDate') return dir * (new Date(va) - new Date(vb));
        if (field === 'totalAed') return dir * (Number(va) - Number(vb));
        return dir * String(va).localeCompare(String(vb));
      });
    }
    const total = result.length;
    if (req.query.page) {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      result = result.slice(offset, offset + limit);
      return res.json({ items: result, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    res.json(result);
  } catch (err) {
    console.error('[API] GET /api/bookings', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single booking
app.get('/api/bookings/:id', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [parseInt(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapBookingRow(rows[0]));
  } catch (err) {
    console.error('[API] GET /api/bookings/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/bookings/:id', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  if (req.body.status && !VALID_BOOKING_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const id = parseInt(req.params.id);
    const cur = await db.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const allowed = ['status', 'carName', 'carId', 'startDate', 'endDate', 'duration', 'location', 'fullName', 'phone', 'email', 'whatsapp', 'totalAed', 'savedAed'];
    const patch = {};
    const changed = [];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) { patch[f] = req.body[f]; changed.push(f); }
    });
    const b = await updateBookingById(id, patch);
    logActivity(req.user.id, 'booking_updated', `Updated booking ${b.ref}: ${changed.join(', ')}`);
    res.json(b);
  } catch (err) {
    console.error('[API] PATCH /api/bookings/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add note to booking
app.post('/api/bookings/:id/notes', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT notes_data, ref FROM bookings WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const note = { id: generateId('note'), text: req.body.text, author: req.user.name, createdAt: new Date().toISOString() };
    const existing = Array.isArray(rows[0].notes_data) ? rows[0].notes_data : [];
    const newNotes = [note, ...existing];
    await db.query('UPDATE bookings SET notes_data = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(newNotes), id]);
    logActivity(req.user.id, 'booking_note_added', `Added note to booking ${rows[0].ref || ''}`);
    res.json(note);
  } catch (err) {
    console.error('[API] POST /api/bookings/:id/notes', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk bookings
app.post('/api/bookings/bulk', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { ids, action, status } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const intIds = ids.map(id => parseInt(id)).filter(n => !isNaN(n));
  try {
    if (action === 'delete') {
      const r = await db.query('DELETE FROM bookings WHERE id = ANY($1::int[]) RETURNING id', [intIds]);
      logActivity(req.user.id, 'bookings_bulk_deleted', `Deleted ${r.rowCount} bookings`);
      return res.json({ success: true, affected: r.rowCount });
    }
    if (action === 'status' && status) {
      if (!VALID_BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const r = await db.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [status, intIds]);
      logActivity(req.user.id, 'bookings_bulk_status', `Changed ${r.rowCount} bookings to ${status}`);
      return res.json({ success: true, affected: r.rowCount });
    }
    res.status(400).json({ error: 'Invalid bulk action' });
  } catch (err) {
    console.error('[API] POST /api/bookings/bulk', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/bookings/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const r = await db.query('DELETE FROM bookings WHERE id = $1 RETURNING ref', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'booking_deleted', `Deleted booking ${r.rows[0].ref || ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/bookings/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// FILE UPLOAD API
// ══════════════════════════════

app.post('/api/upload', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { data, name } = req.body;
  if (!data || !name) return res.status(400).json({ error: 'File data and name required' });

  // Validate base64 image
  const match = data.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format. Use PNG, JPG, or WebP.' });

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');

  // Max 5MB per image
  if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large. Maximum 5MB.' });

  // Generate unique filename
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 40) || 'image';
  const filename = safeName + '-' + Date.now() + '.' + ext;
  const filepath = path.join(uploadsDir, filename);

  fs.writeFileSync(filepath, buffer);
  logActivity(req.user.id, 'image_uploaded', `Uploaded image: ${filename}`);
  res.json({ success: true, url: '/uploads/' + filename, filename });
});

// ══════════════════════════════
// CARS API (full CRUD + ordering + visibility + duplicate)
// ══════════════════════════════

// Admin cars listing (includes inactive)
app.get('/api/cars/admin', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const result = await db.query('SELECT * FROM cars ORDER BY sort_order');
    res.json(result.rows.map(mapCarRowFull));
  } catch (err) {
    console.error('[API] GET /api/cars/admin', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Car stats (MUST come before /:id routes)
app.get('/api/cars/stats', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.active,
              COUNT(b.id)::int AS bookings,
              COALESCE(SUM(b.total),0)::numeric AS revenue
       FROM cars c
       LEFT JOIN bookings b ON (b.car_id = c.id OR b.car_name = c.name)
       GROUP BY c.id, c.name, c.active
       ORDER BY c.sort_order`
    );
    res.json(rows.map(r => ({ id: r.id, name: r.name, bookings: Number(r.bookings) || 0, revenue: Number(r.revenue) || 0, active: r.active })));
  } catch (err) {
    console.error('[API] GET /api/cars/stats', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reorder cars (MUST come before /:id routes)
app.put('/api/cars/reorder', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { order } = req.body;
  if (!order || !Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  try {
    for (let i = 0; i < order.length; i++) {
      await db.query('UPDATE cars SET sort_order = $1 WHERE id = $2', [i, parseInt(order[i])]);
    }
    logActivity(req.user.id, 'cars_reordered', 'Reordered car display order');
    res.json({ success: true });
  } catch (err) {
    console.error('[API] PUT /api/cars/reorder', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/cars', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { name, price } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS c FROM cars');
    const car = await insertCar({
      ...req.body,
      viewers: Math.floor(Math.random() * 15) + 5,
      active: true,
      order: cnt.rows[0].c
    });
    logActivity(req.user.id, 'car_added', `Added car: ${car.name}`);
    res.json(car);
  } catch (err) {
    console.error('[API] POST /api/cars', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/cars/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const cur = await db.query('SELECT id FROM cars WHERE id = $1 LIMIT 1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const patch = { ...req.body };
    delete patch.id;
    const car = await updateCarById(id, patch);
    logActivity(req.user.id, 'car_updated', `Updated car: ${car.name}`);
    res.json(car);
  } catch (err) {
    console.error('[API] PUT /api/cars/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle car visibility
app.patch('/api/cars/:id/toggle', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const cur = await db.query('SELECT active FROM cars WHERE id = $1 LIMIT 1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const car = await updateCarById(id, { active: !cur.rows[0].active });
    logActivity(req.user.id, 'car_toggled', `${car.active ? 'Activated' : 'Deactivated'} car: ${car.name}`);
    res.json(car);
  } catch (err) {
    console.error('[API] PATCH /api/cars/:id/toggle', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Duplicate car
app.post('/api/cars/:id/duplicate', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM cars WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const orig = mapCarRowFull(rows[0]);
    const cnt = await db.query('SELECT COUNT(*)::int AS c FROM cars');
    const dup = await insertCar({
      ...orig,
      name: orig.name + ' (Copy)',
      order: cnt.rows[0].c,
      viewers: Math.floor(Math.random() * 15) + 5
    });
    logActivity(req.user.id, 'car_duplicated', `Duplicated car: ${orig.name}`);
    res.json(dup);
  } catch (err) {
    console.error('[API] POST /api/cars/:id/duplicate', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/cars/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const r = await db.query('DELETE FROM cars WHERE id = $1 RETURNING name', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'car_deleted', `Deleted car: ${r.rows[0].name || ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/cars/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stats
app.get('/api/stats', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const [b, l, c, conv, pop] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total_count, COALESCE(SUM(total),0)::numeric AS revenue, SUM(CASE WHEN status IN ('new','pending') THEN 1 ELSE 0 END)::int AS new_count FROM bookings`),
      db.query(`SELECT COUNT(*)::int AS total_count, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END)::int AS new_count FROM leads`),
      db.query(`SELECT COUNT(*)::int AS c FROM cars`),
      db.query(`SELECT COUNT(*)::int AS c FROM leads WHERE converted_to_booking = true`),
      db.query(`SELECT car_name FROM bookings WHERE car_name IS NOT NULL AND car_name != '' GROUP BY car_name ORDER BY COUNT(*) DESC LIMIT 1`)
    ]);
    const totalLeads = l.rows[0].total_count || 0;
    const convertedLeads = conv.rows[0].c || 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
    res.json({
      totalBookings: b.rows[0].total_count || 0,
      totalLeads,
      totalRevenue: Number(b.rows[0].revenue) || 0,
      newBookings: b.rows[0].new_count || 0,
      newLeads: l.rows[0].new_count || 0,
      convertedLeads,
      conversionRate,
      popularCar: (pop.rows[0] && pop.rows[0].car_name) || '-',
      totalCars: c.rows[0].c
    });
  } catch (err) {
    console.error('[API] GET /api/stats', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// PAGE VIEW & LIVE VISITORS TRACKING
// ═════════════════════���════════

let pageViews = 0;
let liveVisitors = new Map();

app.post('/api/track/view', (req, res) => {
  pageViews++;
  const sid = req.body.sid || req.ip;
  liveVisitors.set(sid, Date.now());
  res.json({ success: true });
});

setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, v] of liveVisitors) { if (v < cutoff) liveVisitors.delete(k); }
}, 30000);

// ══════════════════════════════
// ANALYTICS API
// ══════════════════════════════

function getDateRange(from, to) {
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to + 'T23:59:59') : new Date();
  return { start, end };
}
function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtDateKey(d) { return d.toISOString().split('T')[0]; }
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0,0,0,0); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function groupByPeriod(items, dateField, period) {
  const buckets = {};
  items.forEach(item => {
    const d = new Date(item[dateField]);
    let key;
    if (period === 'daily') key = fmtDateKey(d);
    else if (period === 'weekly') key = fmtDateKey(startOfWeek(d));
    else key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    buckets[key] = (buckets[key] || 0) + 1;
  });
  return buckets;
}

function groupRevByPeriod(items, period) {
  const buckets = {};
  items.forEach(item => {
    const d = new Date(item.createdAt);
    let key;
    if (period === 'daily') key = fmtDateKey(d);
    else if (period === 'weekly') key = fmtDateKey(startOfWeek(d));
    else key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    buckets[key] = (buckets[key] || 0) + (Number(item.totalAed) || 0);
  });
  return buckets;
}

app.get('/api/analytics/overview', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = addDays(todayStart, -1);
  const weekStart = addDays(todayStart, -7);
  const prevWeekStart = addDays(todayStart, -14);
  const monthStart = startOfMonth(now);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const hotCutoff = new Date(Date.now() - 1800000);
  try {
    const [leadAgg, bookAgg, convAgg, carsAgg, hotR] = await Promise.all([
      db.query(
        `SELECT
           SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END)::int AS today,
           SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END)::int AS yesterday,
           SUM(CASE WHEN created_at >= $3 THEN 1 ELSE 0 END)::int AS week,
           SUM(CASE WHEN created_at >= $4 AND created_at < $3 THEN 1 ELSE 0 END)::int AS prev_week,
           SUM(CASE WHEN created_at >= $5 THEN 1 ELSE 0 END)::int AS month,
           SUM(CASE WHEN created_at >= $6 AND created_at <= $7 THEN 1 ELSE 0 END)::int AS prev_month,
           COUNT(*)::int AS total
         FROM leads`,
        [todayStart, yesterdayStart, weekStart, prevWeekStart, monthStart, prevMonthStart, prevMonthEnd]
      ),
      db.query(
        `SELECT
           SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END)::int AS today,
           SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END)::int AS yesterday,
           SUM(CASE WHEN created_at >= $3 THEN 1 ELSE 0 END)::int AS week,
           SUM(CASE WHEN created_at >= $4 THEN 1 ELSE 0 END)::int AS month,
           COUNT(*)::int AS total,
           COALESCE(SUM(CASE WHEN created_at >= $1 THEN total ELSE 0 END),0)::numeric AS today_rev,
           COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN total ELSE 0 END),0)::numeric AS yesterday_rev,
           COALESCE(SUM(total),0)::numeric AS total_rev
         FROM bookings`,
        [todayStart, yesterdayStart, weekStart, monthStart]
      ),
      db.query(`SELECT COUNT(*)::int AS c FROM leads WHERE converted_to_booking = true`),
      db.query(`SELECT COUNT(*)::int AS c FROM cars WHERE active = true`),
      db.query(
        `SELECT id, name, phone, car, created_at FROM leads WHERE status = 'new' AND created_at >= $1 ORDER BY created_at DESC LIMIT 10`,
        [hotCutoff]
      )
    ]);
    const L = leadAgg.rows[0], B = bookAgg.rows[0];
    const totalLeads = L.total || 0;
    const convertedLeads = convAgg.rows[0].c || 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
    res.json({
      leads: {
        today: L.today || 0, yesterday: L.yesterday || 0,
        week: L.week || 0, prevWeek: L.prev_week || 0,
        month: L.month || 0, prevMonth: L.prev_month || 0,
        total: totalLeads
      },
      bookings: {
        today: B.today || 0, yesterday: B.yesterday || 0,
        week: B.week || 0, month: B.month || 0,
        total: B.total || 0
      },
      revenue: {
        today: Number(B.today_rev) || 0,
        yesterday: Number(B.yesterday_rev) || 0,
        total: Number(B.total_rev) || 0
      },
      conversionRate,
      activeCars: carsAgg.rows[0].c || 0,
      liveVisitors: liveVisitors.size,
      pageViews: pageViews || Math.max(totalLeads * 8, 100),
      hotLeads: hotR.rows.map(l => ({ id: l.id, fullName: l.name || '', phone: l.phone || '', interest: l.car || '', createdAt: l.created_at }))
    });
  } catch (err) {
    console.error('[API] GET /api/analytics/overview', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/leads', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const period = req.query.period || 'daily';
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const { rows } = await db.query('SELECT created_at FROM leads WHERE created_at >= $1 AND created_at <= $2', [start, end]);
    const items = rows.map(r => ({ createdAt: r.created_at }));
    res.json(groupByPeriod(items, 'createdAt', period));
  } catch (err) {
    console.error('[API] GET /api/analytics/leads', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/bookings', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const period = req.query.period || 'daily';
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const { rows } = await db.query('SELECT created_at FROM bookings WHERE created_at >= $1 AND created_at <= $2', [start, end]);
    const items = rows.map(r => ({ createdAt: r.created_at }));
    res.json(groupByPeriod(items, 'createdAt', period));
  } catch (err) {
    console.error('[API] GET /api/analytics/bookings', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/revenue', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const period = req.query.period || 'daily';
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const { rows } = await db.query('SELECT created_at, total FROM bookings WHERE created_at >= $1 AND created_at <= $2', [start, end]);
    const items = rows.map(r => ({ createdAt: r.created_at, totalAed: Number(r.total) || 0 }));
    res.json(groupRevByPeriod(items, period));
  } catch (err) {
    console.error('[API] GET /api/analytics/revenue', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/sources', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query(`SELECT COALESCE(NULLIF(source,''),'unknown') AS source, COUNT(*)::int AS c FROM leads GROUP BY 1`);
    const counts = {};
    rows.forEach(r => { counts[r.source] = r.c; });
    res.json(counts);
  } catch (err) {
    console.error('[API] GET /api/analytics/sources', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/popular-cars', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query(`SELECT COALESCE(car_name,'') AS name, COUNT(*)::int AS count FROM bookings WHERE car_name IS NOT NULL AND car_name != '' GROUP BY car_name ORDER BY count DESC`);
    res.json(rows.map(r => ({ name: r.name, count: r.count })));
  } catch (err) {
    console.error('[API] GET /api/analytics/popular-cars', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/locations', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query(`SELECT COALESCE(NULLIF(location,''),'Unknown') AS loc, COUNT(*)::int AS c FROM bookings GROUP BY 1`);
    const counts = {};
    rows.forEach(r => { counts[r.loc] = r.c; });
    res.json(counts);
  } catch (err) {
    console.error('[API] GET /api/analytics/locations', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/funnel', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const [lR, bR] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS c FROM leads'),
      db.query('SELECT COUNT(*)::int AS c FROM bookings')
    ]);
    const leadsCount = lR.rows[0].c;
    const bookingsCount = bR.rows[0].c;
    res.json({ pageViews: pageViews || Math.max(leadsCount * 8, 100), leads: leadsCount, bookings: bookingsCount });
  } catch (err) {
    console.error('[API] GET /api/analytics/funnel', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/analytics/activity', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query('SELECT id, user_id, user_name, user_role, action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 20');
    res.json(rows.map(mapActivityRow));
  } catch (err) {
    console.error('[API] GET /api/analytics/activity', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// CMS CONFIG API
// ══════════════════════════════

const DEFAULT_SECTIONS = DEFAULT_SITE_CONFIG.sections;

// siteConfig is an in-memory cache of the site_config.main row.
// Initialized from defaults, overwritten on startup from DB, and synced back on mutation.
let siteConfig = JSON.parse(JSON.stringify(DEFAULT_SITE_CONFIG));

// Public: landing page fetches config (served from the cache)
app.get('/api/config', (req, res) => {
  res.json(siteConfig);
});

// Admin: update full config
app.put('/api/config', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  try {
    const { content, settings } = req.body;
    if (content) {
      // Deep merge content to preserve nested objects
      for (const key of Object.keys(content)) {
        if (typeof content[key] === 'object' && content[key] !== null && !Array.isArray(content[key]) && siteConfig.content[key]) {
          siteConfig.content[key] = { ...siteConfig.content[key], ...content[key] };
        } else {
          siteConfig.content[key] = content[key];
        }
      }
    }
    if (settings) {
      // Deep merge settings to preserve nested objects (social, colors, fonts, etc.)
      for (const key of Object.keys(settings)) {
        if (typeof settings[key] === 'object' && settings[key] !== null && !Array.isArray(settings[key]) && siteConfig.settings[key]) {
          siteConfig.settings[key] = { ...siteConfig.settings[key], ...settings[key] };
        } else {
          siteConfig.settings[key] = settings[key];
        }
      }
    }
    await syncSiteConfigToDb(siteConfig);
    logActivity(req.user.id, 'config_updated', 'Updated landing page configuration');
    res.json({ success: true, config: siteConfig });
  } catch (err) {
    console.error('[API] Config update failed:', err.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// Sections list
app.get('/api/config/sections', auth, (req, res) => {
  res.json(siteConfig.sections.sort((a, b) => a.order - b.order));
});

// Reorder sections
app.put('/api/config/sections/reorder', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { order } = req.body; // array of section IDs
  if (!order || !Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  order.forEach((id, idx) => {
    const sec = siteConfig.sections.find(s => s.id === id);
    if (sec) sec.order = idx;
  });
  syncSiteConfigToDb(siteConfig);
  logActivity(req.user.id, 'sections_reordered', 'Reordered landing page sections');
  res.json({ success: true, sections: siteConfig.sections.sort((a, b) => a.order - b.order) });
});

// Toggle section visibility
app.patch('/api/config/sections/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const sec = siteConfig.sections.find(s => s.id === req.params.id);
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  if (req.body.visible !== undefined) sec.visible = req.body.visible;
  if (req.body.name) sec.name = req.body.name;
  if (sec.type !== 'builtin') {
    if (req.body.type && ['text', 'image_text', 'cta_banner'].includes(req.body.type)) sec.type = req.body.type;
    if (req.body.content && typeof req.body.content === 'object') sec.content = { ...(sec.content || {}), ...req.body.content };
  }
  syncSiteConfigToDb(siteConfig);
  logActivity(req.user.id, 'section_updated', `Updated section: ${sec.name}`);
  res.json(sec);
});

// Add custom section
app.post('/api/config/sections', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { name, type, content } = req.body;
  if (!name) return res.status(400).json({ error: 'Section name required' });
  const validTypes = ['text', 'image_text', 'cta_banner'];
  const sec = {
    id: 'custom_' + Date.now().toString(36),
    name,
    type: validTypes.includes(type) ? type : 'text',
    visible: true,
    order: siteConfig.sections.length,
    content: content || { heading: '', body: '', imageUrl: '', buttonText: '', buttonUrl: '' }
  };
  siteConfig.sections.push(sec);
  syncSiteConfigToDb(siteConfig);
  logActivity(req.user.id, 'section_added', `Added custom section: ${name}`);
  res.json(sec);
});

// Delete custom section
app.delete('/api/config/sections/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = siteConfig.sections.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Section not found' });
  if (siteConfig.sections[idx].type === 'builtin') return res.status(400).json({ error: 'Cannot delete built-in sections' });
  const deleted = siteConfig.sections.splice(idx, 1)[0];
  syncSiteConfigToDb(siteConfig);
  logActivity(req.user.id, 'section_deleted', `Deleted section: ${deleted.name}`);
  res.json({ success: true });
});

// Reset config to defaults
app.post('/api/config/reset', auth, requireRole('superadmin'), (req, res) => {
  siteConfig.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  syncSiteConfigToDb(siteConfig);
  logActivity(req.user.id, 'config_reset', 'Reset landing page sections to defaults');
  res.json({ success: true });
});

// ══════════════════════════════
// NOTIFICATIONS API
// ══════════════════════════════

app.get('/api/notifications', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const limit = parseInt(req.query.limit) || 30;
  const unreadOnly = req.query.unread === 'true';
  try {
    const filter = unreadOnly ? ' WHERE read = false' : '';
    const rowsR = await db.query(`SELECT id, type, title, body, read, user_id, created_at FROM notifications${filter} ORDER BY created_at DESC LIMIT $1`, [limit]);
    const unreadR = await db.query('SELECT COUNT(*)::int AS c FROM notifications WHERE read = false');
    res.json({
      items: rowsR.rows.map(mapNotificationRow),
      unreadCount: unreadR.rows[0].c
    });
  } catch (err) {
    console.error('[API] GET /api/notifications', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/notifications/:id/read', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await db.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] PATCH /api/notifications/:id/read', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await db.query('UPDATE notifications SET read = true WHERE read = false');
    res.json({ success: true });
  } catch (err) {
    console.error('[API] POST /api/notifications/read-all', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// GLOBAL SEARCH API
// ══════════════════════════════

app.get('/api/search', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ leads: [], bookings: [], cars: [] });
  const like = '%' + q + '%';
  try {
    const [lR, bR, cR] = await Promise.all([
      db.query(
        `SELECT id, name, phone, email, car, status FROM leads
         WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR car ILIKE $1
         ORDER BY created_at DESC LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT id, ref, customer_name, customer_phone, car_name, status FROM bookings
         WHERE customer_name ILIKE $1 OR customer_phone ILIKE $1 OR ref ILIKE $1 OR car_name ILIKE $1
         ORDER BY created_at DESC LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT id, name, cat, type, price FROM cars
         WHERE name ILIKE $1 OR cat ILIKE $1 OR type ILIKE $1
         ORDER BY sort_order LIMIT 8`,
        [like]
      )
    ]);
    res.json({
      leads: lR.rows.map(l => ({ id: l.id, type: 'lead', title: l.name || '', subtitle: (l.phone || '') + ' — ' + (l.status || 'new'), icon: '&#128101;' })),
      bookings: bR.rows.map(b => ({ id: b.id, type: 'booking', title: (b.ref || '') + ' — ' + (b.customer_name || ''), subtitle: (b.car_name || '') + ' — ' + (b.status || 'pending'), icon: '&#128203;' })),
      cars: cR.rows.map(c => ({ id: c.id, type: 'car', title: c.name, subtitle: (c.cat || '') + ' — AED ' + c.price, icon: '&#128663;' }))
    });
  } catch (err) {
    console.error('[API] GET /api/search', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// DATA EXPORT / IMPORT / CLEAR
// ══════════════════════════════

app.get('/api/export', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const [leadsR, bookingsR, carsR, activityR] = await Promise.all([
      db.query('SELECT * FROM leads ORDER BY created_at DESC'),
      db.query('SELECT * FROM bookings ORDER BY created_at DESC'),
      db.query('SELECT * FROM cars ORDER BY sort_order'),
      db.query('SELECT id, user_id, user_name, user_role, action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 100')
    ]);
    res.json({
      exportDate: new Date().toISOString(),
      version: '2.0',
      leads: leadsR.rows.map(mapLeadRow),
      bookings: bookingsR.rows.map(mapBookingRow),
      cars: carsR.rows.map(mapCarRowFull),
      config: siteConfig,
      activityLog: activityR.rows.map(mapActivityRow)
    });
  } catch (err) {
    console.error('[API] GET /api/export', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/import', auth, requireRole('superadmin'), (req, res) => {
  res.status(501).json({ error: 'Import not supported in DB-only mode' });
});

app.delete('/api/data', auth, requireRole('superadmin'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { confirmToken } = req.body;
  if (confirmToken !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
  try {
    const [leadsR, bookingsR] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS c FROM leads'),
      db.query('SELECT COUNT(*)::int AS c FROM bookings')
    ]);
    const prevCounts = { leads: leadsR.rows[0].c, bookings: bookingsR.rows[0].c };
    await db.query('DELETE FROM leads');
    await db.query('DELETE FROM bookings');
    await db.query('DELETE FROM activity_log');
    await db.query('DELETE FROM notifications');
    logActivity(req.user.id, 'data_cleared', `Cleared all data (${prevCounts.leads} leads, ${prevCounts.bookings} bookings)`);
    addNotification('system', 'Data Cleared', 'All leads and bookings have been cleared');
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/data', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// PAYMENT TRACKING API (Feature 1)
// ══════════════════════════════
const VALID_PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];
const VALID_PAYMENT_METHODS = ['', 'cash', 'card', 'transfer', 'cheque'];

app.patch('/api/bookings/:id/payment', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { paymentStatus, amountPaid, paymentMethod, paymentNotes, addPayment } = req.body;
  if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) return res.status(400).json({ error: 'Invalid payment status' });
  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });
  try {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const b = mapBookingRow(rows[0]);
    const patch = {};
    let history = Array.isArray(b.paymentHistory) ? [...b.paymentHistory] : [];
    let newAmountPaid = b.amountPaid || 0;
    if (addPayment && Number(addPayment.amount) > 0) {
      history.unshift({
        id: generateId('pmt'), amount: Number(addPayment.amount),
        method: addPayment.method || b.paymentMethod || '',
        notes: addPayment.notes || '',
        recordedBy: req.user.name,
        recordedAt: new Date().toISOString()
      });
      newAmountPaid = history.reduce((s, p) => s + Number(p.amount || 0), 0);
      patch.paymentHistory = history;
    }
    if (amountPaid !== undefined) newAmountPaid = Number(amountPaid);
    patch.amountPaid = newAmountPaid;
    if (paymentMethod !== undefined) patch.paymentMethod = paymentMethod;
    if (paymentNotes !== undefined) patch.paymentNotes = paymentNotes;
    // Derive payment status
    const total = Number(b.totalAed) || 0;
    let finalStatus = paymentStatus || b.paymentStatus || 'unpaid';
    if (newAmountPaid >= total && total > 0) finalStatus = 'paid';
    else if (newAmountPaid > 0) finalStatus = 'partial';
    else if (!paymentStatus) finalStatus = 'unpaid';
    patch.paymentStatus = finalStatus;
    const updated = await updateBookingById(id, patch);
    logActivity(req.user.id, 'payment_updated', `Payment updated for ${updated.ref}: ${updated.paymentStatus} (AED ${updated.amountPaid}/${total})`);
    res.json(updated);
  } catch (err) {
    console.error('[API] PATCH /api/bookings/:id/payment', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// INVOICE API (Feature 2)
// ══════════════════════════════
app.post('/api/bookings/:id/invoice', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const id = parseInt(req.params.id);
    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    let booking = mapBookingRow(rows[0]);
    if (!booking.invoiceNumber) {
      const updR = await db.query(
        `UPDATE bookings
         SET invoice_number = 'FT-INV-' || LPAD(nextval('invoice_seq')::text, 4, '0'),
             invoice_generated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      booking = mapBookingRow(updR.rows[0]);
    }
    logActivity(req.user.id, 'invoice_generated', `Generated invoice ${booking.invoiceNumber} for booking ${booking.ref}`);
    res.json({ success: true, invoiceNumber: booking.invoiceNumber, booking });
  } catch (err) {
    console.error('[API] POST /api/bookings/:id/invoice', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// CUSTOMERS API (Feature 3)
// ══════════════════════════════
function normPhone(p) { return (p || '').replace(/[^0-9]/g, ''); }

async function buildCustomers() {
  const [bookingsR, leadsR, metaR] = await Promise.all([
    db.query('SELECT * FROM bookings ORDER BY created_at DESC'),
    db.query('SELECT * FROM leads ORDER BY created_at DESC'),
    db.query('SELECT phone, notes, tags FROM customer_meta')
  ]);
  const metaMap = new Map();
  metaR.rows.forEach(m => {
    metaMap.set(m.phone, { notes: m.notes || '', tags: Array.isArray(m.tags) ? m.tags : [] });
  });
  const byPhone = new Map();
  bookingsR.rows.forEach(row => {
    const b = mapBookingRow(row);
    const key = normPhone(b.phone);
    if (!key) return;
    let c = byPhone.get(key);
    if (!c) {
      c = { id: key, phone: b.phone, fullName: b.fullName, email: b.email || '', whatsapp: b.whatsapp || '', address: '', bookings: [], leads: [], totalSpent: 0, customerSince: b.createdAt };
      byPhone.set(key, c);
    }
    c.bookings.push({ id: b.id, ref: b.ref, carName: b.carName, totalAed: b.totalAed, status: b.status, paymentStatus: b.paymentStatus || 'unpaid', createdAt: b.createdAt });
    c.totalSpent += Number(b.totalAed) || 0;
    if (b.email && !c.email) c.email = b.email;
    if (b.whatsapp && !c.whatsapp) c.whatsapp = b.whatsapp;
    if (new Date(b.createdAt) < new Date(c.customerSince)) c.customerSince = b.createdAt;
  });
  leadsR.rows.forEach(row => {
    const l = mapLeadRow(row);
    const key = normPhone(l.phone);
    if (!key) return;
    let c = byPhone.get(key);
    if (!c) {
      c = { id: key, phone: l.phone, fullName: l.fullName, email: l.email || '', whatsapp: l.whatsapp || '', address: l.address || '', bookings: [], leads: [], totalSpent: 0, customerSince: l.createdAt };
      byPhone.set(key, c);
    }
    c.leads.push({ id: l.id, interest: l.interest, source: l.source, status: l.status, createdAt: l.createdAt });
    if (l.email && !c.email) c.email = l.email;
    if (l.address && !c.address) c.address = l.address;
    if (new Date(l.createdAt) < new Date(c.customerSince)) c.customerSince = l.createdAt;
  });
  const list = Array.from(byPhone.values()).map(c => {
    const meta = metaMap.get(c.id) || { notes: '', tags: [] };
    const autoTags = [];
    if (c.bookings.length >= 3) autoTags.push('Repeat');
    if (c.totalSpent >= 10000) autoTags.push('VIP');
    if (c.bookings.length === 0 && c.leads.length > 0) autoTags.push('Lead');
    if (c.bookings.length === 1) autoTags.push('New');
    const tags = Array.from(new Set([...(meta.tags || []), ...autoTags]));
    const lastBooking = c.bookings.length ? c.bookings.map(b => b.createdAt).sort().reverse()[0] : null;
    return { ...c, notes: meta.notes || '', tags, bookingCount: c.bookings.length, leadCount: c.leads.length, lastBooking };
  });
  list.sort((a, b) => b.totalSpent - a.totalSpent);
  return list;
}

app.get('/api/customers', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const all = await buildCustomers();
    const q = (req.query.search || '').toLowerCase();
    const tagFilter = req.query.tag || '';
    let result = all;
    if (q) result = result.filter(c => `${c.fullName} ${c.phone} ${c.email}`.toLowerCase().includes(q));
    if (tagFilter) result = result.filter(c => c.tags.includes(tagFilter));
    res.json(result);
  } catch (err) {
    console.error('[API] GET /api/customers', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/customers/:id', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const all = await buildCustomers();
    const c = all.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    res.json(c);
  } catch (err) {
    console.error('[API] GET /api/customers/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/customers/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { notes, tags } = req.body;
  try {
    const cur = await db.query('SELECT notes, tags FROM customer_meta WHERE phone = $1 LIMIT 1', [req.params.id]);
    const existing = cur.rows[0]
      ? { notes: cur.rows[0].notes || '', tags: Array.isArray(cur.rows[0].tags) ? cur.rows[0].tags : [] }
      : { notes: '', tags: [] };
    if (notes !== undefined) existing.notes = notes;
    if (Array.isArray(tags)) existing.tags = tags;
    await db.query(
      `INSERT INTO customer_meta (phone, notes, tags, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (phone) DO UPDATE SET notes = EXCLUDED.notes, tags = EXCLUDED.tags, updated_at = NOW()`,
      [req.params.id, existing.notes, JSON.stringify(existing.tags)]
    );
    logActivity(req.user.id, 'customer_updated', `Updated customer meta for ${req.params.id}`);
    res.json({ success: true, meta: existing });
  } catch (err) {
    console.error('[API] PATCH /api/customers/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// PROMO CODES API (Feature 4)
// ══════════════════════════════
app.get('/api/promos', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const result = await db.query('SELECT * FROM promos ORDER BY created_at DESC');
    res.json(result.rows.map(mapPromoRow));
  } catch (err) {
    console.error('[API] GET /api/promos', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/promos', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { code, discountType, value, minDuration, maxUses, expiryDate, active } = req.body;
  if (!code || !value) return res.status(400).json({ error: 'Code and value required' });
  if (discountType && !['percentage', 'fixed'].includes(discountType)) return res.status(400).json({ error: 'Invalid discount type' });
  try {
    const dup = await db.query('SELECT id FROM promos WHERE UPPER(code) = UPPER($1) LIMIT 1', [code]);
    if (dup.rows[0]) return res.status(400).json({ error: 'Promo code already exists' });
    const promo = await insertPromo({
      id: generateId('promo'),
      code,
      discountType: discountType || 'percentage',
      value,
      minDuration: minDuration || 0,
      maxUses: maxUses || 0,
      usageCount: 0,
      expiryDate: expiryDate || '',
      active: active !== false
    });
    logActivity(req.user.id, 'promo_created', `Created promo ${promo.code}`);
    res.json(promo);
  } catch (err) {
    console.error('[API] POST /api/promos', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/promos/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { discountType } = req.body;
  if (discountType && !['percentage', 'fixed'].includes(discountType)) return res.status(400).json({ error: 'Invalid discount type' });
  try {
    const cur = await db.query('SELECT id FROM promos WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const p = await updatePromoById(req.params.id, req.body);
    logActivity(req.user.id, 'promo_updated', `Updated promo ${p.code}`);
    res.json(p);
  } catch (err) {
    console.error('[API] PUT /api/promos/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/promos/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const r = await db.query('DELETE FROM promos WHERE id = $1 RETURNING code', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'promo_deleted', `Deleted promo ${r.rows[0].code || ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/promos/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public promo validation
app.post('/api/promos/validate', async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { code, duration, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Promo code required' });
  try {
    const { rows } = await db.query('SELECT * FROM promos WHERE UPPER(code) = UPPER($1) LIMIT 1', [code]);
    if (!rows[0]) return res.status(404).json({ valid: false, error: 'Invalid promo code' });
    const p = mapPromoRow(rows[0]);
    if (!p.active) return res.status(400).json({ valid: false, error: 'Promo code is inactive' });
    if (p.expiryDate && new Date(p.expiryDate) < new Date()) return res.status(400).json({ valid: false, error: 'Promo code has expired' });
    if (p.maxUses && (p.usageCount || 0) >= p.maxUses) return res.status(400).json({ valid: false, error: 'Promo code usage limit reached' });
    if (p.minDuration && Number(duration) < p.minDuration) return res.status(400).json({ valid: false, error: `Minimum ${p.minDuration} months required` });
    const sub = Number(subtotal) || 0;
    let discount = 0;
    if (p.discountType === 'percentage') discount = Math.round(sub * p.value / 100);
    else discount = Math.min(p.value, sub);
    res.json({ valid: true, code: p.code, discountType: p.discountType, value: p.value, discount, finalTotal: Math.max(0, sub - discount) });
  } catch (err) {
    console.error('[API] POST /api/promos/validate', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// CAR DOCUMENT ALERTS API (Feature 6)
// ══════════════════════════════
app.get('/api/cars/alerts', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query('SELECT * FROM cars');
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const alerts = [];
    rows.forEach(row => {
      const c = mapCarRowFull(row);
      ['insuranceExpiry', 'registrationExpiry', 'nextServiceDue'].forEach(field => {
        if (!c[field]) return;
        const d = new Date(c[field]).getTime();
        if (isNaN(d)) return;
        const diff = d - now;
        let severity = null;
        if (diff < 0) severity = 'expired';
        else if (diff < thirtyDays) severity = 'warning';
        if (severity) {
          alerts.push({
            carId: c.id, carName: c.name, field,
            fieldLabel: field === 'insuranceExpiry' ? 'Insurance' : field === 'registrationExpiry' ? 'Registration' : 'Service Due',
            date: c[field], severity, daysRemaining: Math.ceil(diff / (24 * 60 * 60 * 1000))
          });
        }
      });
    });
    res.json(alerts);
  } catch (err) {
    console.error('[API] GET /api/cars/alerts', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// WHATSAPP TEMPLATES API (Feature 7)
// ══════════════════════════════
app.get('/api/templates', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const result = await db.query('SELECT * FROM templates ORDER BY created_at');
    res.json(result.rows.map(mapTemplateRow));
  } catch (err) {
    console.error('[API] GET /api/templates', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/templates', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  const { name, category, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'Name and body required' });
  try {
    const tpl = await insertTemplate({ id: generateId('tpl'), name, category: category || 'custom', body });
    logActivity(req.user.id, 'template_created', `Created template: ${name}`);
    res.json(tpl);
  } catch (err) {
    console.error('[API] POST /api/templates', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/templates/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const cur = await db.query('SELECT id FROM templates WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
    const t = await updateTemplateById(req.params.id, req.body);
    logActivity(req.user.id, 'template_updated', `Updated template: ${t.name}`);
    res.json(t);
  } catch (err) {
    console.error('[API] PUT /api/templates/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/templates/:id', auth, requireRole('superadmin', 'manager'), async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const r = await db.query('DELETE FROM templates WHERE id = $1 RETURNING name', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'template_deleted', `Deleted template: ${r.rows[0].name || ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/templates/:id', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════
// OUTSTANDING PAYMENTS (extend /api/stats)
// ══════════════════════════════
app.get('/api/stats/outstanding', auth, async (req, res) => {
  if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(total - COALESCE(amount_paid,0)), 0)::numeric AS outstanding,
         COUNT(*)::int AS unpaid_count
       FROM bookings
       WHERE status != 'cancelled' AND COALESCE(amount_paid,0) < total`
    );
    res.json({
      outstandingAmount: Number(rows[0].outstanding) || 0,
      unpaidCount: rows[0].unpaid_count || 0
    });
  } catch (err) {
    console.error('[API] GET /api/stats/outstanding', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Database health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: db.isReady() ? 'connected' : 'not connected (memory-only mode)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, async () => {
  console.log(`Fastrack server running on port ${PORT}`);

  if (process.env.JWT_SECRET === undefined) {
    console.warn('[Security] WARNING: Using default JWT_SECRET — set JWT_SECRET env variable in production!');
  }

  // Test database connection
  const dbConnected = await db.testConnection();
  if (dbConnected) {
    console.log('[Server] Database connected');
    const schemaOk = await initSchema();
    if (schemaOk) {
      console.log('[Server] Database schema initialized — all tables ready');
      await seedDefaults();
      console.log('[Server] Default data seeded (if tables were empty)');
      try {
        const dbCfg = await loadSiteConfigFromDb();
        if (dbCfg) {
          siteConfig = dbCfg;
          console.log('[Server] Site config loaded from database');
        }
      } catch (err) {
        console.error('[Server] Failed to load site config from DB:', err.message);
      }
    } else {
      console.error('[Server] Schema initialization failed — DB-dependent endpoints will return 503');
    }
  } else {
    console.log('[Server] Database unavailable — DB-dependent endpoints will return 503 until connected');
  }
});
