# PHASE 4 — Migrate Write Operations (POST/PUT/DELETE)

## PREREQUISITE
Phase 3 must be completed. Verify:
- Default data is seeded in PostgreSQL tables
- GET endpoints read from DB successfully
- Landing page and dashboard work correctly

## CRITICAL SAFETY RULES

1. **DO NOT** modify dashboard.html or index.html
2. **DO NOT** remove in-memory data stores yet — keep dual-write (write to BOTH DB and memory)
3. **DO NOT** change any API response formats
4. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
5. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
6. Before editing server.js, `cp server.js server.js.backup`
7. Use DUAL-WRITE pattern: write to DB AND in-memory simultaneously

## WHAT THIS PHASE DOES

Migrates all POST, PUT, PATCH, DELETE endpoints to write to PostgreSQL AND in-memory.
This ensures the app works even if DB write fails (graceful degradation).

## DUAL-WRITE PATTERN

```javascript
// BEFORE:
app.post('/api/admin/cars', auth, (req, res) => {
  const car = { id: nextCarId++, ...req.body, active: true };
  cars.push(car);
  res.json(car);
});

// AFTER:
app.post('/api/admin/cars', auth, async (req, res) => {
  const car = { id: nextCarId++, ...req.body, active: true };
  cars.push(car); // Always write to memory
  
  try {
    if (db.isReady()) {
      await db.query(
        'INSERT INTO cars (name, cat, img, price, was, type, seats, doors, transmission, bags, viewers, spots, badge, feats, includes, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id',
        [car.name, car.cat, car.img, car.price, car.was, car.type, car.seats, car.doors, car.transmission, car.bags, car.viewers||0, car.spots||0, car.badge, JSON.stringify(car.feats||[]), car.includes, true, car.order||0]
      );
    }
  } catch (err) {
    console.error('[API] DB write failed for car:', err.message);
    // Memory write already succeeded, so request still works
  }
  
  res.json(car);
});
```

## ENDPOINTS TO MIGRATE

Apply dual-write to ALL write endpoints:

### Cars
- POST /api/admin/cars (create car)
- PUT /api/admin/cars/:id (update car)
- DELETE /api/admin/cars/:id (delete car)
- PATCH /api/admin/cars/:id/toggle (toggle active)
- PUT /api/admin/cars/reorder (reorder cars)

### Bookings
- POST /api/admin/bookings (create booking)
- PUT /api/admin/bookings/:id (update booking)
- PATCH /api/admin/bookings/:id/status (change status)

### Leads
- POST /api/leads (public lead submission from landing page)
- PUT /api/admin/leads/:id (update lead)
- PATCH /api/admin/leads/:id/status (change status)
- DELETE /api/admin/leads/:id (delete lead)

### Templates
- POST /api/admin/templates (create template)
- PUT /api/admin/templates/:id (update template)
- DELETE /api/admin/templates/:id (delete template)

### Promos
- POST /api/admin/promos (create promo)
- PUT /api/admin/promos/:id (update promo)
- DELETE /api/admin/promos/:id (delete promo)

### Site Config
- PUT /api/admin/site-config (save site config)

### Users
- POST /api/admin/users (create user)
- PUT /api/admin/users/:id (update user)
- DELETE /api/admin/users/:id (delete user)

### Notifications
- PATCH /api/admin/notifications/:id/read (mark as read)
- POST /api/admin/notifications/read-all (mark all read)

### Activity Log
- Already write-only (logActivity function) — update it to also INSERT into activity_log table

## STEP 1 — Update logActivity and addNotification

These helper functions are called throughout server.js. Update them to dual-write:

```javascript
function logActivity(userId, action, details) {
  // ... existing memory code stays ...
  
  // Also write to DB
  if (db.isReady()) {
    db.query('INSERT INTO activity_log (id, user_id, user_name, user_role, action, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [entry.id, userId, entry.userName, entry.userRole, action, details]
    ).catch(err => console.error('[DB] activity log write failed:', err.message));
  }
}
```

Same pattern for addNotification.

## STEP 2 — Migrate each endpoint group

Work through each group above. For each:
1. Keep the existing in-memory operation
2. Add DB write after memory write
3. Wrap DB write in try/catch
4. Log errors but do not crash

## STEP 3 — Test thoroughly

1. Create a new car in dashboard → verify it appears
2. Create a booking → verify it appears
3. Submit a lead from landing page → verify it shows in dashboard
4. Edit a template → verify changes persist
5. Check Railway Postgres Data tab → verify data exists in tables
6. Restart server → verify data persists from DB (this is the key test!)

## STEP 4 — Commit and push

```bash
rm -f .git/index.lock .git/HEAD.lock
git add server.js
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 4: Dual-write all API endpoints to PostgreSQL + in-memory"
git push origin main
```

## WHAT NOT TO DO

- DO NOT remove in-memory stores (that is Phase 5)
- DO NOT modify HTML files
- DO NOT change API response formats
- DO NOT skip the dual-write pattern — always write to memory AND DB
