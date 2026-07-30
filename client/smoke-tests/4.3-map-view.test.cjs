/**
 * End-to-end smoke test for Module 4.3 — Interactive Map View (client).
 *
 * Module 4.3 is a pure-client module: it reuses GET /api/resources
 * (already covered by the 4.1 server smoke) and adds a Leaflet map
 * page on top of it. There's no new server endpoint to test.
 *
 * What this validates:
 *   1. Vite production build succeeds with the new MapViewPage,
 *      useMapResources hook, and the updated App.jsx + MainLayout.
 *   2. App.jsx imports MapViewPage AND /resources/map sits inside
 *      the auth-only ProtectedRoute AND is registered BEFORE
 *      /resources/:id so the literal "map" segment wins the
 *      matcher (otherwise the :id wildcard captures "map" first).
 *   3. MainLayout renders a NavLink to /resources/map inside the
 *      logged-in branch.
 *   4. useMapResources.js exports the hook, uses useQuery, GETs
 *      /api/resources, and applies limit=50 + the category/status
 *      params.
 *   5. MapViewPage source defines Header/FilterBar/ResourceMap/
 *      ResourceMarker/MapFitter/Legend/StatusBadge/EmptyState/
 *      LoadingState/ErrorBanner; calls useMapResources; imports
 *      the Leaflet primitives (MapContainer, Marker, Popup,
 *      TileLayer, useMap) and the category icon factory; renders
 *      a popup with an "Open details" link to /resources/:id;
 *      privacy boundary: the page source does NOT access
 *      resource.ownerId / owner.email / owner.phone / owner.name.
 *   6. The CSS bundle defines the four status overlay classes
 *      (.whu-pin--status-available/reserved/in_use/unavailable)
 *      AND the map-view helpers (.whu-map / .whu-map-legend).
 *
 * Run: `node smoke-tests/4.3-map-view.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/MapViewPage.jsx');
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useMapResources.js');
const CSS_PATH = path.join(CLIENT_ROOT, 'src/index.css');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');
const SEARCH_PATH = path.join(CLIENT_ROOT, 'src/pages/SearchPage.jsx');

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
    const result = await runChild('npm.cmd', ['run', 'build'], {
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
    const allCss = cssAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // Page name + route are referenced.
    assert(
      /MapViewPage|['"`]resources\/map['"`]/.test(allJs),
      'bundle references the new map page/route'
    );
    // Page copy.
    for (const label of [
      'Resources on the map',
      'Apply filters',
      'Open details',
      'Status',
      'Available',
      'Reserved',
      'In Use',
      'Unavailable',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
    // CSS: status overlay hooks + map view helpers.
    assert(
      /\.whu-pin--status-available\b/.test(allCss),
      'CSS defines .whu-pin--status-available'
    );
    assert(
      /\.whu-pin--status-reserved\b/.test(allCss),
      'CSS defines .whu-pin--status-reserved'
    );
    assert(
      /\.whu-pin--status-in_use\b/.test(allCss),
      'CSS defines .whu-pin--status-in_use'
    );
    assert(
      /\.whu-pin--status-unavailable\b/.test(allCss),
      'CSS defines .whu-pin--status-unavailable'
    );
    assert(/\.whu-map\b/.test(allCss), 'CSS defines .whu-map');
    assert(/\.whu-map-legend\b/.test(allCss), 'CSS defines .whu-map-legend');
  }

  // ── 2. App.jsx wiring ───────────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+MapViewPage\s+from\s+['"]\.\/pages\/MapViewPage\.jsx['"]/.test(appSrc),
      'App.jsx imports MapViewPage'
    );
    assert(
      /path\s*=\s*['"]resources\/map['"]/.test(appSrc),
      'App.jsx registers the /resources/map route'
    );
    // Must be inside an auth-only ProtectedRoute (no `roles` prop).
    const guard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s*\/>\}>([\s\S]*?)<\/Route>/
    );
    assert(guard, 'auth-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]resources\/map['"]/.test(guard[1]),
      '/resources/map sits under the auth-only ProtectedRoute'
    );
    // Route ordering: /resources/map must be registered BEFORE
    // /resources/:id, otherwise React Router matches the :id
    // wildcard first and tries to look up "map" as an ObjectId.
    const mapIdx = appSrc.search(/path\s*=\s*['"]resources\/map['"]/);
    const idIdx = appSrc.search(/path\s*=\s*['"]resources\/:id['"]/);
    assert(mapIdx > 0 && idIdx > 0, 'both routes are registered');
    assert(
      mapIdx < idIdx,
      '/resources/map is registered BEFORE /resources/:id (literal before wildcard)'
    );
  }

  // ── 3. MainLayout nav wiring ────────────────────────────────────────
  section('3. MainLayout nav wiring');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/resources\/map['"]/.test(layoutSrc),
      'MainLayout renders a NavLink to /resources/map'
    );
    // Should sit inside the logged-in branch (alongside the existing
    // Resources link).
    assert(
      /\{user \?/.test(layoutSrc) && /to="\/resources\/map"/.test(layoutSrc),
      'Map nav link is inside the logged-in branch'
    );
  }

  // ── 4. useMapResources.js source guards ─────────────────────────────
  section('4. useMapResources.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    assert(/export function useMapResources\b/.test(src),
      'exports useMapResources');
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'uses useQuery (not useInfiniteQuery)');
    assert(
      /api\.get\(['"]\/resources['"]/.test(src),
      'GETs /api/resources'
    );
    // The hook enforces a generous `limit` so the map gets one
    // round-trip's worth of pins.
    assert(/limit\s*:/.test(src) && /\b50\b/.test(src),
      'requests limit=50 (the server MAX_LIMIT)');
    // Category + status filter params supported.
    assert(/category/.test(src), 'params builder references "category"');
    assert(/status/.test(src), 'params builder references "status"');
    // Stable queryKey includes a hash of the filters.
    assert(
      /queryKey:\s*\[\s*['"]map-resources['"]/.test(src),
      'queryKey is ["map-resources", hash]'
    );
    // Privacy: the hook itself does NOT pull the owner object — only
    // /api/resources. No /users/:id, no /auth/me.
    assert(!/api\.get\(['"]\/users/.test(src), 'hook does NOT fetch /users/:id');
    assert(!/api\.get\(['"]\/auth\/me/.test(src), 'hook does NOT fetch /auth/me');
  }

  // ── 5. MapViewPage.jsx source guards ────────────────────────────────
  section('5. MapViewPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present.
    for (const name of [
      'Header',
      'FilterBar',
      'ResourceMap',
      'MapFitter',
      'ResourceMarker',
      'Legend',
      'StatusBadge',
      'EmptyState',
      'LoadingState',
      'ErrorBanner',
    ]) {
      assert(src.includes(`function ${name}`), `page defines ${name}`);
    }

    // Hooks wired.
    assert(/useMapResources\s*\(/.test(src), 'page calls useMapResources');
    assert(/useSearchParams\s*\(/.test(src), 'page reads useSearchParams');
    assert(/setSearchParams/.test(src), 'page writes setSearchParams');
    assert(
      /import\s*\{[^}]*Link[^}]*\}\s*from\s*['"]react-router-dom['"]/.test(src),
      'page imports Link from react-router-dom'
    );

    // Leaflet primitives.
    assert(
      /import\s*\{[^}]*MapContainer[^}]*\}\s*from\s*['"]react-leaflet['"]/.test(src),
      'page imports MapContainer from react-leaflet'
    );
    assert(/<MapContainer\b/.test(src), 'page renders MapContainer');
    assert(/<TileLayer\b/.test(src), 'page renders TileLayer');
    assert(/<Marker\b/.test(src), 'page renders Marker');
    assert(/<Popup\b/.test(src), 'page renders Popup');
    assert(/useMap\s*\(\s*\)/.test(src), 'page uses useMap() (MapFitter)');

    // Category icon factory + emoji helper.
    assert(/getCategoryIcon\s*\(/.test(src), 'page uses getCategoryIcon');
    assert(/getCategoryEmoji\s*\(/.test(src), 'page uses getCategoryEmoji');
    assert(/getCategoryLabel\s*\(/.test(src), 'page uses getCategoryLabel');

    // OSM attribution (legal requirement).
    assert(
      /OpenStreetMap/.test(src),
      'page references OpenStreetMap attribution'
    );

    // Click → /resources/:id link inside the popup.
    assert(
      /to=\{`\/resources\/\$\{resource\.id\}`\}/.test(src),
      'ResourceMarker builds a /resources/<id> link'
    );
    assert(/Open details/.test(src), 'popup shows an "Open details" CTA');

    // Filter wiring (category + status).
    assert(
      /setSearchParams\(\s*sp\s*,\s*\{\s*replace:\s*true\s*\}\s*\)/.test(src),
      'applyFilters uses replace-true history semantics'
    );
    assert(/clearFilters/.test(src), 'page has a clearFilters handler');

    // Bounds fitter.
    assert(
      /map\.fitBounds|map\.setView/.test(src),
      'MapFitter zooms / fits bounds to the plotted resources'
    );

    // Privacy — strip comments before grepping so the doc block above
    // each function doesn't trip the regex.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/\bowner\.email\b/.test(codeOnly),
      'page does NOT access owner.email'
    );
    assert(
      !/\bowner\.phone\b/.test(codeOnly),
      'page does NOT access owner.phone'
    );
    assert(
      !/\bowner\.name\b/.test(codeOnly),
      'page does NOT access owner.name'
    );
    assert(
      !/\bresource\.owner\b/.test(codeOnly),
      'page does NOT access resource.owner'
    );
    assert(
      !/\bresource\.ownerId\b/.test(codeOnly),
      'page does NOT access resource.ownerId (markers go through getCategoryIcon)'
    );

    // Import paths.
    assert(
      /from\s+['"]\.\.\/hooks\/useMapResources['"]/.test(src),
      'page imports useMapResources from ../hooks/useMapResources'
    );
    assert(
      /from\s+['"]\.\.\/utils\/categories['"]/.test(src),
      'page imports from ../utils/categories'
    );
    assert(
      /from\s+['"]\.\.\/utils\/constants['"]/.test(src),
      'page imports from ../utils/constants'
    );
    assert(
      /import\s+['"]\.\.\/utils\/leaflet-icons['"]/.test(src),
      'page imports leaflet-icons side-effect fix'
    );
    // (Side-effect import has no `from` keyword; the regex matches
    // the bare `import '../utils/leaflet-icons';` form.)
  }

  // ── 6. SearchPage links to the map view ─────────────────────────────
  section('6. SearchPage exposes a map link');
  {
    const src = fs.readFileSync(SEARCH_PATH, 'utf8');
    assert(
      /to="\/resources\/map"/.test(src),
      'SearchPage renders a link to /resources/map'
    );
  }

  // ── 7. CSS bundle contains status + map helpers ─────────────────────
  section('7. index.css — status overlays + map helpers');
  {
    const src = fs.readFileSync(CSS_PATH, 'utf8');
    // Each status overlay references the project's color tokens.
    assert(
      /\.whu-pin--status-available\s*\{[^}]*color:\s*var\(--color-safe-/.test(src),
      '.whu-pin--status-available uses --color-safe-* token'
    );
    assert(
      /\.whu-pin--status-reserved\s*\{[^}]*color:\s*var\(--color-caution-/.test(src),
      '.whu-pin--status-reserved uses --color-caution-* token'
    );
    assert(
      /\.whu-pin--status-in_use\s*\{[^}]*color:\s*var\(--color-caution-/.test(src),
      '.whu-pin--status-in_use uses --color-caution-* token'
    );
    assert(
      /\.whu-pin--status-unavailable\s*\{[^}]*color:\s*var\(--color-alert-/.test(src),
      '.whu-pin--status-unavailable uses --color-alert-* token'
    );
    // Map view helpers (used by the page's className strings).
    assert(/\.whu-map\s*\{/.test(src), '.whu-map defined');
    assert(/\.whu-map-legend\s*\{/.test(src), '.whu-map-legend defined');
    // Base pin styles must still be present (regression guard from 3.3).
    assert(/\.whu-pin\s*\{/.test(src), '.whu-pin defined');
    assert(/\.whu-pin__emoji\s*\{/.test(src), '.whu-pin__emoji defined');
    assert(
      /\.leaflet-div-icon\.whu-category-icon/.test(src),
      '.leaflet-div-icon.whu-category-icon override still present'
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
    process.exitCode = exitCode;
  }
})();