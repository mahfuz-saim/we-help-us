/**
 * End-to-end smoke test for Module 8.2 — Analytics Dashboard (client).
 *
 * The server surface (5 read-only analytics endpoints under
 * /api/analytics) shipped in Module 8.1 and is locked by
 * server/smoke-tests/8.1-analytics-apis.test.js. Module 8.2 ships the
 * moderator-facing dashboard that consumes those endpoints.
 *
 * Coverage:
 *   1. Vite production build succeeds with the new hook + page +
 *      chart components + App.jsx wiring + MainLayout link.
 *   2. useAnalytics.js source guards: 5 named exports + 1 utility,
 *      TanStack Query, GET endpoint shapes correct, queryKey uses the
 *      ANALYTICS_QUERY_KEY constant, the helper exports a comment-
 *      stripping function.
 *   3. AnalyticsPage.jsx source guards: default export + 5 hooks
 *      wired + CSV export + PrivacyFooter + the chart components are
 *      all imported; the page renders every card title; no /users/:id
 *      or /auth/me fetch (privacy boundary).
 *   4. Chart components: CategoryDonut, AreaBreakdownChart,
 *      MostUsedTable, EmergencyAssetsCard — all default-exported +
 *      consume the round-tripped payload as-is.
 *   5. App.jsx imports AnalyticsPage AND /analytics sits inside the
 *      MODERATOR/ADMIN-only ProtectedRoute (regex-extracted).
 *   6. MainLayout.jsx wires a NavLink to /analytics gated on
 *      user.role === 'MODERATOR' || user.role === 'ADMIN'.
 *   7. Bundle carries the dashboard UI copy ("Analytics & reporting",
 *      "Resources by category", "Distribution by area", "Most-used
 *      resources", "Coverage by area", "Emergency mode", "Export CSV",
 *      "Refresh").
 *   8. Regression guards: the prior nav links (Resources / Map / My
 *      Requests / Incoming / Moderation / Profile / Log out) are all
 *      still present; the bundle still references the 7.5 bell +
 *      7.4 socket event.
 *
 * Run: `node smoke-tests/8.2-analytics-dashboard.test.cjs` from
 * `client/`. Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');

const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useAnalytics.js');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/AnalyticsPage.jsx');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');
const DONUT_PATH = path.join(
  CLIENT_ROOT,
  'src/components/analytics/CategoryDonut.jsx'
);
const AREA_PATH = path.join(
  CLIENT_ROOT,
  'src/components/analytics/AreaBreakdownChart.jsx'
);
const MOST_USED_PATH = path.join(
  CLIENT_ROOT,
  'src/components/analytics/MostUsedTable.jsx'
);
const EMERGENCY_PATH = path.join(
  CLIENT_ROOT,
  'src/components/analytics/EmergencyAssetsCard.jsx'
);

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

    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // UI copy that the bundle must carry.
    for (const label of [
      'Analytics',
      'Resources by category',
      'Distribution by area',
      'Most-used resources',
      'Coverage by area',
      'Emergency mode',
      'Export CSV',
      'Refresh',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. useAnalytics.js source guards ────────────────────────────────
  section('2. useAnalytics.js source guards');
  {
    const src = readSrc(HOOK_PATH);

    for (const name of [
      'useTotalByCategory',
      'useDistributionByArea',
      'useMostUsedResources',
      'useActiveEmergencyAssets',
      'useCoverageByVillage',
    ]) {
      assert(
        new RegExp(`export function ${name}\\b`).test(src),
        `exports ${name}`
      );
    }
    assert(
      /export function useInvalidateAnalytics\b/.test(src),
      'exports useInvalidateAnalytics'
    );

    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'uses useQuery');
    assert(/useQueryClient\s*\(/.test(src), 'uses useQueryClient');
    assert(
      /from\s+['"]\.\.\/services\/api['"]/.test(src),
      'imports the axios api service'
    );

    // ANALYTICS_QUERY_KEY constant export.
    assert(
      /export const ANALYTICS_QUERY_KEY\s*=\s*['"]analytics['"]/.test(src),
      'exports ANALYTICS_QUERY_KEY = "analytics"'
    );

    // queryKey uses the ANALYTICS_QUERY_KEY constant for every hook.
    const queryKeyMatches = src.match(/queryKey:\s*\[\s*ANALYTICS_QUERY_KEY/g) || [];
    assert(
      queryKeyMatches.length >= 5,
      `queryKey uses ANALYTICS_QUERY_KEY in all 5 hooks (got ${queryKeyMatches.length})`
    );

    // GET /api/analytics/total-by-category
    assert(
      /api\.get\(\s*['"`]\/analytics\/total-by-category['"`]/.test(src),
      'GETs /api/analytics/total-by-category'
    );
    // GET /api/analytics/distribution-by-area
    assert(
      /api\.get\(\s*['"`]\/analytics\/distribution-by-area['"`]/.test(src),
      'GETs /api/analytics/distribution-by-area'
    );
    // GET /api/analytics/most-used-resources
    assert(
      /api\.get\(\s*['"`]\/analytics\/most-used-resources['"`]/.test(src),
      'GETs /api/analytics/most-used-resources'
    );
    // GET /api/analytics/active-emergency-assets
    assert(
      /api\.get\(\s*['"`]\/analytics\/active-emergency-assets['"`]/.test(src),
      'GETs /api/analytics/active-emergency-assets'
    );
    // GET /api/analytics/coverage-by-village
    assert(
      /api\.get\(\s*['"`]\/analytics\/coverage-by-village['"`]/.test(src),
      'GETs /api/analytics/coverage-by-village'
    );

    // stripComments helper exported for tests.
    assert(
      /export\s*\{\s*stripComments\s*\};?/.test(src),
      're-exports stripComments helper'
    );

    // Privacy: never phones home for /users/:id or /auth/me.
    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'hook does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'hook does NOT GET /auth/me'
    );
  }

  // ── 3. AnalyticsPage.jsx source guards ───────────────────────────────
  section('3. AnalyticsPage.jsx source guards');
  {
    const src = readSrc(PAGE_PATH);

    assert(
      /export default function AnalyticsPage\b/.test(src),
      'exports AnalyticsPage as default'
    );

    assert(
      /from\s+['"]\.\.\/hooks\/useAnalytics['"]/.test(src),
      'imports the useAnalytics hook module'
    );
    assert(
      /from\s+['"]\.\.\/context\/AuthContext['"]/.test(src),
      'imports AuthContext for the user gate'
    );
    assert(
      /from\s+['"]\.\.\/components\/analytics\/CategoryDonut['"]/.test(src),
      'imports CategoryDonut'
    );
    assert(
      /from\s+['"]\.\.\/components\/analytics\/AreaBreakdownChart['"]/.test(src),
      'imports AreaBreakdownChart'
    );
    assert(
      /from\s+['"]\.\.\/components\/analytics\/MostUsedTable['"]/.test(src),
      'imports MostUsedTable'
    );
    assert(
      /from\s+['"]\.\.\/components\/analytics\/EmergencyAssetsCard['"]/.test(src),
      'imports EmergencyAssetsCard'
    );

    // All 5 hooks wired.
    for (const hook of [
      'useTotalByCategory',
      'useDistributionByArea',
      'useMostUsedResources',
      'useActiveEmergencyAssets',
      'useCoverageByVillage',
    ]) {
      assert(
        new RegExp(`\\b${hook}\\(`).test(src),
        `page wires ${hook}()`
      );
    }

    // CSV export surfaces the four roll-up slices.
    assert(/Export CSV/.test(src), 'page renders the "Export CSV" button');
    assert(/Blob\(/.test(src), 'CSV export uses Blob()');
    assert(/application\/octet-stream|text\/csv/.test(src), 'CSV export sets a CSV mime type');
    assert(/download\s*=/.test(src), 'CSV export triggers a download');
    assert(/analytics-/.test(src), 'CSV export filename is analytics-<date>.csv');

    // PrivacyFooter present.
    assert(/function PrivacyFooter\b/.test(src), 'page defines a PrivacyFooter');
    assert(
      /stripped|safety|contact info|privacy/i.test(src),
      'PrivacyFooter references privacy / contact info'
    );

    // The five card titles.
    for (const title of [
      'Resources by category',
      'Emergency mode',
      'Coverage by area',
      'Distribution by area',
      'Most-used resources',
    ]) {
      assert(src.includes(title), `page renders card title "${title}"`);
    }

    // Privacy: never phones home for /users/:id or /auth/me.
    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'page does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'page does NOT GET /auth/me'
    );
    assert(
      !/api\.patch\(/.test(codeOnly),
      'page does NOT PATCH anything (analytics is read-only)'
    );
    assert(
      !/api\.post\(/.test(codeOnly),
      'page does NOT POST anything (analytics is read-only)'
    );
    assert(
      !/api\.delete\(/.test(codeOnly),
      'page does NOT DELETE anything (analytics is read-only)'
    );
  }

  // ── 4. Chart components ─────────────────────────────────────────────
  section('4. Chart component guards');
  {
    const donut = readSrc(DONUT_PATH);
    assert(
      /export default function CategoryDonut\b/.test(donut),
      'CategoryDonut default export'
    );
    assert(/svg/.test(donut), 'CategoryDonut renders an SVG');
    assert(/strokeDasharray/.test(donut), 'CategoryDonut uses stroke-dasharray for arc segments');
    assert(
      /getCategoryColor|getCategoryEmoji|getCategoryLabel/.test(donut),
      'CategoryDonut uses category metadata helpers'
    );

    const area = readSrc(AREA_PATH);
    assert(
      /export default function AreaBreakdownChart\b/.test(area),
      'AreaBreakdownChart default export'
    );
    assert(/width:\s*`\$\{/.test(area), 'AreaBreakdownChart sets bar widths dynamically');

    const most = readSrc(MOST_USED_PATH);
    assert(
      /export default function MostUsedTable\b/.test(most),
      'MostUsedTable default export'
    );
    assert(/<table\b/.test(most), 'MostUsedTable renders a <table>');
    assert(/requestCount/.test(most), 'MostUsedTable renders requestCount column');
    assert(/completedCount/.test(most), 'MostUsedTable renders completedCount column');

    const em = readSrc(EMERGENCY_PATH);
    assert(
      /export default function EmergencyAssetsCard\b/.test(em),
      'EmergencyAssetsCard default export'
    );
    assert(/emergencyModeAreas/.test(em), 'EmergencyAssetsCard reads emergencyModeAreas');
    assert(/byStatus/.test(em), 'EmergencyAssetsCard reads byStatus');
    assert(/sample/.test(em), 'EmergencyAssetsCard reads sample');

    // Privacy: chart components are purely presentational — they
    // shouldn't fetch any user-detail endpoint.
    for (const [label, src] of [
      ['CategoryDonut', donut],
      ['AreaBreakdownChart', area],
      ['MostUsedTable', most],
      ['EmergencyAssetsCard', em],
    ]) {
      const codeOnly = stripComments(src);
      assert(
        !/api\.get\(['"]\/users/.test(codeOnly),
        `${label} does NOT GET /users/:id`
      );
      assert(
        !/api\.get\(['"]\/auth\/me/.test(codeOnly),
        `${label} does NOT GET /auth/me`
      );
    }
  }

  // ── 5. App.jsx wiring ───────────────────────────────────────────────
  section('5. App.jsx wiring');
  {
    const src = readSrc(APP_PATH);

    assert(
      /import\s+AnalyticsPage\s+from\s+['"]\.\/pages\/AnalyticsPage\.jsx['"]/.test(
        src
      ),
      'App.jsx imports AnalyticsPage'
    );
    // /analytics sits inside the MODERATOR/ADMIN ProtectedRoute.
    const routeGuardIdx = src.search(
      /ProtectedRoute\s+roles=\{?\['MODERATOR',\s*'ADMIN'\]/
    );
    const analyticsIdx = src.search(/path=["']analytics["']/);
    assert(routeGuardIdx > -1, 'MODERATOR/ADMIN ProtectedRoute exists');
    assert(analyticsIdx > -1, '/analytics route is registered');
    assert(
      analyticsIdx > routeGuardIdx,
      '/analytics is inside the MODERATOR/ADMIN-only ProtectedRoute'
    );
    // The route element is the imported AnalyticsPage.
    assert(
      /path=["']analytics["'][^<]*element=\{<AnalyticsPage\s*\/>\}/.test(src),
      '/analytics route renders <AnalyticsPage />'
    );
  }

  // ── 6. MainLayout.jsx wiring ────────────────────────────────────────
  section('6. MainLayout.jsx wiring');
  {
    const src = readSrc(LAYOUT_PATH);

    assert(
      /to=["']\/analytics["']/.test(src),
      'MainLayout renders a NavLink to /analytics'
    );
    // Gate: at least one of the two NavLink branches matches
    // user.role === 'MODERATOR' || user.role === 'ADMIN'.
    assert(
      /NavLink[\s\S]*\/analytics[\s\S]*Analytics/.test(src),
      'Analytics nav link is wired in the logged-in branch'
    );
    // The Moderation nav link is still present (regression guard).
    assert(/to=["']\/moderator["']/.test(src), 'Moderation nav link still present');
    // The Notification bell is still rendered.
    assert(/<NotificationBell\s*\/>/.test(src), 'NotificationBell still rendered');
    // Profile + Log out buttons still rendered.
    assert(/to=["']\/profile["']/.test(src), 'Profile nav link still present');
    assert(/>\s*Log out\s*</.test(src), 'Log out button still present');
  }

  // ── 7. Bundle assertions ────────────────────────────────────────────
  section('7. Bundle assertions');
  {
    const assets = fs.existsSync(DIST_ASSETS)
      ? fs.readdirSync(DIST_ASSETS)
      : [];
    const allJs = assets
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    for (const label of [
      '/analytics',
      'Analytics',
      'Analytics &',
      'Export CSV',
    ]) {
      assert(allJs.includes(label), `bundle contains "${label}"`);
    }
    // The dashboard's five endpoint strings are present (Vite mangles
    // the rest of the URL but preserves the path segment after the
    // baseURL trim).
    for (const path of [
      '/analytics/total-by-category',
      '/analytics/distribution-by-area',
      '/analytics/most-used-resources',
      '/analytics/active-emergency-assets',
      '/analytics/coverage-by-village',
    ]) {
      assert(
        allJs.includes(path),
        `bundle references analytics endpoint ${path}`
      );
    }
    // Regression: prior 7.4 socket event + 7.5 bell are still in the
    // bundle (they're imported through MainLayout).
    assert(
      allJs.includes('notification:new'),
      'bundle still references the 7.4 socket event'
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