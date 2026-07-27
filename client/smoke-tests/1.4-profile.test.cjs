/**
 * End-to-end smoke test for Module 1.4 — ProfilePage.
 *
 * Scope: verifies the Vite SPA builds cleanly with the new ProfilePage
 * imported by App.jsx, and that the dev server + mock-backend wiring
 * works for the new endpoints (`GET /api/users/me`, `PATCH /api/users/me`,
 * `POST /api/users/me/avatar`).
 *
 * Run: `node smoke-tests/1.4-profile.test.cjs` from `client/`.
 * Exit code 0 = all assertions passed, non-zero = first failure.
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
 * Mock backend that handles /api/health, /api/auth/login + /me (1.3),
 * and the new /api/users/{me,me/avatar} endpoints (1.4).
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
      if (url.pathname === '/api/users/me' && req.method === 'GET') {
        return send(200, {
          success: true,
          data: {
            user: {
              id: 'mock',
              name: 'Mock User',
              email: 'mock@example.com',
              role: 'OWNER',
              phone: '+8801712345000',
              avatarUrl: null,
              isVerified: false,
              createdAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
            },
          },
        });
      }
      if (url.pathname === '/api/users/me' && req.method === 'PATCH') {
        let body = {};
        try { body = JSON.parse(buf || '{}'); } catch {}
        return send(200, {
          success: true,
          data: {
            user: {
              id: 'mock',
              name: body.name || 'Mock User',
              email: body.email || 'mock@example.com',
              role: 'OWNER',
              phone: body.phone || '+8801712345000',
              avatarUrl: null,
            },
          },
        });
      }
      if (url.pathname === '/api/users/me/avatar' && req.method === 'POST') {
        return send(503, {
          success: false,
          message: 'Cloudinary not configured (mock)',
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
    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');
    // The ProfilePage has stable copy. The bundle is minified, but
    // these strings survive minification.
    assert(/Save changes/.test(allJs), 'bundle contains "Save changes"');
    assert(/Upload avatar/.test(allJs), 'bundle contains "Upload avatar"');
    assert(/Profile/.test(allJs), 'bundle contains "Profile"');
  }

  // ── 2. Static role-escalation guard ────────────────────────────────────
  section('2. Static guards');
  {
    const profileSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/pages/ProfilePage.jsx'),
      'utf8'
    );
    assert(/ProfilePage/.test(profileSrc), 'ProfilePage.jsx exports ProfilePage');
    // Defense in depth: even though the server rejects these, the
    // client form should not even render a role/password input.
    assert(
      !/<input[^>]*name="role"/i.test(profileSrc),
      'ProfilePage does NOT render a role input'
    );
    assert(
      !/<input[^>]*type="password"/i.test(profileSrc),
      'ProfilePage does NOT render a password input (password change lands later)'
    );
    assert(
      /api\.patch\(['"]\/users\/me['"]/.test(profileSrc),
      'ProfilePage PATCHes /api/users/me'
    );
    assert(
      /api\.post\(['"]\/users\/me\/avatar['"]/.test(profileSrc),
      'ProfilePage POSTs avatar to /api/users/me/avatar'
    );

    const appSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/App.jsx'),
      'utf8'
    );
    assert(
      /<ProfilePage\s*\/>/.test(appSrc),
      'App.jsx renders <ProfilePage />'
    );
    assert(
      !/placeholder="Profile \(1\.4\)"/.test(appSrc),
      'App.jsx no longer references the Profile placeholder'
    );
  }

  // ── 3. Dev server + mock backend ──────────────────────────────────────
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

    const status = await waitForServer(
      [`http://127.0.0.1:${devPort}/`, `http://localhost:${devPort}/`],
      { timeoutMs: 60_000 }
    );
    assert(status === 200, 'GET / on Vite dev server returns 200');

    // /api/health via proxy
    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${devPort}/api/health`, (res) => {
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

    // /api/users/me via proxy
    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${devPort}/api/users/me`, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const body = JSON.parse(buf);
            assert(
              body && body.data && body.data.user && body.data.user.id === 'mock',
              '/api/users/me via Vite proxy returns mock user'
            );
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
    });

    // /api/users/me PATCH via proxy — round-trip the new endpoint.
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ name: 'Patched' });
      const req = http.request(
        `http://127.0.0.1:${devPort}/api/users/me`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(buf);
              assert(
                parsed && parsed.data && parsed.data.user && parsed.data.user.name === 'Patched',
                'PATCH /api/users/me via Vite proxy round-trips'
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
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