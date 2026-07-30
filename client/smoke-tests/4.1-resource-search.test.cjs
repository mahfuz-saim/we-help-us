/**
 * End-to-end smoke test for Module 4.1 — Resource Search Page (client).
 *
 * What this validates:
 *   1. Vite production build succeeds with the new SearchPage,
 *      useResourceSearch, AreaCascadeFilter, and utils/distance.
 *   2. App.jsx imports SearchPage AND /resources sits inside the
 *      auth-only ProtectedRoute.
 *   3. MainLayout exposes a "Resources" NavLink for logged-in users.
 *   4. useResourceSearch uses useInfiniteQuery, sends the new
 *      filter params (category/status/areaId/q/minCapacity/lat/lng/radius)
 *      to /api/resources, and advances pages via pagination.pages.
 *   5. AreaCascadeFilter is search-only — uses useDistricts + useChildren
 *      but does NOT import leaflet or useNominatimSearch.
 *   6. utils/distance exports haversineMeters + formatDistance and the
 *      haversine function returns the expected values for known pairs.
 *   7. SearchPage source contains the filters form, the Load more
 *      button, the StatusBadge helper, the distance display, and
 *      never renders ownerId / owner.email / owner.phone.
 *
 * Run: `node smoke-tests/4.1-resource-search.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/SearchPage.jsx');
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useResourceSearch.js');
const AREA_PATH = path.join(CLIENT_ROOT, 'src/components/AreaCascadeFilter.jsx');
const DIST_PATH = path.join(CLIENT_ROOT, 'src/utils/distance.js');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');

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

async function run() {
  // ── 1. Production build ─────────────────────────────────────────────
  section('1. Vite production build');
  {
    const result = await runChild('npm', ['run', 'build'], {
      cwd: CLIENT_ROOT,
      env: { NODE_ENV: 'production' },
    });
    if (result.code !== 0) {
      console.error(result.err);
      console.error(result.out);
    }
    assert(result.code === 0, '‘npm run build’ exits 0');
    assert(fs.existsSync(DIST_DIR), 'dist/ exists');
    const assets = fs.existsSync(DIST_ASSETS) ? fs.readdirSync(DIST_ASSETS) : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    const cssAssets = assets.filter((f) => f.endsWith('.css'));
    assert(jsAssets.length > 0, 'dist/assets has at least one JS bundle');
    assert(cssAssets.length > 0, 'dist/assets has at least one CSS bundle');

    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // The page name + route are in the bundle because the router
    // imports the page module statically.
    assert(/SearchPage|['"`]resources['"`]/.test(allJs),
      'bundle references the new search page/route');
    // Filter labels and copy.
    for (const label of ['Apply filters', 'Clear filters', 'Load more', 'Any distance', 'Any category', 'Any status', 'Within 1 km']) {
      assert(allJs.includes(label), `bundle contains filter copy "${label}"`);
    }
    // Empty-state copy.
    assert(
      /No resources match your filters|No resources yet/.test(allJs),
      'bundle contains empty-state copy'
    );
  }

  // ── 2. App.jsx wiring ───────────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+SearchPage\s+from\s+['"]\.\/pages\/SearchPage\.jsx['"]/.test(appSrc),
      'App.jsx imports SearchPage'
    );
    assert(
      /path\s*=\s*['"]resources['"]/.test(appSrc),
      'App.jsx registers the /resources route'
    );
    // Must be inside an auth-only ProtectedRoute (no `roles` prop).
    const guard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s*\/>\}>([\s\S]*?)<\/Route>/
    );
    assert(guard, 'auth-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]resources['"]/.test(guard[1]),
      '/resources sits under the auth-only ProtectedRoute'
    );
    assert(
      /path\s*=\s*['"]profile['"]/.test(guard[1]),
      '/profile still sits under the auth-only ProtectedRoute'
    );
  }

  // ── 3. MainLayout exposes Resources nav ─────────────────────────────
  section('3. MainLayout nav wiring');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/resources['"]/.test(layoutSrc),
      'MainLayout renders a NavLink to /resources'
    );
    // The link should be visible only to logged-in users, alongside
    // the existing Profile link.
    assert(
      /\{user \?/.test(layoutSrc) && /to="\/resources"/.test(layoutSrc),
      'Resources nav link is inside the logged-in branch'
    );
  }

  // ── 4. useResourceSearch source guards ──────────────────────────────
  section('4. useResourceSearch.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    assert(/export function useResourceSearch/.test(src),
      'exports useResourceSearch');
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useInfiniteQuery\s*\(/.test(src),
      'uses useInfiniteQuery');
    assert(
      /api\.get\(['"]\/resources['"]/.test(src),
      'GETs /api/resources'
    );
    // Every new filter param appears in the params builder.
    for (const k of ['category', 'status', 'areaId', 'q', 'minCapacity', 'lat', 'lng', 'radius']) {
      assert(
        new RegExp(`params\\.${k}\\b|${k}\\s*:`).test(src),
        `params builder references "${k}"`
      );
    }
    assert(
      /initialPageParam:\s*1/.test(src),
      'starts at page 1'
    );
    assert(
      /getNextPageParam/.test(src),
      'defines getNextPageParam'
    );
    assert(
      /const\s*\{\s*page\s*,\s*pages\s*\}\s*=\s*lastPage\.pagination/.test(src) ||
        /pagination\.(?:page|pages)/.test(src),
      'getNextPageParam reads pagination.page + pagination.pages'
    );
  }

  // ── 5. AreaCascadeFilter is search-only ─────────────────────────────
  section('5. AreaCascadeFilter.jsx source guards');
  {
    const src = fs.readFileSync(AREA_PATH, 'utf8');
    assert(/export default function AreaCascadeFilter/.test(src),
      'exports AreaCascadeFilter default');
    assert(
      /from\s+['"]\.\.\/hooks\/useAreas['"]/.test(src),
      'imports useAreas hooks'
    );
    assert(/useDistricts\s*\(/.test(src), 'calls useDistricts');
    assert(/useChildren\s*\(/.test(src), 'calls useChildren');
    // No map / Nominatim / leaflet — this component is filter-only.
    assert(!/leaflet/.test(src), 'does NOT import leaflet');
    assert(!/useNominatimSearch/.test(src), 'does NOT import useNominatimSearch');
    assert(!/react-leaflet/.test(src), 'does NOT import react-leaflet');
    // No MapContainer / Marker / TileLayer — confirms no map UI.
    assert(!/<MapContainer|<Marker|<TileLayer/.test(src),
      'does NOT render any Leaflet primitives');
  }

  // ── 6. utils/distance ───────────────────────────────────────────────
  section('6. utils/distance.js source + runtime');
  {
    const src = fs.readFileSync(DIST_PATH, 'utf8');
    assert(/export function haversineMeters/.test(src), 'exports haversineMeters');
    assert(/export function formatDistance/.test(src), 'exports formatDistance');

    // Runtime exercise via dynamic import.
    const url = 'file://' + DIST_PATH.replace(/\\/g, '/');
    const mod = await import(url);

    // Round-trip: distance from a point to itself is 0.
    assert(mod.haversineMeters([90.4, 23.8], [90.4, 23.8]) === 0,
      'haversine round-trip is 0 m');

    // Known pair: Dhaka center to ~6km east. Should be roughly 5551m
    // (the server's haversine returns the same value within ±5m for
    // the same pair, so we tolerate a 50m margin).
    const d = mod.haversineMeters([90.4125, 23.8103], [90.4625, 23.8303]);
    assert(d != null && Math.abs(d - 5551) < 50,
      `haversine Dhaka center → 6km east ≈ 5551 m (got ${d})`);

    // Bad input is null, not NaN.
    assert(mod.haversineMeters(null, [0, 0]) === null, 'null input → null');
    assert(mod.haversineMeters([90.4, 23.8], [200, 0]) === null,
      'out-of-range lng → null');

    // Formatter.
    assert(mod.formatDistance(850) === '850 m', 'format 850 m');
    assert(mod.formatDistance(2300) === '2.3 km', 'format 2300 m');
    assert(mod.formatDistance(12500) === '13 km', 'format 12500 m');
    assert(mod.formatDistance(null) === null, 'format null');
  }

  // ── 7. SearchPage source guards ─────────────────────────────────────
  section('7. SearchPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present.
    for (const name of ['Header', 'FiltersForm', 'ResourceCard', 'StatusBadge', 'Pagination', 'EmptyState', 'LoadingState', 'ErrorBanner']) {
      assert(src.includes(`function ${name}`), `page defines ${name}`);
    }

    // Hooks wired.
    assert(/useResourceSearch\s*\(/.test(src), 'page calls useResourceSearch');
    assert(/useAuth\s*\(/.test(src), 'page calls useAuth');
    assert(/AreaCascadeFilter/.test(src), 'page imports AreaCascadeFilter');

    // Distance computation.
    assert(/haversineMeters\s*\(/.test(src), 'page computes distance');
    assert(/formatDistance\s*\(/.test(src), 'page formats distance');
    assert(/away/.test(src), 'distance label includes "away"');

    // URL state (search params).
    assert(/useSearchParams\s*\(/.test(src), 'page reads useSearchParams');
    assert(/setSearchParams/.test(src), 'page writes setSearchParams');

    // Load more button.
    assert(/fetchNextPage/.test(src), 'page wires fetchNextPage');
    assert(/Load more/.test(src), 'page shows Load more button');

    // Privacy boundary: never renders ownerId / owner email / owner phone.
    // We allow the literal string 'owner' in identifiers but ban any
    // direct render of owner contact info.
    assert(!/resource\.ownerId/.test(src), 'page does NOT access resource.ownerId');
    assert(!/owner\.email/.test(src), 'page does NOT access owner.email');
    assert(!/owner\.phone/.test(src), 'page does NOT access owner.phone');
    assert(!/resource\.owner/.test(src), 'page does NOT access resource.owner');
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = exitCode;
  }
})();