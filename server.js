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

let refreshTokens = new Map(); // token -> { userId, expiresAt }
let resetTokens = new Map();   // token -> { userId, expiresAt }
let activityLog = [];

let cars = [
  {id:1,name:'Mitsubishi Attrage',cat:'Economy Sedan',img:'https://fasttrackrac.com/cdn/shop/products/fastrack-Mitsubishi-attrage-car.jpg?v=1726815463&width=900',price:999,was:1399,type:'Sedan',viewers:12,spots:3,badge:'Best Value',feats:['A/C','Reverse Camera','Bluetooth','Fog Lights'],includes:'Insurance + UAE delivery included',active:true,order:0},
  {id:2,name:'JAC J7',cat:'Sport Sedan',img:'https://fasttrackrac.com/cdn/shop/products/3_4084eaf4-7efa-4c62-bc2d-85fb8ee7faaa.jpg?v=1676898190&width=900',price:1299,was:1899,type:'Liftback',viewers:9,spots:5,badge:'Hot Deal',feats:['Premium Audio','Leather Seats','Touchscreen','Keyless Entry'],includes:'Full insurance + Free delivery',active:true,order:1},
  {id:3,name:'Mitsubishi ASX',cat:'Compact SUV',img:'https://fasttrackrac.com/cdn/shop/files/20240622_110500.jpg?v=1726652270&width=900',price:1299,was:1899,type:'SUV',viewers:18,spots:2,badge:'Most Popular',feats:['Apple CarPlay','Cruise Control','Rear Camera','Fuel Efficient'],includes:'Insurance + Unlimited km',active:true,order:2},
  {id:4,name:'JAC JS4',cat:'Crossover SUV',img:'https://fasttrackrac.com/cdn/shop/products/11_1ae257ad-721e-4766-9db8-38e299289cab.jpg?v=1676898117&width=900',price:1499,was:1999,type:'SUV',viewers:7,spots:4,badge:'SUV Special',feats:['10.25" Display','Panoramic Roof','360 Camera','Keyless Entry'],includes:'Full insurance + Free delivery',active:true,order:3}
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
  // Support both Bearer token and legacy x-admin-token
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-admin-token']) {
    // Legacy support: if someone sends the raw password, create a minimal user context
    if (req.headers['x-admin-token'] === ADMIN_PASS) {
      req.user = users[0]; // default admin
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

// ── Role Check Middleware ──
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Keep backward compat alias
function auth(req, res, next) {
  return jwtAuth(req, res, next);
}

// ══════════════════════════════
// PUBLIC API
// ══════════════════════════════

app.get('/api/cars', (req, res) => {
  // Public endpoint returns only active cars, sorted by order
  const activeCars = cars.filter(c => c.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(activeCars);
});

app.post('/api/leads', (req, res) => {
  const { fullName, phone, interest, source } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  const lead = {
    id: nextLeadId++,
    fullName,
    phone,
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
  const { carId, carName, startDate, duration, location, fullName, phone, email, whatsapp, totalAed, savedAed } = req.body;
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
    duration: duration || '3',
    location: location || '',
    fullName,
    phone,
    email: email || '',
    whatsapp: whatsapp || '',
    totalAed: totalAed || 0,
    savedAed: savedAed || 0,
    status: 'pending',
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

// Login
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
  refreshTokens.set(refreshToken, {
    userId: user.id,
    expiresAt: Date.now() + refreshExpiry
  });

  logActivity(user.id, 'login', `${user.name} logged in`);

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar: user.avatar
    }
  });
});

// Legacy auth endpoint (backward compat)
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

// Logout
app.post('/api/auth/logout', jwtAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    refreshTokens.delete(refreshToken);
  }
  logActivity(req.user.id, 'logout', `${req.user.name} logged out`);
  res.json({ success: true });
});

// Refresh token
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const tokenData = refreshTokens.get(refreshToken);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    refreshTokens.delete(refreshToken);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = users.find(u => u.id === tokenData.userId && u.active);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, accessToken });
});

// Get current user
app.get('/api/auth/me', jwtAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
    avatar: req.user.avatar,
    active: req.user.active,
    createdAt: req.user.createdAt
  });
});

// Password reset - request
app.post('/api/auth/reset-request', (req, res) => {
  const { email } = req.body;
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user) {
    // Don't reveal if email exists
    return res.json({ success: true, message: 'If the email exists, a reset link has been generated' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 3600000 }); // 1 hour
  logActivity(user.id, 'password_reset_requested', `Password reset requested for ${user.email}`);

  // In production this would send an email. For now return the token.
  res.json({ success: true, message: 'Reset token generated', resetToken: token });
});

// Password reset - execute
app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  const tokenData = resetTokens.get(token);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    resetTokens.delete(token);
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const user = users.find(u => u.id === tokenData.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.passwordHash = hashPassword(newPassword);
  resetTokens.delete(token);
  logActivity(user.id, 'password_reset', `Password was reset for ${user.email}`);
  res.json({ success: true });
});

// ══════════════════════════════
// TEAM MANAGEMENT (Super Admin only)
// ══════════════════════════════

// List team members
app.get('/api/team', jwtAuth, requireRole('superadmin', 'manager'), (req, res) => {
  const teamList = users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    avatar: u.avatar,
    createdAt: u.createdAt
  }));
  res.json(teamList);
});

// Add team member
app.post('/api/team', jwtAuth, requireRole('superadmin'), (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, name, and password required' });
  }

  const validRoles = ['superadmin', 'manager', 'viewer'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const newUser = {
    id: generateId('usr'),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    name,
    role: role || 'viewer',
    avatar: null,
    active: true,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  logActivity(req.user.id, 'team_member_added', `${req.user.name} added ${name} (${role || 'viewer'})`);

  res.json({
    success: true,
    user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, active: newUser.active, createdAt: newUser.createdAt }
  });
});

// Update team member
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

  res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, createdAt: user.createdAt }
  });
});

// Delete team member
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
  res.json({
    items: activityLog.slice(offset, offset + limit),
    total: activityLog.length
  });
});

// ══════════════════════════════
// ADMIN API (requires auth)
// ══════════════════════════════

// Get all leads
app.get('/api/leads', auth, (req, res) => {
  res.json(leads);
});

// Update lead
app.patch('/api/leads/:id', auth, (req, res) => {
  const l = leads.find(x => x.id === parseInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) {
    logActivity(req.user.id, 'lead_status_changed', `Changed lead ${l.fullName} status to ${req.body.status}`);
    l.status = req.body.status;
  }
  if (req.body.fullName) l.fullName = req.body.fullName;
  if (req.body.phone) l.phone = req.body.phone;
  if (req.body.interest) l.interest = req.body.interest;
  if (req.body.convertedToBooking !== undefined) l.convertedToBooking = req.body.convertedToBooking;
  res.json(l);
});

// Add note to lead
app.post('/api/leads/:id/notes', auth, (req, res) => {
  const l = leads.find(x => x.id === parseInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found' });
  const note = {
    id: generateId('note'),
    text: req.body.text,
    author: req.user.name,
    createdAt: new Date().toISOString()
  };
  if (!l.notes) l.notes = [];
  l.notes.unshift(note);
  logActivity(req.user.id, 'lead_note_added', `Added note to lead ${l.fullName}`);
  res.json(note);
});

// Delete lead
app.delete('/api/leads/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = leads.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = leads.splice(idx, 1)[0];
  logActivity(req.user.id, 'lead_deleted', `Deleted lead ${deleted.fullName}`);
  res.json({ success: true });
});

// Get all bookings
app.get('/api/bookings', auth, (req, res) => {
  res.json(bookings);
});

app.patch('/api/bookings/:id', auth, (req, res) => {
  const b = bookings.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) {
    logActivity(req.user.id, 'booking_status_changed', `Changed booking ${b.ref} status to ${req.body.status}`);
    b.status = req.body.status;
  }
  if (req.body.carName) b.carName = req.body.carName;
  if (req.body.startDate) b.startDate = req.body.startDate;
  if (req.body.duration) b.duration = req.body.duration;
  if (req.body.location) b.location = req.body.location;
  if (req.body.totalAed !== undefined) b.totalAed = req.body.totalAed;
  res.json(b);
});

app.delete('/api/bookings/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = bookings.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = bookings.splice(idx, 1)[0];
  logActivity(req.user.id, 'booking_deleted', `Deleted booking ${deleted.ref}`);
  res.json({ success: true });
});

app.post('/api/cars', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const { name, cat, img, price, was, type, badge, feats, includes, spots } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  const car = {
    id: nextCarId++,
    name, cat: cat || '', img: img || '', price: Number(price), was: Number(was) || Number(price),
    type: type || '', badge: badge || '', feats: feats || [], includes: includes || '',
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
  Object.assign(car, req.body, { id: car.id });
  car.price = Number(car.price);
  car.was = Number(car.was);
  logActivity(req.user.id, 'car_updated', `Updated car: ${car.name}`);
  res.json(car);
});

app.delete('/api/cars/:id', auth, requireRole('superadmin', 'manager'), (req, res) => {
  const idx = cars.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = cars.splice(idx, 1)[0];
  logActivity(req.user.id, 'car_deleted', `Deleted car: ${deleted.name}`);
  res.json({ success: true });
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
