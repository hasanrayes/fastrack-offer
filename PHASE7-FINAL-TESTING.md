# PHASE 7 — Final Testing & Cleanup

## PREREQUISITE
All phases 1-6 must be completed.

## CRITICAL SAFETY RULES

1. **DO NOT** modify dashboard.html or index.html
2. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
3. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation

## WHAT THIS PHASE DOES

1. Full end-to-end testing of all features
2. Remove backup files
3. Remove old in-memory code remnants if any
4. Final commit

## TESTING CHECKLIST

### Landing Page (http://localhost:3000)
- [ ] Page loads with all 4 cars
- [ ] Car images display correctly
- [ ] Contact form submits (creates a lead)
- [ ] WhatsApp button works
- [ ] Countdown timer shows
- [ ] Mobile responsive layout works
- [ ] Sticky bar shows on mobile

### Dashboard Login (http://localhost:3000/dashboard.html)
- [ ] Login with admin@fastrack.ae / fastrack2024
- [ ] Dashboard stats load (total bookings, leads, cars, revenue)
- [ ] Activity log shows recent actions

### Dashboard — Cars
- [ ] All cars display in car management
- [ ] Add new car works
- [ ] Edit existing car works
- [ ] Toggle car active/inactive works
- [ ] Delete car works
- [ ] Reorder cars works
- [ ] Car changes persist after server restart

### Dashboard — Bookings
- [ ] Create new booking
- [ ] Edit booking details
- [ ] Change booking status
- [ ] Bookings persist after restart

### Dashboard — Leads
- [ ] Leads from landing page appear here
- [ ] Edit lead status
- [ ] Lead notes work
- [ ] Delete lead works

### Dashboard — Templates
- [ ] All 6 default templates load
- [ ] Create new template
- [ ] Edit template
- [ ] Delete template

### Dashboard — Promos
- [ ] Create promo code
- [ ] Edit promo
- [ ] Delete promo

### Dashboard — Site Builder
- [ ] Section editor opens for each section
- [ ] Text changes save
- [ ] Button edits save
- [ ] Color changes save
- [ ] Changes reflect on landing page after save

### Dashboard — Users
- [ ] Admin user shows
- [ ] Create new user works
- [ ] Edit user works

### API Health
- [ ] GET /api/health returns { status: 'ok', database: 'connected' }

### Data Persistence (THE KEY TEST)
- [ ] Add a test car, booking, and lead
- [ ] Restart the server (stop and start node server.js)
- [ ] Verify all test data still exists
- [ ] This confirms PostgreSQL is working correctly

## CLEANUP

1. Delete backup files: `rm -f server.js.backup`
2. Optionally delete the phase prompt files (or keep for reference)
3. Verify package.json has correct dependencies (express, helmet, jsonwebtoken, pg, bcryptjs)

## FINAL COMMIT

```bash
rm -f .git/index.lock .git/HEAD.lock
git add -A
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 7: Final testing and cleanup — PostgreSQL migration complete"
git push origin main
```

## SUCCESS CRITERIA

After this phase, the fastrack-offer app should:
1. Store ALL data in PostgreSQL (no more data loss on restart)
2. Use bcrypt for password hashing
3. Have a health check endpoint
4. Gracefully handle database connection failures
5. Keep the exact same UI and API behavior as before
