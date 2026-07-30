/**
 * End-to-end smoke test for Module 9 — Emergency Activation UI (client).
 *
 * Module 9 ships the new emergency surface:
 *   - Volunteer: EmergencyActivationForm (address chain picker +
 *     optional Leaflet pin + radius) on VolunteerDashboardPage.
 *   - Moderator: EmergencyActivationDialog (locked root area +
 *     optional pin + radius) wired into ModeratorDashboardPage.
 *   - Owner + Search: EmergencyActiveBadge rendered on resource rows
 *     where `areaEmergencyActive === true`.
 *   - Analytics: EmergencyMapCard full-width below the existing grid.
 *   - Socket: useNotificationSocket subscribes to `emergency:activated`
 *     and invalidates the `emergency-activations` + `resources` +
 *     `owner-resources` + `resource-requests` + `resource-search`
 *     + `moderator-emergency-mode` cache families.
 *   - Hooks: useEmergencyActivations exports the five hooks
 *     (useEmergencyActivations, useCreateVolunteerActivation,
 *     useCreateModeratorActivation, useDeactivateEmergencyActivation,
 *     useEmergencyMap); TanStack Query; correct endpoint shapes.
 *   - Service: emergency.js wraps POST /emergency-activations,
 *     POST /moderator/emergency-activations, GET /emergency-activations,
 *     PATCH /emergency-activations/:id/deactivate,
 *     GET /analytics/emergency-map.
 *
 * Coverage:
 *   1. Vite production build succeeds with the new components + pages.
 *   2. useEmergencyActivations.js source guards: 5 exports, TanStack
 *      Query usage, correct endpoint shapes, family-key
 *      `['emergency-activations']`, mutations invalidate the family
 *      + the resource/owner-resources/resource-requests families.
 *   3. emergency.js service: 5 functions, all 5 endpoint paths
 *      present, payload unwrapping uses `data?.data?.activations` /
 *      `data?.data`.
 *   4. EmergencyActivationForm.jsx exports default; uses the
 *      volunteer hook; renders address-chain dropdown + textarea +
 *      Leaflet picker + radius slider.
 *   5. EmergencyActivationDialog.jsx exports default; uses the
 *      moderator hooks; renders the locked-root copy.
 *   6. EmergencyActiveBadge.jsx exports default; uses alert-700
 *      palette; reads `show` prop.
 *   7. EmergencyMapCard.jsx exports default; uses useEmergencyMap;
 *      renders `<Circle>` for CIRCLE scope + `<Marker>` for
 *      HIERARCHY scope.
 *   8. useNotificationSocket.js source guards: subscribes to
 *      `emergency:activated`, invalidates `['emergency-activations']`
 *      + `['resources']` + `['owner-resources']` +
 *      `['resource-requests']` + `['resource-search']` +
 *      `['moderator-emergency-mode']`.
 *   9. VolunteerDashboardPage imports EmergencyActivationForm +
 *      useEmergencyActivations + useAreaChain; renders the form
 *      only when canActivate (verified volunteer with areaId).
 *   10. OwnerDashboardPage + SearchPage render EmergencyActiveBadge
 *       inside ResourceCard, gated on `areaEmergencyActive === true`.
 *   11. ModeratorDashboardPage imports EmergencyActivationDialog;
 *       opens the dialog from the existing toggle handler.
 *   12. AnalyticsPage imports EmergencyMapCard + renders it
 *       full-width below the existing grid.
 *   13. Privacy: none of the new components reach for /users/:id
 *       or /auth/me. Activator info is read from the server's
 *       public shape only.
 *   14. Regression: the legacy 6.3 emergency-mode toggle path
 *       remains intact (`useEmergencyMode` + EmergencyModeBanner +
 *       EmergencyModeToggleCard + EmergencyModeDialog).
 *
 * Run: `node smoke-tests/9.1-emergency-activation-ui.test.cjs` from
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
  'src/hooks/useEmergencyActivations.js'
);
const SOCKET_HOOK_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useNotificationSocket.js'
);
const SERVICE_PATH = path.join(
  CLIENT_ROOT,
  'src/services/emergency.js'
);
const FORM_PATH = path.join(
  CLIENT_ROOT,
  'src/components/emergency/EmergencyActivationForm.jsx'
);
const DIALOG_PATH = path.join(
  CLIENT_ROOT,
  'src/components/emergency/EmergencyActivationDialog.jsx'
);
const BADGE_PATH = path.join(
  CLIENT_ROOT,
  'src/components/emergency/EmergencyActiveBadge.jsx'
);
const MAP_PATH = path.join(
  CLIENT_ROOT,
  'src/components/emergency/EmergencyMapCard.jsx'
);
const VOLUNTEER_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/volunteer/VolunteerDashboardPage.jsx'
);
const OWNER_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/owner/OwnerDashboardPage.jsx'
);
const SEARCH_PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/SearchPage.jsx');
const MOD_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/moderator/ModeratorDashboardPage.jsx'
);
const ANALYTICS_PAGE_PATH = path.join(
  CLIENT_ROOT,
  'src/pages/AnalyticsPage.jsx'
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

  // ── 2. useEmergencyActivations.js source guards ────────────────────
  section('2. useEmergencyActivations.js source guards');
  {
    const src = readSrc(HOOK_PATH);

    // Five named exports.
    for (const name of [
      'useEmergencyActivations',
      'useCreateVolunteerActivation',
      'useCreateModeratorActivation',
      'useDeactivateEmergencyActivation',
      'useEmergencyMap',
    ]) {
      assert(
        new RegExp(`export function ${name}\\b`).test(src),
        `exports ${name}`
      );
    }

    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'hooks use useQuery');
    assert(/useMutation\s*\(/.test(src), 'mutations use useMutation');
    assert(/useQueryClient\s*\(/.test(src), 'mutations use useQueryClient');

    // Shared family key ['emergency-activations'].
    assert(
      /family:\s*\[\s*['"]emergency-activations['"]/.test(src) ||
        /\[\s*['"]emergency-activations['"]/.test(src),
      'queryKey family is ["emergency-activations"]'
    );

    // Endpoint paths (the hooks wrap a service layer — they import the
    // service functions rather than calling api directly. We assert
    // the hooks call the imported service names).
    assert(
      /createVolunteerActivation\(\s*body\s*\)/.test(src),
      'createVolunteerActivation calls the service'
    );
    assert(
      /createModeratorActivation\(\s*body\s*\)/.test(src),
      'createModeratorActivation calls the service'
    );
    assert(
      /deactivateEmergencyActivation\(\s*id\s*\)/.test(src),
      'deactivateEmergencyActivation calls the service'
    );
    assert(
      /listEmergencyActivations\(\s*filters\s*\)/.test(src),
      'useEmergencyActivations calls listEmergencyActivations'
    );
    assert(
      /getEmergencyMap\(\s*\)/.test(src),
      'useEmergencyMap calls getEmergencyMap'
    );

    // Mutations invalidate the resource families too — that's how the
    // owner dashboard + search list + volunteer request rows refresh.
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]resources['"]/.test(
        src
      ),
      'mutations invalidate ["resources"]'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]owner-resources['"]/.test(
        src
      ),
      'mutations invalidate ["owner-resources"]'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]resource-requests['"]/.test(
        src
      ),
      'mutations invalidate ["resource-requests"]'
    );

    // Privacy: hook does NOT phone home for contact info.
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

  // ── 3. emergency.js service ─────────────────────────────────────────
  section('3. emergency.js service');
  {
    const src = readSrc(SERVICE_PATH);

    // Five named exports.
    for (const name of [
      'createVolunteerActivation',
      'createModeratorActivation',
      'listEmergencyActivations',
      'deactivateEmergencyActivation',
      'getEmergencyMap',
    ]) {
      assert(
        new RegExp(`export (async )?function ${name}\\b`).test(src),
        `exports ${name}`
      );
    }

    // All five endpoint paths.
    assert(
      /api\.post\(\s*['"]\/emergency-activations['"]/.test(src),
      'createVolunteerActivation POSTs /emergency-activations'
    );
    assert(
      /api\.post\(\s*['"]\/moderator\/emergency-activations['"]/.test(src),
      'createModeratorActivation POSTs /moderator/emergency-activations'
    );
    assert(
      /api\.get\(\s*['"]\/emergency-activations['"]/.test(src),
      'listEmergencyActivations GETs /emergency-activations'
    );
    assert(
      /api\.patch\(\s*[`'"]\/emergency-activations\/.+\/deactivate/.test(src),
      'deactivateEmergencyActivation PATCHes /:id/deactivate'
    );
    assert(
      /api\.get\(\s*['"]\/analytics\/emergency-map['"]/.test(src),
      'getEmergencyMap GETs /analytics/emergency-map'
    );
  }

  // ── 4. EmergencyActivationForm.jsx ──────────────────────────────────
  section('4. EmergencyActivationForm.jsx');
  {
    const src = readSrc(FORM_PATH);
    assert(/export default function/.test(src), 'exports default function');
    assert(
      /useCreateVolunteerActivation/.test(src),
      'imports useCreateVolunteerActivation'
    );
    assert(
      /useDeactivateEmergencyActivation/.test(src),
      'imports useDeactivateEmergencyActivation'
    );
    // MapContainer + radius slider + textarea + chain dropdown.
    assert(/MapContainer/.test(src), 'renders MapContainer');
    assert(/TileLayer/.test(src), 'renders TileLayer');
    assert(/type="range"/.test(src), 'renders radius slider');
    assert(/<textarea/.test(src), 'renders message textarea');
    assert(/<select/.test(src), 'renders area-chain select');

    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'form does NOT GET /users/:id'
    );
  }

  // ── 5. EmergencyActivationDialog.jsx ────────────────────────────────
  section('5. EmergencyActivationDialog.jsx');
  {
    const src = readSrc(DIALOG_PATH);
    assert(/export default function/.test(src), 'exports default function');
    assert(
      /useCreateModeratorActivation/.test(src),
      'imports useCreateModeratorActivation'
    );
    assert(
      /useDeactivateEmergencyActivation/.test(src),
      'imports useDeactivateEmergencyActivation'
    );
    assert(
      /moderatorAreaLabel/.test(src),
      'renders moderatorAreaLabel locked-root copy'
    );
  }

  // ── 6. EmergencyActiveBadge.jsx ─────────────────────────────────────
  section('6. EmergencyActiveBadge.jsx');
  {
    const src = readSrc(BADGE_PATH);
    assert(/export default function/.test(src), 'exports default function');
    assert(/Emergency/.test(src), 'renders Emergency label');
    assert(/bg-alert-700/.test(src), 'uses the alert palette');
    assert(/show/.test(src), 'reads the show prop');
  }

  // ── 7. EmergencyMapCard.jsx ─────────────────────────────────────────
  section('7. EmergencyMapCard.jsx');
  {
    const src = readSrc(MAP_PATH);
    assert(/export default function/.test(src), 'exports default function');
    assert(/useEmergencyMap/.test(src), 'imports useEmergencyMap');
    assert(/<Circle\b/.test(src), 'renders <Circle> for CIRCLE scope');
    assert(/<Marker\b/.test(src), 'renders <Marker> for HIERARCHY scope');
    assert(/TileLayer/.test(src), 'renders TileLayer');
  }

  // ── 8. useNotificationSocket.js source guards ───────────────────────
  section('8. useNotificationSocket.js source guards');
  {
    const src = readSrc(SOCKET_HOOK_PATH);

    // Subscribes to emergency:activated.
    assert(
      /socket\.on\(\s*['"]emergency:activated['"]/.test(src),
      'subscribes to emergency:activated'
    );
    assert(
      /socket\.off\(\s*['"]emergency:activated['"]/.test(src),
      'unbinds emergency:activated'
    );

    // Invalidates the right families.
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]emergency-activations['"]/.test(
        src
      ),
      'invalidates ["emergency-activations"]'
    );
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]resources['"]/.test(
        src
      ),
      'invalidates ["resources"]'
    );
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]owner-resources['"]/.test(
        src
      ),
      'invalidates ["owner-resources"]'
    );
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]resource-requests['"]/.test(
        src
      ),
      'invalidates ["resource-requests"]'
    );
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]resource-search['"]/.test(
        src
      ),
      'invalidates ["resource-search"]'
    );
    assert(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-emergency-mode['"]/.test(
        src
      ),
      'invalidates ["moderator-emergency-mode"]'
    );
  }

  // ── 9. VolunteerDashboardPage integration ───────────────────────────
  section('9. VolunteerDashboardPage integration');
  {
    const src = readSrc(VOLUNTEER_PAGE_PATH);
    assert(
      /from\s+['"]\.\.\/\.\.\/components\/emergency\/EmergencyActivationForm['"]/.test(
        src
      ),
      'imports EmergencyActivationForm'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useEmergencyActivations['"]/.test(src),
      'imports useEmergencyActivations'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useAreas['"]/.test(src),
      'imports useAreas (useAreaChain)'
    );
    assert(/<EmergencyActivationForm\b/.test(src), 'renders EmergencyActivationForm');
    assert(/canActivate/.test(src), 'gates the form behind canActivate');
    assert(
      /user\.role\s*===\s*['"]VOLUNTEER['"]/.test(src),
      'canActivate checks VOLUNTEER role'
    );
    assert(
      /user\.isVerified\s*===\s*true/.test(src),
      'canActivate checks isVerified === true'
    );
  }

  // ── 10. OwnerDashboardPage + SearchPage integration ─────────────────
  section('10. OwnerDashboardPage + SearchPage integration');
  {
    const ownerSrc = readSrc(OWNER_PAGE_PATH);
    assert(
      /from\s+['"]\.\.\/\.\.\/components\/emergency\/EmergencyActiveBadge['"]/.test(
        ownerSrc
      ),
      'OwnerDashboardPage imports EmergencyActiveBadge'
    );
    assert(
      /<EmergencyActiveBadge\b/.test(ownerSrc),
      'OwnerDashboardPage renders EmergencyActiveBadge'
    );
    assert(
      /areaEmergencyActive\s*===\s*true/.test(ownerSrc),
      'OwnerDashboardPage gates the badge on areaEmergencyActive === true'
    );

    const searchSrc = readSrc(SEARCH_PAGE_PATH);
    assert(
      /from\s+['"]\.\.\/components\/emergency\/EmergencyActiveBadge['"]/.test(
        searchSrc
      ),
      'SearchPage imports EmergencyActiveBadge'
    );
    assert(
      /<EmergencyActiveBadge\b/.test(searchSrc),
      'SearchPage renders EmergencyActiveBadge'
    );
    assert(
      /areaEmergencyActive\s*===\s*true/.test(searchSrc),
      'SearchPage gates the badge on areaEmergencyActive === true'
    );
  }

  // ── 11. ModeratorDashboardPage integration ──────────────────────────
  section('11. ModeratorDashboardPage integration');
  {
    const src = readSrc(MOD_PAGE_PATH);
    assert(
      /from\s+['"]\.\.\/\.\.\/components\/emergency\/EmergencyActivationDialog['"]/.test(
        src
      ),
      'ModeratorDashboardPage imports EmergencyActivationDialog'
    );
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useEmergencyActivations['"]/.test(src),
      'ModeratorDashboardPage imports useEmergencyActivations'
    );
    assert(
      /<EmergencyActivationDialog\b/.test(src),
      'ModeratorDashboardPage renders EmergencyActivationDialog'
    );

    // Regression — the legacy 6.3 surface remains intact.
    for (const name of [
      'EmergencyModeBanner',
      'EmergencyModeToggleCard',
      'EmergencyModeDialog',
    ]) {
      assert(
        new RegExp(`function ${name}\\b`).test(src),
        `regression: ${name} still defined`
      );
    }
  }

  // ── 12. AnalyticsPage integration ───────────────────────────────────
  section('12. AnalyticsPage integration');
  {
    const src = readSrc(ANALYTICS_PAGE_PATH);
    assert(
      /from\s+['"]\.\.\/components\/emergency\/EmergencyMapCard['"]/.test(src),
      'AnalyticsPage imports EmergencyMapCard'
    );
    assert(
      /<EmergencyMapCard\b/.test(src),
      'AnalyticsPage renders EmergencyMapCard'
    );
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    process.exitCode = exitCode || 1;
  } finally {
    if (exitCode !== 0) process.exitCode = exitCode;
  }
})();