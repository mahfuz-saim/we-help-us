# We Help Us — Server

Node.js + Express + MongoDB backend for the **We Help Us** community-resource
and disaster-coordination platform.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then fill in MONGODB_URI, JWT_SECRET, CLOUDINARY_* etc.

# 3. Run
npm run dev      # nodemon, hot-reload
# or
npm start        # plain node
```

Default port: **5000** (override with `PORT`).

## Endpoints

| Method | Path             | Description                |
|--------|------------------|----------------------------|
| GET    | `/`              | Service banner             |
| GET    | `/api/health`    | Health check (no auth)     |
| GET    | `/api/areas`     | Cascading dropdown query (Module 2.1, no auth) |

Feature endpoints land in later modules (resources, requests, moderator,
notifications, analytics).

### `GET /api/areas`

Public reference-data endpoint. Powers the cascading administrative
dropdown (district → upazila → union → ward → village). No auth required —
areas are not PII.

Query parameters (at least one is required):

| Param    | Type     | Notes                                                     |
|----------|----------|-----------------------------------------------------------|
| `level`  | enum     | `DISTRICT \| UPAZILA \| UNION \| WARD \| VILLAGE`        |
| `parent` | ObjectId | 24-char hex id of the parent area                         |

Examples:

```bash
# All top-level districts
curl 'http://localhost:5000/api/areas?level=DISTRICT'

# All upazilas under a specific district
curl 'http://localhost:5000/api/areas?level=UPAZILA&parent=<districtId>'

# All children of a node regardless of level
curl 'http://localhost:5000/api/areas?parent=<districtId>'
```

Response shape:

```json
{
  "success": true,
  "data": {
    "areas": [
      {
        "id": "64a0...",
        "country": "Bangladesh",
        "level": "UPAZILA",
        "name": "Dhaka North",
        "parentId": "64a0..."
      }
    ],
    "count": 3
  },
  "message": "Areas fetched"
}
```

### Seeding the Bangladesh hierarchy

The server auto-seeds the `areas` collection on first boot when it's
empty (see `server.js` → `seedAreasIfEmpty()`). You normally don't
need to do anything — just start the server and the cascading
dropdown in the profile page will have data.

To force a fresh seed (e.g. after editing the district list), run:

```bash
node scripts/seed-areas.js
```

To disable auto-seed in a specific environment, set
`SKIP_AREA_AUTOSEED=1` before starting the server.

The script is destructive: it wipes the `areas` collection and re-inserts
the full hierarchy (64 districts + 3 upazilas per district + 2 unions per
upazila + 2 wards per union + 2 villages per ward ≈ 2,944 nodes).

## MongoDB Connection (Module 0.4)

`server/config/db.js` wires up the Mongoose connection on boot:

- **Production (`NODE_ENV=production`)**: missing or unreachable `MONGODB_URI`
  is **fatal** — the server exits with code 1. No traffic without a DB.
- **Development**: missing `MONGODB_URI` warns and boots anyway (so the
  health route still works). Unreachable URI is retried with exponential
  backoff (default 5 attempts, configurable via `DB_MAX_RETRIES`); if all
  fail, the server continues with `db.connected=false`.

Connection events (`connected`, `reconnected`, `disconnected`, `error`,
`close`) are logged through the standard `console` interface. The Mongo
URI is masked in logs (`mongodb://user:***@host`).

Connection errors are classified in `describeConnectionError()` and the
result is included in every log/throw so the operator immediately knows
what kind of failure they hit:

- **SRV / DNS** — `mongodb+srv://` URI failed to resolve. Common on Node 24
  + Windows where the c-ares resolver returns `ECONNREFUSED` even when
  `nslookup` works. **Fix:** switch to the non-SRV (direct) connection
  string from Atlas.
- **Atlas IP whitelist** — the driver explicitly mentions "IP that isn't
  whitelisted". **Fix:** Atlas → Network Access → add your IP (or
  `0.0.0.0/0` for development).
- **Auth** — wrong username/password in the URI.
- **Network** — `ETIMEDOUT`, `ECONNRESET`, `EHOSTUNREACH`.

Tunables (all optional, see `.env.example`):

- `DB_SERVER_SELECTION_TIMEOUT_MS` (default 10000)
- `DB_CONNECT_TIMEOUT_MS` (default 10000)
- `DB_MAX_RETRIES` (default 5, dev-only)

The `/api/health` route reports the live `db.connected` flag plus the
connection `host` and `name` so operators can verify Atlas wiring at a
glance.

### Quick troubleshooting recipe

1. Look at the server's `[db]` log lines — they already classify the error.
2. If you see `querySrv ECONNREFUSED` → switch `MONGODB_URI` to the
   non-SRV direct form from Atlas.
3. If you see "IP that isn't whitelisted" → add your IP in
   Atlas → Network Access.
4. If you see `Authentication failed` → check the username/password.
5. Otherwise, check `curl /api/health` — its `db` field tells you the live
   state regardless of whether the boot succeeded.

## Folder Layout

```
server/
├── app.js                  # Express app factory (no port binding)
├── server.js               # HTTP + Socket.io entry point
├── config/
│   ├── db.js               # MongoDB connection (Module 0.4)
│   └── cloudinary.js       # Cloudinary SDK configuration
├── controllers/            # Feature controllers (added per module)
├── middlewares/
│   ├── auth.js             # protect / authorize stubs (Module 1.2)
│   ├── validate.js         # Zod validator factory
│   ├── rateLimit.js        # authLimiter + globalLimiter
│   ├── upload.js           # Multer — enforces 5-file / 5MB / image-only rule
│   ├── notFound.js
│   └── errorHandler.js
├── models/                 # Mongoose models (added per module)
├── routes/
│   ├── health.routes.js
│   └── index.js            # Central router (mounts feature routers)
├── sockets/
│   └── index.js            # Socket.io bootstrap (full logic in Module 7.4)
└── utils/
    ├── apiError.js
    ├── apiResponse.js
    ├── asyncHandler.js
    └── jwt.js              # signJwt/verifyJwt stubs (Module 1.2)
```

## Upload Limits (enforced by `middlewares/upload.js`)

- **Max files per request:** 5
- **Max size per file:** 5 MB
- **Allowed mime types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`

These match the `KEY DESIGN REMINDERS` section of `plan.txt` and are mirrored
on the client in Module 3.4.

## Role-based Access (Module 1.2 onwards)

Public registration only creates **OWNER** or **VOLUNTEER** accounts.
`MODERATOR` and `ADMIN` accounts can only be created via the protected
`POST /api/admin/create-privileged-user` route or the seed script.