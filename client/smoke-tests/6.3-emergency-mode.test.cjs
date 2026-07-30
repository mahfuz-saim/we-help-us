/**
 * End-to-end smoke test for Module 6.3 — Emergency Mode (client).
 *
 * Module 6.3 ships the per-area emergency-mode toggle on the
 * moderator dashboard. The server side
 * (GET + PATCH /api/moderator/emergency-mode) is locked by the 6.3
 * server smoke; the client side wires:
 *   - useEmergencyMode hook (TanStack Query useQuery + useMutation)
 *   - EmergencyModeBanner (red alert banner above the dashboard)
 *   - EmergencyModeToggleCard (Activate / Deactivate affordance)
 *   - EmergencyModeDialog (confirm modal with optional note)
 *   - Response-focused view: while active, the dashboard surfaces
 *     a "Response mode" badge + the queue is the priority surface.
 *
 * Coverage:
 *   1. Vite production build succeeds with the new useEmergencyMode
 *      hook + the updated ModeratorDashboardPage.
 *   2. useEmergencyMode.js exports useEmergencyMode +
 *      useSetEmergencyMode; TanStack Query; GET + PATCH endpoint
 *      shapes correct; invalidates ['moderator-emergency-mode'] +
 *      ['moderator-requests'] on success.
 *   3. ModeratorDashboardPage source guards: defines the three
 *      sub-components (EmergencyModeBanner, EmergencyModeToggleCard,
 *      EmergencyModeDialog); calls the new hooks; renders the banner
 *      + card; wires the dialog; the no-area moderator sees the
 *      "Assign an area" muted hint instead of the toggle.
 *   4. Privacy boundary: none of the dashboard source reaches for
 *      /users/:id or /auth/me; the activatedBy name renders via the
 *      server's publicUserDirectory response.
 *   5. Regression: 5.5 dashboard surface intact (Header +
 *      AreaScopeHint + FilterBar + RequestRow + ActionRow +
 *      ModeratorNoteDialog + StatusBadge + LoadingState +
 *      ErrorBanner + EmptyState + PrivacyFooter all still defined;
 *      the request-reject CTA still works).
 *
 * Run: `node smoke-tests/6.3-emergency-mode.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useEmergencyMode.js');
const PAGE_PATH = path.join(
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

  // ── 2. useEmergencyMode.js source guards ───────────────────────────
  section('2. useEmergencyMode.js source guards');
  {
    const src = readSrc(HOOK_PATH);

    // Two named exports.
    for (const name of ['useEmergencyMode', 'useSetEmergencyMode']) {
      assert(
        new RegExp(`export function ${name}\\b`).test(src),
        `exports ${name}`
      );
    }

    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'useEmergencyMode uses useQuery');
    assert(/useMutation\s*\(/.test(src), 'useSetEmergencyMode uses useMutation');
    assert(/useQueryClient\s*\(/.test(src), 'useSetEmergencyMode uses useQueryClient');

    // GET /api/moderator/emergency-mode
    assert(
      /api\.get\(\s*[\`'"]\/moderator\/emergency-mode['"]\s*\)/.test(src),
      'GETs /api/moderator/emergency-mode'
    );

    // PATCH /api/moderator/emergency-mode with body { isActive, note }
    assert(
      /api\.patch\(\s*[\`'"]\/moderator\/emergency-mode['"]/.test(src),
      'PATCHes /api/moderator/emergency-mode'
    );
    assert(
      /isActive:\s*isActive\s*===\s*true/.test(src),
      'body sends { isActive: isActive === true }'
    );
    assert(
      /body\.note\s*=|if\s*\(\s*note\s*\)\s*body\.note/.test(src),
      'body carries optional note only when truthy'
    );

    // Cache key ['moderator-emergency-mode']
    assert(
      /queryKey:\s*\[\s*['"]moderator-emergency-mode['"]/.test(src),
      'queryKey is ["moderator-emergency-mode"]'
    );

    // Invalidate on success.
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-emergency-mode['"]/.test(
        src
      ),
      'useSetEmergencyMode invalidates ["moderator-emergency-mode"] cache'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]moderator-requests['"]/.test(
        src
      ),
      'useSetEmergencyMode invalidates ["moderator-requests"] cache'
    );

    // Privacy: hook does NOT phone home for contact info.
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
  }

  // ── 3. ModeratorDashboardPage source guards ─────────────────────────
  section('3. ModeratorDashboardPage.jsx source guards');
  {
    const src = readSrc(PAGE_PATH);

    // Sub-components present.
    for (const name of [
      'EmergencyModeBanner',
      'EmergencyModeToggleCard',
      'EmergencyModeDialog',
    ]) {
      assert(
        new RegExp(`function ${name}\\b`).test(src),
        `page defines function ${name}`
      );
    }

    // Hooks wired.
    assert(/useEmergencyMode\s*\(/.test(src),
      'page calls useEmergencyMode');
    assert(/useSetEmergencyMode\s*\(/.test(src),
      'page calls useSetEmergencyMode');
    assert(
      /from\s+['"]\.\.\/\.\.\/hooks\/useEmergencyMode['"]/.test(src),
      'page imports useEmergencyMode + useSetEmergencyMode from the hook'
    );

    // The 5.5 sub-components remain intact (regression guard).
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
        new RegExp(`function ${name}\\b`).test(src),
        `regression: page still defines function ${name}`
      );
    }

    // The toggle path passes through a dialog gated on `emergencyDialog`.
    assert(
      /emergencyDialog/.test(src),
      'page tracks emergencyDialog state (open/close)'
    );
    assert(
      /EmergencyModeDialog[\s\S]+onCancel=[\s\S]+onSubmit=/.test(src),
      'page renders EmergencyModeDialog with onCancel + onSubmit'
    );

    // No-area moderator gets the muted hint instead of the toggle.
    assert(
      /hasArea[\s\S]+Assign an area/.test(src),
      'EmergencyModeToggleCard renders no-area hint when !hasArea'
    );

    // Banner copy in the bundle.
    const allJs = fs
      .readdirSync(DIST_ASSETS)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');
    for (const label of [
      'Emergency mode',
      'Response mode',
      'Activated by',
      'Activate',
      'Deactivate',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 4. Privacy boundary ────────────────────────────────────────────
  section('4. privacy boundary');
  {
    const src = readSrc(PAGE_PATH);
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'page does NOT GET /users/:id (no per-user contact lookup)'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'page does NOT GET /auth/me'
    );
    assert(
      !/api\.get\(['"]\/api\/users/.test(codeOnly),
      'page does NOT GET /api/users'
    );
    assert(
      !/api\.get\(['"]\/api\/auth\/me/.test(codeOnly),
      'page does NOT GET /api/auth/me'
    );
    // The activatedBy actor's name renders from the response — never
    // as a separate fetch.
    assert(
      /data\.activatedBy(\s*&&\s*data\.activatedBy\.name)?\s*\?\s*data\.activatedBy\.name\s*:/.test(
        src
      ) || /activatedByName/.test(src),
      'page reads activatedBy.name from the round-tripped response'
    );
  }

  // ── 5. Regression ───────────────────────────────────────────────────
  section('5. regression — 5.5 dashboard surface intact');
  {
    const src = readSrc(PAGE_PATH);
    // The 5.5 hooks still fire.
    assert(
      /useModeratorRequests\s*\(/.test(src),
      'regression: page still calls useModeratorRequests'
    );
    assert(
      /useModeratorRequestCount\s*\(/.test(src),
      'regression: page still calls useModeratorRequestCount'
    );
    assert(
      /useRejectModeratorRequest\s*\(/.test(src),
      'regression: page still calls useRejectModeratorRequest'
    );
    // The Reject CTA still wires through ModeratorNoteDialog.
    assert(
      /Reject request|Rejecting/.test(src),
      'regression: page still renders the Reject CTA label'
    );
    // The privacy footer copy from 5.5 is preserved.
    assert(
      /summaries only/.test(src),
      "regression: PrivacyFooter 'summaries only' copy intact"
    );
  }

  process.exit(exitCode);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});