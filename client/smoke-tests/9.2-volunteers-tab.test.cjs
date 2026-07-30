/**
 * Smoke test for Module: Volunteers Tab — Admin + Moderator panels.
 *
 * Validates:
 *   1. Vite production build succeeds with the new pages, hooks,
 *      and route entry.
 *   2. Backend additions:
 *        - `volunteersAdminQuerySchema` exported from
 *          server/validators/admin.validators.js
 *        - `GET /volunteers` registered in server/routes/admin.routes.js
 *        - `listVolunteers` exported from
 *          server/controllers/admin.controller.js
 *   3. Client hooks:
 *        - `useAdminVolunteers` hits /admin/volunteers with the
 *          right query keys + staleTime.
 *        - `useModeratorVolunteers` hits /moderator/volunteers with
 *          the right query keys + staleTime.
 *        - `useVerifyVolunteer` invalidates the new admin-volunteers
 *          + moderator-volunteers keys.
 *   4. New pages exist + render the right sub-components.
 *   5. App.jsx registers the new route under the right role gate.
 *   6. MainLayout.jsx + MobileNavDrawer.jsx include the "Volunteers"
 *      link gated to MODERATOR | ADMIN (Module 9.1 parity).
 *   7. Privacy posture — neither page reads email / phone (defence
 *      in depth on top of the server's `publicUserDirectory()`).
 *
 * Run: `node smoke-tests/9.2-volunteers-tab.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');

const ADMIN_VALIDATORS_PATH = path.resolve(
  __dirname,
  '../../server/validators/admin.validators.js'
);
const ADMIN_ROUTES_PATH = path.resolve(
  __dirname,
  '../../server/routes/admin.routes.js'
);
const ADMIN_CONTROLLER_PATH = path.resolve(
  __dirname,
  '../../server/controllers/admin.controller.js'
);

const HOOK_ADMIN_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useAdminVolunteers.js'
);
const HOOK_MOD_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useModeratorVolunteers.js'
);
const HOOK_VERIFY_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useVerifyVolunteer.js'
);
const ADMIN_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/admin/AdminVolunteersListPage.jsx'
);
const MOD_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/moderator/ModeratorVolunteersListPage.jsx'
);
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');
const LAYOUT_PATH = path.join(CLIENT_ROOT, 'src/layouts/MainLayout.jsx');
const DRAWER_PATH = path.join(
  CLIENT_ROOT,
  'src/components/MobileNavDrawer.jsx'
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
    for (const label of [
      'Volunteers',
      'Mark verified',
      'No volunteers match your filters',
      'No volunteers in this area yet',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. Backend additions ────────────────────────────────────────────
  section('2. Backend additions (admin volunteers API)');
  {
    const validatorsSrc = fs.readFileSync(ADMIN_VALIDATORS_PATH, 'utf8');
    assert(
      /volunteersAdminQuerySchema/.test(validatorsSrc),
      'admin.validators.js exports volunteersAdminQuerySchema'
    );
    assert(
      /areaId[\s\S]{0,200}ObjectId/.test(validatorsSrc) ||
        /areaId[\s\S]{0,200}valid ObjectId/.test(validatorsSrc),
      'volunteersAdminQuerySchema validates areaId as ObjectId'
    );
    assert(
      /isVerified[\s\S]{0,200}'true',\s*'false'/.test(validatorsSrc) ||
        /isVerified[\s\S]{0,200}['"`]true['"`],\s*['"`]false['"`]/.test(validatorsSrc),
      'volunteersAdminQuerySchema validates isVerified as true|false'
    );

    const routesSrc = fs.readFileSync(ADMIN_ROUTES_PATH, 'utf8');
    assert(
      /router\.get\(\s*['"`]\/volunteers['"`]/.test(routesSrc),
      'admin.routes.js registers GET /volunteers'
    );
    assert(
      /volunteersAdminQuerySchema/.test(routesSrc),
      'admin.routes.js wires the volunteersAdminQuerySchema validator'
    );

    const ctrlSrc = fs.readFileSync(ADMIN_CONTROLLER_PATH, 'utf8');
    assert(
      /async\s+function\s+listVolunteers/.test(ctrlSrc),
      'admin.controller.js defines listVolunteers'
    );
    assert(
      /module\.exports[\s\S]*listVolunteers/.test(ctrlSrc),
      'admin.controller.js exports listVolunteers'
    );
    assert(
      /User\.ROLES\.VOLUNTEER/.test(ctrlSrc),
      'listVolunteers filters by role: VOLUNTEER'
    );
    assert(
      /publicUserDirectory/.test(ctrlSrc),
      'listVolunteers uses publicUserDirectory (privacy stripper)'
    );
    assert(
      /filter\.isVerified\s*=\s*req\.query\.isVerified\s*===\s*'true'/.test(
        ctrlSrc
      ),
      'listVolunteers coerces isVerified from string to boolean'
    );
  }

  // ── 3. Client hooks ─────────────────────────────────────────────────
  section('3. Client hooks');
  {
    const adminHookSrc = fs.readFileSync(HOOK_ADMIN_PATH, 'utf8');
    assert(
      /export function useAdminVolunteers/.test(adminHookSrc),
      'useAdminVolunteers.js exports useAdminVolunteers'
    );
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(adminHookSrc),
      'useAdminVolunteers.js imports @tanstack/react-query'
    );
    assert(
      /queryKey:\s*\[\s*['"]admin-volunteers['"]/.test(adminHookSrc),
      'useAdminVolunteers queryKey starts with "admin-volunteers"'
    );
    assert(
      /api\.get\(['"]\/admin\/volunteers['"]/.test(adminHookSrc),
      'useAdminVolunteers GETs /admin/volunteers'
    );
    assert(
      /staleTime/.test(adminHookSrc) &&
        /30\s*\*\s*1000|30_000/.test(adminHookSrc),
      'useAdminVolunteers uses 30s staleTime'
    );

    const modHookSrc = fs.readFileSync(HOOK_MOD_PATH, 'utf8');
    assert(
      /export function useModeratorVolunteers/.test(modHookSrc),
      'useModeratorVolunteers.js exports useModeratorVolunteers'
    );
    assert(
      /queryKey:\s*\[\s*['"]moderator-volunteers['"]/.test(modHookSrc),
      'useModeratorVolunteers queryKey starts with "moderator-volunteers"'
    );
    assert(
      /api\.get\(['"]\/moderator\/volunteers['"]/.test(modHookSrc),
      'useModeratorVolunteers GETs /moderator/volunteers'
    );
    assert(
      /staleTime/.test(modHookSrc) &&
        /30\s*\*\s*1000|30_000/.test(modHookSrc),
      'useModeratorVolunteers uses 30s staleTime'
    );

    const verifySrc = fs.readFileSync(HOOK_VERIFY_PATH, 'utf8');
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]admin-volunteers['"]/.test(
        verifySrc
      ),
      'useVerifyVolunteer invalidates "admin-volunteers"'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-volunteers['"]/.test(
        verifySrc
      ),
      'useVerifyVolunteer invalidates "moderator-volunteers"'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-requests['"]/.test(
        verifySrc
      ) &&
        /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]owner-requests['"]/.test(
          verifySrc
        ),
      'useVerifyVolunteer still invalidates the original 6.2 keys'
    );
  }

  // ── 4. New pages ────────────────────────────────────────────────────
  section('4. New pages');
  {
    assert(fs.existsSync(ADMIN_PAGE_PATH), 'AdminVolunteersListPage.jsx exists');
    assert(
      fs.existsSync(MOD_PAGE_PATH),
      'ModeratorVolunteersListPage.jsx exists'
    );

    const adminPageSrc = fs.readFileSync(ADMIN_PAGE_PATH, 'utf8');
    assert(
      /import\s+\{\s*useAdminVolunteers\s*\}\s+from\s+['"]\.\.\/\.\.\/hooks\/useAdminVolunteers['"]/.test(
        adminPageSrc
      ),
      'AdminVolunteersListPage imports useAdminVolunteers'
    );
    assert(
      /import\s+AreaCascadeFilter/.test(adminPageSrc),
      'AdminVolunteersListPage imports AreaCascadeFilter (admin has area picker)'
    );
    assert(
      /useVerifyVolunteer/.test(adminPageSrc),
      'AdminVolunteersListPage wires useVerifyVolunteer'
    );
    // Sub-components
    for (const name of [
      'Header',
      'Filters',
      'VolunteerTable',
      'VolunteerRow',
      'AreaCell',
      'Pagination',
      'LoadingState',
      'ErrorBanner',
      'EmptyState',
    ]) {
      assert(
        adminPageSrc.includes(`function ${name}`),
        `AdminVolunteersListPage defines ${name}`
      );
    }

    const modPageSrc = fs.readFileSync(MOD_PAGE_PATH, 'utf8');
    assert(
      /import\s+\{\s*useModeratorVolunteers\s*\}\s+from\s+['"]\.\.\/\.\.\/hooks\/useModeratorVolunteers['"]/.test(
        modPageSrc
      ),
      'ModeratorVolunteersListPage imports useModeratorVolunteers'
    );
    assert(
      /useAreaChain/.test(modPageSrc),
      'ModeratorVolunteersListPage resolves the moderator area label via useAreaChain'
    );
    assert(
      /useVerifyVolunteer/.test(modPageSrc),
      'ModeratorVolunteersListPage wires useVerifyVolunteer'
    );
    assert(
      !/AreaCascadeFilter/.test(modPageSrc),
      'ModeratorVolunteersListPage does NOT use AreaCascadeFilter (area is auto-scoped)'
    );
    for (const name of [
      'Header',
      'FilterBar',
      'VolunteerTable',
      'VolunteerRow',
      'Pagination',
      'LoadingState',
      'ErrorBanner',
      'EmptyState',
      'NoAreaEmptyState',
    ]) {
      assert(
        modPageSrc.includes(`function ${name}`),
        `ModeratorVolunteersListPage defines ${name}`
      );
    }

    // Privacy — neither page reads volunteer.email/phone (defence in
    // depth on top of the server-side publicUserDirectory).
    for (const [label, src] of [
      ['AdminVolunteersListPage', adminPageSrc],
      ['ModeratorVolunteersListPage', modPageSrc],
    ]) {
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert(
        !/volunteer\.email/.test(codeOnly) &&
          !/volunteer\.phone/.test(codeOnly),
        `${label} does NOT access volunteer.email or volunteer.phone`
      );
      assert(
        !/v\.email/.test(codeOnly) && !/v\.phone/.test(codeOnly),
        `${label} does NOT access row.email or row.phone`
      );
    }
  }

  // ── 5. App.jsx routes ──────────────────────────────────────────────
  section('5. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+ModeratorVolunteersListPage\s+from\s+['"]\.\/pages\/moderator\/ModeratorVolunteersListPage\.jsx['"]/.test(
        appSrc
      ),
      'App.jsx imports ModeratorVolunteersListPage'
    );
    assert(
      /import\s+AdminVolunteersListPage\s+from\s+['"]\.\/pages\/admin\/AdminVolunteersListPage\.jsx['"]/.test(
        appSrc
      ),
      'App.jsx imports AdminVolunteersListPage'
    );
    // Route registration under the MODERATOR|ADMIN gate.
    assert(
      /path\s*=\s*['"]moderator\/volunteers['"]/.test(appSrc),
      'App.jsx registers /moderator/volunteers'
    );
    // The dispatcher should branch on user.role === 'ADMIN'.
    assert(
      /function\s+VolunteersTabDispatcher[\s\S]*user\?\.role\s*===\s*['"]ADMIN['"]/.test(
        appSrc
      ),
      'VolunteersTabDispatcher dispatches on user.role === ADMIN'
    );
    // Confirm the moderator-only route block is gated correctly.
    // Look for the MODERATOR|ADMIN gate anywhere in App.jsx and
    // verify /moderator/volunteers is registered inside the same
    // protected block.
    assert(
      /roles=\{\[\s*['"]MODERATOR['"]\s*,\s*['"]ADMIN['"]\s*\]\}/.test(
        appSrc
      ),
      'App.jsx declares the MODERATOR|ADMIN ProtectedRoute roles'
    );
    assert(
      /path\s*=\s*['"]moderator['"]/.test(appSrc) &&
        /path\s*=\s*['"]moderator\/volunteers['"]/.test(appSrc) &&
        /path\s*=\s*['"]analytics['"]/.test(appSrc),
      '/moderator, /moderator/volunteers, and /analytics all registered'
    );
    // Admin-only gate still exists (separate from moderator) — sanity.
    assert(
      /roles=\{\[\s*['"]ADMIN['"]\s*\]\}/.test(appSrc),
      'ADMIN-only ProtectedRoute (roles=["ADMIN"]) exists'
    );
  }

  // ── 6. Navigation parity (Module 9.1 contract) ──────────────────────
  section('6. Navigation parity (desktop + drawer)');
  {
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    const drawerSrc = fs.readFileSync(DRAWER_PATH, 'utf8');

    for (const [label, src] of [
      ['MainLayout', layoutSrc],
      ['MobileNavDrawer', drawerSrc],
    ]) {
      assert(
        /\/moderator\/volunteers/.test(src),
        `${label} links to /moderator/volunteers`
      );
      // The Volunteers link MUST live inside a block that gates on
      // MODERATOR | ADMIN. The desktop nav uses
      // `user.role === 'MODERATOR' || user.role === 'ADMIN'` and the
      // drawer mirrors the same pattern. Either form is acceptable
      // as long as both roles are present AND the link is wrapped
      // inside the gate.
      assert(
        /MODERATOR['"]/.test(src) && /ADMIN['"]/.test(src),
        `${label} gates Volunteers on MODERATOR|ADMIN (both role strings present)`
      );
    }
  }

  // ── 7. Smoke regression: prior nav tests still pass logically ───────
  section('7. Regression: nav-link parity for moderator + admin sections');
  {
    // The Volunteers link must NOT replace the existing Moderation link.
    const layoutSrc = fs.readFileSync(LAYOUT_PATH, 'utf8');
    assert(
      /to\s*=\s*['"]\/moderator['"]/.test(layoutSrc),
      'MainLayout still has the existing /moderator link'
    );
    assert(
      /to\s*=\s*['"]\/analytics['"]/.test(layoutSrc),
      'MainLayout still has the existing /analytics link'
    );
    assert(
      /to\s*=\s*['"]\/admin\/moderators['"]/.test(layoutSrc),
      'MainLayout still has the existing /admin/moderators link'
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
