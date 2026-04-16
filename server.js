const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'fastrack2024';

app.use(express.json());
app.use(express.static(__dirname));

// ── In-memory data store ──
let cars = [
  {id:1,name:'Mitsubishi Attrage',cat:'Economy Sedan',img:'https://fasttrackrac.com/cdn/shop/products/fastrack-Mitsubishi-attrage-car.jpg?v=1726815463&width=900',price:999,was:1399,type:'Sedan',viewers:12,spots:3,badge:'Best Value',feats:['A/C','Reverse Camera','Bluetooth','Fog Lights'],includes:'Insurance + UAE delivery included'},
  {id:2,name:'JAC J7',cat:'Sport Sedan',img:'https://fasttrackrac.com/cdn/shop/products/3_4084eaf4-7efa-4c62-bc2d-85fb8ee7faaa.jpg?v=1676898190&width=900',price:1299,was:1899,type:'Liftback',viewers:9,spots:5,badge:'Hot Deal',feats:['Premium Audio','Leather Seats','Touchscreen','Keyless Entry'],includes:'Full insurance + Free delivery'},
  {id:3,name:'Mitsubishi ASX',cat:'Compact SUV',img:'https://fasttrackrac.com/cdn/shop/files/20240622_110500.jpg?v=1726652270&width=900',price:1299,was:1899,type:'SUV',viewers:18,spots:2,badge:'Most Popular',feats:['Apple CarPlay','Cruise Control','Rear Camera','Fuel Efficient'],includes:'Insurance + Unlimited km'},
  {id:4,name:'JAC JS4',cat:'Crossover SUV',img:'https://fasttrackrac.com/cdn/shop/products/11_1ae257ad-721e-4766-9db8-38e299289cab.jpg?v=1676898117&width=900',price:1499,was:1999,type:'SUV',viewers:7,spots:4,badge:'SUV Special',feats:['10.25" Display','Panoramic Roof','360 Camera','Keyless Entry'],includes:'Full insurance + Free delivery'}
];
let nextCarId = 5;
let bookings = [];
let nextBookingId = 1;

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === ADMIN_PASS) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ══════════════════════════════
// PUBLIC API
// ══════════════════════════════

// Get all cars (public)
app.get('/api/cars', (req, res) => {
  res.json(cars);
});

// Create booking (public - from landing page)
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
    status: 'new',
    createdAt: new Date().toISOString()
  };
  bookings.unshift(booking);
  res.json({ success: true, ref, booking });
});

// ══════════════════════════════
// ADMIN API (requires auth)
// ══════════════════════════════

// Login check
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    res.json({ success: true, token: ADMIN_PASS });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Get all bookings
app.get('/api/bookings', auth, (req, res) => {
  res.json(bookings);
});

// Update booking status
app.patch('/api/bookings/:id', auth, (req, res) => {
  const b = bookings.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) b.status = req.body.status;
  res.json(b);
});

// Delete booking
app.delete('/api/bookings/:id', auth, (req, res) => {
  const idx = bookings.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  bookings.splice(idx, 1);
  res.json({ success: true });
});

// Add car
app.post('/api/cars', auth, (req, res) => {
  const { name, cat, img, price, was, type, badge, feats, includes, spots } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  const car = {
    id: nextCarId++,
    name, cat: cat || '', img: img || '', price: Number(price), was: Number(was) || Number(price),
    type: type || '', badge: badge || '', feats: feats || [], includes: includes || '',
    spots: spots || 5, viewers: Math.floor(Math.random() * 15) + 5
  };
  cars.push(car);
  res.json(car);
});

// Update car
app.put('/api/cars/:id', auth, (req, res) => {
  const car = cars.find(x => x.id === parseInt(req.params.id));
  if (!car) return res.status(404).json({ error: 'Not found' });
  Object.assign(car, req.body, { id: car.id });
  car.price = Number(car.price);
  car.was = Number(car.was);
  res.json(car);
});

// Delete car
app.delete('/api/cars/:id', auth, (req, res) => {
  const idx = cars.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  cars.splice(idx, 1);
  res.json({ success: true });
});

// Stats
app.get('/api/stats', auth, (req, res) => {
  const totalBookings = bookings.length;
  const totalRevenue = bookings.reduce((s, b) => s + (Number(b.totalAed) || 0), 0);
  const newBookings = bookings.filter(b => b.status === 'new').length;
  const carCounts = {};
  bookings.forEach(b => { carCounts[b.carName] = (carCounts[b.carName] || 0) + 1; });
  const popularCar = Object.keys(carCounts).sort((a, b) => carCounts[b] - carCounts[a])[0] || '-';
  res.json({ totalBookings, totalRevenue, newBookings, popularCar, totalCars: cars.length });
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log('Fastrack server running on port ' + PORT);
});
