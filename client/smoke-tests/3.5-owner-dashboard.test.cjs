/**
 * End-to-end smoke test for Module 3.5 — Owner Dashboard (client side).
 *
 * What this validates:
 *   - Vite production build succeeds with the new OwnerDashboardPage,
 *     the useMyResources hook trio, and the page wiring in App.jsx.
 *   - The page is mounted under the OWNER-only ProtectedRoute in
 *     App.jsx so the route guard + role check are wired at the
 *     router level.
 *   - useMyResources exports the three hooks the dashboard consumes
 *     (useMyResources / useToggleAvailability / useDeleteResource) and
 *     sends the `mine=1` query that 3.5's server-side filter relies on.
 *   - OwnerDashboardPage defines the status filter chips, the
 *     lifecycle-status guard, the confirm-delete modal, and the
 *     post-registration toast + URL strip — all the pieces the
 *     spec promised.
 *   - The hook trio wires cache invalidation on mutation success so
 *     the dashboard refreshes after toggle / delete.
 *
 * We do NOT dynamic-import the page itself under Node — it pulls in
 * react-leaflet (transitive) which crashes without a DOM. The
 * previous modules proved that workaround is brittle; instead the
 * build + static-guard sections cover the page surface and the hook
 * trio gets its own static-guard section.
 *
 * Run: `node smoke-tests/3.5-owner-dashboard.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/owner/OwnerDashboardPage.jsx');
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useMyResources.js');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const CONSTANTS_PATH = path.join(CLIENT_ROOT, 'src/utils/constants.js');

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
  // ── 1. Production build ───────────────────────────────────────────────
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

    // The page name + route are present in the bundle because the
    // router imports the page module statically.
    assert(/OwnerDashboardPage|owner\/resources['"`]/.test(allJs),
      'bundle references the new dashboard page/route');
    // Status filter labels are constants in the bundle.
    for (const label of ['All', 'Available', 'Unavailable', 'Reserved', 'In Use']) {
      assert(
        allJs.includes(label),
        `bundle contains status filter label "${label}"`
      );
    }
    // Empty-state + lifecycle-status copy.
    assert(
      /haven.?t registered|Managed by request/.test(allJs),
      'bundle contains empty-state or lifecycle-status copy'
    );
  }

  // ── 2. App.jsx wires the page under the OWNER role guard ──────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+OwnerDashboardPage\s+from\s+['"]\.\/pages\/owner\/OwnerDashboardPage\.jsx['"]/.test(appSrc),
      'App.jsx imports OwnerDashboardPage'
    );
    assert(
      /path\s*=\s*['"]owner\/resources['"]/.test(appSrc),
      'App.jsx registers the /owner/resources route'
    );
    // Must be inside an OWNER-only ProtectedRoute so the page can't be
    // reached by a VOLUNTEER or anonymous user.
    const ownerGuard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s+roles=\{?\[['\"]OWNER['\"]\][^}]*\}?\s*\/>\}>([\s\S]*?)<\/Route>/
    );
    assert(ownerGuard, 'OWNER-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]owner\/resources['"]/.test(ownerGuard[1]),
      '/owner/resources sits under the OWNER-only ProtectedRoute'
    );
    assert(
      /path\s*=\s*['"]owner\/resources\/new['"]/.test(ownerGuard[1]),
      '/owner/resources/new sits under the OWNER-only ProtectedRoute'
    );
  }

  // ── 3. useMyResources.js source guards ───────────────────────────────
  section('3. useMyResources.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    assert(/export function useMyResources\b/.test(src), 'exports useMyResources');
    assert(/export function useToggleAvailability\b/.test(src), 'exports useToggleAvailability');
    assert(/export function useDeleteResource\b/.test(src), 'exports useDeleteResource');
    // The hook trio imports the right primitives.
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'hooks import @tanstack/react-query'
    );
    assert(
      /import\s+api\s+from\s+['"]\.\.\/services\/api['"]/.test(src),
      'hooks import the shared api client'
    );
    // The queryFn sends `mine: 1` — the literal the server expects.
    assert(/mine:\s*1\b/.test(src), 'useMyResources queryFn sends mine=1');
    assert(/['"]\/resources['"]/.test(src), 'hooks target /api/resources');
    // Mutations invalidate the matching query keys so the UI refreshes.
    assert(
      /qc\.invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]my-resources['"]/.test(src),
      'mutations invalidate ["my-resources"] cache keys'
    );
    // PATCH body shape matches what the server's updateResourceSchema
    // expects: { status }.
    assert(
      /api\.patch\([^)]*\{\s*status:\s*nextStatus\s*\}/.test(src),
      'useToggleAvailability PATCHes { status: nextStatus }'
    );
    assert(
      /api\.delete\([^)]*\)/.test(src),
      'useDeleteResource DELETEs /api/resources/:id'
    );
  }

  // ── 4. Page source guards ─────────────────────────────────────────────
  section('4. OwnerDashboardPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');
    // Sub-components present.
    for (const name of ['Header', 'StatusFilters', 'ResourceCard', 'StatusBadge', 'EmptyState', 'LoadingState', 'ErrorBanner', 'DeleteConfirmModal']) {
      assert(src.includes(`function ${name}`), `page defines ${name}`);
    }
    // Hook trio wired.
    assert(/useMyResources\(/.test(src), 'page calls useMyResources');
    assert(/useToggleAvailability\(/.test(src), 'page calls useToggleAvailability');
    assert(/useDeleteResource\(/.test(src), 'page calls useDeleteResource');
    // Hook trio imported from the right module.
    assert(
      /import\s*\{[^}]*useMyResources[^}]*\}\s*from\s*['"]\.\.\/\.\.\/hooks\/useMyResources['"]/.test(src),
      'page imports useMyResources from the hook module'
    );
    // Status filter list is frozen so it can't be mutated at runtime.
    assert(
      /STATUS_FILTERS\s*=\s*Object\.freeze/.test(src),
      'STATUS_FILTERS is Object.freeze-d'
    );
    // Lifecycle-status guard — RESERVED and IN_USE rows must NOT show
    // a manual toggle.
    assert(
      /LIFECYCLE_STATUSES\s*=\s*new\s+Set\(\s*\[\s*['"]RESERVED['"]\s*,\s*['"]IN_USE['"]\s*\]\s*\)/.test(src),
      'page defines LIFECYCLE_STATUSES = {RESERVED, IN_USE}'
    );
    // The dashboard reads ?new=<id> from searchParams post-registration
    // and strips it. The form page passes ?new=<id>; the dashboard
    // mirrors that handshake.
    assert(/searchParams\.get\(['"]new['"]\)/.test(src), 'page reads ?new=<id> from URL');
    assert(
      /next\.delete\(['"]new['"]\)/.test(src),
      'page strips ?new=<id> from the URL after toasting'
    );
    // Post-registration toast copy.
    assert(/Resource registered/.test(src), 'page toasts "Resource registered"');
    // Toggle mutation updates with the next status the server expects.
    assert(
      /RESOURCE_STATUS\.AVAILABLE\.value/.test(src) &&
        /RESOURCE_STATUS\.UNAVAILABLE\.value/.test(src),
      'toggle uses RESOURCE_STATUS.AVAILABLE.value + UNAVAILABLE.value'
    );
    // The toggle button copy mentions available/unavailable.
    assert(/Mark available|Mark unavailable/.test(src), 'toggle button copy is wired');
    // Edit action defers to a future module rather than building a full
    // edit form in 3.5. The button stays in the markup so the layout
    // is stable.
    assert(/Edit/.test(src), 'Edit button exists');
    assert(
      /e\.preventDefault\(\)/.test(src),
      'Edit button is intercepted (defers to a future module)'
    );
    // The dashboard surfaces ownerId nowhere — privacy boundary.
    // (Owner contact info isn't on the response, but a defensive
    // assertion keeps us from accidentally rendering ownerId later.)
    assert(
      !/\bresource\.ownerId\b/.test(src),
      'page does not display resource.ownerId (dashboard is for the owner themselves)'
    );
  }

  // ── 5. Constants sync ─────────────────────────────────────────────────
  section('5. constants.js RESOURCE_STATUS is in sync with the page');
  {
    const constSrc = fs.readFileSync(CONSTANTS_PATH, 'utf8');
    // Every status the dashboard's filter chips reference must exist
    // in RESOURCE_STATUS. The filter chips drive off literal status
    // values — drift here would silently break filtering.
    for (const value of ['AVAILABLE', 'UNAVAILABLE', 'RESERVED', 'IN_USE']) {
      assert(
        new RegExp(`${value}\\s*:`).test(constSrc),
        `RESOURCE_STATUS defines ${value}`
      );
    }
    // Each status entry must carry a `color` token (the badge styling
    // maps off it).
    for (const value of ['AVAILABLE', 'UNAVAILABLE', 'RESERVED', 'IN_USE']) {
      const block = constSrc.match(
        new RegExp(`${value}\\s*:\\s*\\{[\\s\\S]*?\\}\\s*,?`)
      );
      assert(block, `RESOURCE_STATUS has a block for ${value}`);
      assert(
        block && /color:\s*['"][a-z]+['"]/.test(block[0]),
        `  ${value} has a color token`
      );
    }
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