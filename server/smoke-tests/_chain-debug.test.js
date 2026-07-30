/**
 * Debug script: spin up the real Express app + in-memory Mongo, seed
 * the Area collection, then hit GET /api/areas/:id in three scenarios:
 *   - no Authorization header
 *   - with a bogus Bearer token
 *   - unknown (but well-formed) area id → 404 path
 *   - valid id → chain path
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';

const { createApp } = require('../app');
const { seedAreas } = require('../utils/seedAreas');

let mongo;
let server;
let baseUrl;

function http_(method, path, headers = {}) {
  const url = new URL(baseUrl + path);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: { ...headers } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {
            /* keep null */
          }
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    await seedAreas();

    // List districts so we can pick a real id.
    const districts = await http_('GET', '/api/areas?level=DISTRICT');
    const dhaka = districts.body.data.areas.find((a) => a.name === 'Dhaka');
    const firstUpazila = await http_(
      'GET',
      `/api/areas?level=UPAZILA&parent=${dhaka.id}`
    );
    const upazila = firstUpazila.body.data.areas[0];
    // Walk down to a VILLAGE properly: dhaka -> upazila -> union -> ward -> village
    const upazilas = (await http_('GET', `/api/areas?parent=${dhaka.id}`)).body.data.areas;
    const u = upazilas[0];
    const unions = (await http_('GET', `/api/areas?parent=${u.id}`)).body.data.areas;
    const un = unions[0];
    const wards = (await http_('GET', `/api/areas?parent=${un.id}`)).body.data.areas;
    const w = wards[0];
    const villages = (await http_('GET', `/api/areas?parent=${w.id}`)).body.data.areas;
    const village = villages[0];

    console.log('--- A) NO auth header, real DISTRICT id ---');
    const a = await http_('GET', `/api/areas/${dhaka.id}`);
    console.log(a.status, JSON.stringify(a.body, null, 2));

    console.log('--- B) bogus Bearer token, real VILLAGE id ---');
    const b = await http_('GET', `/api/areas/${village.id}`, {
      Authorization: 'Bearer this-is-not-a-real-token',
    });
    console.log(b.status, JSON.stringify(b.body, null, 2));

    console.log('--- C) Unknown area id (well-formed ObjectId) ---');
    const fakeId = '64a0000000000000000000ff';
    const c = await http_('GET', `/api/areas/${fakeId}`);
    console.log(c.status, JSON.stringify(c.body, null, 2));

    console.log('--- D) Malformed area id ---');
    const d = await http_('GET', `/api/areas/not-an-id`);
    console.log(d.status, JSON.stringify(d.body, null, 2));

    console.log('--- E) Full deep chain for VILLAGE id (5 levels) ---');
    const e = await http_('GET', `/api/areas/${village.id}`);
    console.log(e.status, JSON.stringify(e.body, null, 2));
  } catch (err) {
    console.error('FATAL', err);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    if (mongo) await mongo.stop();
  }
})();
