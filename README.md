# We Help Us

> *"When disaster strikes, communities save themselves first."*

**We Help Us** is a Community Resource Intelligence & Emergency Coordination Platform that lets communities map, share, and request critical resources (transport, rescue equipment, medical supplies, infrastructure, utilities, skilled professionals) during disasters and day-to-day coordination.

The project is being built module-by-module following `plan.txt`, with progress tracked in `progress.txt`. (These planning files are intentionally git-ignored.)

---

## Repository Layout

This is a **monorepo** with two main packages:

```
.
├── client/   # Frontend — Vite + React + Tailwind
├── server/   # Backend  — Node.js + Express + MongoDB (Mongoose)
├── .gitignore
└── README.md
```

`plan.txt` and `progress.txt` at the repo root are working documents for the implementation agent and are excluded from version control.

---

## Tech Stack

| Layer        | Choice                                                   |
|--------------|----------------------------------------------------------|
| Frontend     | Vite, React, Tailwind CSS, React Router                  |
| State / Data | TanStack Query, React Hook Form                          |
| Maps         | Leaflet + react-leaflet (OpenStreetMap tiles)            |
| Realtime     | Socket.io (`socket.io-client`)                           |
| HTTP         | Axios (with token interceptor)                           |
| Backend      | Node.js, Express, Mongoose                               |
| Auth         | JWT (single access token, 7-day expiry), bcryptjs        |
| Uploads      | Multer + Cloudinary                                      |
| Validation   | Zod                                                      |
| Security     | Helmet, express-rate-limit, CORS whitelist               |
| Database     | MongoDB Atlas                                            |
| Deploy       | Vercel (client) + Railway/Render (server)                |

---

## Quick Start (after Module 0.2 / 0.3 land)

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install

# 2. Set up environment files
cp server/.env.example server/.env
cp client/.env.example client/.env
# then fill in real values (Mongo URI, JWT secret, Cloudinary keys, etc.)

# 3. Run both apps (in separate terminals)
# Terminal A
cd server && npm run dev

# Terminal B
cd client && npm run dev
```

Default ports: server `5000`, client `5173`.

---

## Development Workflow

- Default working branch: **`develop`**
- Production / protected branch: **`main`**
- Branch naming: `feature/module-X.Y-short-description`
- Commit convention: `<type>(<scope>): <summary>`
  - `feat(server): ...`, `feat(client): ...`, `fix(...)`, `chore(...)`, `docs(...)`, `style(...)`, `refactor(...)`, `test(...)`
- One module per commit; push to `develop` after every completed module.

See `plan.txt` (git-ignored, in this repo only) for the full phased roadmap and `progress.txt` for live status.

---

## Roles

Public registration creates only **OWNER** or **VOLUNTEER** accounts. **MODERATOR** and **ADMIN** accounts can only be created via:

- the protected `POST /api/admin/create-privileged-user` endpoint (ADMIN-only), or
- the seed script shipped with the documentation/demo-data module.

This is a hard privacy/safety rule of the platform.

---

## License

MIT License
