# We Help Us — Client

Frontend for the **We Help Us** community-resource and disaster-coordination
platform. Built with **Vite + React 19 + Tailwind v4 + React Router v7**.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then fill in VITE_API_URL etc. Defaults already point to the Vite dev
# proxy which forwards /api and /socket.io to http://localhost:5000.

# 3. Run
npm run dev      # http://localhost:5173

# 4. Build & preview production
npm run build
npm run preview
```

## Folder Layout

```
client/
├── index.html
├── vite.config.js              # Vite + React + Tailwind v4 plugin
├── src/
│   ├── main.jsx                # Entry — providers (Query, Router, Auth, Toaster)
│   ├── App.jsx                 # Route tree
│   ├── index.css               # Tailwind v4 import + @theme tokens
│   ├── components/
│   │   ├── ProtectedRoute.jsx  # Role-aware route guard
│   │   └── RoleBadge.jsx
│   ├── context/
│   │   └── AuthContext.jsx     # user / token / login / register / logout
│   ├── hooks/
│   │   └── useAuth.js          # Re-export of AuthContext's useAuth
│   ├── layouts/
│   │   └── MainLayout.jsx      # Header + Outlet + footer
│   ├── pages/
│   │   ├── HomePage.jsx
│   │   ├── LoginPage.jsx       # Placeholder (Module 1.3)
│   │   ├── RegisterPage.jsx    # Placeholder — documents the OWNER/VOLUNTEER-only rule
│   │   ├── HealthPage.jsx      # Calls GET /api/health
│   │   └── NotFoundPage.jsx
│   ├── services/
│   │   ├── api.js              # Axios instance + token interceptor + error normalization
│   │   └── socket.js           # socket.io-client singleton
│   └── utils/
│       ├── constants.js        # Roles, categories, statuses, upload limits
│       └── leaflet-icons.js    # Vite-compatible Leaflet default icon paths
```

## Routing

Routes are mounted inside `<MainLayout>` so every page gets the header and
footer. Protected routes use `<ProtectedRoute roles={[...]}/>`:

- `/`                       — Home
- `/login`                  — Login (Module 1.3)
- `/register`               — Register (Module 1.3)
- `/profile`                — Protected; any authed user
- `/owner/resources`        — Protected; OWNER only
- `/volunteer/requests`     — Protected; VOLUNTEER only
- `/moderator`              — Protected; MODERATOR or ADMIN
- `/health`                 — Backend health probe (calls `/api/health`)
- `*`                       — 404

## Tailwind Theme

Disaster-response palette is declared in `src/index.css` under `@theme`:

| Family   | Use case                                     |
|----------|----------------------------------------------|
| `alert`  | Emergency, unavailable, critical            |
| `safe`   | Available, verified, success                 |
| `caution`| Pending, limited, warning                    |
| `brand`  | Primary brand color                          |
| `slate`  | Neutrals (provided by Tailwind v4 default)   |

Example: `bg-alert-700`, `text-safe-600`, `ring-caution-200`.

## Role Registration Rule

Per `plan.txt` KEY DESIGN REMINDERS, **public registration is OWNER/VOLUNTEER
only**. `MODERATOR` and `ADMIN` accounts must be created via the protected
`POST /api/admin/create-privileged-user` route or a seed script. The
`AuthContext.register()` helper strips any non-public role from the payload
as defense-in-depth.

## Upload Limits (used by Module 3.4 — kept in sync with server)

`src/utils/constants.js → UPLOAD_LIMITS` mirrors the server-side
enforcement in `server/middlewares/upload.js`:

- **Max files:** 5
- **Max size per file:** 5 MB
- **Accepted types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`

## Notes

- Leaflet default marker icons are fixed via `src/utils/leaflet-icons.js`
  — pages that mount `<Marker>` should `import '../utils/leaflet-icons'`
  once (the module applies the fix on import).
- The Vite dev server proxies `/api` and `/socket.io` to the backend (default
  `http://localhost:5000`).
- `socket.io-client` is lazy-initialised and does not auto-connect until
  Module 7.4 wires the real auth handshake.