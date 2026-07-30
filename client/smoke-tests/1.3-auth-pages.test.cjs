/**
 * End-to-end smoke test for Module 1.3 — Auth Frontend Pages.
 *
 * Scope: verifies the Vite SPA builds cleanly, the dev server boots, and the
 * auth pages load. Real DOM-level form interaction is intentionally out of
 * scope here (that lives behind a Vitest/jsdom suite added in a later
 * module). This test catches:
 *
 *   1. `npm run build` exits 0 and emits `dist/index.html` + at least one
 *      hashed JS asset (catches "did the new pages compile?" regressions).
 *   2. A mock backend can be booted on a free port, the Vite dev server
 *      can be launched with VITE_API_PROXY_TARGET pointing at it, and the
 *      SPA shell loads (catches "is the router / AuthProvider wired?").
 *   3. `client/src/pages/RegisterPage.jsx` does NOT expose MODERATOR or
 *      ADMIN as user-selectable roles in the form's rendered options
 *      (catches accidental role-escalation regressions in the UI).
 *
 * Run: `node smoke-tests/1.3-auth-pages.test.js` from `client/`.
 * Exit code 0 = all assertions passed, non-zero = first failure.
 *
 * Design notes:
 *   - We don't `import` from client/ or server/. The smoke test must work
 *     against the built artifacts, not against source modules.
 *   - We don't need a real MongoDB. The mock backend is a 60-line Express
 *     stub that emulates /api/auth/{register,login,logout,me} + /api/health.
 *   - Vite's dev server is killed on every test path (success and failure).
 */

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForServer(urls, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let pending = list.length;
      let resolved = false;
      const onResult = (err, status) => {
        if (resolved) return;
        if (!err && status && status < 500) {
          resolved = true;
          return resolve(status);
        }
        pending -= 1;
        if (pending === 0) retry();
      };
      for (const u of list) {
        const req = http.get(u, (res) => {
          res.resume();
          onResult(null, res.statusCode);
        });
        req.on('error', (e) => onResult(e));
        req.setTimeout(intervalMs, () => {
          req.destroy();
          onResult(new Error('timeout'));
        });
      }
    };
    const retry = () => {
      if (Date.now() > deadline)
        return reject(new Error('server did not become ready in time'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * 60-line mock backend that emulates /api/auth/* + /api/health so the
 * Vite dev-server proxy has a real target. We don't validate JWTs — we
 * just return canned envelopes with the same shape the real server does.
 */
function bootMockBackend(port) {
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return send(200, {
          success: true,
          data: {
            status: 'ok',
            service: 'mock',
            version: '0.0.0-mock',
            uptimeSeconds: 0,
            db: { connected: true, host: 'mock', name: 'mock' },
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        return send(200, {
          success: true,
          data: {
            user: { id: 'mock', name: 'Mock', email: 'mock@example.com', role: 'OWNER' },
            token: 'mock.jwt.token',
          },
        });
      }
      if (url.pathname === '/api/auth/me' && req.method === 'GET') {
        return send(200, {
          success: true,
          data: { user: { id: 'mock', name: 'Mock', email: 'mock@example.com', role: 'OWNER' } },
        });
      }
      send(404, { success: false, message: 'not found in mock' });
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function cleanup(...handles) {
  for (const h of handles) {
    if (!h) continue;
    try {
      if (typeof h.kill === 'function') h.kill('SIGTERM');
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    try {
      if (typeof h.close === 'function') await new Promise((r) => h.close(r));
    } catch {}
  }
}

async function run() {
  // ── 1. Build sanity ─────────────────────────────────────────────────────
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
    assert(result.code === 0, '`npm run build` exits 0');
    assert(fs.existsSync(DIST_INDEX), 'dist/index.html exists');
    const indexHtml = fs.readFileSync(DIST_INDEX, 'utf8');
    assert(/<div id="root">/.test(indexHtml), 'index.html has #root mount');
    assert(/src="\/assets\//.test(indexHtml), 'index.html references a hashed JS asset');

    const assets = fs.existsSync(DIST_ASSETS) ? fs.readdirSync(DIST_ASSETS) : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    assert(jsAssets.length > 0, 'dist/assets has at least one .js bundle');
    // Confirm the new Login/Register pages are inside the bundle. The bundle
    // is minified, so we look for the most stable strings — the form labels.
    const allJs = jsAssets.map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8')).join('\n');
    assert(/Log in/.test(allJs), 'bundle contains Login page copy ("Log in")');
    assert(/Create an account/.test(allJs), 'bundle contains Register page copy');
  }

  // ── 2. Static role-escalation guard ────────────────────────────────────
  section('2. Role escalation guard');
  {
    // Read the source file directly — dist is minified, so we can't regex
    // against it. The RegisterPage must not iterate over MODERATOR/ADMIN
    // values when rendering options.
    const src = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/pages/RegisterPage.jsx'),
      'utf8'
    );
    assert(
      /PUBLIC_REGISTRATION_ROLES\.map/.test(src),
      'RegisterPage iterates PUBLIC_REGISTRATION_ROLES (the constant)'
    );
    // Sanity: the constant source itself is loaded.
    const constSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/utils/constants.js'),
      'utf8'
    );
    const publicRolesMatch = constSrc.match(
      /PUBLIC_REGISTRATION_ROLES\s*=\s*Object\.freeze\(\[(.*?)\]\)/s
    );
    assert(publicRolesMatch, 'PUBLIC_REGISTRATION_ROLES constant is exported');
    const listed = publicRolesMatch[1];
    assert(!/MODERATOR/.test(listed), 'PUBLIC_REGISTRATION_ROLES does not contain MODERATOR');
    assert(!/ADMIN/.test(listed), 'PUBLIC_REGISTRATION_ROLES does not contain ADMIN');
  }

  // ── 3. Dev server + mock backend end-to-end ────────────────────────────
  section('3. Dev server boot + mock backend wiring');
  let mockServer;
  let devServer;
  try {
    const mockPort = await getFreePort();
    const devPort = await getFreePort();
    mockServer = await bootMockBackend(mockPort);
    console.log('  mock backend listening on', mockPort);

    devServer = spawn(
      'npm',
      ['run', 'dev', '--', '--port', String(devPort), '--strictPort', '--host', '127.0.0.1'],
      {
        cwd: CLIENT_ROOT,
        env: {
          ...process.env,
          VITE_API_PROXY_TARGET: `http://127.0.0.1:${mockPort}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      }
    );
    devServer.stdout.on('data', (c) => process.stdout.write('  [vite] ' + c.toString()));
    devServer.stderr.on('data', (c) => process.stderr.write('  [vite!] ' + c.toString()));

    const status = await waitForServer([
      `http://127.0.0.1:${devPort}/`,
      `http://localhost:${devPort}/`,
    ], {
      timeoutMs: 60_000,
    });
    assert(status === 200, 'GET / on Vite dev server returns 200');

    // Smoke the proxy: /api/health on the dev server should hit the mock.
    // Try both 127.0.0.1 and localhost — Vite binds to whichever its
    // host param resolves to first; we hit whichever the wait succeeded on.
    const apiUrl =
      status === 200
        ? `http://127.0.0.1:${devPort}/api/health`
        : `http://localhost:${devPort}/api/health`;
    await new Promise((resolve, reject) => {
      const req = http.get(apiUrl, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const body = JSON.parse(buf);
            assert(
              body && body.data && body.data.status === 'ok',
              '/api/health via Vite proxy returns mock payload'
            );
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
    });
  } finally {
    await cleanup(devServer, mockServer);
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
})();