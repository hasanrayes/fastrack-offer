const crypto = require('crypto');
const db = require('./db');

const ADMIN_PASS = process.env.ADMIN_PASS || 'fastrack2024';

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const DEFAULT_CARS = [
  { id: 1, name: 'Mitsubishi Attrage', cat: 'Economy Sedan', img: 'https://fasttrackrac.com/cdn/shop/products/fastrack-Mitsubishi-attrage-car.jpg?v=1726815463&width=900', price: 999, was: 1399, type: 'Sedan', seats: 5, doors: 4, transmission: 'Automatic', bags: 2, viewers: 12, spots: 3, badge: 'Best Value', feats: ['A/C','Reverse Camera','Bluetooth','Fog Lights'], includes: 'Insurance + UAE delivery included', active: true, sort_order: 0 },
  { id: 2, name: 'JAC J7', cat: 'Sport Sedan', img: 'https://fasttrackrac.com/cdn/shop/products/3_4084eaf4-7efa-4c62-bc2d-85fb8ee7faaa.jpg?v=1676898190&width=900', price: 1299, was: 1899, type: 'Liftback', seats: 5, doors: 4, transmission: 'Automatic', bags: 2, viewers: 9, spots: 5, badge: 'Hot Deal', feats: ['Premium Audio','Leather Seats','Touchscreen','Keyless Entry'], includes: 'Full insurance + Free delivery', active: true, sort_order: 1 },
  { id: 3, name: 'Mitsubishi ASX', cat: 'Compact SUV', img: 'https://fasttrackrac.com/cdn/shop/files/20240622_110500.jpg?v=1726652270&width=900', price: 1299, was: 1899, type: 'SUV', seats: 5, doors: 5, transmission: 'Automatic', bags: 3, viewers: 18, spots: 2, badge: 'Most Popular', feats: ['Apple CarPlay','Cruise Control','Rear Camera','Fuel Efficient'], includes: 'Insurance + Unlimited km', active: true, sort_order: 2 },
  { id: 4, name: 'JAC JS4', cat: 'Crossover SUV', img: 'https://fasttrackrac.com/cdn/shop/products/11_1ae257ad-721e-4766-9db8-38e299289cab.jpg?v=1676898117&width=900', price: 1499, was: 1999, type: 'SUV', seats: 5, doors: 5, transmission: 'Automatic', bags: 3, viewers: 7, spots: 4, badge: 'SUV Special', feats: ['10.25" Display','Panoramic Roof','360 Camera','Keyless Entry'], includes: 'Full insurance + Free delivery', active: true, sort_order: 3 }
];

const DEFAULT_TEMPLATES = [
  { id: 'tpl_welcome', name: 'Welcome Message', category: 'welcome', body: 'Hi {{name}}! Welcome to Fastrack Rent a Car. We received your inquiry about {{car}}. One of our agents will contact you shortly.' },
  { id: 'tpl_confirmation', name: 'Booking Confirmation', category: 'booking', body: 'Hi {{name}}, your booking {{ref}} for {{car}} starting {{date}} is confirmed. Total: AED {{price}}. We will be in touch to finalize delivery.' },
  { id: 'tpl_payment', name: 'Payment Reminder', category: 'payment', body: 'Hi {{name}}, friendly reminder about your pending payment for booking {{ref}}. Total due: AED {{price}}. Please let us know how you would like to proceed.' },
  { id: 'tpl_delivery', name: 'Delivery Scheduled', category: 'delivery', body: 'Hi {{name}}, your {{car}} delivery is scheduled for {{date}}. Our driver will contact you 30 minutes before arrival. Ref: {{ref}}' },
  { id: 'tpl_return', name: 'Return Reminder', category: 'return', body: 'Hi {{name}}, this is a reminder that your rental ({{car}}, ref {{ref}}) ends on {{date}}. Please let us know if you would like to extend.' },
  { id: 'tpl_followup', name: 'Follow Up', category: 'followup', body: 'Hi {{name}}, following up on your interest in renting with Fastrack. Is there anything I can help clarify? We have great monthly offers available!' }
];

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

const DEFAULT_SITE_CONFIG = {
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
      subtext: "Lock in your discounted monthly rate before it's gone."
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
      subtext: "Found a cheaper monthly rate? We'll match it + give you extra 5% off."
    },
    finalCta: {
      headline: "DON'T MISS OUT — <strong>LOCK YOUR RATE</strong>",
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
      subtext: "Drop your WhatsApp and we'll send you an exclusive discount code.",
      buttonText: 'Send Me The Deal',
      skipText: "No thanks, I'll pay full price"
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

async function isEmpty(table) {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return rows[0].c === 0;
}

async function seedUsers() {
  if (!(await isEmpty('users'))) return 0;
  await db.query(
    `INSERT INTO users (id, email, password_hash, name, role, avatar, active) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['usr_admin', 'admin@fastrack.ae', hashPassword(ADMIN_PASS), 'Super Admin', 'superadmin', null, true]
  );
  return 1;
}

async function seedCars() {
  if (!(await isEmpty('cars'))) return 0;
  for (const c of DEFAULT_CARS) {
    await db.query(
      `INSERT INTO cars (id, name, cat, img, price, was, type, seats, doors, transmission, bags, viewers, spots, badge, feats, includes, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [c.id, c.name, c.cat, c.img, c.price, c.was, c.type, c.seats, c.doors, c.transmission, c.bags, c.viewers, c.spots, c.badge, JSON.stringify(c.feats), c.includes, c.active, c.sort_order]
    );
  }
  await db.query(`SELECT setval(pg_get_serial_sequence('cars','id'), (SELECT MAX(id) FROM cars))`);
  return DEFAULT_CARS.length;
}

async function seedTemplates() {
  if (!(await isEmpty('templates'))) return 0;
  for (const t of DEFAULT_TEMPLATES) {
    await db.query(
      `INSERT INTO templates (id, name, category, body) VALUES ($1,$2,$3,$4)`,
      [t.id, t.name, t.category, t.body]
    );
  }
  return DEFAULT_TEMPLATES.length;
}

async function seedSiteConfig() {
  if (!(await isEmpty('site_config'))) return 0;
  await db.query(
    `INSERT INTO site_config (key, value) VALUES ($1, $2::jsonb)`,
    ['main', JSON.stringify(DEFAULT_SITE_CONFIG)]
  );
  return 1;
}

async function seedDefaults() {
  try {
    const u = await seedUsers();
    const c = await seedCars();
    const t = await seedTemplates();
    const s = await seedSiteConfig();
    if (u + c + t + s > 0) {
      console.log(`[Seed] Inserted defaults — users:${u}, cars:${c}, templates:${t}, site_config:${s}`);
    } else {
      console.log('[Seed] All tables already populated — skipping');
    }
    return true;
  } catch (err) {
    console.error('[Seed] Error:', err.message);
    return false;
  }
}

module.exports = { seedDefaults, DEFAULT_SITE_CONFIG };
