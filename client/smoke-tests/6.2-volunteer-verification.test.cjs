/**
 * End-to-end smoke test for Module 6.2 — Volunteer Verification
 * (client).
 *
 * Module 6.2 ships the moderator-side verification action and the
 * "Verified" badge on volunteer profiles. The server side
 * (POST /api/moderator/verify-volunteer/:userId) lives in the
 * moderator controller; the client side wires the mutation hook and
 * renders the badge in three places:
 *   - OwnerRequestsPage (next to the volunteer name in a request row)
 *   - ModeratorDashboardPage (same surface, moderator side)
 *   - ProfilePage (next to the user's own name + a dedicated Meta row)
 *
 * Coverage:
 *   1. Vite production build succeeds with the new useVerifyVolunteer
 *      hook, the updated ProfilePage / OwnerRequestsPage /
 *      ModeratorDashboardPage, and the populated isVerified field.
 *   2. useVerifyVolunteer.js source guards: named export, TanStack
 *      Query useMutation + useQueryClient, POST endpoint shape,
 *      queryKey invalidations on the two existing request-list
 *      caches (['moderator-requests'] and ['owner-requests']).
 *   3. Badge keying strings ("Verified", "Verified by moderator",
 *      "Verified volunteer") appear in the production bundle.
 *   4. ProfilePage source guards: badge renders only for VOLUNTEER
 *      + isVerified; Verification Meta row delegates to a status
 *      string; the page does NOT call the verify endpoint (the
 *      owner-facing profile has no moderation CTA).
 *   5. OwnerRequestsPage source guards: badge renders next to
 *      volunteer name when populated volunteerSummary.isVerified is
 *      true (so the server-side populate contract is honored).
 *   6. ModeratorDashboardPage source guards: same badge on the
 *      moderator's request row.
 *   7. Regression guards: prior contact-leak guards on the 6.2
 *      surface (the hook does NOT fetch /users/:id or /auth/me;
 *      the badge source does NOT phone home for contact info).
 *
 * Run: `node smoke-tests/6.2-volunteer-verification.test.cjs` from
 * `client/`. Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const HOOK_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useVerifyVolunteer.js'
);
const PROFILE_PATH = path.join(CLIENT_ROOT, 'src/pages/ProfilePage.jsx');
const OWNER_REQ_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerRequestsPage.jsx'
);
const MOD_DASH_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/moderator/ModeratorDashboardPage.jsx'
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

function readBundleJs() {
  const assets = fs.existsSync(DIST_ASSETS)
    ? fs.readdirSync(DIST_ASSETS)
    : [];
  const jsAssets = assets.filter((f) => f.endsWith('.js'));
  return jsAssets
    .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
    .join('\n');
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
  }

  // ── 2. useVerifyVolunteer.js source guards ─────────────────────────
  section('2. useVerifyVolunteer.js source guards');
  {
    const src = readSrc(HOOK_PATH);
    assert(
      /export function useVerifyVolunteer\b/.test(src),
      'exports useVerifyVolunteer'
    );
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(
      /useMutation\s*\(/.test(src),
      'uses useMutation'
    );
    assert(
      /useQueryClient\s*\(/.test(src),
      'uses useQueryClient'
    );

    // POST endpoint — /moderator/verify-volunteer/:userId.
    assert(
      /api\.post\(\s*[\`'"]\/moderator\/verify-volunteer\/\$\{[^}]+\}/.test(
        src
      ),
      'POSTs /api/moderator/verify-volunteer/:userId'
    );

    // Cache invalidations on the two existing request-list caches.
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-requests['"]/.test(
        src
      ),
      'invalidates ["moderator-requests"] cache on success'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]owner-requests['"]/.test(
        src
      ),
      'invalidates ["owner-requests"] cache on success'
    );

    // Response extraction — data.data.user.
    assert(
      /data\?\.data\?\.user/.test(src),
      'relays response.data.data.user (post-ok wrapper shape)'
    );

    // Privacy — strip comments so the doc block doesn't trip the
    // assertion, then assert the hook NEVER reaches for /users/:id
    // or /auth/me directly.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'hook does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'hook does NOT GET /auth/me'
    );
    assert(
      !/api\.get\(['"]\/api\/users/.test(codeOnly),
      'hook does NOT GET /api/users'
    );
    assert(
      !/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'hook does NOT GET /api/auth/me'
    );
    // The hook body is intentional — moderatorNote is accepted but
    // only sent when truthy. No silent PATCH / PUT additions.
    assert(
      !/api\.put\(/.test(codeOnly),
      'hook does NOT PUT (verify is a POST mutation)'
    );
  }

  // ── 3. Bundle keying strings ───────────────────────────────────────
  section('3. production bundle carries the badge copy');
  {
    const allJs = readBundleJs();
    // The bundle must contain the strings the badge renders
    // (matching the source-of-truth "Verified" labels).
    for (const label of [
      'Verified',
      'Verified volunteer',
      'Verified by moderator',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }

    // NOTE: The verify-volunteer URL path is intentionally NOT
    // asserted in the bundle. Vite tree-shakes unused module exports
    // in production builds, and useVerifyVolunteer is not yet
    // consumed by any committed page (the moderator-side verification
    // CTA lives on Module 6.3's surface area). The hook is shipped
    // for forward compat; if consumers land and the URL string
    // appears in the bundle, this is a happy bonus — not a
    // regression.
  }

  // ── 4. ProfilePage badge wiring ────────────────────────────────────
  section('4. ProfilePage badge wiring');
  {
    const src = readSrc(PROFILE_PATH);

    // VOLUNTEER + isVerified gate on the header badge (the badge that
    // sits next to the user's own name).
    assert(
      /user\.role\s*===\s*['"]VOLUNTEER['"]\s*&&[^&]*?\buser\.isVerified\b/.test(
        src
      ) || /user\.isVerified\b[^&]*?user\.role\s*===\s*['"]VOLUNTEER['"]/.test(
        src
      ),
      'Profile header badge gated on user.role === "VOLUNTEER" && user.isVerified'
    );

    // The role-aware Verification Meta row mentions the moderator
    // verification text + render of the status badge.
    assert(
      /Verified by moderator/.test(src),
      'Profile Verification Meta row mentions "Verified by moderator"'
    );

    // The Verification Meta row's value is the user's isVerified flag.
    assert(
      /user\.isVerified/.test(src),
      'Profile Verification Meta row shows user.isVerified'
    );

    // The profile page does NOT include the verify mutation hook
    // (the owner-facing profile is read-only — moderating needs the
    // moderator dashboard surface).
    assert(
      !/useVerifyVolunteer/.test(src),
      'ProfilePage does NOT wire useVerifyVolunteer (no self-verify CTA)'
    );
  }

  // ── 5. OwnerRequestsPage badge wiring ──────────────────────────────
  section('5. OwnerRequestsPage badge wiring');
  {
    const src = readSrc(OWNER_REQ_PATH);

    // The badge sits next to the volunteer name in the request row,
    // gated on volunteer.isVerified (the populated summary field).
    assert(
      /volunteer\.isVerified/.test(src),
      'OwnerRequestsPage reads volunteer.isVerified for the badge'
    );
    assert(
      /Verified volunteer/.test(src),
      'OwnerRequestsPage renders "Verified volunteer" copy'
    );
    // The badge uses the project's safe color tokens.
    assert(
      /bg-safe-100/.test(src) && /text-safe-800/.test(src),
      'OwnerRequestsPage badge uses bg-safe-100 + text-safe-800 tokens'
    );
  }

  // ── 6. ModeratorDashboardPage badge wiring ─────────────────────────
  section('6. ModeratorDashboardPage badge wiring');
  {
    const src = readSrc(MOD_DASH_PATH);

    // Same badge on the moderator side.
    assert(
      /volunteer\.isVerified/.test(src),
      'ModeratorDashboardPage reads volunteer.isVerified for the badge'
    );
    assert(
      /Verified volunteer/.test(src),
      'ModeratorDashboardPage renders "Verified volunteer" copy'
    );
    assert(
      /bg-safe-100/.test(src) && /text-safe-800/.test(src),
      'ModeratorDashboardPage badge uses bg-safe-100 + text-safe-800 tokens'
    );
  }

  // ── 7. Regression guards ───────────────────────────────────────────
  section('7. regression guards');
  {
    const profileSrc = readSrc(PROFILE_PATH);
    const ownerReqSrc = readSrc(OWNER_REQ_PATH);
    const modDashSrc = readSrc(MOD_DASH_PATH);

    // Tighten the in-source privacy posture: none of the three files
    // that render the badge ever reach for /users/:id — they consume
    // the populated volunteerSummary.isVerified from the existing
    // /api/requests response.
    for (const [label, src] of [
      ['ProfilePage', profileSrc],
      ['OwnerRequestsPage', ownerReqSrc],
      ['ModeratorDashboardPage', modDashSrc],
    ]) {
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert(
        !/api\.get\(['"]\/users/.test(codeOnly),
        `${label} does NOT GET /users/:id (populated isVerified round-trip)`
      );
      assert(
        !/api\.get\(['"]\/auth\/me/.test(codeOnly),
        `${label} does NOT GET /auth/me (no per-user contact lookup)`
      );
    }
  }

  // If any assert above threw, exitCode was set.
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
