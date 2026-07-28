/**
 * End-to-end smoke test for Module 5.5 — Moderator Dashboard
 * (Request Oversight) (client).
 *
 * Module 5.5 is the MODERATOR's surface for area-scoped request
 * oversight. The server side (area-scoped list + reject endpoint)
 * shipped in 5.2 and the populated list helpers were enhanced in
 * 5.4 for the OWNER side — the MODERATOR side reuses the exact
 * same contract (the server populates `volunteerSummary.name` +
 * `resource.{category,title,status}` for any caller, including
 * MODERATOR). Module 5.5 itself is the client-side dashboard:
 * a list + status filter + one CTA (reject, with optional
 * `moderatorNote`).
 *
 * This smoke focuses on the client wiring:
 *
 *   1. Vite production build succeeds with the new
 *      ModeratorDashboardPage, useModeratorRequests hook, and the
 *      updated App.jsx + MainLayout.
 *   2. App.jsx imports ModeratorDashboardPage AND /moderator sits
 *      inside the MODERATOR-only ProtectedRoute.
 *   3. MainLayout renders a NavLink to /moderator inside the
 *      MODERATOR/ADMIN branch of the logged-in nav.
 *   4. useModeratorRequests.js exports the three hooks
 *      (useModeratorRequests, useRejectModeratorRequest,
 *      useModeratorRequestCount); uses TanStack Query; PATCH +
 *      GET endpoints correct.
 *   5. ModeratorDashboardPage source defines the sub-components
 *      (Header, AreaScopeHint, FilterBar, RequestRow, ActionRow,
 *      ModeratorNoteDialog, StatusBadge, LoadingState, ErrorBanner,
 *      EmptyState, PrivacyFooter); calls the three hooks; renders
 *      the Reject CTA gated on status; privacy boundary: the page
 *      source does NOT pre-fetch /users/:id or /auth/me, and does
 *      NOT make any GET /api/requests/:id call (the moderator's
 *      contact-gated surface is intentionally absent).
 *   6. Owner dashboard wiring from 5.4 remains intact (regression
 *      guard — the moderator nav addition must not break the
 *      existing owner nav).
 *
 * Run: `node smoke-tests/5.5-moderator-dashboard.test.cjs` from `client/`.
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
  'src/pages/moderator/ModeratorDashboardPage.jsx'
);
const HOOK_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useModeratorRequests.js'
);
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');
const OWNER_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerRequestsPage.jsx'
);
const OWNER_DASH_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerDashboardPage.jsx'
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

    // Page copy — Module 5.5 surface text that the bundle must carry.
    for (const label of [
      'Request oversight',
      'Area scope',
      'Rejecting',
      'Reject request',
      'summaries only',
      'This request is closed',
      'Browse resources',
      'Pending',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. App.jsx router wiring ────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+ModeratorDashboardPage\s+from\s+['"]\.\/pages\/moderator\/ModeratorDashboardPage\.jsx['"]/.test(
        appSrc
      ),
      'App.jsx imports ModeratorDashboardPage'
    );
    assert(
      /path\s*=\s*['"]moderator['"]/.test(appSrc),
      'App.jsx registers the /moderator route'
    );

    // Must sit inside the MODERATOR-only ProtectedRoute (i.e. the
    // one with `roles={['MODERATOR','ADMIN']}`).
    const modGuard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute[^>]*roles=\{?\[\s*['"]MODERATOR['"]\s*,\s*['"]ADMIN['"]\s*[^>]*\}?\s*\/>\}([\s\S]*?)<\/Route>/
    );
    assert(modGuard, 'MODERATOR/ADMIN-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]moderator['"]/.test(modGuard[1]),
      '/moderator sits under the MODERATOR/ADMIN-only ProtectedRoute'
    );

    // The placeholder is GONE.
    assert(
      !/placeholder\s*=\s*['"]Moderator Dashboard\s*\(5\.5\)['"]/.test(appSrc),
      'placeholder "Moderator Dashboard (5.5)" is removed'
    );
  }

  // ── 3. MainLayout nav wiring ────────────────────────────────────────
  section('3. MainLayout nav wiring');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/moderator['"]/.test(layoutSrc),
      'MainLayout renders a NavLink to /moderator'
    );
    // The link must be visible only to MODERATOR/ADMIN.
    assert(
      /user\.role\s*===\s*['"]MODERATOR['"][\s\S]{0,40}user\.role\s*===\s*['"]ADMIN['"]/.test(
        layoutSrc
      ) ||
        /user\.role\s*===\s*['"]ADMIN['"][\s\S]{0,40}user\.role\s*===\s*['"]MODERATOR['"]/.test(
          layoutSrc
        ),
      'Moderator nav link is gated on user.role === MODERATOR || ADMIN'
    );
    assert(
      /Moderation/.test(layoutSrc),
      'Moderation nav label is rendered'
    );

    // Regression: OWNER's "Incoming" nav is still there (5.4 work).
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/owner\/requests['"]/.test(layoutSrc),
      'Owner Incoming nav link is still present (5.4 regression)'
    );
    // Regression: VOLUNTEER's "My Requests" nav is still there (5.3 work).
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/volunteer\/requests['"]/.test(layoutSrc),
      'Volunteer My Requests nav link is still present (5.3 regression)'
    );
  }

  // ── 4. useModeratorRequests.js source guards ───────────────────────
  section('4. useModeratorRequests.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');

    // Three named exports.
    for (const name of [
      'useModeratorRequests',
      'useRejectModeratorRequest',
      'useModeratorRequestCount',
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
      'list + counter use useQuery');
    assert(/useMutation\s*\(/.test(src),
      'reject mutation uses useMutation');
    assert(/useQueryClient\s*\(/.test(src),
      'mutation uses useQueryClient');

    // List endpoint shape — /api/requests, area-scoped server-side.
    assert(
      /api\.get\(['"]\/requests['"]/.test(src),
      'useModeratorRequests GETs /api/requests'
    );
    assert(
      /queryKey:\s*\[\s*['"]moderator-requests['"]/.test(src),
      'queryKey is ["moderator-requests", ...]'
    );

    // Reject endpoint — PATCH /api/requests/:id/reject. Match either
    // the backtick template literal or the plain-string form.
    assert(
      /api\.patch\([\`'"]\/requests\/\$\{[^}]+\}\/reject[\`'"]/.test(src),
      'useRejectModeratorRequest PATCHes /api/requests/:id/reject'
    );

    // The mutation invalidates the list cache.
    assert(
      /qc\.invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]moderator-requests['"]/.test(
        src
      ),
      'useRejectModeratorRequest invalidates the moderator-requests cache'
    );

    // Privacy — strip comments so the doc block doesn't trip the
    // assertion, then assert the hook NEVER reaches for /users/:id
    // or /auth/me.
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

    // No single-request GET — the moderator hook only hits list.
    assert(
      !/api\.get\(\s*[\`'"]\/requests\/\$\{/.test(codeOnly),
      'hook does NOT GET /api/requests/:id (moderator has no per-row contact surface)'
    );
  }

  // ── 5. ModeratorDashboardPage.jsx source guards ───────────────────
  section('5. ModeratorDashboardPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present.
    for (const name of [
      'Header',
      'AreaScopeHint',
      'FilterBar',
      'RequestRow',
      'ActionRow',
      'ModeratorNoteDialog',
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
    assert(/useModeratorRequests\s*\(/.test(src),
      'page calls useModeratorRequests');
    assert(/useRejectModeratorRequest\s*\(/.test(src),
      'page calls useRejectModeratorRequest');
    assert(/useModeratorRequestCount\s*\(/.test(src),
      'page calls useModeratorRequestCount');
    assert(/useAuth\s*\(/.test(src),
      'page reads useAuth (for `enabled: Boolean(user)`)');

    // Imports — verify the relative paths.
    assert(
      /from\s+['"]\.\.\/\.\.\/context\/AuthContext['"]/.test(src),
      'page imports AuthContext via ../../context/AuthContext'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useModeratorRequests['"]/.test(src),
      'page imports useModeratorRequests via ../../hooks/useModeratorRequests'
    );

    // Reject CTA — the source uses a ternary (`{pending ? 'Rejecting…' : 'Reject with note'}`)
    // so assert the string literal.
    assert(/'Reject with note'/.test(src),
      "page renders the 'Reject with note' CTA");
    assert(/'Rejecting…'/.test(src),
      "page renders the pending 'Rejecting…' label");

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

    // Reject CTA gating — must require REQUESTED || APPROVED.
    assert(
      /canReject\s*=\s*r\.status\s*===\s*['"]REQUESTED['"]\s*\|\|\s*r\.status\s*===\s*['"]APPROVED['"]/.test(
        src
      ) ||
        /['"]REQUESTED['"][\s\S]{0,60}['"]APPROVED['"]/.test(src),
      'Reject CTA gated on status === REQUESTED || APPROVED'
    );

    // Privacy — strip comments first so the doc block doesn't trip
    // the assertion.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The page MUST NOT pre-fetch /users/:id or /auth/me (mod is
    // summary-only by design).
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

    // The page MUST NOT make a single-request GET /api/requests/:id
    // call — the moderator's contact-gated surface is intentionally
    // absent. (The hook only fires GET /requests list + PATCH
    // /:id/reject; neither is a /:id GET.)
    assert(
      !/\.get\([\`'"]\/requests\/\$\{[^}]+\}[\`'"]\)/.test(codeOnly),
      'page does NOT GET /api/requests/:id (moderator has no per-row contact reveal)'
    );
    // Same idea for dynamically-imported api via dynamic import
    // (the 5.4 pattern was `import(...).then(({default: api}) => api.get(...))`).
    assert(
      !/api\.get\(\s*[\`'"]\/requests\/\$\{/.test(codeOnly),
      'page does NOT lazily GET /api/requests/:id either'
    );

    // No contact-reveal actions.
    assert(
      !/mailto:/.test(codeOnly),
      'page does NOT render mailto: (moderator has no contact links)'
    );
    assert(
      !/tel:/.test(codeOnly),
      'page does NOT render tel: (moderator has no contact links)'
    );

    // No volunteer/owner email/phone accesses.
    const volEmailHits = (codeOnly.match(/volunteer\.email/g) || []).length;
    const volPhoneHits = (codeOnly.match(/volunteer\.phone/g) || []).length;
    const ownerEmailHits = (codeOnly.match(/owner\.email/g) || []).length;
    const ownerPhoneHits = (codeOnly.match(/owner\.phone/g) || []).length;
    assert(volEmailHits === 0,
      'page never accesses volunteer.email');
    assert(volPhoneHits === 0,
      'page never accesses volunteer.phone');
    assert(ownerEmailHits === 0,
      'page never accesses owner.email');
    assert(ownerPhoneHits === 0,
      'page never accesses owner.phone');

    // PrivacyFooter explains the moderator's summary-only stance.
    assert(/summaries only/i.test(src) || /summary-only/i.test(src),
      'PrivacyFooter explains the moderator summary-only privacy boundary');

    // ModeratorNoteDialog — captures an optional moderatorNote.
    assert(/moderatorNote/.test(src),
      'ModeratorNoteDialog captures moderatorNote');
  }

  // ── 6. Owner 5.4 work remains intact (regression guard) ────────────
  section('6. Owner 5.4 work remains intact (regression guard)');
  {
    const ownerSrc = fs.readFileSync(OWNER_PAGE_PATH, 'utf8');
    assert(
      ownerSrc.includes('function VolunteerContactCard'),
      "OwnerRequestsPage still defines VolunteerContactCard (5.4)"
    );
    assert(
      /api\.get\(\s*[`'"]\/requests\/\$\{requestId\}/.test(ownerSrc) ||
        /\.get\([`'"]\/requests\/\$\{requestId\}[`'"]\)/.test(ownerSrc),
      'OwnerRequestsPage still lazily GETs /api/requests/:id via VolunteerContactCard'
    );

    const dashSrc = fs.readFileSync(OWNER_DASH_PATH, 'utf8');
    assert(
      /useActiveRequestCount\s*\(/.test(dashSrc),
      'OwnerDashboardPage still uses useActiveRequestCount (5.4)'
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