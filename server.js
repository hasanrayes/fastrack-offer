const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
let helmet;
try { helmet = require('helmet'); } catch(e) { helmet = null; }

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
  return str.replace(/[<>]/g, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim();
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
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ── In-memory data stores ──
let users = [
  {
    id: 'usr_admin',
    email: 'admin@fastrack.ae',
    passwordHash: hashPassword(ADMIN_PASS),
    name: 'Super Admin',
    role: 'superadmin',
    avatar: null,
    active: true,
    createdAt: new Date().toISOString()
  }
];

let refreshTokens = new Map();
let resetTokens = new Map();
let activityLog = [];
let notifications = [];

function addNotification(type, title, body, userId) {
  notifications.unshift({ id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), type, title, body, read: false, userId: userId || null, createdAt: new Date().toISOString() });
  if (notifications.length > 200) notifications.length = 200;
}

// ── Status whitelists ──
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const VALID_BOOKING_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled'];

let cars = [
  {id:1,name:'Mitsubishi Attrage',cat:'Economy Sedan',img:'https://fasttrackrac.com/cdn/shop/products/fastrack-Mitsubishi-attrage-car.jpg?v=1726815463&width=900',price:999,was:1399,type:'Sedan',seats:5,doors:4,transmission:'Automatic',bags:2,viewers:12,spots:3,badge:'Best Value',feats:['A/C','Reverse Camera','Bluetooth','Fog Lights'],includes:'Insurance + UAE delivery included',active:true,order:0},
  {id:2,name:'JAC J7',cat:'Sport Sedan',img:'https://fasttrackrac.com/cdn/shop/products/3_4084eaf4-7efa-4c62-bc2d-85fb8ee7faaa.jpg?v=1676898190&width=900',price:1299,was:1899,type:'Liftback',seats:5,doors:4,transmission:'Automatic',bags:2,viewers:9,spots:5,badge:'Hot Deal',feats:['Premium Audio','Leather Seats','Touchscreen','Keyless Entry'],includes:'Full insurance + Free delivery',active:true,order:1},
  {id:3,name:'Mitsubishi ASX',cat:'Compact SUV',img:'https://fasttrackrac.com/cdn/shop/files/20240622_110500.jpg?v=1726652270&width=900',price:1299,was:1899,type:'SUV',seats:5,doors:5,transmission:'Automatic',bags:3,viewers:18,spots:2,badge:'Most Popular',feats:['Apple CarPlay','Cruise Control','Rear Camera','Fuel Efficient'],includes:'Insurance + Unlimited km',active:true,order:2},
  {id:4,name:'JAC JS4',cat:'Crossover SUV',img:'https://fasttrackrac.com/cdn/shop/products/11_1ae257ad-721e-4766-9db8-38e299289cab.jpg?v=1676898117&width=900',price:1499,was:1999,type:'SUV',seats:5,doors:5,transmission:'Automatic',bags:3,viewers:7,spots:4,badge:'SUV Special',feats:['10.25" Display','Panoramic Roof','360 Camera','Keyless Entry'],includes:'Full insurance + Free delivery',active:true,order:3}
];
let nextCarId = 5;
let bookings = [];
let nextBookingId = 1;
let leads = [];
let nextLeadId = 1;

// ── Activity Logger ──
function logActivity(userId, action, details) {
  const user = users.find(u => u.id === userId);
  activityLog.unshift({
    id: generateId('act'),
    userId,
    userName: user ? user.name : 'System',
    userRole: user ? user.role : 'system',
    action,
    details,
    timestamp: new Date().toISOString()
  });
  if (activityLog.length > 490 && activityLog.length <= 500) console.warn('Activity log approaching limit: ' + activityLog.length + '/500');
  if (activityLog.length > 500) activityLog.length = 500;
}

// ── JWT Auth Middleware ──
function jwtAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-admin-token']) {
    if (req.headers['x-admin-token'] === ADMIN_PASS) {
      req.user = users[0];
      return next();
    }
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === decoded.userId && u.active);
    if (!user) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
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

app.get('/api/cars', (req, res) => {
  const activeCars = cars.filter(c => c.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(c => ({ ...c, trans: c.transmission || c.trans || 'Auto' }));
  res.json(activeCars);
});

app.post('/api/leads', (req, res) => {
  const { fullName, phone, interest, source, whatsapp, email, address } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  const lead = {
    id: nextLeadId++,
    fullName,
    phone,
    whatsapp: whatsapp || phone,
    email: email || '',
    interest: interest || '',
    address: address || '',
    source: source || 'popup',
    status: 'new',
    notes: [],
    convertedToBooking: false,
    createdAt: new Date().toISOString()
  };
  leads.unshift(lead);
  logActivity('system', 'lead_created', `New lead: ${fullName} (${phone})`);
  addNotification('lead', 'New Lead', `${fullName} (${phone}) — ${interest || 'General'}`);
  res.json({ success: true, lead });
});

app.post('/api/bookings', (req, res) => {
  const { carId, carName, startDate, endDate, duration, location, fullName, phone, email, whatsapp, totalAed, savedAed } = req.body;
  if (!carName || !fullName || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ref = 'FT-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  const booking = {
    id: nextBookingId++,
    ref,
    carId: carId || null,
    carName,
    startDate: startDate || '',
    endDate: endDate || '',
    duration: duration || '3',
    location: location || '',
    fullName,
    phone,
    email: email || '',
    whatsapp: whatsapp || '',
    totalAed: totalAed || 0,
    savedAed: savedAed || 0,
    status: 'pending',
    notes: [],
    type: 'booking',
    createdAt: new Date().toISOString()
  };
  bookings.unshift(booking);
  const matchLead = leads.find(l => l.phone === phone && !l.convertedToBooking);
  if (matchLead) matchLead.convertedToBooking = true;
  logActivity('system', 'booking_created', `New booking: ${ref} - ${fullName} for ${carName}`);
  addNotification('booking', 'New Booking', `${ref} — ${fullName} booked ${carName}`);
  res.json({ success: true, ref, booking });
});

// ══════════════════════════════
// AUTH API
// ══════════════════════════════

app.post('/api/auth/login', rateLimit(5, 60000), (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
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
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    const user = users[0];
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ success: true, token: ADMIN_PASS, accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/auth/logout', jwtAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) refreshTokens.delete(refreshToken);
  logActivity(req.user.id, 'logout', `${req.user.name} logged out`);
  res.json({ success: true });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
  const tokenData = refreshTokens.get(refreshToken);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    refreshTokens.delete(refreshToken);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  const user = users.find(u => u.id === tokenData.userId && u.active);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, accessToken });
});

app.get('/api/auth/me', jwtAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, avatar: req.user.avatar, active: req.user.active, createdAt: req.user.createdAt });
});

app.post('/api/auth/reset-request', rateLimit(3, 60000), (req, res) => {
  const { email } = req.body;
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user) return res.json({ success: true, message: 'If the email exists, a reset link has been generated' });
  const token = crypto.randomBytes(32).toString('hex');
  resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 3600000 });
  logActivity(user.id, 'password_reset_requested', `Password reset requested for ${user.email}`);
  res.json({ success: true, message: 'Reset token generated', resetToken: token });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  const tokenData = resetTokens.get(token);
  if (!tokenData || tokenData.expiresAt < Date.now()) { resetTokens.delete(token); return res.status(400).json({ error: 'Invalid or expired reset token' }); }
  const user = users.find(u => u.id === tokenData.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.passwordHash = hashPassword(newPassword);
  resetTokens.delete(token);
  logActivity(user.id, 'password_reset', `Password was reset for ${user.email}`);
  res.json({ success: true });
});

// ══════════════════════════════
// TEAM MANAGEMENT
// ══════════════════════════════

app.get('/api/team', jwtAuth, requireRole('superadmin', 'manager'), (req, res) => {
  res.json(users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, avatar: u.avatar, createdAt: u.createdAt })));
});

app.post('/api/team', jwtAuth, requireRole('superadmin'), (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password required' });
  if (role && !['superadmin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already exists' });
  const newUser = { id: generateId('usr'), email: email.toLowerCase(), passwordHash: hashPassword(password), name, role: role || 'viewer', avatar: null, active: true, createdAt: new Date().toISOString() };
  users.push(newUser);
  logActivity(req.user.id, 'team_member_added', `${req.user.name} added ${name} (${role || 'viewer'})`);
  res.json({ success: true, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, active: newUser.active, createdAt: newUser.createdAt } });
});

app.put('/api/team/:id', jwtAuth, requireRole('superadmin'), (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, email, role, active, password } = req.body;
  if (name) user.name = name;
  if (email) {
    const dup = users.find(u => u.id !== user.id && u.email.toLowerCase() === email.toLowerCase());
    if (dup) return res.status(400).json({ error: 'Email already in use by another member' });
    user.email = email.toLowerCase();
  }
  if (role) user.role = role;
  if (active !== undefined) user.active = active;
  if (password) user.passwordHash = hashPassword(password);
  logActivity(req.user.id, 'team_member_updated', `${req.user.name} updated ${user.name}'s profile`);
  res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, createdAt: user.createdAt } });
});

app.delete('/api/team/:id', jwtAuth, requireRole('superadmin'), (req, res) => {
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (users[idx].id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const deleted = users.splice(idx, 1)[0];
  logActivity(req.user.id, 'team_member_deleted', `${req.user.name} removed ${deleted.name}`);
  res.json({ success: true });
});

// ══════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════

app.get('/api/activity-log', jwtAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json({ items: activityLog.slice(offset, offset + limit), total: activityLog.length });
});

// ══════════════════════════════
// LEADS API (full CRUD + filters)
// ══════════════════════════════

app.get('/api/leads', auth, (req, res) => {
  let result = [...leads];
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
});

// Bulk update leads
app.post('/api/leads/bulk', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { ids, action, status } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

  if (action === 'delete') {
    const deleted = ids.filter(id => {
      const idx = leads.findIndex(l => l.id === id);
      if (idx !== -1) { leads.splice(idx, 1); return true; }
      return false;
    });
    logActivity(req.user.id, 'leads_bulk_deleted', `Deleted ${deleted.length} leads`);
    return res.json({ success: true, affected: deleted.length });
  }
  if (action === 'status' && status) {
    let count = 0;
    ids.forEach(id => {
      const l = leads.find(x => x.id === id);
      if (l) { l.status = status; count++; }
    });
    logActivity(req.user.id, 'leads_bulk_status', `Changed ${count} leads to ${status}`);
    return res.json({ success: true, affected: count });
  }
  res.status(400).json({ error: 'Invalid bulk action' });
});

app.patch('/api/leads/:id', auth, (req, res) => {
  const l = leads.find(x => x.id === parseInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && !VALID_LEAD_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  const fields = ['status', 'fullName', 'phone', 'whatsapp', 'email', 'interest', 'address', 'source', 'convertedToBooking'];
  fields.forEach(f => { if (req.body[f] !== undefined) l[f] = req.body[f]; });
  logActivity(req.user.id, 'lead_updated', `Updated lead ${l.fullName}`);
  res.json(l);
});

// Get single lead
app.get('/api/leads/:id', auth, (req, res) => {
  const l = leads.find(x => x.id === parseInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found' });
  res.json(l);
});

app.post('/api/leads/:id/notes', auth, (req, res) => {
  const l = leads.find(x => x.id === parseInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found' });
  const note = { id: generateId('note'), text: req.body.text, author: req.user.name, createdAt: new Date().toISOString() };
  if (!l.notes) l.notes = [];
  l.notes.unshift(note);
  logActivity(req.user.id, 'lead_note_added', `Added note to lead ${l.fullName}`);
  res.json(note);
});

app.delete('/api/leads/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = leads.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = leads.splice(idx, 1)[0];
  logActivity(req.user.id, 'lead_deleted', `Deleted lead ${deleted.fullName}`);
  res.json({ success: true });
});

// ══════════════════════════════
// BOOKINGS API (full CRUD + filters)
// ══════════════════════════════

app.get('/api/bookings', auth, (req, res) => {
  let result = [...bookings];
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
});

// Get single booking
app.get('/api/bookings/:id', auth, (req, res) => {
  const b = bookings.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

app.patch('/api/bookings/:id', auth, (req, res) => {
  const b = bookings.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && !VALID_BOOKING_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  const fields = ['status', 'carName', 'carId', 'startDate', 'endDate', 'duration', 'location', 'fullName', 'phone', 'email', 'whatsapp', 'totalAed', 'savedAed'];
  const changed = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined && req.body[f] !== b[f]) {
      changed.push(f);
      b[f] = req.body[f];
    }
  });
  if (changed.includes('totalAed')) b.totalAed = Number(b.totalAed);
  logActivity(req.user.id, 'booking_updated', `Updated booking ${b.ref}: ${changed.join(', ')}`);
  res.json(b);
});

// Add note to booking
app.post('/api/bookings/:id/notes', auth, (req, res) => {
  const b = bookings.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Not found' });
  const note = { id: generateId('note'), text: req.body.text, author: req.user.name, createdAt: new Date().toISOString() };
  if (!b.notes) b.notes = [];
  b.notes.unshift(note);
  logActivity(req.user.id, 'booking_note_added', `Added note to booking ${b.ref}`);
  res.json(note);
});

// Bulk bookings
app.post('/api/bookings/bulk', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { ids, action, status } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  if (action === 'delete') {
    const deleted = ids.filter(id => { const idx = bookings.findIndex(b => b.id === id); if (idx !== -1) { bookings.splice(idx, 1); return true; } return false; });
    logActivity(req.user.id, 'bookings_bulk_deleted', `Deleted ${deleted.length} bookings`);
    return res.json({ success: true, affected: deleted.length });
  }
  if (action === 'status' && status) {
    let count = 0;
    ids.forEach(id => { const b = bookings.find(x => x.id === id); if (b) { b.status = status; count++; } });
    logActivity(req.user.id, 'bookings_bulk_status', `Changed ${count} bookings to ${status}`);
    return res.json({ success: true, affected: count });
  }
  res.status(400).json({ error: 'Invalid bulk action' });
});

app.delete('/api/bookings/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = bookings.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = bookings.splice(idx, 1)[0];
  logActivity(req.user.id, 'booking_deleted', `Deleted booking ${deleted.ref}`);
  res.json({ success: true });
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
app.get('/api/cars/admin', auth, (req, res) => {
  const sorted = [...cars].sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(c => ({ ...c, trans: c.transmission || c.trans || 'Auto' }));
  res.json(sorted);
});

app.post('/api/cars', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { name, cat, img, imgCard, imgBooking, price, was, type, seats, doors, transmission, bags, badge, feats, includes, spots, description, year, color, mileage, fuelType } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  const car = {
    id: nextCarId++,
    name, cat: cat || '', img: img || '', imgCard: imgCard || '', imgBooking: imgBooking || '',
    price: Number(price), was: Number(was) || Number(price),
    type: type || '', seats: seats || 5, doors: doors || 4, transmission: transmission || 'Automatic', bags: bags || 2,
    badge: badge || '', feats: feats || [], includes: includes || '',
    description: description || '', year: year || '', color: color || '', mileage: mileage || '', fuelType: fuelType || 'Petrol',
    spots: spots || 5, viewers: Math.floor(Math.random() * 15) + 5,
    active: true, order: cars.length
  };
  cars.push(car);
  logActivity(req.user.id, 'car_added', `Added car: ${name}`);
  res.json(car);
});

app.put('/api/cars/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const car = cars.find(x => x.id === parseInt(req.params.id));
  if (!car) return res.status(404).json({ error: 'Not found' });
  const prev = { ...car };
  Object.assign(car, req.body, { id: car.id });
  car.price = Number(car.price);
  car.was = Number(car.was);
  if (car.seats) car.seats = Number(car.seats);
  if (car.doors) car.doors = Number(car.doors);
  if (car.bags) car.bags = Number(car.bags);
  logActivity(req.user.id, 'car_updated', `Updated car: ${car.name}`);
  res.json(car);
});

// Toggle car visibility
app.patch('/api/cars/:id/toggle', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const car = cars.find(x => x.id === parseInt(req.params.id));
  if (!car) return res.status(404).json({ error: 'Not found' });
  car.active = !car.active;
  logActivity(req.user.id, 'car_toggled', `${car.active ? 'Activated' : 'Deactivated'} car: ${car.name}`);
  res.json(car);
});

// Duplicate car
app.post('/api/cars/:id/duplicate', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const original = cars.find(x => x.id === parseInt(req.params.id));
  if (!original) return res.status(404).json({ error: 'Not found' });
  const dup = {
    ...original,
    id: nextCarId++,
    name: original.name + ' (Copy)',
    order: cars.length,
    viewers: Math.floor(Math.random() * 15) + 5
  };
  cars.push(dup);
  logActivity(req.user.id, 'car_duplicated', `Duplicated car: ${original.name}`);
  res.json(dup);
});

// Reorder cars
app.put('/api/cars/reorder', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { order } = req.body; // array of car IDs in new order
  if (!order || !Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  order.forEach((id, idx) => {
    const car = cars.find(c => c.id === id);
    if (car) car.order = idx;
  });
  logActivity(req.user.id, 'cars_reordered', 'Reordered car display order');
  res.json({ success: true });
});

app.delete('/api/cars/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = cars.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = cars.splice(idx, 1)[0];
  logActivity(req.user.id, 'car_deleted', `Deleted car: ${deleted.name}`);
  res.json({ success: true });
});

// Car stats
app.get('/api/cars/stats', auth, (req, res) => {
  const stats = cars.map(c => {
    const carBookings = bookings.filter(b => b.carId === c.id || b.carName === c.name);
    return {
      id: c.id, name: c.name,
      bookings: carBookings.length,
      revenue: carBookings.reduce((s, b) => s + (Number(b.totalAed) || 0), 0),
      active: c.active
    };
  });
  res.json(stats);
});

// Stats
app.get('/api/stats', auth, (req, res) => {
  const totalBookings = bookings.length;
  const totalLeads = leads.length;
  const totalRevenue = bookings.reduce((s, b) => s + (Number(b.totalAed) || 0), 0);
  const newBookings = bookings.filter(b => b.status === 'new' || b.status === 'pending').length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const convertedLeads = leads.filter(l => l.convertedToBooking).length;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const carCounts = {};
  bookings.forEach(b => { carCounts[b.carName] = (carCounts[b.carName] || 0) + 1; });
  const popularCar = Object.keys(carCounts).sort((a, b) => carCounts[b] - carCounts[a])[0] || '-';
  res.json({ totalBookings, totalLeads, totalRevenue, newBookings, newLeads, convertedLeads, conversionRate, popularCar, totalCars: cars.length });
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

app.get('/api/analytics/overview', auth, (req, res) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = addDays(todayStart, -1);
  const weekStart = addDays(todayStart, -7);
  const prevWeekStart = addDays(todayStart, -14);
  const monthStart = startOfMonth(now);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const todayLeads = leads.filter(l => new Date(l.createdAt) >= todayStart).length;
  const yesterdayLeads = leads.filter(l => { const d = new Date(l.createdAt); return d >= yesterdayStart && d < todayStart; }).length;
  const weekLeads = leads.filter(l => new Date(l.createdAt) >= weekStart).length;
  const prevWeekLeads = leads.filter(l => { const d = new Date(l.createdAt); return d >= prevWeekStart && d < weekStart; }).length;
  const monthLeads = leads.filter(l => new Date(l.createdAt) >= monthStart).length;
  const prevMonthLeads = leads.filter(l => { const d = new Date(l.createdAt); return d >= prevMonthStart && d <= prevMonthEnd; }).length;
  const todayBookings = bookings.filter(b => new Date(b.createdAt) >= todayStart).length;
  const yesterdayBookings = bookings.filter(b => { const d = new Date(b.createdAt); return d >= yesterdayStart && d < todayStart; }).length;
  const weekBookings = bookings.filter(b => new Date(b.createdAt) >= weekStart).length;
  const monthBookings = bookings.filter(b => new Date(b.createdAt) >= monthStart).length;
  const todayRevenue = bookings.filter(b => new Date(b.createdAt) >= todayStart).reduce((s, b) => s + (Number(b.totalAed) || 0), 0);
  const yesterdayRevenue = bookings.filter(b => { const d = new Date(b.createdAt); return d >= yesterdayStart && d < todayStart; }).reduce((s, b) => s + (Number(b.totalAed) || 0), 0);
  const totalRevenue = bookings.reduce((s, b) => s + (Number(b.totalAed) || 0), 0);
  const totalLeads = leads.length;
  const totalBookingsCount = bookings.length;
  const convertedLeads = leads.filter(l => l.convertedToBooking).length;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const activeCars = cars.filter(c => c.active !== false).length;
  const hotCutoff = Date.now() - 1800000;
  const hotLeads = leads.filter(l => l.status === 'new' && new Date(l.createdAt).getTime() >= hotCutoff);

  res.json({
    leads: { today: todayLeads, yesterday: yesterdayLeads, week: weekLeads, prevWeek: prevWeekLeads, month: monthLeads, prevMonth: prevMonthLeads, total: totalLeads },
    bookings: { today: todayBookings, yesterday: yesterdayBookings, week: weekBookings, month: monthBookings, total: totalBookingsCount },
    revenue: { today: todayRevenue, yesterday: yesterdayRevenue, total: totalRevenue },
    conversionRate, activeCars,
    liveVisitors: liveVisitors.size,
    pageViews: pageViews || Math.max(leads.length * 8, 100),
    hotLeads: hotLeads.map(l => ({ id: l.id, fullName: l.fullName, phone: l.phone, interest: l.interest, createdAt: l.createdAt }))
  });
});

app.get('/api/analytics/leads', auth, (req, res) => {
  const period = req.query.period || 'daily';
  const { start, end } = getDateRange(req.query.from, req.query.to);
  const filtered = leads.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  res.json(groupByPeriod(filtered, 'createdAt', period));
});

app.get('/api/analytics/bookings', auth, (req, res) => {
  const period = req.query.period || 'daily';
  const { start, end } = getDateRange(req.query.from, req.query.to);
  const filtered = bookings.filter(b => { const d = new Date(b.createdAt); return d >= start && d <= end; });
  res.json(groupByPeriod(filtered, 'createdAt', period));
});

app.get('/api/analytics/revenue', auth, (req, res) => {
  const period = req.query.period || 'daily';
  const { start, end } = getDateRange(req.query.from, req.query.to);
  const filtered = bookings.filter(b => { const d = new Date(b.createdAt); return d >= start && d <= end; });
  res.json(groupRevByPeriod(filtered, period));
});

app.get('/api/analytics/sources', auth, (req, res) => {
  const counts = {};
  leads.forEach(l => { const s = l.source || 'unknown'; counts[s] = (counts[s] || 0) + 1; });
  res.json(counts);
});

app.get('/api/analytics/popular-cars', auth, (req, res) => {
  const counts = {};
  bookings.forEach(b => { counts[b.carName] = (counts[b.carName] || 0) + 1; });
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })));
});

app.get('/api/analytics/locations', auth, (req, res) => {
  const counts = {};
  bookings.forEach(b => { const loc = b.location || 'Unknown'; counts[loc] = (counts[loc] || 0) + 1; });
  res.json(counts);
});

app.get('/api/analytics/funnel', auth, (req, res) => {
  res.json({ pageViews: pageViews || Math.max(leads.length * 8, 100), leads: leads.length, bookings: bookings.length });
});

app.get('/api/analytics/activity', auth, (req, res) => {
  res.json(activityLog.slice(0, 20));
});

// ══════════════════════════════
// CMS CONFIG API
// ══════════════════════════════

const DEFAULT_SECTIONS = [
  { id: 'nav', name: 'Navigation', type: 'builtin', visible: true, order: 0 },
  { id: 'countdown', name: 'Countdown Timer', type: 'builtin', visible: true, order: 1 },
  { id: 'hero', name: 'Hero Section', type: 'builtin', visible: true, order: 2 },
  { id: 'ticker', name: 'Social Proof Ticker', type: 'builtin', visible: true, order: 3 },
  { id: 'trust', name: 'Trust Bar', type: 'builtin', visible: true, order: 4 },
  { id: 'cars', name: 'Cars / Offers', type: 'builtin', visible: true, order: 5 },
  { id: 'why', name: 'Why Us', type: 'builtin', visible: true, order: 6 },
  { id: 'reviews', name: 'Customer Reviews', type: 'builtin', visible: true, order: 7 },
  { id: 'guarantee', name: 'Guarantee', type: 'builtin', visible: true, order: 8 },
  { id: 'finalcta', name: 'Final CTA', type: 'builtin', visible: true, order: 9 },
  { id: 'footer', name: 'Footer', type: 'builtin', visible: true, order: 10 },
  { id: 'sticky', name: 'Sticky Bottom Bar', type: 'builtin', visible: true, order: 11 },
  { id: 'leadpopup', name: 'Lead Popup', type: 'builtin', visible: true, order: 12 }
];

let siteConfig = {
  content: {
    logo: 'FASTRACK',
    nav: { ctaText: 'View Offers' },
    countdown: { enabled: true, urgencyText: 'DEAL EXPIRES IN:', endDate: '' },
    hero: {
      urgencyBadge: 'Offer Ends Soon — Limited Spots',
      headline: 'SAVE UP TO <strong>40%</strong> ON MONTHLY CAR RENTAL',
      subtext: 'Premium cars from AED 999/month. Full insurance, free UAE delivery, zero hidden fees.',
      proof1: '4.9/5 from 2,500+ customers',
      proof2: '143 booked this week',
      ctaPrimary: 'Claim Your Deal',
      ctaSecondary: 'WhatsApp Us',
      liveText: 'people viewing offers right now'
    },
    ticker: {
      messages: [
        'Ahmed from Dubai Marina just booked a Mitsubishi ASX',
        'Sara saved AED 2,400 on a 3-month plan',
        'Mohammed from Business Bay booked 2 min ago',
        '143 rentals booked this week',
        '4.9★ average from 2,500+ customers'
      ]
    },
    trust: {
      items: ['Full Insurance', 'Free Delivery', '24/7 Assist', 'No Hidden Fees', 'Cancel Anytime']
    },
    carsSection: {
      tag: 'Limited Spots Available',
      headline: 'CHOOSE YOUR <strong>DEAL</strong>',
      subtext: 'Lock in your discounted monthly rate before it\'s gone.'
    },
    whyUs: {
      label: 'Why 2,500+ Customers Trust Us',
      title: 'THE FASTRACK DIFFERENCE',
      cards: [
        { icon: '🛡️', title: 'Full Insurance', text: 'Comprehensive coverage. Zero deductibles, zero worries.' },
        { icon: '🚚', title: 'Free Delivery', text: 'To your doorstep anywhere in UAE. No pickup hassle.' },
        { icon: '💰', title: 'No Hidden Fees', text: 'Price you see is the price you pay. Period.' },
        { icon: '⚡', title: '2-Min Booking', text: 'Pick, confirm, done. Car at your door tomorrow.' },
        { icon: '🔄', title: 'Flexible Plans', text: 'Switch cars, extend, or cancel anytime. No penalties.' },
        { icon: '📞', title: '24/7 Support', text: 'Phone & WhatsApp support around the clock.' }
      ]
    },
    reviews: {
      label: 'Real Reviews',
      title: 'WHAT OUR CUSTOMERS SAY',
      items: [
        { stars: 5, text: 'Saved AED 2,400 on a 3-month rental. Fastrack beat every quote I got.', name: 'Ahmed K.', role: 'Business Consultant, Dubai Marina' },
        { stars: 5, text: 'Compared 5 companies. Fastrack was 40% cheaper with better insurance.', name: 'Sara M.', role: 'Marketing Manager, Business Bay' },
        { stars: 5, text: 'Booked in 2 minutes. Car delivered next day to my apartment.', name: 'Omar H.', role: 'Entrepreneur, JBR' },
        { stars: 5, text: 'I was paying AED 2,200/month before. Now paying AED 1,299. Same class of car.', name: 'Khalid R.', role: 'Sales Director, Downtown' },
        { stars: 5, text: 'Needed a car urgently. Called at 9pm, had a car by 8am next morning.', name: 'Fatima A.', role: 'Consultant, Abu Dhabi' },
        { stars: 5, text: 'Third time renting from them. Consistent quality and fair pricing.', name: 'Rami T.', role: 'Freelancer, Deira' },
        { stars: 5, text: 'Rented a JS4 for 6 months. Panoramic roof, 360 camera — luxury for less.', name: 'Layla S.', role: 'Interior Designer, JBR' },
        { stars: 5, text: 'My company rents 3 cars from Fastrack. Best fleet deal in the UAE.', name: 'Nasser Q.', role: 'CEO, Small Business, Sharjah' }
      ]
    },
    guarantee: {
      headline: 'PRICE MATCH <strong>GUARANTEE</strong>',
      subtext: 'Found a cheaper monthly rate? We\'ll match it + give you extra 5% off.'
    },
    finalCta: {
      headline: 'DON\'T MISS OUT — <strong>LOCK YOUR RATE</strong>',
      subtext: 'Prices go up when spots are filled. Secure your deal today.',
      buttonText: 'View Deals'
    },
    footer: {
      copyright: '© 2024 Fastrack Rent a Car • Dubai, UAE',
      phone: '+971 58 596 9960',
      whatsappText: 'WhatsApp',
      email: 'info@fasttrackrac.com'
    },
    stickyBar: {
      prefix: 'From',
      wasPrice: 'AED 1,399',
      currentPrice: 'AED 999/mo',
      buttonText: 'Claim Deal'
    },
    leadPopup: {
      headline: 'Wait — Get 5% Extra Off',
      subtext: 'Drop your WhatsApp and we\'ll send you an exclusive discount code.',
      buttonText: 'Send Me The Deal',
      skipText: 'No thanks, I\'ll pay full price'
    },
    notifications: {
      messages: [
        'Ahmed from Dubai Marina just booked Mitsubishi ASX',
        'Sara from JBR saved AED 2,400',
        'Mohammed from Business Bay booked 2 min ago',
        'Fatima from Downtown claimed the JAC J7 deal',
        'Ali from Sharjah booked Mitsubishi Attrage',
        'Khalid from Abu Dhabi just booked JAC JS4'
      ]
    }
  },
  sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
  settings: {
    colors: { primary: '#FF5F00', dark: '#1A1A1A', accent: '#00C853' },
    fonts: { family: 'Inter', sizePreset: 'default' },
    seo: { title: 'Fastrack Rent a Car Dubai — Save Up to 40%', description: 'Premium monthly car rental in Dubai from AED 999. Full insurance, free delivery.', ogImage: '' },
    scripts: { headerScripts: '', footerScripts: '' },
    social: { whatsapp: '971585969960', phone: '+971 58 596 9960', email: 'info@fasttrackrac.com' }
  }
};

// Public: landing page fetches config
app.get('/api/config', (req, res) => {
  res.json(siteConfig);
});

// Admin: update full config
app.put('/api/config', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { content, settings } = req.body;
  if (content) siteConfig.content = { ...siteConfig.content, ...content };
  if (settings) siteConfig.settings = { ...siteConfig.settings, ...settings };
  logActivity(req.user.id, 'config_updated', 'Updated landing page configuration');
  res.json({ success: true, config: siteConfig });
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
  logActivity(req.user.id, 'sections_reordered', 'Reordered landing page sections');
  res.json({ success: true, sections: siteConfig.sections.sort((a, b) => a.order - b.order) });
});

// Toggle section visibility
app.patch('/api/config/sections/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const sec = siteConfig.sections.find(s => s.id === req.params.id);
  if (!sec) return res.status(404).json({ error: 'Section not found' });
  if (req.body.visible !== undefined) sec.visible = req.body.visible;
  if (req.body.name) sec.name = req.body.name;
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
  logActivity(req.user.id, 'section_added', `Added custom section: ${name}`);
  res.json(sec);
});

// Delete custom section
app.delete('/api/config/sections/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = siteConfig.sections.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Section not found' });
  if (siteConfig.sections[idx].type === 'builtin') return res.status(400).json({ error: 'Cannot delete built-in sections' });
  const deleted = siteConfig.sections.splice(idx, 1)[0];
  logActivity(req.user.id, 'section_deleted', `Deleted section: ${deleted.name}`);
  res.json({ success: true });
});

// Reset config to defaults
app.post('/api/config/reset', auth, requireRole('superadmin'), (req, res) => {
  siteConfig.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  logActivity(req.user.id, 'config_reset', 'Reset landing page sections to defaults');
  res.json({ success: true });
});

// ══════════════════════════════
// NOTIFICATIONS API
// ══════════════════════════════

app.get('/api/notifications', auth, (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const unreadOnly = req.query.unread === 'true';
  let result = notifications;
  if (unreadOnly) result = result.filter(n => !n.read);
  res.json({ items: result.slice(0, limit), unreadCount: notifications.filter(n => !n.read).length });
});

app.patch('/api/notifications/:id/read', auth, (req, res) => {
  const n = notifications.find(x => String(x.id) === req.params.id);
  if (n) n.read = true;
  res.json({ success: true });
});

app.post('/api/notifications/read-all', auth, (req, res) => {
  notifications.forEach(n => n.read = true);
  res.json({ success: true });
});

// ══════════════════════════════
// GLOBAL SEARCH API
// ══════════════════════════════

app.get('/api/search', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q || q.length < 2) return res.json({ leads: [], bookings: [], cars: [] });

  const matchedLeads = leads.filter(l => `${l.fullName} ${l.phone} ${l.email} ${l.interest}`.toLowerCase().includes(q)).slice(0, 8).map(l => ({ id: l.id, type: 'lead', title: l.fullName, subtitle: l.phone + ' — ' + (l.status || 'new'), icon: '&#128101;' }));
  const matchedBookings = bookings.filter(b => `${b.fullName} ${b.phone} ${b.ref} ${b.carName}`.toLowerCase().includes(q)).slice(0, 8).map(b => ({ id: b.id, type: 'booking', title: b.ref + ' — ' + b.fullName, subtitle: b.carName + ' — ' + (b.status || 'pending'), icon: '&#128203;' }));
  const matchedCars = cars.filter(c => `${c.name} ${c.cat} ${c.type}`.toLowerCase().includes(q)).slice(0, 8).map(c => ({ id: c.id, type: 'car', title: c.name, subtitle: c.cat + ' — AED ' + c.price, icon: '&#128663;' }));

  res.json({ leads: matchedLeads, bookings: matchedBookings, cars: matchedCars });
});

// ══════════════════════════════
// DATA EXPORT / IMPORT / CLEAR
// ══════════════════════════════

app.get('/api/export', auth, (req, res) => {
  res.json({
    exportDate: new Date().toISOString(),
    version: '2.0',
    leads, bookings, cars,
    config: siteConfig,
    activityLog: activityLog.slice(0, 100)
  });
});

app.post('/api/import', auth, requireRole('superadmin'), (req, res) => {
  const { data, mode } = req.body; // mode: 'merge' or 'replace'
  if (!data) return res.status(400).json({ error: 'No data provided' });

  try {
    if (mode === 'replace') {
      if (data.leads) { leads = data.leads; nextLeadId = Math.max(...leads.map(l => l.id || 0), 0) + 1; }
      if (data.bookings) { bookings = data.bookings; nextBookingId = Math.max(...bookings.map(b => b.id || 0), 0) + 1; }
      if (data.cars) { cars = data.cars; nextCarId = Math.max(...cars.map(c => c.id || 0), 0) + 1; }
      if (data.config) { siteConfig = { ...siteConfig, ...data.config }; }
    } else {
      if (data.leads) { const existIds = new Set(leads.map(l => l.id)); data.leads.forEach(l => { if (!existIds.has(l.id)) leads.push(l); }); nextLeadId = Math.max(...leads.map(l => l.id || 0), 0) + 1; }
      if (data.bookings) { const existIds = new Set(bookings.map(b => b.id)); data.bookings.forEach(b => { if (!existIds.has(b.id)) bookings.push(b); }); nextBookingId = Math.max(...bookings.map(b => b.id || 0), 0) + 1; }
      if (data.cars) { const existIds = new Set(cars.map(c => c.id)); data.cars.forEach(c => { if (!existIds.has(c.id)) cars.push(c); }); nextCarId = Math.max(...cars.map(c => c.id || 0), 0) + 1; }
    }
    logActivity(req.user.id, 'data_imported', `Imported data (${mode} mode)`);
    addNotification('system', 'Data Imported', `Data was imported in ${mode} mode`);
    res.json({ success: true, counts: { leads: leads.length, bookings: bookings.length, cars: cars.length } });
  } catch(e) {
    res.status(400).json({ error: 'Invalid data format: ' + e.message });
  }
});

app.delete('/api/data', auth, requireRole('superadmin'), (req, res) => {
  const { confirmToken } = req.body;
  if (confirmToken !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
  const prevCounts = { leads: leads.length, bookings: bookings.length };
  leads = []; bookings = []; nextLeadId = 1; nextBookingId = 1;
  logActivity(req.user.id, 'data_cleared', `Cleared all data (${prevCounts.leads} leads, ${prevCounts.bookings} bookings)`);
  addNotification('system', 'Data Cleared', 'All leads and bookings have been cleared');
  res.json({ success: true });
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log('Fastrack server running on port ' + PORT);
});
