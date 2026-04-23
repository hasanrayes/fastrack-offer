# DASHBOARD MEGA UPGRADE — Glassmorphism UI + Mobile + Elementor Builder

## ⚠️ CRITICAL SAFETY RULES — READ FIRST

1. **DO NOT touch `index.html`** — the landing page stays exactly as-is
2. **DO NOT touch `server.js`** — backend stays exactly as-is
3. **ONLY modify `dashboard.html`** — everything is in this one file
4. **Before ANY edit**: run `cp dashboard.html dashboard-backup.html` as the very first step
5. **After ALL edits**: run `git diff dashboard.html | head -2000` and verify ONLY intended changes
6. **Preserve ALL existing functionality**: login, leads CRUD, bookings CRUD, cars CRUD, CMS editor, analytics, team management, activity log, data export/import, customers, promos, notifications — ALL must continue working exactly as before
7. **Preserve ALL API calls**: every fetch() to /api/* endpoints must remain unchanged
8. **Preserve ALL JavaScript logic**: do NOT rewrite business logic, only update HTML structure and CSS
9. **Test after each phase**: open dashboard in browser, login with admin@fastrack.ae / fastrack2024, and verify login works before continuing

---

## PHASE 1: GLASSMORPHISM DARK UI REDESIGN

Transform the dashboard visual design to Glassmorphism Dark style while keeping all functionality identical.

### Design System — CSS Variables to Replace

Replace the existing `:root` CSS variables with this Glassmorphism palette:

```css
:root {
    --primary: #FF5F00; --primary-light: #FF7F33; --primary-dark: #CC4C00;
    --primary-bg: rgba(255,95,0,0.08); --primary-bg-hover: rgba(255,95,0,0.15);
    --green: #10B981; --green-bg: rgba(16,185,129,0.1);
    --red: #EF4444; --red-bg: rgba(239,68,68,0.1);
    --yellow: #F59E0B; --yellow-bg: rgba(245,158,11,0.1);
    --blue: #3B82F6; --blue-bg: rgba(59,130,246,0.1);
    --purple: #8B5CF6; --purple-bg: rgba(139,92,246,0.1);

    /* GLASSMORPHISM OVERRIDES */
    --bg-primary: #0f0f23;
    --bg-secondary: #0a0a1a;
    --bg-card: rgba(255,255,255,0.04);
    --bg-card-hover: rgba(255,255,255,0.07);
    --bg-input: rgba(255,255,255,0.04);
    --glass: rgba(255,255,255,0.04);
    --glass-border: rgba(255,255,255,0.08);
    --glass-hover: rgba(255,255,255,0.07);
    --border: rgba(255,255,255,0.08);
    --border-hover: rgba(255,255,255,0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255,255,255,0.5);
    --text-muted: rgba(255,255,255,0.3);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.3);
    --shadow-lg: 0 12px 40px rgba(0,0,0,0.4);
    --blur: blur(16px);
    --sidebar-width: 260px;
    --sidebar-collapsed-width: 72px;
    --header-height: 64px;
    --transition: 0.2s ease;
}
```

### Key Visual Changes (CSS only, no HTML structure changes unless specified)

1. **Body background**: Change from solid color to gradient:
   ```css
   body { background: linear-gradient(135deg, #0f0f23 0%, #1a0a2e 40%, #0a1628 100%); }
   ```

2. **All cards** (`.card`, `.stat-card`, `.analytics-card`, etc.): Add glass effect:
   ```css
   background: var(--glass);
   backdrop-filter: var(--blur);
   -webkit-backdrop-filter: var(--blur);
   border: 1px solid var(--glass-border);
   border-radius: 16px;
   ```

3. **Sidebar**: Glass sidebar:
   ```css
   .sidebar {
       background: rgba(255,255,255,0.03);
       backdrop-filter: blur(20px);
       -webkit-backdrop-filter: blur(20px);
       border-right: 1px solid rgba(255,255,255,0.06);
   }
   ```

4. **Header bar**: Glass header:
   ```css
   .header {
       background: rgba(255,255,255,0.03);
       backdrop-filter: blur(20px);
       -webkit-backdrop-filter: blur(20px);
       border-bottom: 1px solid rgba(255,255,255,0.06);
   }
   ```

5. **Login card**: Glass login:
   ```css
   .login-card {
       background: rgba(255,255,255,0.05);
       backdrop-filter: blur(24px);
       -webkit-backdrop-filter: blur(24px);
       border: 1px solid rgba(255,255,255,0.1);
       border-radius: 20px;
   }
   .login-screen {
       background: linear-gradient(135deg, #0f0f23 0%, #1a0a2e 40%, #0a1628 100%);
   }
   ```

6. **Stat cards on dashboard overview**: Add gradient accent bar on top:
   ```css
   .stat-card {
       background: var(--glass);
       backdrop-filter: var(--blur);
       border: 1px solid var(--glass-border);
       border-radius: 16px;
       position: relative;
       overflow: hidden;
   }
   .stat-card::before {
       content: '';
       position: absolute;
       top: 0; left: 0; right: 0;
       height: 3px;
       background: linear-gradient(90deg, var(--primary), var(--primary-light));
       border-radius: 16px 16px 0 0;
   }
   ```

7. **Tables**: Glass table styling:
   ```css
   .table-wrap, table {
       background: var(--glass);
       backdrop-filter: var(--blur);
       border: 1px solid var(--glass-border);
       border-radius: 14px;
       overflow: hidden;
   }
   thead th {
       background: rgba(255,255,255,0.03);
       border-bottom: 1px solid rgba(255,255,255,0.06);
   }
   tbody tr:hover {
       background: rgba(255,255,255,0.03);
   }
   ```

8. **Modals**: Glass modals:
   ```css
   .modal-content {
       background: rgba(15,15,35,0.95);
       backdrop-filter: blur(24px);
       border: 1px solid rgba(255,255,255,0.1);
       border-radius: 20px;
   }
   ```

9. **Form inputs**: Subtle glass inputs:
   ```css
   .form-input {
       background: rgba(255,255,255,0.04);
       border: 1px solid rgba(255,255,255,0.08);
       border-radius: 10px;
       color: #fff;
   }
   .form-input:focus {
       border-color: var(--primary);
       box-shadow: 0 0 0 3px rgba(255,95,0,0.15);
       background: rgba(255,255,255,0.06);
   }
   ```

10. **Buttons — Primary**: Subtle glow effect:
    ```css
    .btn-primary {
        background: var(--primary);
        color: #fff;
        box-shadow: 0 0 20px rgba(255,95,0,0.2);
    }
    .btn-primary:hover:not(:disabled) {
        background: var(--primary-light);
        box-shadow: 0 0 30px rgba(255,95,0,0.3);
    }
    ```

11. **Status badges**: Semi-transparent pill style:
    ```css
    .badge, .status-badge {
        backdrop-filter: blur(8px);
        border-radius: 20px;
        font-size: 11px;
        padding: 3px 10px;
    }
    ```

12. **Charts (Chart.js)**: When initializing charts, use these colors:
    - Grid lines: `rgba(255,255,255,0.04)`
    - Tick labels: `rgba(255,255,255,0.4)`
    - Tooltip background: `rgba(15,15,35,0.95)`
    - Tooltip border: `rgba(255,255,255,0.1)`
    - Dataset colors: use `rgba(255,95,0,0.3)` for fill, `#FF5F00` for borders
    DO NOT change chart data logic — only the visual colors.

### Light Mode

Update the `.light-mode` CSS to also use glass effects with light tones:
```css
.light-mode {
    --bg-primary: #f0f0f8;
    --bg-secondary: rgba(255,255,255,0.8);
    --bg-card: rgba(255,255,255,0.6);
    --bg-card-hover: rgba(255,255,255,0.8);
    --glass: rgba(255,255,255,0.6);
    --glass-border: rgba(0,0,0,0.06);
    --glass-hover: rgba(255,255,255,0.8);
    --border: rgba(0,0,0,0.06);
    --border-hover: rgba(0,0,0,0.12);
    --text-primary: #111111;
    --text-secondary: #666666;
    --text-muted: #999999;
}
.light-mode body { background: linear-gradient(135deg, #f0f0f8 0%, #e8e0f0 40%, #e0e8f0 100%); }
```

---

## PHASE 2: MOBILE RESPONSIVENESS

Add a complete mobile responsive layer. Add these CSS rules at the end of the `<style>` block.

### Key Mobile Issues to Fix:
- Sidebar must collapse to hamburger on mobile
- Stat cards are too tall with too much spacing
- Header "EN" and user info are cut off
- Tables must become card-view on small screens
- Modals must be full-screen on mobile
- Touch-friendly tap targets (min 44px)

```css
/* ─── MOBILE RESPONSIVE ─── */
@media (max-width: 768px) {
    :root {
        --sidebar-width: 0px;
        --header-height: 56px;
    }
    
    /* Sidebar: hidden by default, slide-in overlay */
    .sidebar {
        position: fixed;
        left: -280px;
        top: 0;
        bottom: 0;
        width: 280px;
        z-index: 1000;
        transition: left 0.3s ease;
    }
    .sidebar.mobile-open {
        left: 0;
        box-shadow: 0 0 40px rgba(0,0,0,0.5);
    }
    .sidebar-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 999;
    }
    .sidebar-overlay.active { display: block; }
    
    /* Main content: full width */
    .main-content, .main-area {
        margin-left: 0 !important;
        width: 100% !important;
    }
    
    /* Header: compact */
    .header, .top-header {
        padding: 8px 12px;
        height: auto;
        min-height: 50px;
        flex-wrap: wrap;
        gap: 8px;
    }
    
    /* Hamburger button visible */
    .mobile-menu-btn {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: var(--glass);
        border: 1px solid var(--glass-border);
        color: var(--text-primary);
        font-size: 20px;
        cursor: pointer;
    }
    
    /* Stat cards grid: 2 columns instead of 4 */
    .stats-grid, .analytics-grid {
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
    }
    .stat-card {
        padding: 12px !important;
    }
    .stat-card .stat-value {
        font-size: 20px !important;
    }
    
    /* Tables: horizontal scroll or card view */
    .table-wrap {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
    }
    table {
        min-width: 600px;
    }
    
    /* OR: Card view for tables on very small screens */
    .mobile-card-view table thead { display: none; }
    .mobile-card-view table tr {
        display: block;
        background: var(--glass);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 8px;
    }
    .mobile-card-view table td {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        border: none;
    }
    .mobile-card-view table td::before {
        content: attr(data-label);
        font-weight: 600;
        font-size: 11px;
        color: var(--text-secondary);
    }
    
    /* Modals: full screen on mobile */
    .modal-content {
        width: 100% !important;
        max-width: 100% !important;
        height: 100vh !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
        margin: 0 !important;
    }
    
    /* Form rows: stack vertically */
    .form-row {
        grid-template-columns: 1fr !important;
    }
    
    /* Buttons: full width on mobile */
    .btn {
        min-height: 44px;
        padding: 10px 16px;
    }
    
    /* Login: full screen friendly */
    .login-wrapper {
        padding: 16px;
    }
    .login-card {
        padding: 24px;
    }
    
    /* Page title area */
    .page-title {
        font-size: 20px !important;
    }
    
    /* Notification panel */
    .notif-panel {
        right: 0 !important;
        left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
    }
}

@media (max-width: 480px) {
    .stats-grid, .analytics-grid {
        grid-template-columns: 1fr !important;
    }
}
```

### HTML Changes for Mobile:
1. Add a hamburger menu button in the header (visible only on mobile):
   In the header bar HTML, add as the FIRST child:
   ```html
   <button class="mobile-menu-btn" onclick="toggleMobileSidebar()" style="display:none">☰</button>
   ```

2. Add a sidebar overlay div right after the sidebar:
   ```html
   <div class="sidebar-overlay" onclick="toggleMobileSidebar()"></div>
   ```

3. Add this JavaScript function (add it near the other UI toggle functions):
   ```javascript
   function toggleMobileSidebar() {
       const sidebar = document.querySelector('.sidebar');
       const overlay = document.querySelector('.sidebar-overlay');
       if (sidebar.classList.contains('mobile-open')) {
           sidebar.classList.remove('mobile-open');
           overlay.classList.remove('active');
       } else {
           sidebar.classList.add('mobile-open');
           overlay.classList.add('active');
       }
   }
   // Close sidebar when a menu item is clicked on mobile
   document.querySelectorAll('.sidebar .nav-item').forEach(item => {
       item.addEventListener('click', () => {
           if (window.innerWidth <= 768) toggleMobileSidebar();
       });
   });
   ```

4. Make the mobile-menu-btn visible only on mobile (already handled by the @media rule showing `display:flex !important` on mobile).

---

## PHASE 3: ELEMENTOR-STYLE SECTION BUILDER

This is the biggest change. Transform the current Section Builder from a simple list with text editors into a visual page builder like Elementor.

### Current State:
- Sections listed as expandable accordion items
- Each section has a text-field editor when expanded
- Drag to reorder, toggle visibility, add custom sections

### Target State:
Each section in the builder should be a **visual card** showing:
- **Section preview thumbnail** (a small visual representation)
- **Section name + type label**
- **3 action buttons**: Edit (pencil), Delete (trash), Duplicate (copy)
- **Drag handle** for reorder
- **Visibility toggle**
- **Click to expand** into a full inline editor

### Section Editor Upgrade:
When a section is expanded for editing, it should show **element-level controls** like Elementor:

For each section, the editor should show ALL its elements as **editable blocks** with individual Edit/Delete buttons:

#### Element Block Pattern:
```html
<div class="elem-block">
    <div class="elem-header">
        <span class="elem-type">📝 Text</span>
        <div class="elem-actions">
            <button class="btn btn-ghost btn-xs" onclick="..." title="Edit">✏️</button>
            <button class="btn btn-danger btn-xs" onclick="..." title="Delete">🗑️</button>
        </div>
    </div>
    <div class="elem-preview">Preview text here...</div>
</div>
```

#### Button Elements (NEW — this is what the user specifically asked for):
Every section that has a CTA button should show the button as an **editable element block**:

```html
<div class="elem-block elem-button">
    <div class="elem-header">
        <span class="elem-type">🔘 Button</span>
        <div class="elem-actions">
            <button class="btn btn-ghost btn-xs" onclick="editButton('sectionId','btnIndex')" title="Edit">✏️</button>
            <button class="btn btn-danger btn-xs" onclick="removeButton('sectionId','btnIndex')" title="Delete">🗑️</button>
        </div>
    </div>
    <div class="elem-preview">
        <span class="elem-btn-preview" style="background:var(--primary);color:#fff;padding:4px 12px;border-radius:6px;font-size:12px">Button Text</span>
    </div>
</div>
<button class="btn btn-secondary btn-xs add-elem-btn" onclick="addButton('sectionId')">+ Add Button</button>
```

When clicking "Edit" on a button element, show inline fields:
- **Button Text** (input)
- **Button URL / Action** (input — can be URL, #section-id, or javascript action like openBooking())  
- **Button Color** (color picker — background color)
- **Button Style** (select: filled, outline, ghost)

#### Per-Section Element Breakdown:

**Hero Section** should show these editable element blocks:
1. 📛 Badge Text — edit/delete
2. 📝 Headline — edit/delete (HTML allowed)
3. 📝 Subtext — edit/delete
4. 📊 Proof Stats — edit/delete (2 stats)
5. 🔘 Primary Button — edit/delete + add button
6. 🔘 Secondary Button — edit/delete
7. **+ Add Element** button at bottom

**Cars Section** should show:
1. 📛 Tag — edit/delete
2. 📝 Headline — edit/delete
3. 📝 Subtext — edit/delete

**Why Us Section** should show:
1. 📝 Section Label — edit/delete
2. 📝 Section Title — edit/delete
3. 🃏 Card 1 — edit/delete (icon + title + desc)
4. 🃏 Card 2 — edit/delete
5. 🃏 Card 3 — edit/delete
6. **+ Add Card** button

**Reviews Section** should show:
1. 📝 Section Label — edit/delete
2. 📝 Section Title — edit/delete
3. ⭐ Review 1 — edit/delete
4. ⭐ Review 2 — edit/delete
5. **+ Add Review** button

**Guarantee Section**:
1. 📝 Headline — edit/delete (HTML allowed)
2. 📝 Subtext — edit/delete

**Final CTA Section**:
1. 📝 Headline — edit/delete (HTML allowed)
2. 📝 Subtext — edit/delete
3. 🔘 Button — edit/delete + add button

**Sticky Bar**:
1. 📝 Price Info — edit/delete
2. 🔘 Button — edit/delete

**Lead Popup**:
1. 📛 Offer Tag — edit/delete
2. 📝 Headline — edit/delete
3. 📝 Value Text — edit/delete
4. 📝 Description — edit/delete
5. 🔘 Submit Button — edit/delete
6. 📝 Skip Text — edit/delete

**Footer**:
1. 📝 Copyright — edit/delete
2. 📞 Phone — edit/delete
3. 📞 WhatsApp — edit/delete
4. 📧 Email — edit/delete

### CSS for Element Blocks:
```css
.elem-block {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    margin-bottom: 6px;
    transition: all 0.15s ease;
}
.elem-block:hover {
    border-color: rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.05);
}
.elem-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
}
.elem-type {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
}
.elem-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
.elem-block:hover .elem-actions {
    opacity: 1;
}
.elem-preview {
    padding: 0 12px 8px;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.elem-editing {
    padding: 8px 12px 12px;
    border-top: 1px solid rgba(255,255,255,0.06);
}
.add-elem-btn {
    width: 100%;
    margin-top: 6px;
    border-style: dashed !important;
    justify-content: center;
}
```

### Custom Section Builder:

When adding a custom section, the user should see an "Add Section" modal/panel with:
- **Section Name** input
- **Section Type** selector with visual thumbnails:
  - **Text Block**: heading + body text
  - **Image + Text**: image on one side, text on other
  - **CTA Banner**: full-width colored banner with headline + button
  - **Gallery**: image grid
  - **FAQ**: expandable question/answer pairs
  - **Video**: embed a video
- Each type shows a small visual preview card

After adding, the custom section appears in the builder list with full element-level editing matching its type.

### Important JavaScript Notes:
- The `buildSecEditorHTML(id)` function needs to be rewritten to return element-block HTML instead of flat form fields
- Each element block should be togglable (click to expand/collapse its edit fields)
- The `saveSecContent(id)` function collects values from element edit fields the same way, just from the new structure
- All existing cmsConfig data structure must stay the same — this is only a UI change for the builder view
- Buttons are stored in config as: `{ text: 'Click', url: '#', color: '#FF5F00', style: 'filled' }`

---

## FINAL CHECKLIST — MUST VERIFY

After all 3 phases, verify:

- [ ] Login works (admin@fastrack.ae / fastrack2024)
- [ ] Dashboard overview loads with charts
- [ ] Leads: create, edit, delete, kanban view
- [ ] Bookings: create, edit, delete, calendar view
- [ ] Cars: add, edit, delete, toggle availability
- [ ] Content Editor: loads config, saves changes
- [ ] Section Builder: drag reorder, visibility toggle, expand editors, element blocks work
- [ ] Custom sections: add, edit, delete, duplicate
- [ ] Button editing: can edit text, URL, color for every button element
- [ ] Page Settings: saves SEO, colors, fonts
- [ ] Live Preview: iframe loads
- [ ] Team: CRUD works
- [ ] On mobile (resize to 375px width): sidebar is hidden, hamburger works, cards stack nicely, no horizontal overflow
- [ ] No JS errors in console
- [ ] All glass effects render (check backdrop-filter support)

Run `git diff dashboard.html | wc -l` and report the total lines changed. DO NOT commit — just save and report.
