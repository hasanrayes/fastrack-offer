# PHASE 6 — Security Upgrades

## PREREQUISITE
Phase 5 must be completed. All data lives in PostgreSQL.

## CRITICAL SAFETY RULES

1. **DO NOT** modify dashboard.html or index.html
2. **DO NOT** change API response formats  
3. **ALWAYS** commit with: `git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit`
4. **ALWAYS** run `rm -f .git/index.lock .git/HEAD.lock` before any git operation
5. Before editing server.js, `cp server.js server.js.backup`

## WHAT THIS PHASE DOES

1. Replaces SHA-256 password hashing with bcrypt
2. Migrates existing admin password hash to bcrypt
3. Adds parameterized query validation
4. Adds JWT_SECRET environment variable check

## STEP 1 — Install bcrypt

```bash
npm install bcryptjs
```

Note: Use `bcryptjs` (pure JS) not `bcrypt` (native) — bcryptjs works everywhere without compilation.

## STEP 2 — Replace hashPassword

```javascript
const bcrypt = require('bcryptjs');

// Replace the old hashPassword function:
async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

async function comparePassword(pw, hash) {
  // Support both old SHA-256 and new bcrypt hashes
  if (hash.length === 64) {
    // Old SHA-256 hash — compare and upgrade
    const sha256 = crypto.createHash('sha256').update(pw).digest('hex');
    if (sha256 === hash) {
      // Upgrade to bcrypt
      const newHash = await bcrypt.hash(pw, 12);
      return { match: true, upgradedHash: newHash };
    }
    return { match: false };
  }
  // bcrypt hash
  const match = await bcrypt.compare(pw, hash);
  return { match };
}
```

## STEP 3 — Update login endpoint

Update the login to use comparePassword and auto-upgrade old hashes:

```javascript
// In the login handler:
const result = await comparePassword(password, user.password_hash);
if (!result.match) return res.status(401).json({ error: 'Invalid credentials' });

// Auto-upgrade SHA-256 to bcrypt
if (result.upgradedHash) {
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [result.upgradedHash, user.id]);
  console.log('[Auth] Upgraded password hash to bcrypt for:', user.email);
}
```

## STEP 4 — Update user creation and password changes

All places that create or update passwords should now use `await hashPassword(pw)`.

## STEP 5 — Update seed.js

The seed file should hash the admin password with bcrypt:

```javascript
const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASS || 'fastrack2024', 12);
```

## STEP 6 — JWT_SECRET warning

Add a startup check:

```javascript
if (process.env.JWT_SECRET === undefined) {
  console.warn('[Security] WARNING: Using default JWT_SECRET — set JWT_SECRET env variable in production!');
}
```

## STEP 7 — Test

1. Login with admin@fastrack.ae / fastrack2024 — should work (auto-upgrades hash)
2. Login again — should work (now using bcrypt hash)
3. Create a new user — should use bcrypt
4. All API endpoints still function correctly

## COMMIT

```bash
rm -f .git/index.lock .git/HEAD.lock
git add server.js seed.js package.json package-lock.json
git -c user.name="Hasan Rayes" -c user.email="hasanabbasrayesbusiness@gmail.com" commit -m "Phase 6: Upgrade password hashing to bcrypt with auto-migration from SHA-256"
git push origin main
```
