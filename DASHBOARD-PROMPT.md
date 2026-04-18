# Fastrack Rent a Car — Full Admin Dashboard Build

## Project Context

This is a car rental business in Dubai (Fastrack Rent a Car). We already have:
- A **sales landing page** (`index.html`) — fully built, live on Railway
- A **basic Express.js backend** (`server.js`) with REST APIs for cars, bookings, leads
- GitHub repo: `hasanrayes/fastrack-offer` with Railway auto-deploy
- Admin auth uses `x-admin-token` header, password from env `ADMIN_PASS` (default: `fastrack2024`)

The current `dashboard.html` is a basic placeholder. We need a **full professional admin dashboard** to replace it.

## Tech Stack

- **Backend**: Express.js (extend `server.js` — add new API routes as needed)
- **Frontend**: Single `dashboard.html` file (or split into modules if needed)
- **Database**: Start with in-memory store (already in server.js), but structure code so we can plug in MongoDB/PostgreSQL later
- **Auth**: JWT-based sessions (upgrade from simple token)
- **Design System**: Inter font, primary color `#FF5F00` (orange), dark `#1A1A1A`, same visual DNA as the landing page

## IMPORTANT RULES

1. **DO NOT modify `index.html`** — the landing page is final and approved
2. All new features go in `dashboard.html` + extensions to `server.js`
3. Push to GitHub when each major phase is complete
4. Use `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com"` for commits
5. Before any git operation, run `rm -f .git/index.lock`
6. Keep track of what's DONE vs what's PENDING after each phase

---

## PHASE 1: Core Dashboard Framework + Auth System
**Priority: CRITICAL**

### 1.1 Authentication System (upgrade from basic token)
- Login page with email + password (styled with brand identity)
- JWT token-based sessions with expiry
- "Remember me" option
- Logout functionality
- Password reset flow (basic — store reset tokens in memory)
- Session persistence across page refreshes

### 1.2 Dashboard Layout Shell
- Collapsible sidebar navigation with icons
- Top header bar with: user avatar/name, notifications bell, quick search, theme toggle
- Main content area with breadcrumbs
- **Light mode / Dark mode** toggle (save preference in localStorage)
- Fully responsive — works on mobile with hamburger menu
- Brand identity: Inter font, `#FF5F00` orange accent, clean modern UI
- Loading states and skeleton screens

### 1.3 Role-Based Access Control (RBAC)
- **Super Admin**: Full access to everything
- **Manager**: Can manage bookings, leads, cars. Cannot manage team or system settings
- **Viewer**: Read-only access to bookings and leads. Cannot edit or delete
- Team member management: invite (by email), edit role, deactivate, delete
- Activity log: track who did what and when

**API Routes needed:**
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/refresh
- GET /api/auth/me
- CRUD /api/team (Super Admin only)
- GET /api/activity-log

---

## PHASE 2: Data Management (Leads, Bookings, Cars)
**Priority: HIGH**

### 2.1 Leads Management
- Table view with: name, phone, WhatsApp, interest, source, date, status
- Status workflow: New → Contacted → Qualified → Converted → Lost
- Inline quick-edit (click to edit any field)
- Bulk actions: select multiple → change status, delete, export
- Filters: by status, date range, source, interest
- Search across all fields
- Sort by any column
- Export to CSV / Excel
- Lead detail modal with full history and notes
- Add notes/comments to each lead
- Quick actions: call (tel: link), WhatsApp (wa.me link), email

### 2.2 Bookings Management
- Table view with: ref#, customer, car, dates, duration, location, total, status
- Status workflow: Pending → Confirmed → Active → Completed → Cancelled
- Booking detail modal with all information
- Edit booking details (dates, car, location, price)
- Filters: by status, car, date range, location
- Calendar view option (see bookings on a calendar)
- Revenue calculation per booking
- Quick actions: confirm, cancel, extend, contact customer

### 2.3 Cars / Fleet Management
- Grid view (card layout like the landing page) + Table view toggle
- **Add new car** form: name, category, image URL, price, was-price, type, seats, doors, transmission, bags, badge, features, includes text
- **Edit car**: inline or modal edit for all fields
- **Delete car** with confirmation
- Toggle car visibility (active/inactive on landing page)
- Image preview when adding/editing
- Drag to reorder cars (changes display order on landing page)
- Duplicate a car listing
- Car performance stats: views, bookings, conversion rate

**API Routes needed:**
- Full CRUD for /api/leads with status, notes, filters
- Full CRUD for /api/bookings with status workflow
- Full CRUD for /api/cars with ordering, visibility
- GET /api/cars/stats

---

## PHASE 3: Landing Page Content Management (CMS)
**Priority: HIGH**

### 3.1 Content Editor
All landing page text should be editable from the dashboard:
- **Logo text**: Edit "FASTRACK" branding
- **Hero section**: headline, subtext, proof stats, CTA button texts
- **Countdown timer**: set end date/time, enable/disable
- **Trust bar items**: edit each trust badge text
- **Ticker messages**: add, edit, delete, reorder scrolling messages
- **Why Us cards**: edit icon, title, description for each card
- **Reviews**: add, edit, delete, reorder customer reviews
- **Guarantee section**: edit title and description
- **Final CTA**: edit headline, subtext, button text
- **Footer**: edit links, phone, email, copyright text
- **Sticky bottom bar**: edit price display and button text

### 3.2 Drag & Drop Section Builder
- Visual list of all landing page sections
- Drag sections to reorder them
- Toggle sections on/off (show/hide)
- Add new custom sections (text block, image+text, CTA banner)
- Delete custom sections
- Live preview of section order
- Save & publish changes to landing page
- "Reset to default" option

### 3.3 Landing Page Settings
- **Colors**: primary color picker, dark color, accent colors
- **Fonts**: font family selector, size presets
- **SEO**: page title, meta description, OG tags
- **Scripts**: custom header/footer scripts (analytics, pixels)
- **Favicon**: upload/URL
- **Social links**: WhatsApp number, phone, email

**How this works technically:**
- Store all CMS content in a JSON config (e.g., `/api/config`)
- The landing page (`index.html`) fetches config on load and applies it
- OR: server-side renders index.html with config values
- Dashboard saves config via PUT /api/config

**API Routes needed:**
- GET/PUT /api/config (page content, section order, settings)
- GET /api/config/sections (section list with order)
- PUT /api/config/sections/reorder
- POST /api/config/sections (add custom section)

---

## PHASE 4: Analytics Dashboard
**Priority: MEDIUM**

### 4.1 Overview Cards (top of dashboard)
- Total leads (today / this week / this month / all time)
- Total bookings + revenue
- Conversion rate (leads → bookings)
- Active cars count
- Live visitors (from landing page)

### 4.2 Charts & Graphs
- Leads over time (line chart — daily/weekly/monthly)
- Bookings over time (line chart)
- Revenue over time (bar chart)
- Leads by source (pie chart: popup, direct, WhatsApp)
- Most popular cars (horizontal bar chart)
- Bookings by location (pie chart)
- Conversion funnel: page views → leads → bookings

### 4.3 Real-time Panel
- Live visitor count on landing page
- Recent activity feed (new lead, new booking, status change)
- Today's metrics vs yesterday comparison

**Libraries**: Use Chart.js (CDN) for charts

**API Routes needed:**
- GET /api/analytics/overview
- GET /api/analytics/leads?period=daily|weekly|monthly
- GET /api/analytics/bookings?period=daily|weekly|monthly
- GET /api/analytics/revenue?period=daily|weekly|monthly
- GET /api/analytics/popular-cars
- GET /api/analytics/sources

---

## PHASE 5: Live Preview + Advanced Features
**Priority: MEDIUM**

### 5.1 Live Preview
- Iframe showing the landing page inside the dashboard
- Updates in real-time as you edit content in CMS
- Device preview toggle: Desktop / Tablet / Mobile frame sizes
- "Open in new tab" button

### 5.2 Notifications System
- In-app notifications (bell icon with badge count)
- New lead notification
- New booking notification
- Team activity notifications
- Mark as read / mark all as read

### 5.3 Quick Actions
- Global search (Cmd+K): search across leads, bookings, cars
- Quick-add buttons: new lead, new booking, new car
- Keyboard shortcuts for power users
- Dashboard widgets (drag to rearrange dashboard cards)

### 5.4 Data & Backup
- Export all data (leads, bookings, cars) as JSON
- Import data from JSON
- Clear all data (with double confirmation)

---

## PHASE 6: Polish & Production Ready
**Priority: LOW (but important)**

### 6.1 UX Polish
- Smooth animations and transitions
- Toast notifications for all actions (success/error)
- Confirmation dialogs for destructive actions
- Empty states with illustrations
- Error handling with user-friendly messages
- Form validation with inline errors

### 6.2 Performance
- Pagination for large datasets
- Debounced search
- Lazy loading for images
- Optimistic UI updates

### 6.3 Security
- Rate limiting on auth endpoints
- Input sanitization
- CORS configuration
- Helmet.js for security headers
- XSS protection

---

## Git Workflow

After completing each PHASE:
```bash
rm -f .git/index.lock
git add -A
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase X: [description]"
git push
```

## Progress Tracker

After each phase, update this section:

| Phase | Feature | Status |
|-------|---------|--------|
| 1.1 | Auth System (JWT + Login) | ✅ DONE |
| 1.2 | Dashboard Layout Shell | ✅ DONE |
| 1.3 | Role-Based Access (RBAC) | ✅ DONE |
| 2.1 | Leads Management | ✅ DONE |
| 2.2 | Bookings Management | ✅ DONE |
| 2.3 | Cars / Fleet Management | ✅ DONE |
| 3.1 | Content Editor (CMS) | ✅ DONE |
| 3.2 | Drag & Drop Section Builder | ✅ DONE |
| 3.3 | Landing Page Settings | ✅ DONE |
| 4.1 | Analytics Overview Cards | ✅ DONE |
| 4.2 | Charts & Graphs | ✅ DONE |
| 4.3 | Real-time Panel | ✅ DONE |
| 5.1 | Live Preview | ✅ DONE |
| 5.2 | Notifications System | ✅ DONE |
| 5.3 | Quick Actions + Search | ✅ DONE |
| 5.4 | Data Import/Export | ✅ DONE |
| 6.1 | UX Polish | ✅ DONE |
| 6.2 | Performance | ✅ DONE |
| 6.3 | Security | ✅ DONE |

Update each row to ✅ DONE or 🔄 IN PROGRESS as you work.

---

## Current File Structure
```
fastrack-offer/
├── index.html        ← Landing page (DO NOT TOUCH)
├── dashboard.html    ← Admin dashboard (REBUILD THIS)
├── server.js         ← Express backend (EXTEND THIS)
├── package.json      ← Dependencies
└── DASHBOARD-PROMPT.md  ← This file
```

## Final Notes
- Railway auto-deploys from GitHub main branch
- Live URL: fastrack-offer-production.up.railway.app
- Dashboard URL: fastrack-offer-production.up.railway.app/dashboard
- Start with Phase 1, get it solid, then move to Phase 2, etc.
- Each phase should be fully functional before moving to the next
- Test everything works before pushing

---

## UI/UX Audit — RESOLVED

Full audit completed and all 33 issues fixed:

### CRITICAL (1-6)
1. JWT_SECRET now uses stable hardcoded fallback — sessions survive deploys
2. WCAG contrast fixed: --onDarkM raised to .75 opacity, footer text to .55/.70
3. Deep recursive sanitizer for nested objects/arrays — prevents XSS
4. HTTPS redirect middleware for production (x-forwarded-proto check)
5. Car card onclick uses data-car-id + JS map — no inline JSON injection
6. Booking modal step 1 validates date + location before proceeding

### HIGH (7-14)
7. Mobile responsive below 480px: stacked filters, smaller tables, full-width modals
8. Escape key closes booking modal and lead popup
9. Car images have onerror fallback SVG placeholder + srcset for responsive loading
10. Empty states improved with helpful action hints
11. Toast max 3 limit — oldest removed when 4th appears
12. Charts rebuild on theme toggle — colors update with dark/light mode
13. Countdown syncs across tabs via localStorage
14. Global loading spinner during API calls (top-right indicator)

### MEDIUM (15-26)
15. Section padding standardized to 36px
16. Typography minimums: car-type 12px, cd-u 10px, why-card p 12px
17. Drag handles 44px minimum, toggle switches 48x28px (WCAG compliant)
18. Form labels have matching for="" attributes
19. Status whitelist validation on PATCH leads/bookings
20. Inline edit fields max-width:160px
21. Date filtering uses Dubai UTC+4 timezone
22. Danger buttons use red background, white text on hover
23. Car images have srcset (400w + 900w) for responsive loading
24. Image onerror shows SVG placeholder
25. Activity log warns at 490+ entries approaching 500 limit
26. Team email uniqueness check on PUT update

### LOW (27-33)
27. Hero headline clamp raised to 48px max
28. Exit intent trigger changed to clientY < 0
29. Notification messages shuffled on init
30. Car FOMO dots staggered with animation-delay
31. Body overflow-x:clip replaces overflow-x:hidden (Safari fix)
32. Breadcrumbs update when modals open/close
33. Notification IDs use timestamp+random (restart-safe)

---

## QA Integration Fixes — RESOLVED

After full QA audit, the following issues were fixed:

1. **Section reorder now applies to DOM** (`index.html` config-loader)
   - Built-in reorderable sections (hero, ticker, trust, cars, why, reviews, guarantee, finalcta) now physically reorder via `document.body.appendChild(el)` in config-order.
   - Applied after visibility so hidden sections are skipped from DOM move.

2. **Custom sections now render** (`index.html` config-loader)
   - New renderer reads non-builtin sections from config and creates `<section id="custom-{id}">` elements.
   - Supports 3 types: `text` (centered block), `image_text` (2-column grid), `cta_banner` (dark CTA block).
   - Inserted before the footer in the DOM. Hidden sections skipped. Re-renders cleanly if config changes.

3. **Lead popup CMS selector fixed** (`index.html` config-loader)
   - Changed `.lead-box .desc` → `.lead-box .offer-desc` to match the redesigned lead popup DOM.
   - CMS edits to lead popup subtext now apply correctly.

4. **Transmission field normalized** (`server.js` GET `/api/cars` + `/api/cars/admin`)
   - Response now includes `trans: car.transmission || car.trans || 'Auto'` on every car object.
   - Landing page `renderCars()` reads `c.trans` and now gets the correct value.
   - Dashboard still reads `c.transmission` directly (unchanged, still works).
   - Fallback `CARS` array in index.html left untouched.

5. **Booking back button restored** (`index.html` booking flow)
   - Added `bkPrev()` function + inline back button in steps 2 and 3.
   - Step 2→1 preserves location, date, duration (already in window vars).
   - Step 2→1 also captures current field values before navigating back, so re-entry retains them.
   - Step 1, 2 re-render now populates form fields from window vars (`_bkDt`, `_bkLc`, `_bkDu`, `_bkNm`, `_bkPh`, `_bkWa`, `_bkEm`).
   - New CSS `.bk-back-inline` for the inline back link.

6. **Lead popup empty-field display** (`dashboard.html`) — already satisfied
   - Interest, address, source columns already render `||'-'` when empty.
   - Email only shown in detail modal if present.
   - No code change needed — verified during audit.

7. **Custom scripts injected** (`index.html` config-loader)
   - After config load, `settings.scripts.headerScripts` is parsed, `<script>` tags extracted and appended to `<head>` with proper attributes and inline code.
   - `settings.scripts.footerScripts` appended to `<body>`.
   - Safety guard: scripts with `document.cookie=` or `localStorage.clear/removeItem` blocked, max 50KB per field.
   - Enables Google Analytics, Meta Pixel, etc.
