/**
 * End-to-end smoke test for the navbar profile menu.
 *
 * Verifies the right-corner profile icon + dropdown shipped as part of
 * the navbar polish pass:
 *   - ProfileMenu component exists in src/components/ and exports a
 *     default function.
 *   - It reads the user from AuthContext and renders an avatar (or
 *     initials fallback) inside a circular icon button.
 *   - Clicking the icon opens a dropdown panel containing a Profile
 *     link (to /profile) and a Log out button (calls `logout` from
 *     AuthContext).
 *   - The dropdown closes on outside click and on Escape, matching
 *     the NotificationBell pattern.
 *   - MainLayout wires ProfileMenu into the logged-in desktop nav in
 *     place of the previous text "Profile" link + standalone "Log out"
 *     button.
 *
 * Pure client-side smoke (no DB / server). Mirrors the style of
 * 7.5-notification-ui.test.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(CLIENT_ROOT, 'src');
const PROFILE_MENU = path.join(SRC, 'components', 'ProfileMenu.jsx');
const MAIN_LAYOUT = path.join(SRC, 'layouts', 'MainLayout.jsx');
const AUTH_CONTEXT = path.join(SRC, 'context', 'AuthContext.jsx');

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const results = [];
function section(name) {
  console.log(`\n--- ${name} ---`);
}
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓', msg);
    results.push({ pass: true, msg });
  } else {
    console.log('  ✗', msg);
    results.push({ pass: false, msg });
  }
}

// ── 1. Files exist ────────────────────────────────────────────────────
section('1. files exist');
assert(exists(PROFILE_MENU), 'ProfileMenu.jsx exists at src/components/');
assert(exists(MAIN_LAYOUT), 'MainLayout.jsx exists at src/layouts/');
assert(exists(AUTH_CONTEXT), 'AuthContext.jsx exists at src/context/');

if (!results.every((r) => r.pass)) {
  console.log('\n--- EARLY EXIT ---');
  process.exit(1);
}

const menuSrc = read(PROFILE_MENU);
const layoutSrc = read(MAIN_LAYOUT);
const authSrc = read(AUTH_CONTEXT);

// ── 2. ProfileMenu component shape ────────────────────────────────────
section('2. ProfileMenu — component shape');
assert(
  /export\s+default\s+function\s+ProfileMenu\b/.test(menuSrc),
  'ProfileMenu.jsx exports a default function named ProfileMenu'
);
assert(
  /from\s+['"]\.\.\/context\/AuthContext['"]/.test(menuSrc),
  'ProfileMenu imports AuthContext via relative path'
);
assert(
  /useAuth\s*\(/.test(menuSrc),
  'ProfileMenu calls useAuth()'
);
assert(
  /logout/.test(menuSrc),
  'ProfileMenu destructures logout from useAuth()'
);

// ── 3. Avatar + initials fallback ─────────────────────────────────────
section('3. ProfileMenu — avatar / initials fallback');
assert(
  /user\.avatarUrl/.test(menuSrc),
  'ProfileMenu reads user.avatarUrl'
);
assert(
  /aria-hidden/.test(menuSrc) && /initials/.test(menuSrc),
  'ProfileMenu renders an aria-hidden initials fallback when no avatar'
);
assert(
  /<img\b/.test(menuSrc),
  'ProfileMenu renders an <img> when user.avatarUrl is set'
);
assert(
  /rounded-full/.test(menuSrc),
  'ProfileMenu uses a circular avatar disc (rounded-full)'
);

// ── 4. Dropdown panel + Profile / Log out items ───────────────────────
section('4. ProfileMenu — dropdown panel + items');
assert(
  /useState\(\s*false\s*\)/.test(menuSrc),
  'ProfileMenu tracks open/closed state with a useState(false)'
);
assert(
  /role="menu"/.test(menuSrc) || /role=['"]menu['"]/.test(menuSrc),
  'ProfileMenu renders a role="menu" dropdown panel'
);
assert(
  /aria-haspopup="menu"/.test(menuSrc),
  'ProfileMenu trigger has aria-haspopup="menu"'
);
assert(
  /aria-expanded/.test(menuSrc),
  'ProfileMenu trigger has aria-expanded wired to open state'
);
assert(
  /to=['"]\/profile['"]/.test(menuSrc),
  'ProfileMenu links Profile item to /profile'
);
assert(
  /[Ll]og out/.test(menuSrc) || /[Ll]ogout/.test(menuSrc),
  'ProfileMenu shows a "Log out" item'
);
assert(
  /onClick=\{[^}]*logout[^}]*\}|logout\(\)/.test(menuSrc),
  'ProfileMenu invokes logout() when Log out is clicked'
);

// ── 5. Click-outside + Escape close behavior ──────────────────────────
section('5. ProfileMenu — close behavior');
assert(
  /mousedown/.test(menuSrc) && /Escape/.test(menuSrc),
  'ProfileMenu closes on outside mousedown AND on Escape key'
);
assert(
  /useRef\(/.test(menuSrc) && /contains\(e\.target\)/.test(menuSrc),
  'ProfileMenu uses a wrapperRef to detect outside clicks'
);

// ── 6. MainLayout integration ─────────────────────────────────────────
section('6. MainLayout — ProfileMenu wiring');
assert(
  /from\s+['"]\.\.\/components\/ProfileMenu['"]/.test(layoutSrc),
  'MainLayout imports ProfileMenu from ../components/ProfileMenu'
);
assert(
  /<ProfileMenu\s*\/?>/.test(layoutSrc),
  'MainLayout renders <ProfileMenu /> in the desktop nav'
);
// The old "Log out" text button was REMOVED from MainLayout.
assert(
  !/>\s*Log out\s*</.test(layoutSrc),
  'MainLayout no longer renders the old standalone "Log out" text button'
);
// The old <NavLink to="/profile"> text label was REPLACED with ProfileMenu.
assert(
  !/<NavLink[^>]*to=['"]\/profile['"][^>]*>\s*<span[^>]*hidden sm:inline/.test(
    layoutSrc
  ),
  'MainLayout no longer renders the old profile text <NavLink> with name/email inside'
);

// ── 7. AuthContext logout (sanity) ────────────────────────────────────
section('7. AuthContext — logout callback still exports');
assert(
  /const\s+logout\s*=/.test(authSrc),
  'AuthContext defines a logout callback'
);
assert(
  /api\.post\(['"]\/auth\/logout['"]/.test(authSrc),
  'AuthContext.logout calls POST /auth/logout'
);
assert(
  /localStorage\.removeItem\(TOKEN_STORAGE_KEY\)/.test(authSrc),
  'AuthContext.logout clears the stored token'
);

// ── 8. Production build succeeds ──────────────────────────────────────
section('8. vite build succeeds with ProfileMenu');
try {
  execSync('npx vite build', { cwd: CLIENT_ROOT, stdio: 'pipe' });
  console.log('  ✓ vite build succeeded');
  results.push({ pass: true, msg: 'vite build succeeded' });
} catch (e) {
  console.log('  ✗ vite build failed');
  console.log(String(e.stdout || '').slice(-400));
  console.log(String(e.stderr || '').slice(-400));
  results.push({ pass: false, msg: 'vite build succeeded' });
}

// ── summary ──────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(
  `\n--- ${failed === 0 ? 'ALL' : failed + ' OF ' + results.length} ASSERTIONS ${
    failed === 0 ? 'PASSED' : 'PASSED'
  } ---`
);
if (failed > 0) {
  for (const r of results.filter((x) => !x.pass)) {
    console.log('  ✗', r.msg);
  }
  process.exit(1);
}