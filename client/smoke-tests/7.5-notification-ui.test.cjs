/**
 * End-to-end smoke test for Module 7.5 — Notification UI (client).
 *
 * Module 7.5 ships the real-time notification center:
 *   - Bell icon with unread badge in the header
 *   - Dropdown notification panel
 *   - Real-time toasts via react-hot-toast (already wired at app root)
 *
 * The server surface (notifications inbox + triggers + Socket.io
 * fan-out) shipped in Modules 7.1–7.4 and is locked by those
 * server smokes + the 7.4 socket smoke. This smoke is purely
 * client-side.
 *
 * Coverage:
 *   1. Vite production build succeeds with the new hooks + bell +
 *      panel + MainLayout wiring.
 *   2. useNotifications.js exports the four hooks
 *      (useNotifications, useUnreadNotifications,
 *      useMarkNotificationRead, useMarkAllNotificationsRead);
 *      TanStack Query; GET + PATCH endpoint shapes correct;
 *      queryKey + cache invalidations match the bell's read model.
 *   3. useNotificationSocket.js wires the singleton Socket.io
 *      connection: subscribes to `notification:new`, mutates the
 *      notifications cache, emits a toast. Disconnects on
 *      `enabled → false`.
 *   4. NotificationBell renders the bell + (optionally) the unread
 *      badge + the dropdown panel when open; closes on outside
 *      click + Escape.
 *   5. NotificationPanel lists the latest unread rows, surfaces
 *      empty / loading / error states, and offers the
 *      "Mark all as read" CTA. Maps known REQUEST_* types to
 *      recipient-side routes via the `linkFor` helper.
 *   6. MainLayout imports NotificationBell AND renders it inside
 *      the logged-in nav branch.
 *   7. Privacy boundary: none of the new client code reaches for
 *      /users/:id or /auth/me; payloads are consumed as-is.
 *   8. Regression: the prior nav links (Owner / Volunteer /
 *      Moderator / Profile / Log out) remain intact.
 *
 * Run: `node smoke-tests/7.5-notification-ui.test.cjs` from
 * `client/`. Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');

const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useNotifications.js');
const SOCKET_HOOK_PATH = path.join(
  CLIENT_ROOT,
  'src/hooks/useNotificationSocket.js'
);
const BELL_PATH = path.join(
  CLIENT_ROOT,
  'src/components/NotificationBell.jsx'
);
const PANEL_PATH = path.join(
  CLIENT_ROOT,
  'src/components/NotificationPanel.jsx'
);
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

    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // UI copy that the bundle must carry.
    for (const label of [
      'Notifications',
      "You're all caught up",
      'Mark all as read',
      'Marking',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. useNotifications.js source guards ───────────────────────────
  section('2. useNotifications.js source guards');
  {
    const src = readSrc(HOOK_PATH);

    for (const name of [
      'useNotifications',
      'useUnreadNotifications',
      'useMarkNotificationRead',
      'useMarkAllNotificationsRead',
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
    assert(/useQuery\s*\(/.test(src), 'list uses useQuery');
    assert(
      /useMutation[\s\S]*useMarkNotificationRead[\s\S]*useMutation/.test(src) ||
        /export function useMarkNotificationRead[\s\S]*useMutation\s*\(/.test(src),
      'mark-one uses useMutation'
    );
    assert(
      /export function useMarkAllNotificationsRead[\s\S]*useMutation\s*\(/.test(
        src
      ),
      'mark-all uses useMutation'
    );
    assert(/useQueryClient\s*\(/.test(src), 'mutations use useQueryClient');

    // GET /api/notifications
    assert(
      /api\.get\(\s*['"`]\/notifications['"`]/.test(src),
      'GETs /api/notifications'
    );

    // PATCH /api/notifications/:id/read
    assert(
      /api\.patch\(\s*['"`]\/notifications\/\$\{id\}\/read['"`]/.test(src),
      'PATCHes /api/notifications/:id/read'
    );

    // PATCH /api/notifications/mark-all-read
    assert(
      /api\.patch\(\s*['"`]\/notifications\/mark-all-read['"`]/.test(src),
      'PATCHes /api/notifications/mark-all-read'
    );

    // queryKey + invalidation — accepts both the literal 'notifications'
    // string AND the exported NOTIFICATION_QUERY_KEY constant.
    assert(
      /queryKey:\s*\[\s*(NOTIFICATION_QUERY_KEY|['"]notifications['"])/
        .test(src),
      'queryKey is ["notifications", ...]'
    );
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[(NOTIFICATION_QUERY_KEY|['"]notifications['"])/
        .test(src),
      'mutations invalidate ["notifications"] cache'
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

  // ── 3. useNotificationSocket.js source guards ───────────────────────
  section('3. useNotificationSocket.js source guards');
  {
    const src = readSrc(SOCKET_HOOK_PATH);

    assert(
      /export function useNotificationSocket\b/.test(src),
      'exports useNotificationSocket'
    );

    // Reads the singleton socket + react-hot-toast.
    assert(
      /from\s+['"]\.\.\/services\/socket['"]/.test(src),
      'imports from ../services/socket'
    );
    assert(/getSocket\s*\(/.test(src), 'calls getSocket()');
    assert(
      /disconnectSocket\s*\(/.test(src),
      'calls disconnectSocket() on logout'
    );

    // Subscribes to the right event name.
    assert(
      /socket\.on\(\s*['"]notification:new['"]/.test(src),
      "subscribes to 'notification:new'"
    );
    assert(
      /socket\.off\(\s*['"]notification:new['"]/.test(src),
      "unsubscribes on cleanup"
    );

    // Drives the notifications cache + emits a toast.
    assert(/qc\.setQueryData\s*\(/.test(src), 'mutates the notifications cache');
    assert(
      /qc\.invalidateQueries\(\s*\{\s*queryKey:\s*\[(NOTIFICATION_QUERY_KEY|['"]notifications['"])/
        .test(src),
      'invalidates ["notifications"] cache'
    );
    assert(/toast\s*\(/.test(src), 'emits a react-hot-toast');
    assert(
      /from\s+['"]react-hot-toast['"]/.test(src),
      'imports react-hot-toast'
    );
    // The toast payload is a plain string concatenation so the hook
    // stays a pure .js file (no JSX).
    assert(
      /payload\.title[\s\S]+payload\.message/.test(src),
      'toast body composes title + message from the round-tripped payload'
    );

    // Privacy.
    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'socket hook does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'socket hook does NOT GET /auth/me'
    );
  }

  // ── 4. NotificationBell.jsx source guards ───────────────────────────
  section('4. NotificationBell.jsx source guards');
  {
    const src = readSrc(BELL_PATH);

    assert(
      /export default function NotificationBell\b/.test(src),
      'exports NotificationBell as default'
    );
    assert(
      /from\s+['"]\.\.\/hooks\/useNotificationSocket['"]/.test(src),
      'imports useNotificationSocket'
    );
    assert(
      /useNotificationSocket\s*\(/.test(src),
      'calls useNotificationSocket'
    );
    assert(
      /from\s+['"]\.\.\/hooks\/useNotifications['"]/.test(src),
      'imports useUnreadNotifications from useNotifications'
    );

    // Bell + badge + dropdown wiring.
    assert(
      /data-testid\s*=\s*['"]whu-notification-bell['"]/.test(src),
      'bell has data-testid="whu-notification-bell"'
    );
    assert(
      /data-testid\s*=\s*['"]whu-notification-badge['"]/.test(src),
      'badge has data-testid="whu-notification-badge"'
    );
    assert(
      /<NotificationPanel[\s\S]+\/>/.test(src),
      'renders <NotificationPanel />'
    );

    // Outside-click + Escape close behavior.
    assert(
      /mousedown/.test(src) && /keydown/.test(src),
      'hooks mousedown + keydown listeners'
    );
    assert(/Escape/.test(src), 'Escape key closes the panel');

    // Privacy.
    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'bell does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'bell does NOT GET /auth/me'
    );
  }

  // ── 5. NotificationPanel.jsx source guards ──────────────────────────
  section('5. NotificationPanel.jsx source guards');
  {
    const src = readSrc(PANEL_PATH);

    assert(
      /export default function NotificationPanel\b/.test(src),
      'exports NotificationPanel as default'
    );

    // Hooks wired.
    assert(/useUnreadNotifications\s*\(/.test(src),
      'calls useUnreadNotifications');
    assert(/useMarkNotificationRead\s*\(/.test(src),
      'calls useMarkNotificationRead');
    assert(/useMarkAllNotificationsRead\s*\(/.test(src),
      'calls useMarkAllNotificationsRead');

    // Empty + loading + error + retry surfaces.
    assert(
      /data-testid\s*=\s*['"]whu-notification-empty['"]/.test(src),
      'empty state has data-testid="whu-notification-empty"'
    );
    assert(
      /data-testid\s*=\s*['"]whu-notification-loading['"]/.test(src),
      'loading state has data-testid="whu-notification-loading"'
    );
    assert(
      /data-testid\s*=\s*['"]whu-notification-error['"]/.test(src),
      'error state has data-testid="whu-notification-error"'
    );
    assert(
      /data-testid\s*=\s*['"]whu-notification-mark-all['"]/.test(src),
      'mark-all CTA has data-testid="whu-notification-mark-all"'
    );

    // Per-row deep-link helper.
    assert(
      /function linkFor\b/.test(src),
      'panel defines linkFor() deep-link helper'
    );
    assert(
      /['"]\/owner\/requests['"]/.test(src),
      'linkFor routes OWNER REQUEST_* → /owner/requests'
    );
    assert(
      /['"]\/volunteer\/requests['"]/.test(src),
      'linkFor routes VOLUNTEER REQUEST_* → /volunteer/requests'
    );

    // Privacy.
    const codeOnly = stripComments(src);
    assert(
      !/api\.get\(['"]\/users/.test(codeOnly),
      'panel does NOT GET /users/:id'
    );
    assert(
      !/api\.get\(['"]\/auth\/me/.test(codeOnly),
      'panel does NOT GET /auth/me'
    );
    // The panel must NEVER render contact keys.
    assert(
      !/\.email\b/.test(codeOnly),
      'panel source does NOT render .email on a notification'
    );
    assert(
      !/\.phone\b/.test(codeOnly),
      'panel source does NOT render .phone on a notification'
    );
  }

  // ── 6. MainLayout.jsx wiring ────────────────────────────────────────
  section('6. MainLayout.jsx wiring');
  {
    const src = readSrc(LAYOUT_PATH);

    assert(
      /import\s+NotificationBell\s+from\s+['"]\.\.\/components\/NotificationBell['"]/.test(
        src
      ),
      'MainLayout imports NotificationBell'
    );

    // Bell must sit inside the logged-in branch (rendered when `user`).
    // Match the wider JSX shape used by MainLayout — {user ? (<>...</>) : (<>...</>)}.
    const userBlock = src.match(/\{user \? \(([\s\S]*?)\) : \(/);
    assert(userBlock, 'MainLayout has a {user ? ... : ...} branch');
    assert(
      /<NotificationBell\s*\/>\s*</.test(userBlock[1]),
      '<NotificationBell /> sits inside the logged-in branch'
    );
    // Bell is positioned after the role-specific nav links (within
    // ~400 chars — generous because the role conditional adds some
    // whitespace).
    assert(
      /Moderation[\s\S]{0,400}<NotificationBell/.test(src) ||
        /\/owner\/requests[\s\S]{0,400}<NotificationBell/.test(src) ||
        /\/volunteer\/requests[\s\S]{0,400}<NotificationBell/.test(src),
      'bell appears after the role-specific nav links'
    );

    // Regression: prior nav links survive.
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/owner\/requests['"]/.test(src),
      'OWNER Incoming nav link still present (5.4 regression)'
    );
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/volunteer\/requests['"]/.test(src),
      'VOLUNTEER My Requests nav link still present (5.3 regression)'
    );
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/moderator['"]/.test(src),
      'MODERATOR Moderation nav link still present (5.5 regression)'
    );
    assert(
      /<NavLink[^>]*to\s*=\s*['"]\/profile['"]/.test(src),
      'Profile nav link still present'
    );
    assert(
      /onClick=\{logout\}/.test(src),
      'Log out button still present'
    );
  }

  // ── 7. Bundle carries the socket + toast wiring ─────────────────────
  section('7. Bundle copy + module shape');
  {
    const allJs = fs
      .readdirSync(DIST_ASSETS)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');
    // socket.io-client is bundled in main.jsx (Module 0.3) and the
    // socket hook must reach it. We don't import the actual module
    // name here because tree-shaking rewrites symbols, but the event
    // string survives into the bundle.
    assert(
      allJs.includes('notification:new'),
      "bundle includes the 'notification:new' socket event string"
    );
    // The bell + panel survive too.
    assert(
      allJs.includes('whu-notification-bell') ||
        allJs.includes('NotificationBell'),
      'bundle references NotificationBell'
    );
  }

  process.exit(exitCode);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});