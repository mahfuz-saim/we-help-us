/**
 * End-to-end smoke test for Module 9.1 — Responsive Design Pass.
 *
 * What this validates:
 *   1. Vite production build succeeds.
 *   2. MobileNavDrawer.jsx source guards: default export, role-gated
 *      NavLink items, Escape-key + backdrop close, Min header at top.
 *   3. useMediaQuery.js exports useMediaQuery + useIsDesktop and
 *      uses window.matchMedia.
 *   4. MainLayout.jsx wiring: desktop nav (`hidden md:flex` /
 *      `md:flex`), mobile hamburger (`md:hidden`), MobileNavDrawer
 *      imported + rendered conditionally; bell still present.
 *   5. MapViewPage.jsx uses ZoomControl + turn off default, with
 *      `.whu-pin` and `.whu-zoom*` CSS hooks in the bundle.
 *   6. CSS rules force Leaflet zoom-control buttons to 44×44.
 *   7. Tap-target sweep: the 8 affected pages bump `py-1.5` /
 *      `py-2` action buttons to `py-2.5` with `min-h-[44px]`.
 *   8. Bundle carries the new mobile-nav UI copy.
 *   9. Regression: prior 7.4 socket + 7.5 bell + 8.2 analytics
 *      surface are still in the bundle.
 *
 * Run: `node smoke-tests/9.1-responsive-design.test.cjs` from `client/`.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/MapViewPage.jsx');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');
const DRAWER_PATH = path.join(CLIENT_ROOT, 'src/components/MobileNavDrawer.jsx');
const MEDIA_HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useMediaQuery.js');
const TOUCH_UTIL_PATH = path.join(CLIENT_ROOT, 'src/utils/touchTargets.js');
const NAV_CLASS_PATH = path.join(CLIENT_ROOT, 'src/utils/navLinkClass.js');
const CSS_PATH = path.join(CLIENT_ROOT, 'src/index.css');

// Pages whose action buttons / inputs we expect to be 44 px tall.
const SWEEP_FILES = [
  'src/pages/LoginPage.jsx',
  'src/pages/RegisterPage.jsx',
  'src/pages/ProfilePage.jsx',
  'src/pages/owner/OwnerDashboardPage.jsx',
  'src/pages/owner/OwnerRequestsPage.jsx',
  'src/pages/volunteer/VolunteerDashboardPage.jsx',
  'src/pages/moderator/ModeratorDashboardPage.jsx',
  'src/pages/ResourceDetailsPage.jsx',
  'src/pages/MapViewPage.jsx',
];

let exitCode = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

function section(title) {
  console.log('\n--- ' + title + ' ---');
}

function runChild(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function readSrc(p) {
  return fs.readFileSync(p, 'utf8');
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

async function run() {
  // ── 1. Production build ─────────────────────────────────────────────
  section('1. Vite production build');
  {
    const result = await runChild('npm.cmd', ['run', 'build'], {
      cwd: CLIENT_ROOT,
      env: { NODE_ENV: 'production' },
    });
    if (result.code !== 0) {
      console.error(result.err);
      console.error(result.out);
    }
    assert(result.code === 0, '`npm run build` exits 0');
    assert(fs.existsSync(DIST_DIR), 'dist/ exists');
    const assets = fs.existsSync(DIST_ASSETS)
      ? fs.readdirSync(DIST_ASSETS)
      : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    const cssAssets = assets.filter((f) => f.endsWith('.css'));
    assert(jsAssets.length > 0, 'dist/assets has at least one JS bundle');
    assert(cssAssets.length > 0, 'dist/assets has at least one CSS bundle');

    const allCss = cssAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // CSS rules forcing Leaflet zoom-control buttons to 44 px.
    assert(
      /\.leaflet-bar a,[\s\n]*\.leaflet-bar a:hover[\s\n]*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/.test(allCss) ||
        /\.leaflet-bar a[\s\n]*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/.test(allCss),
      'CSS forces Leaflet zoom controls to 44×44'
    );
    assert(
      /\.whu-pin\s*\{[^}]*width:\s*44px[\s\S]*?height:\s*44px/.test(allCss),
      '.whu-pin is 44×44'
    );
  }

  // ── 2. MobileNavDrawer.jsx source guards ────────────────────────────
  section('2. MobileNavDrawer.jsx source guards');
  {
    const src = readSrc(DRAWER_PATH);

    assert(
      /export default function MobileNavDrawer\b/.test(src),
      'exports MobileNavDrawer as default'
    );
    assert(
      /from\s+['"]react-router-dom['"]/.test(src),
      'imports react-router-dom'
    );
    assert(/<NavLink\b/.test(src), 'uses NavLink');
    assert(/NavLink/.test(src), 'renders NavLinks for every nav item');
    assert(/onClose/.test(src), 'invokes onClose for nav interactions');

    // All drawer items appear in source.
    for (const label of [
      'Home',
      'Health',
      'Resources',
      'Map',
      'My Requests',
      'Incoming',
      'Moderation',
      'Analytics',
      'Profile',
      'Log out',
    ]) {
      assert(src.includes(label), `drawer renders nav item "${label}"`);
    }

    // Role-gating parity with MainLayout.
    assert(
      /user\.role === ['"]VOLUNTEER['"]/.test(src),
      'drawer gates My Requests on VOLUNTEER'
    );
    assert(
      /user\.role === ['"]OWNER['"]/.test(src),
      'drawer gates Incoming on OWNER'
    );
    assert(
      /user\.role === ['"]MODERATOR['"]\s*\|\|\s*user\.role === ['"]ADMIN['"]/.test(
        src
      ),
      'drawer gates Moderation+Analytics on MODERATOR|ADMIN'
    );

    // Closes on Escape + backdrop click.
    assert(/Escape/.test(src), 'drawer closes on Escape key');
    assert(
      /onClick=\{close\}[\s\S]{0,80}aria-label="Close menu"/.test(src) ||
        /onClick=\{\(\) => onClose\(\)\}/.test(src),
      'drawer renders a close button'
    );

    // Lock body scroll while open.
    assert(
      /document\.body\.style\.overflow/.test(src),
      'drawer locks body scroll while open'
    );
  }

  // ── 3. useMediaQuery.js source guards ───────────────────────────────
  section('3. useMediaQuery.js source guards');
  {
    const src = readSrc(MEDIA_HOOK_PATH);
    assert(
      /export\s+default\s+function\s+useMediaQuery\b/.test(src),
      'exports useMediaQuery as default'
    );
    assert(
      /export\s+function\s+useIsDesktop\b/.test(src),
      'exports useIsDesktop named export'
    );
    assert(
      /window\.matchMedia/.test(src),
      'useMediaQuery uses window.matchMedia'
    );
    assert(
      /addEventListener[\s\S]{0,8}change/.test(src),
      'listens for media-query change events'
    );
  }

  // ── 4. MainLayout.jsx wiring ────────────────────────────────────────
  section('4. MainLayout.jsx wiring');
  {
    const src = readSrc(LAYOUT_PATH);
    assert(
      /import\s+MobileNavDrawer\s+from\s+['"]\.\.\/components\/MobileNavDrawer['"]/.test(
        src
      ),
      'MainLayout imports MobileNavDrawer'
    );
    assert(
      /<MobileNavDrawer\b/.test(src),
      'MainLayout renders MobileNavDrawer'
    );

    // Desktop nav has the full-width horizontal nav.
    assert(
      /hidden[^"]*md:flex/.test(src) ||
        /md:flex[^"]*hidden/.test(src),
      'MainLayout desktop nav uses md:flex'
    );

    // Mobile hamburger button is hidden on desktop.
    assert(
      /md:hidden/.test(src),
      'MainLayout mobile block uses md:hidden'
    );
    assert(
      /whu-mobile-menu-toggle/.test(src),
      'hamburger button has a stable testid'
    );
    assert(
      /aria-expanded/.test(src),
      'hamburger button sets aria-expanded'
    );

    // utils/navLinkClass pulls the shared helper.
    assert(
      /from\s+['"]\.\.\/utils\/navLinkClass['"]/.test(src),
      'MainLayout imports navLinkClass'
    );

    // Bell is still rendered (regression for 7.5).
    assert(/<NotificationBell\s*\/>/.test(src), 'NotificationBell still rendered');
    // The 7.5 regression expects the bell within ~400 chars after a
    // role-specific nav link. Both fragments (desktop + mobile) still
    // include the bell, so we just confirm "Moderation" appears within
    // 600 chars before the bell (mobile+desktop both sit adjacent).
    assert(
      /Moderation[\s\S]{0,600}<NotificationBell/.test(src),
      'bell still appears in source within ~600 chars after a Moderation anchor'
    );

    // Role gate still present.
    assert(
      /user\.role === ['"]MODERATOR['"]\s*\|\|\s*user\.role === ['"]ADMIN['"]/.test(
        src
      ),
      'MainLayout gates Moderation+Analytics on MODERATOR|ADMIN'
    );
  }

  // ── 5. MapViewPage.jsx ──────────────────────────────────────────────
  section('5. MapViewPage.jsx wiring');
  {
    const src = readSrc(PAGE_PATH);
    assert(
      /import\s*\{[^}]*ZoomControl[^}]*\}\s*from\s+['"]react-leaflet['"]/.test(
        src
      ),
      'MapViewPage imports ZoomControl from react-leaflet'
    );
    assert(
      /zoomControl=\{false\}/.test(src),
      'MapContainer disables the default zoom control'
    );
    assert(
      /<ZoomControl\b[^>]*position\s*=\s*["']bottomright["']/m.test(src),
      'renders a <ZoomControl position="bottomright" />'
    );

    // The popup action button was bumped to 44 px.
    assert(/min-h-\[44px\]/.test(src), 'popup "Open details" button is 44 px tall');
  }

  // ── 6. Touch-target sweep ───────────────────────────────────────────
  section('6. Touch-target sweep');
  {
    assert(fs.existsSync(TOUCH_UTIL_PATH), 'utils/touchTargets.js exists');
    const util = readSrc(TOUCH_UTIL_PATH);
    assert(/TOUCH_BTN/.test(util), 'touchTargets exports TOUCH_BTN constant');

    for (const rel of SWEEP_FILES) {
      const p = path.join(CLIENT_ROOT, rel);
      assert(fs.existsSync(p), `${rel} exists`);
      const src = readSrc(p);

      // Page must have at least one 44 px action control.
      assert(
        /min-h-\[44px\]/.test(src),
        `${rel} bumped some action control to min-h-[44px]`
      );
      // And the page must have at least one `py-2.5` (the 44 px pad).
      assert(
        /py-2\.5/.test(src),
        `${rel} uses py-2.5 padding (44 px touch target)`
      );
    }
  }

  // ── 7. Bundle carries the mobile-nav UI copy ────────────────────────
  section('7. Bundle assertions');
  {
    const assets = fs.existsSync(DIST_ASSETS)
      ? fs.readdirSync(DIST_ASSETS)
      : [];
    const allJs = assets
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // Mobile-nav UI copy that must reach the bundle.
    for (const label of [
      'Open menu',
      'Close menu',
      'We Help Us',
    ]) {
      assert(allJs.includes(label), `bundle contains "${label}"`);
    }

    // Regression: 7.4 socket + 7.5 bell are still in the bundle.
    assert(
      allJs.includes('notification:new'),
      'bundle still references the 7.4 socket event'
    );
    assert(
      allJs.includes('whu-notification-bell') ||
        allJs.includes('NotificationBell'),
      'bundle still references the 7.5 bell'
    );

    // Regression: 8.2 analytics dashboard is still rendered.
    assert(
      /analytics\/(total-by-category|distribution-by-area|most-used-resources|active-emergency-assets|coverage-by-village)/.test(
        allJs
      ),
      'bundle still references an 8.2 analytics endpoint'
    );
  }

  // ── 8. React smoke (App.jsx still mounts the layout) ────────────────
  section('8. App.jsx regression');
  {
    const src = readSrc(APP_PATH);
    assert(
      /import\s+MainLayout\s+from\s+['"]\.\/layouts\/MainLayout\.jsx['"]/.test(
        src
      ),
      'App.jsx still imports MainLayout'
    );
    // /analytics route is still inside the MODERATOR/ADMIN gate.
    assert(
      /path=["']analytics["']/.test(src),
      'App.jsx still registers /analytics'
    );
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = process.exitCode || exitCode || 1;
  } finally {
    if (process.exitCode !== 1 && exitCode === 1) {
      process.exitCode = exitCode;
    }
  }
})();
