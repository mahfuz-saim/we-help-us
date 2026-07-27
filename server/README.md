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

Feature endpoints land in later modules (auth, areas, resources, requests,
moderator, notifications, analytics).

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

Tunables (all optional, see `.env.example`):

- `DB_SERVER_SELECTION_TIMEOUT_MS` (default 10000)
- `DB_CONNECT_TIMEOUT_MS` (default 10000)
- `DB_MAX_RETRIES` (default 5, dev-only)

The `/api/health` route reports the live `db.connected` flag plus the
connection `host` and `name` so operators can verify Atlas wiring at a
glance.

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