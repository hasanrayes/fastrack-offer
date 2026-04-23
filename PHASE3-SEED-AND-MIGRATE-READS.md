# PHASE 3 — Seed Default Data + Migrate API Read Operations

## PREREQUISITE
Phase 2 must be completed. Verify:
- All tables exist in PostgreSQL (check `/api/health` or Railway Data tab)
- `schema.js` exists and runs on startup
- `node server.js` shows "Database schema initialized"

## CRITICAL SAFETY RULES

1. **DO NOT** delete or modify dashboard.html or index.html
2. **DO NOT** remove in-memory data stores from server.js yet — keep them as fallback
3. **DO NOT** change any API response formats — same JSON shape as before
4. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
5. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
6. Before editing server.js, `cp server.js server.js.backup`
7. Every API must work BOTH with and without database (graceful fallback to in-memory)

## WHAT THIS PHASE DOES

1. Creates a `seed.js` file that inserts default data (admin user, 4 cars, 6 templates) into PostgreSQL — only if tables are empty
2. Migrates GET/read API endpoints to read from PostgreSQL first, falling back to in-memory if DB unavailable
3. Uses a simple pattern: try DB first, catch → use memory

## STEP 1 — Create seed.js

Create `seed.js` that:
- Checks if the `users` table is empty
- If empty, inserts the default admin user (admin@fastrack.ae with hashed password)
- Checks if `cars` table is empty  
- If empty, inserts the 4 default cars (Mitsubishi Attrage, JAC J7, Mitsubishi ASX, JAC JS4)
- Checks if `templates` table is empty
- If empty, inserts the 6 default WhatsApp templates
- Checks if `site_config` table is empty
- If empty, inserts the default siteConfig as a JSON row with key='main'

IMPORTANT: Use the EXACT same data that is currently hardcoded in server.js (lines 111-161 and 955+). Copy the values exactly.

## STEP 2 — Call seed on startup

In server.js startup (after schema init), add:
```javascript
const { seedDefaults } = require('./seed');
// ... inside app.listen callback, after initSchema:
if (schemaOk) {
  await seedDefaults();
  console.log('[Server] Default data seeded (if tables were empty)');
}
```

## STEP 3 — Migrate READ endpoints

For each GET endpoint, change to: try reading from DB, fall back to in-memory.

Use this pattern:

```javascript
// BEFORE (memory only):
app.get('/api/cars', (req, res) => {
  res.json(cars.filter(c => c.active));
});

// AFTER (DB first, memory fallback):
app.get('/api/cars', async (req, res) => {
  try {
    if (db.isReady()) {
      const result = await db.query('SELECT * FROM cars WHERE active = true ORDER BY sort_order');
      return res.json(result.rows);
    }
  } catch (err) {
    console.error('[API] DB read failed for cars:', err.message);
  }
  // Fallback to in-memory
  res.json(cars.filter(c => c.active));
});
```

Apply this pattern to ALL GET endpoints:
- GET /api/cars (public car listing)
- GET /api/admin/cars (admin car listing — all cars including inactive)
- GET /api/admin/bookings
- GET /api/admin/leads  
- GET /api/admin/templates
- GET /api/admin/promos
- GET /api/admin/activity
- GET /api/admin/notifications
- GET /api/admin/site-config
- GET /api/admin/dashboard-stats (this one aggregates data — query counts from DB)
- GET /api/admin/users

**IMPORTANT**: The JSON response format must remain EXACTLY the same as before. The frontend expects specific field names. For the cars table, map `sort_order` back to `order` and `feats` from JSONB back to array if needed.

## STEP 4 — Test

1. `node server.js` — starts clean, seeds data, no errors
2. Landing page shows all 4 cars
3. Dashboard login works, shows correct data
4. All dashboard sections (Bookings, Leads, Cars, Templates, etc.) load data
5. `/api/health` shows database connected

## STEP 5 — Commit and push

```bash
rm -f .git/index.lock .git/HEAD.lock
git add seed.js server.js
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 3: Seed default data and migrate read APIs to PostgreSQL with memory fallback"
git push origin main
```

## WHAT NOT TO DO

- DO NOT migrate write/POST/PUT/DELETE operations yet (that is Phase 4)
- DO NOT remove in-memory arrays
- DO NOT change response JSON structure
- DO NOT modify any HTML files
