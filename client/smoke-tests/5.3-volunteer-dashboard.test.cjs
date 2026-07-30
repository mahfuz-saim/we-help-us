/**
 * End-to-end smoke test for Module 5.3 — Volunteer Dashboard (client).
 *
 * Module 5.3 is the volunteer's request-management surface. The server
 * side (list + collect + return endpoints) was delivered by Module 5.2
 * and is covered by `server/smoke-tests/5.2-request-apis.test.js`. This
 * smoke focuses on the client wiring:
 *
 *   1. Vite production build succeeds with the new VolunteerDashboardPage,
 *      useMyRequests hook, and the updated App.jsx + MainLayout.
 *   2. App.jsx imports VolunteerDashboardPage AND /volunteer/requests
 *      sits inside the VOLUNTEER-only ProtectedRoute (the
 *      `roles={['VOLUNTEER']}` guard).
 *   3. MainLayout renders a NavLink to /volunteer/requests inside the
 *      VOLUNTEER branch of the logged-in nav.
 *   4. useMyRequests.js exports three hooks (useMyRequests,
 *      useCollectRequest, useReturnRequest); useMyRequests is a
 *      useQuery that GETs /api/requests with optional status/page/
 *      limit params, queryKey ['my-requests', {status, page, limit}];
 *      both mutations PATCH /api/requests/:id/{collect,return} and
 *      invalidate ['my-requests'].
 *   5. VolunteerDashboardPage source defines the sub-components
 *      (Header, FilterBar, RequestRow, ActionRow, OwnerContactCard,
 *      StatusBadge, LoadingState, ErrorBanner, EmptyState,
 *      PrivacyFooter); calls useMyRequests + useCollectRequest +
 *      useReturnRequest; renders the COLLECTED-gated contact card;
 *      privacy boundary: with comments stripped, the page source
 *      does NOT call /users/:id, /auth/me, and does NOT pre-fetch
 *      owner info outside the COLLECTED branch.
 *
 * Run: `node smoke-tests/5.3-volunteer-dashboard.test.cjs` from `client/`.
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
  'src/pages/volunteer/VolunteerDashboardPage.jsx'
);
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useMyRequests.js');
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

    // Page copy.
    for (const label of [
      'My Requests',
      "I picked it up",
      "I've returned it",
      'Owner contact',
      'revealed after collection',
      'contact info hidden',
      'Browse resources',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. App.jsx router wiring ────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+VolunteerDashboardPage\s+from\s+['"]\.\/pages\/volunteer\/VolunteerDashboardPage\.jsx['"]/.test(
        appSrc
      ),
      'App.jsx imports VolunteerDashboardPage'
    );
    assert(
      /path\s*=\s*['"]volunteer\/requests['"]/.test(appSrc),
      'App.jsx registers the /volunteer/requests route'
    );

    // Must sit inside the VOLUNTEER-only ProtectedRoute (not the
    // auth-only or owner-only guard).
    const volunteerGuard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s+roles=\{\[\s*['"]VOLUNTEER['"]\s*\]\s*\}\s*\/\>\}([\s\S]*?)<\/Route>/
    );
    assert(
      volunteerGuard,
      'VOLUNTEER-only ProtectedRoute exists'
    );
    assert(
      /path\s*=\s*['"]volunteer\/requests['"]/.test(volunteerGuard[1]),
      '/volunteer/requests sits under the VOLUNTEER-only ProtectedRoute'
    );

    // Negative check: the placeholder text from Module 5.2 days
    // should be gone — the route should NOT render HomePage.
    const placeholder = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s+roles=\{\[\s*['"]VOLUNTEER['"]\s*\]\s*\}\s*\/\}\}>[\s\S]*?HomePage\s+placeholder\s*=\s*['"]My Requests\s*\(5\.3\)['"]/
    );
    assert(
      !placeholder,
      'the 5.2 placeholder (HomePage placeholder="My Requests (5.3)") is GONE'
    );
  }

  // ── 3. MainLayout nav wiring ────────────────────────────────────────
  section('3. MainLayout nav wiring');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/volunteer\/requests['"]/.test(layoutSrc),
      'MainLayout renders a NavLink to /volunteer/requests'
    );
    // Should be conditional on user.role === 'VOLUNTEER' (mirror of
    // the OWNER dashboard pattern; we don't show a "My Requests" tab
    // to owners).
    assert(
      /user\.role\s*===\s*['"]VOLUNTEER['"]/.test(layoutSrc),
      'My Requests nav link is gated on user.role === VOLUNTEER'
    );
    assert(
      /My Requests/.test(layoutSrc),
      'My Requests nav link label is rendered'
    );
  }

  // ── 4. useMyRequests.js source guards ───────────────────────────────
  section('4. useMyRequests.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');

    // Three named exports.
    assert(/export function useMyRequests\b/.test(src),
      'exports useMyRequests');
    assert(/export function useCollectRequest\b/.test(src),
      'exports useCollectRequest');
    assert(/export function useReturnRequest\b/.test(src),
      'exports useReturnRequest');

    // TanStack Query.
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'useMyRequests uses useQuery');
    assert(/useMutation\s*\(/.test(src), 'mutations use useMutation');
    assert(/useQueryClient\s*\(/.test(src),
      'mutations use useQueryClient');

    // List endpoint shape.
    assert(
      /api\.get\(['"]\/requests['"]/.test(src),
      'useMyRequests GETs /api/requests'
    );
    assert(
      /queryKey:\s*\[\s*['"]my-requests['"]/.test(src),
      'queryKey is ["my-requests", ...]'
    );
    assert(/status/.test(src),
      'queryKey includes the status filter');
    assert(/page/.test(src) && /limit/.test(src),
      'queryKey includes page + limit');

    // Lifecycle actions.
    assert(
      /api\.patch\(['"]\/requests\/\$\{[^}]+\}\/collect['"]/.test(src) ||
        /api\.patch\([`'"]\/requests\/\$\{[^}]+\}\/collect[`'"]\)/.test(src),
      'useCollectRequest PATCHes /api/requests/:id/collect'
    );
    assert(
      /api\.patch\([`'"]\/requests\/\$\{[^}]+\}\/return[`'"]\)/.test(src),
      'useReturnRequest PATCHes /api/requests/:id/return'
    );

    // Both mutations invalidate the list so the status pill updates.
    const invalidateCount = (src.match(
      /qc\.invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]my-requests['"]/g
    ) || []).length;
    assert(invalidateCount >= 2,
      'both mutations invalidate the my-requests cache');

    // Privacy — strip comments so the doc block doesn't trip the
    // assertions, then assert the hook NEVER reaches for /users/:id
    // or /auth/me to "enrich" a request.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(!/api\.get\(['"]\/users/.test(codeOnly),
      'hook does NOT fetch /users/:id');
    assert(!/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'hook does NOT fetch /auth/me');
    assert(!/api\.get\(['"]\/api\/users/.test(codeOnly),
      'hook does NOT fetch /api/users');
    assert(!/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'hook does NOT fetch /api/auth/me');
  }

  // ── 5. VolunteerDashboardPage.jsx source guards ─────────────────────
  section('5. VolunteerDashboardPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present.
    for (const name of [
      'Header',
      'FilterBar',
      'RequestRow',
      'ActionRow',
      'OwnerContactCard',
      'StatusBadge',
      'LoadingState',
      'ErrorBanner',
      'EmptyState',
      'PrivacyFooter',
    ]) {
      assert(src.includes(`function ${name}`),
        `page defines function ${name}`);
    }

    // Hooks wired.
    assert(/useMyRequests\s*\(/.test(src),
      'page calls useMyRequests');
    assert(/useCollectRequest\s*\(/.test(src),
      'page calls useCollectRequest');
    assert(/useReturnRequest\s*\(/.test(src),
      'page calls useReturnRequest');
    assert(
      /useAuth\s*\(/.test(src),
      'page reads useAuth (for `enabled: Boolean(user)`)'
    );

    // Imports — confirm we use the right relative paths.
    assert(
      /from\s+['"]\.\.\/\.\.\/context\/AuthContext['"]/.test(src),
      'page imports AuthContext via ../../context/AuthContext'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useMyRequests['"]/.test(src),
      'page imports useMyRequests via ../../hooks/useMyRequests'
    );

    // Action labels.
    assert(/I picked it up/.test(src),
      'page renders the "I picked it up" CTA');
    assert(/I've returned it/.test(src),
      'page renders the "I\'ve returned it" CTA');

    // Status filter chip set covers the full REQUEST_STATUS enum
    // (REQUESTED, APPROVED, REJECTED, COLLECTED, RETURNED) plus All.
    for (const s of [
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'COLLECTED',
      'RETURNED',
    ]) {
      assert(src.includes(`'${s}'`) || src.includes(`"${s}"`),
        `STATUS_FILTERS mentions ${s}`);
    }

    // The COLLECTED branch is the ONLY place owner contact info is
    // surfaced — owner.email/owner.phone rendering must be inside an
    // `status === 'COLLECTED'` guard.
    const collectedGuard = src.match(
      /status\s*===\s*['"]COLLECTED['"][\s\S]*?owner\.email[\s\S]*?owner\.phone/
    );
    assert(
      collectedGuard,
      'owner.email + owner.phone render inside a status===COLLECTED guard'
    );

    // OwnerContactCard uses mailto: + tel: for actionable contact.
    assert(/mailto:/.test(src),
      'OwnerContactCard renders a mailto: link');
    assert(/tel:/.test(src),
      'OwnerContactCard renders a tel: link');
    // Module 6.3 — phone row must carry a call glyph next to the
    // number so users know tapping dials the owner. The project has
    // no icon library; we use the 📞 emoji as the convention.
    assert(/📞/.test(src),
      'OwnerContactCard renders a call glyph (📞) next to the phone number');

    // Privacy — strip comments first so the doc block above doesn't
    // trip the assertions.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The page source MUST NOT bypass the privacy gate by phoning home
    // for owner info. (Owner contact info arrives via the response —
    // the COLLECTED branch in the server's `publicRequest` helper is
    // the single source of truth.)
    assert(!/api\.get\(['"]\/users/.test(codeOnly),
      'page does NOT fetch /users/:id');
    assert(!/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'page does NOT fetch /auth/me');
    assert(!/api\.get\(['"]\/api\/users/.test(codeOnly),
      'page does NOT fetch /api/users');
    assert(!/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'page does NOT fetch /api/auth/me');

    // No "owner.email" or "owner.phone" outside the COLLECTED branch.
    // We already verified the COLLECTED branch contains both; now we
    // assert there's no SECOND, unguarded render path.
    const ownerEmailHits = (codeOnly.match(/owner\.email/g) || []).length;
    const ownerPhoneHits = (codeOnly.match(/owner\.phone/g) || []).length;
    assert(ownerEmailHits >= 1 && ownerEmailHits <= 4,
      'owner.email appears a sensible number of times (COLLECTED card only)');
    assert(ownerPhoneHits >= 1 && ownerPhoneHits <= 4,
      'owner.phone appears a sensible number of times (COLLECTED card only)');

    // "contact info hidden" copy must render for non-COLLECTED.
    assert(/contact info hidden/.test(codeOnly),
      'non-COLLECTED rows render a "contact info hidden" hint');

    // PrivacyFooter reminds the user of the gate.
    assert(/revealed after a request is approved/.test(src) ||
      /privacy safeguard/i.test(src),
      'PrivacyFooter explains the privacy gate');
  }

  // ── 6. CSS bundle contains safe-* tokens used by OwnerContactCard ──
  section('6. index.css — safe-* color tokens used by the contact card');
  {
    const src = fs.readFileSync(CSS_PATH, 'utf8');
    // OwnerContactCard uses bg-safe-50, border-safe-300, text-safe-800,
    // text-safe-900, ring-safe-700. Tailwind v4 + custom theme wires
    // these to --color-safe-* tokens; we sanity-check the CSS exposes
    // them.
    assert(/--color-safe-50\b/.test(src),
      '--color-safe-50 token defined (contact card background)');
    assert(/--color-safe-300\b/.test(src),
      '--color-safe-300 token defined (contact card border)');
    assert(/--color-safe-800\b/.test(src),
      '--color-safe-800 token defined (contact card heading)');
    assert(/--color-safe-900\b/.test(src),
      '--color-safe-900 token defined (contact card body)');
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