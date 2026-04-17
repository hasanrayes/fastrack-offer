const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'fastrack2024';
const JWT_SECRET = process.env.JWT_SECRET || 'fastrack-secret-' + crypto.randomBytes(16).toString('hex');
const JWT_EXPIRY = '24h';
const JWT_REFRESH_EXPIRY = '7d';

app.use(express.json());
app.use(express.static(__dirname));

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
  const activeCars = cars.filter(c => c.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(activeCars);
});

app.post('/api/leads', (req, res) => {
  const { fullName, phone, interest, source, whatsapp, email } = req.body;
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
    source: source || 'popup',
    status: 'new',
    notes: [],
    convertedToBooking: false,
    createdAt: new Date().toISOString()
  };
  leads.unshift(lead);
  logActivity('system', 'lead_created', `New lead: ${fullName} (${phone})`);
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
  res.json({ success: true, ref, booking });
});

// ══════════════════════════════
// AUTH API
// ══════════════════════════════

app.post('/api/auth/login', (req, res) => {
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

app.post('/api/auth/reset-request', (req, res) => {
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
  if (email) user.email = email.toLowerCase();
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
  if (req.query.from) result = result.filter(l => new Date(l.createdAt) >= new Date(req.query.from));
  if (req.query.to) result = result.filter(l => new Date(l.createdAt) <= new Date(req.query.to + 'T23:59:59'));
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
  const fields = ['status', 'fullName', 'phone', 'whatsapp', 'email', 'interest', 'source', 'convertedToBooking'];
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
// CARS API (full CRUD + ordering + visibility + duplicate)
// ══════════════════════════════

// Admin cars listing (includes inactive)
app.get('/api/cars/admin', auth, (req, res) => {
  const sorted = [...cars].sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(sorted);
});

app.post('/api/cars', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { name, cat, img, price, was, type, seats, doors, transmission, bags, badge, feats, includes, spots } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  const car = {
    id: nextCarId++,
    name, cat: cat || '', img: img || '', price: Number(price), was: Number(was) || Number(price),
    type: type || '', seats: seats || 5, doors: doors || 4, transmission: transmission || 'Automatic', bags: bags || 2,
    badge: badge || '', feats: feats || [], includes: includes || '',
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

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log('Fastrack server running on port ' + PORT);
});
