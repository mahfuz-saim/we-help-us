/**
 * End-to-end smoke test for Module 5.4 — Owner Request Notifications &
 * Actions (client).
 *
 * Module 5.4 is the OWNER's surface for incoming resource requests.
 * The server side (list populate + approve/reject/complete endpoints)
 * shipped in 5.2 with a 5.4 enhancement to populate volunteer + resource
 * summaries on the OWNER list response. Module 5.4 itself is the
 * client-side inbox: a list + status filter + three CTAs (approve,
 * reject, confirm-return) + a COLLECTED-gated volunteer-contact card.
 *
 * This smoke focuses on the client wiring:
 *
 *   1. Vite production build succeeds with the new OwnerRequestsPage,
 *      useOwnerRequests hook, the active-requests counter on
 *      OwnerDashboardPage, and the updated App.jsx + MainLayout.
 *   2. App.jsx imports OwnerRequestsPage AND /owner/requests sits
 *      inside the OWNER-only ProtectedRoute.
 *   3. MainLayout renders a NavLink to /owner/requests inside the
 *      OWNER branch of the logged-in nav.
 *   4. useOwnerRequests.js exports the four hooks (useOwnerRequests,
 *      useApproveRequest, useRejectRequest, useCompleteRequest) +
 *      the active-count hook; uses TanStack Query; PATCH + GET
 *      endpoints correct.
 *   5. OwnerRequestsPage source defines the sub-components
 *      (Header, FilterBar, RequestRow, ActionRow,
 *      VolunteerContactCard, StatusBadge, LoadingState, ErrorBanner,
 *      EmptyState, PrivacyFooter); calls the four hooks; renders
 *      approve/reject/confirm-return CTAs gated on status; lazy-
 *      fetches GET /:id for COLLECTED rows; privacy boundary: the
 *      page source does NOT pre-fetch /users/:id or /auth/me, and
 *      the COLLECTED branch is the only place contact info is
 *      fetched.
 *   6. OwnerDashboardPage source wires the active-requests counter
 *      to the header (Module 5.4 enhancement).
 *
 * Run: `node smoke-tests/5.4-owner-requests.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerRequestsPage.jsx'
);
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useOwnerRequests.js');
const DASHBOARD_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerDashboardPage.jsx'
);
const CSS_PATH = path.join(CLIENT_ROOT, 'src/index.css');
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

    // Page copy — Module 5.4 surface text that the bundle must carry.
    for (const label of [
      'Incoming requests',
      'Volunteer contact',
      'revealed after collection',
      'Approve',
      'Reject',
      'Confirm return',
      'Open my resources',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. App.jsx router wiring ────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+OwnerRequestsPage\s+from\s+['"]\.\/pages\/owner\/OwnerRequestsPage\.jsx['"]/.test(
        appSrc
      ),
      'App.jsx imports OwnerRequestsPage'
    );
    assert(
      /path\s*=\s*['"]owner\/requests['"]/.test(appSrc),
      'App.jsx registers the /owner/requests route'
    );

    // Must sit inside the OWNER-only ProtectedRoute (not the
    // auth-only or volunteer-only guard).
    const ownerGuard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute[^>]*roles=\{?\[\s*['"]OWNER['"]\s*[^>]*\}?\s*\/>\}([\s\S]*?)<\/Route>/
    );
    assert(ownerGuard, 'OWNER-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]owner\/requests['"]/.test(ownerGuard[1]),
      '/owner/requests sits under the OWNER-only ProtectedRoute'
    );
  }

  // ── 3. MainLayout nav wiring ────────────────────────────────────────
  section('3. MainLayout nav wiring');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/owner\/requests['"]/.test(layoutSrc),
      'MainLayout renders a NavLink to /owner/requests'
    );
    // The link must be visible only to owners.
    assert(
      /user\.role\s*===\s*['"]OWNER['"]/.test(layoutSrc),
      'Incoming nav link is gated on user.role === OWNER'
    );
    assert(
      /Incoming/.test(layoutSrc),
      'Incoming nav label is rendered'
    );
  }

  // ── 4. useOwnerRequests.js source guards ───────────────────────────
  section('4. useOwnerRequests.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');

    // Five named exports.
    for (const name of [
      'useOwnerRequests',
      'useApproveRequest',
      'useRejectRequest',
      'useCompleteRequest',
      'useActiveRequestCount',
    ]) {
      assert(
        new RegExp(`export function ${name}\\b`).test(src),
        `exports ${name}`
      );
    }

    // TanStack Query.
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src),
      'useOwnerRequests / useActiveRequestCount use useQuery');
    assert(/useMutation\s*\(/.test(src),
      'mutations use useMutation');
    assert(/useQueryClient\s*\(/.test(src),
      'mutations use useQueryClient');

    // List endpoint shape — /api/requests, role-scoped server-side.
    assert(
      /api\.get\(['"]\/requests['"]/.test(src),
      'useOwnerRequests GETs /api/requests'
    );
    assert(
      /queryKey:\s*\[\s*['"]owner-requests['"]/.test(src),
      'queryKey is ["owner-requests", ...]'
    );

    // Lifecycle actions — three PATCH endpoints. Match either the
    // backtick-template-literal form (`/requests/${id}/<verb>`) or
    // the plain-string form.
    for (const verb of ['approve', 'reject', 'complete']) {
      const re = new RegExp(
        `api\\.patch\\([\`'"]\\/requests\\/\\$\\{[^}]+\\}\\/${verb}[\`'"]`
      );
      assert(re.test(src), `use${verb[0].toUpperCase() + verb.slice(1)}Request PATCHes /api/requests/:id/${verb}`);
    }

    // All three mutations invalidate the list cache.
    const invalidateCount = (
      src.match(
        /qc\.invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]owner-requests['"]/g
      ) || []
    ).length;
    assert(
      invalidateCount >= 3,
      'all three mutations invalidate the owner-requests cache'
    );

    // Privacy — strip comments so the doc block doesn't trip the
    // assertions, then assert the hook NEVER reaches for /users/:id
    // or /auth/me to enrich a request.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'hook does NOT fetch /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'hook does NOT fetch /auth/me'
    );
    assert(
      !/api\.get\(['"]\/api\/users/.test(codeOnly),
      'hook does NOT fetch /api/users'
    );
    assert(
      !/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'hook does NOT fetch /api/auth/me'
    );
  }

  // ── 5. OwnerRequestsPage.jsx source guards ─────────────────────────
  section('5. OwnerRequestsPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present.
    for (const name of [
      'Header',
      'FilterBar',
      'RequestRow',
      'ActionRow',
      'VolunteerContactCard',
      'StatusBadge',
      'LoadingState',
      'ErrorBanner',
      'EmptyState',
      'PrivacyFooter',
    ]) {
      assert(
        src.includes(`function ${name}`),
        `page defines function ${name}`
      );
    }

    // Hooks wired.
    assert(/useOwnerRequests\s*\(/.test(src), 'page calls useOwnerRequests');
    assert(/useApproveRequest\s*\(/.test(src), 'page calls useApproveRequest');
    assert(/useRejectRequest\s*\(/.test(src), 'page calls useRejectRequest');
    assert(/useCompleteRequest\s*\(/.test(src), 'page calls useCompleteRequest');
    assert(/useAuth\s*\(/.test(src), 'page reads useAuth (for `enabled: Boolean(user)`)');

    // Imports — verify the relative paths.
    assert(
      /from\s+['"]\.\.\/\.\.\/context\/AuthContext['"]/.test(src),
      'page imports AuthContext via ../../context/AuthContext'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useOwnerRequests['"]/.test(src),
      'page imports useOwnerRequests via ../../hooks/useOwnerRequests'
    );

    // Action labels — the source uses conditional expressions
    // (`{pending ? 'Approving…' : 'Approve'}`) so look for the
    // string literals rather than the rendered JSX text.
    assert(/'Approve'/.test(src), 'page renders the "Approve" CTA');
    assert(/'Reject'/.test(src), 'page renders the "Reject" CTA');
    assert(/'Confirm return'/.test(src), 'page renders the "Confirm return" CTA');

    // Status filter chip set covers all six REQUEST_STATUS values.
    for (const s of [
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'COLLECTED',
      'RETURNED',
      'CANCELLED',
    ]) {
      assert(
        src.includes(`'${s}'`) || src.includes(`"${s}"`),
        `STATUS_FILTERS mentions ${s}`
      );
    }

    // The COLLECTED branch is the ONLY place volunteer contact info
    // is fetched — VolunteerContactCard lazily GETs /api/requests/:id
    // and surfaces email/phone only when the response carries them.
    // Assert the three components are wired:
    //   1. RequestRow gates VolunteerContactCard on status === 'COLLECTED'
    //   2. VolunteerContactCard itself exists as a function
    //   3. The component calls api.get on /requests/<requestId>
    assert(
      /status\s*===\s*['"]COLLECTED['"][\s\S]{0,80}<VolunteerContactCard/.test(src),
      "RequestRow gates VolunteerContactCard on status === 'COLLECTED'"
    );
    assert(
      /\.get\([`'"]\/requests\/\$\{requestId\}[`'"]\)/.test(src),
      'VolunteerContactCard fetches /api/requests/:id (using requestId)'
    );

    // VolunteerContactCard uses mailto: + tel: for actionable contact.
    assert(/mailto:/.test(src), 'VolunteerContactCard renders a mailto: link');
    assert(/tel:/.test(src), 'VolunteerContactCard renders a tel: link');

    // Privacy — strip comments first so the doc block doesn't trip
    // the assertion.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The page source MUST NOT bypass the privacy gate by phoning
    // home for volunteer info outside the COLLECTED branch. There
    // is exactly ONE GET /api/requests/<id> call — inside the
    // COLLECTED-gated VolunteerContactCard. (The call uses
    // a dynamically-imported api instance: `import(...).then(({default: api}) => api.get(...))`.)
    const singleCall = (
      codeOnly.match(/\.get\([`'"]\/requests\/\$\{[^}]+\}[`'"]\)/g) || []
    );
    assert(
      singleCall.length === 1,
      'page makes exactly 1 lazy GET /api/requests/:id call (the COLLECTED card)'
    );

    // No /users/:id, /auth/me fallback paths.
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'page does NOT fetch /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'page does NOT fetch /auth/me'
    );
    assert(
      !/api\.get\(['"]\/api\/users/.test(codeOnly),
      'page does NOT fetch /api/users'
    );
    assert(
      !/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'page does NOT fetch /api/auth/me'
    );

    // No "owner.email" / "owner.phone" outside the privacy gate.
    const ownerEmailHits = (codeOnly.match(/owner\.email/g) || []).length;
    const ownerPhoneHits = (codeOnly.match(/owner\.phone/g) || []).length;
    assert(
      ownerEmailHits === 0,
      'page never accesses owner.email (OWNER side already has own info)'
    );
    assert(
      ownerPhoneHits === 0,
      'page never accesses owner.phone'
    );

    // PrivacyFooter explains the privacy boundary.
    assert(/revealed after collection/i.test(src) || /privacy safeguard/i.test(src),
      'PrivacyFooter explains the OWNER-side privacy gate');
  }

  // ── 6. OwnerDashboardPage active-counter wiring ─────────────────────
  section('6. OwnerDashboardPage.jsx — Module 5.4 active-counter');
  {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf8');

    // Active-requests counter — must be wired.
    assert(
      /useActiveRequestCount\s*\(/.test(src),
      'OwnerDashboardPage calls useActiveRequestCount'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useOwnerRequests['"]/.test(src),
      'OwnerDashboardPage imports useActiveRequestCount from ../../hooks/useOwnerRequests'
    );

    // Header receives the counter values.
    const headerCall = src.match(
      /Header[\s\S]*?activeCount\s*=/
    );
    assert(
      headerCall,
      'Header receives activeCount prop'
    );
    assert(
      /activeCount\s*=\s*\{[^}]*\.total/.test(src),
      'activeCount is bound to query.data.total'
    );

    // Dashboard links to the inbox.
    assert(
      /to\s*=\s*['"]\/owner\/requests['"]/.test(src),
      'OwnerDashboardPage has a Link to /owner/requests'
    );
    assert(
      /Incoming requests/.test(src),
      'OwnerDashboardPage renders the "Incoming requests" label'
    );
  }

  // ── 7. CSS bundle contains safe-* tokens used by Approve CTA ───────
  section('7. index.css — safe-* color tokens used by the action buttons');
  {
    const src = fs.readFileSync(CSS_PATH, 'utf8');
    // The Approve + Confirm return CTAs use bg-safe-700; hover uses
    // bg-safe-800. Verify the underlying tokens exist.
    assert(/--color-safe-700\b/.test(src),
      '--color-safe-700 token defined (Approve / Confirm CTA background)');
    assert(/--color-safe-800\b/.test(src),
      '--color-safe-800 token defined (hover state)');
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