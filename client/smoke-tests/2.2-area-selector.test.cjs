/**
 * End-to-end smoke test for Module 2.2 — AreaSelector.
 *
 * Scope:
 *   1. Vite production build succeeds with the AreaSelector wired into
 *      ProfilePage via react-hook-form Controller.
 *   2. Static guards:
 *      - Bundle contains the three tab labels ("By hierarchy",
 *        "Search address", "Pick on map") so the UI is reachable.
 *      - AreaSelector emits areaId/lng/lat/areaLabel via onChange
 *        (the wiring into the form).
 *      - ProfilePage no longer has raw lng/lat inputs (the
 *        interactive picker replaced them).
 *      - ProfilePage no longer claims the selector "lands in 2.2".
 *      - Leaflet CSS is imported in index.css so the map renders.
 *      - useAreas + useNominatimSearch hooks exist with the right keys.
 *      - AREA_LEVELS / DEFAULT_MAP_CENTER constants are present.
 *      - ProfilePage sends areaId + GeoJSON Point on save.
 *   3. Dev server boot + mock backend with /api/areas (cascading
 *      queries) so the dev server boot still works and the proxy
 *      serves the area tree.
 *
 * Run: `node smoke-tests/2.2-area-selector.test.cjs` from `client/`.
 * Exit code 0 = all assertions passed, non-zero = first failure.
 */

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const url = require('node:url');

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
 * A small in-memory area tree for the mock backend. Mirrors the
 * Module 2.1 cascading shape: {data:{areas:[{id,country,level,name,parentId}], count}}.
 *
 * Structure:
 *   - 1 district (D1 "Dhaka")
 *   - 1 upazila   (U1 "Mirpur")
 *   - 1 union     (UN1 "Mirpur-1")
 *   - 1 ward      (W1 "Ward 1")
 *   - 1 village   (V1 "Village A")
 */
const AREAS = [
  { id: 'D1', country: 'Bangladesh', level: 'DISTRICT', name: 'Dhaka',   parentId: null },
  { id: 'U1', country: 'Bangladesh', level: 'UPAZILA',  name: 'Mirpur',  parentId: 'D1' },
  { id: 'UN1', country: 'Bangladesh', level: 'UNION',    name: 'Mirpur-1', parentId: 'U1' },
  { id: 'W1', country: 'Bangladesh', level: 'WARD',     name: 'Ward 1',  parentId: 'UN1' },
  { id: 'V1', country: 'Bangladesh', level: 'VILLAGE',  name: 'Village A', parentId: 'W1' },
];

function listAreas(query) {
  const params = new URLSearchParams(query || {});
  const level = params.get('level');
  const parent = params.get('parent');
  let filtered = AREAS;
  if (level) filtered = filtered.filter((a) => a.level === level);
  if (parent) filtered = filtered.filter((a) => a.parentId === parent);
  return filtered;
}

function bootMockBackend(port) {
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      const parsed = url.parse(req.url, true);
      const pathname = parsed.pathname;
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };

      if (pathname === '/api/health' && req.method === 'GET') {
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
      if (pathname === '/api/auth/me' && req.method === 'GET') {
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
      if (pathname === '/api/areas' && req.method === 'GET') {
        const areas = listAreas(parsed.query);
        return send(200, {
          success: true,
          data: { areas, count: areas.length },
        });
      }
      if (pathname === '/api/users/me' && req.method === 'PATCH') {
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
              areaId: body.areaId || null,
              location: body.location || null,
            },
          },
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
    // Tab labels survive minification (string literals).
    assert(/By hierarchy/.test(allJs), 'bundle contains "By hierarchy" tab label');
    assert(/Search address/.test(allJs), 'bundle contains "Search address" tab label');
    assert(/Pick on map/.test(allJs), 'bundle contains "Pick on map" tab label');
    // OpenStreetMap attribution is rendered by the TileLayer.
    assert(/OpenStreetMap/.test(allJs), 'bundle references OpenStreetMap attribution');
    // The ProfilePage keeps its stable copy.
    assert(/Save changes/.test(allJs), 'bundle contains "Save changes"');
  }

  // ── 2. Static guards ────────────────────────────────────────────────────
  section('2. Static guards');
  {
    const selectorSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/components/AreaSelector.jsx'),
      'utf8'
    );
    assert(/AreaSelector/.test(selectorSrc), 'AreaSelector.jsx exports AreaSelector');
    assert(
      /export default function AreaSelector/.test(selectorSrc),
      'AreaSelector.jsx has a default export'
    );
    // The three tabs must be defined.
    assert(
      /hierarchy/.test(selectorSrc) &&
        /search/.test(selectorSrc) &&
        /map/.test(selectorSrc),
      'AreaSelector defines hierarchy / search / map tabs'
    );
    // Cascading via useChildren.
    assert(
      /useChildren/.test(selectorSrc),
      'AreaSelector uses useChildren for cascading dropdowns'
    );
    // Debounced search via useNominatimSearch.
    assert(
      /useNominatimSearch/.test(selectorSrc),
      'AreaSelector uses useNominatimSearch'
    );
    // Leaflet map (MapContainer + TileLayer + Marker).
    assert(
      /MapContainer/.test(selectorSrc) &&
        /TileLayer/.test(selectorSrc) &&
        /Marker/.test(selectorSrc),
      'AreaSelector mounts MapContainer + TileLayer + Marker'
    );
    // onChange shape: { areaId, lng, lat, areaLabel }.
    assert(
      /areaId:\s*deepest\s*\?/.test(selectorSrc) ||
        /areaId:.*deepest/s.test(selectorSrc),
      'AreaSelector emits areaId from deepest selection'
    );
    assert(
      /lng:\s*pin\s*\?/.test(selectorSrc) || /lng:.*pin/s.test(selectorSrc),
      'AreaSelector emits lng from map pin'
    );
    assert(
      /lat:\s*pin\s*\?/.test(selectorSrc) || /lat:.*pin/s.test(selectorSrc),
      'AreaSelector emits lat from map pin'
    );
    assert(/areaLabel:/.test(selectorSrc), 'AreaSelector emits areaLabel');
    // KEY DESIGN REMINDER: no silent geolocation.
    assert(
      !/navigator\.geolocation/.test(selectorSrc),
      'AreaSelector does NOT call navigator.geolocation silently'
    );

    // ── Hooks ─────────────────────────────────────────────────────────────
    const areasHookSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/hooks/useAreas.js'),
      'utf8'
    );
    assert(/useDistricts/.test(areasHookSrc), 'useAreas exports useDistricts');
    assert(/useChildren/.test(areasHookSrc), 'useAreas exports useChildren');
    assert(
      /queryKey:\s*\[\s*['"]areas['"]/.test(areasHookSrc),
      'useAreas uses queryKey prefix ["areas", ...]'
    );
    assert(
      /\/areas/.test(areasHookSrc),
      'useAreas calls the /areas endpoint'
    );

    const nominatimSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/hooks/useNominatimSearch.js'),
      'utf8'
    );
    assert(/nominatim/i.test(nominatimSrc), 'useNominatimSearch targets Nominatim');
    assert(
      /countrycodes/.test(nominatimSrc),
      'useNominatimSearch biases by countrycodes (bd)'
    );
    assert(
      /bd/.test(nominatimSrc),
      'useNominatimSearch defaults countrycodes to "bd"'
    );
    assert(
      /DEBOUNCE_MS|debounce|setTimeout/.test(nominatimSrc),
      'useNominatimSearch debounces requests'
    );

    // ── Constants ─────────────────────────────────────────────────────────
    const constantsSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/utils/constants.js'),
      'utf8'
    );
    assert(
      /DISTRICT/.test(constantsSrc) &&
        /UPAZILA/.test(constantsSrc) &&
        /UNION/.test(constantsSrc) &&
        /WARD/.test(constantsSrc) &&
        /VILLAGE/.test(constantsSrc),
      'constants.js exports all five AREA_LEVELS'
    );
    assert(
      /DEFAULT_MAP_CENTER/.test(constantsSrc),
      'constants.js exports DEFAULT_MAP_CENTER'
    );
    assert(
      /DEFAULT_MAP_ZOOM/.test(constantsSrc),
      'constants.js exports DEFAULT_MAP_ZOOM'
    );

    // ── Leaflet CSS imported ──────────────────────────────────────────────
    const indexCss = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/index.css'),
      'utf8'
    );
    assert(
      /leaflet\/dist\/leaflet\.css/.test(indexCss),
      'index.css imports leaflet/dist/leaflet.css'
    );

    // ── ProfilePage integration ───────────────────────────────────────────
    const profileSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/pages/ProfilePage.jsx'),
      'utf8'
    );
    assert(
      /import AreaSelector/.test(profileSrc),
      'ProfilePage imports AreaSelector'
    );
    assert(
      /Controller/.test(profileSrc),
      'ProfilePage uses react-hook-form Controller to bind AreaSelector'
    );
    // Raw lng/lat inputs are GONE — the interactive picker replaced them.
    assert(
      !/register\(\s*['"]lng['"]/.test(profileSrc),
      'ProfilePage no longer has a raw lng input'
    );
    assert(
      !/register\(\s*['"]lat['"]/.test(profileSrc),
      'ProfilePage no longer has a raw lat input'
    );
    // The old "lands in Module 2.2" copy is gone.
    assert(
      !/lands in Module 2\.2/.test(profileSrc),
      'ProfilePage no longer claims the selector "lands in 2.2"'
    );
    // PATCH /users/me still happens; new payload fields exist.
    assert(
      /api\.patch\(['"]\/users\/me['"]/.test(profileSrc),
      'ProfilePage PATCHes /api/users/me'
    );
    assert(
      /payload\.areaId/.test(profileSrc),
      'ProfilePage sends areaId in the PATCH payload'
    );
    assert(
      /payload\.location/.test(profileSrc) &&
        /type:\s*['"]Point['"]/.test(profileSrc),
      'ProfilePage sends a GeoJSON Point location'
    );
    // The onSave submit handler still refreshes the user.
    assert(
      /refreshUser\s*\(\s*\)/.test(profileSrc),
      'ProfilePage still calls refreshUser() after save'
    );

    // ── App.jsx still wires ProfilePage ───────────────────────────────────
    const appSrc = fs.readFileSync(
      path.join(CLIENT_ROOT, 'src/App.jsx'),
      'utf8'
    );
    assert(/<ProfilePage\s*\/>/.test(appSrc), 'App.jsx renders <ProfilePage />');
  }

  // ── 3. Dev server + mock backend (areas endpoint) ──────────────────────
  section('3. Dev server boot + mock /api/areas wiring');
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

    // GET /api/areas (top-level) → only the district.
    await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${devPort}/api/areas?level=DISTRICT`,
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              const body = JSON.parse(buf);
              assert(
                body && body.data && body.data.areas && body.data.areas.length === 1,
                'GET /api/areas?level=DISTRICT returns 1 area'
              );
              assert(
                body.data.areas[0].name === 'Dhaka',
                'GET /api/areas?level=DISTRICT returns Dhaka'
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
    });

    // GET /api/areas?parent=D1 → only the upazila child.
    await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${devPort}/api/areas?parent=D1`,
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              const body = JSON.parse(buf);
              assert(
                body && body.data && body.data.areas && body.data.areas.length === 1,
                'GET /api/areas?parent=D1 returns 1 child (Mirpur upazila)'
              );
              assert(
                body.data.areas[0].level === 'UPAZILA',
                'child of D1 is at UPAZILA level'
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
    });

    // GET /api/areas?parent=W1 → only the village child.
    await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${devPort}/api/areas?parent=W1`,
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              const body = JSON.parse(buf);
              assert(
                body && body.data && body.data.areas && body.data.areas.length === 1,
                'GET /api/areas?parent=W1 returns 1 child (Village A)'
              );
              assert(
                body.data.areas[0].level === 'VILLAGE',
                'child of W1 is at VILLAGE level'
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
    });

    // /api/users/me PATCH via proxy round-trips the new area payload.
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        name: 'Mock User',
        email: 'mock@example.com',
        phone: '+8801712345000',
        areaId: 'V1',
        location: { type: 'Point', coordinates: [90.4125, 23.8103] },
      });
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
                parsed && parsed.data && parsed.data.user,
                'PATCH /api/users/me returns the updated user'
              );
              assert(
                parsed.data.user.areaId === 'V1',
                'PATCH /api/users/me round-trips areaId'
              );
              assert(
                parsed.data.user.location &&
                  parsed.data.user.location.type === 'Point',
                'PATCH /api/users/me round-trips GeoJSON Point location'
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
