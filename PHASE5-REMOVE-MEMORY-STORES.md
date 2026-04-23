# PHASE 5 — Remove In-Memory Stores (Full PostgreSQL)

## PREREQUISITE
Phase 4 must be completed AND tested. Verify:
- All write operations save to PostgreSQL
- Data persists after server restart
- Landing page and dashboard work with DB reads
- At least 1 test record exists in each table

## CRITICAL SAFETY RULES

1. **DO NOT** modify dashboard.html or index.html
2. **DO NOT** change API response JSON formats
3. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
4. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
5. Before editing server.js, `cp server.js server.js.backup`
6. **KEEP a graceful "DB unavailable" error** for all endpoints

## WHAT THIS PHASE DOES

1. Removes the in-memory arrays (cars, bookings, leads, etc.) from server.js
2. All API endpoints now read/write exclusively from PostgreSQL
3. If DB is unavailable, endpoints return a friendly error instead of crashing

## PATTERN

```javascript
// BEFORE (dual mode):
app.get('/api/cars', async (req, res) => {
  try {
    if (db.isReady()) {
      const result = await db.query('SELECT * FROM cars WHERE active = true ORDER BY sort_order');
      return res.json(result.rows);
    }
  } catch (err) { ... }
  res.json(cars.filter(c => c.active)); // memory fallback
});

// AFTER (DB only):
app.get('/api/cars', async (req, res) => {
  try {
    if (!db.isReady()) return res.status(503).json({ error: 'Database unavailable' });
    const result = await db.query('SELECT * FROM cars WHERE active = true ORDER BY sort_order');
    res.json(result.rows);
  } catch (err) {
    console.error('[API] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
```

## STEPS

1. Remove all `let cars = [...]`, `let bookings = []`, etc. variable declarations
2. Remove `nextCarId`, `nextBookingId`, `nextLeadId`, `nextInvoiceNumber` (use DB sequences/SERIAL)
3. Keep `siteConfig` as a local cache that loads from DB on startup
4. Update all endpoints to DB-only with proper error handling
5. Update `logActivity` and `addNotification` to DB-only
6. Keep `refreshTokens` and `resetTokens` as in-memory Maps (these are session data, fine in RAM)
7. Keep `rateLimitMap` in-memory (ephemeral by design)
8. Test everything thoroughly

## IMPORTANT NOTES

- The `users` array can be removed — auth should query DB
- Keep the password hashing function (hashPassword) — it is still needed
- The login endpoint should query: `SELECT * FROM users WHERE email = $1 AND active = true`
- Then compare password hash as before

## COMMIT

```bash
rm -f .git/index.lock .git/HEAD.lock
git add server.js
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 5: Remove in-memory stores — all data now persisted in PostgreSQL"
git push origin main
```
