# Contributing to We Help Us

Thank you for contributing. This document describes the day-to-day workflow
we follow to keep `we-help-us` shippable, reviewable, and traceable.

> The full phased roadmap lives in `plan.txt` (git-ignored — kept at the
> repo root for the implementation agent). Live module status lives in
> `progress.txt`. Both are ignored on purpose: they're planning artifacts,
> not part of the product.

---

## 1. Branches

| Branch   | Purpose                                                | Lifetime                |
|----------|--------------------------------------------------------|-------------------------|
| `main`   | Production-ready code. **Protected.**                  | Permanent, fast-forward only |
| `develop`| Default working branch. All feature work lands here.  | Permanent                |
| `feature/...` | Short-lived feature branches, branched off `develop`. | Merged via PR, then deleted |

### Branch naming convention

```
feature/module-X.Y-short-description
```

- Lower-case, hyphen-separated.
- The `module-X.Y` token ties the branch to a specific module in `plan.txt`
  so review and commit history stay traceable to the roadmap.
- The trailing description is a 2–5 word slug of what the module does.
- Examples:
  - `feature/module-1.2-auth-apis`
  - `feature/module-3.1-resource-model`
  - `feature/module-3.4-registration-form`

### Long-running branches (only when really needed)

- `release/x.y` — short-lived release prep, branched off `develop`,
  merged to both `main` (tagged) and `develop` (so fixes are not lost).
- `hotfix/x.y.z-description` — urgent fix off `main`, merged back to both
  `main` and `develop`.

We use these rarely; the default is one feature branch per module.

### Branch protection (recommended GitHub settings)

- `main`
  - Require pull-request reviews before merging.
  - Require status checks (CI) to pass.
  - Require linear history (no merge commits from PRs).
  - Restrict who can push.
- `develop`
  - Require status checks to pass.
  - No direct pushes from contributors without review.

---

## 2. Commit messages

We follow **Conventional Commits** with a scope that names the affected
package. The format is:

```
<type>(<scope>): <short summary>

[optional body — wrap at 72 chars]

[optional footer(s)]
```

### Types

| Type       | When to use                                                   |
|------------|---------------------------------------------------------------|
| `feat`     | A new user-visible feature                                    |
| `fix`      | A bug fix                                                     |
| `chore`    | Tooling, config, dependencies, build infra                    |
| `docs`     | Documentation only                                            |
| `style`    | Formatting only (no behavior change)                          |
| `refactor` | Code restructure without behavior change                      |
| `test`     | Adding or fixing tests                                        |
| `perf`     | Performance improvement                                       |

### Scopes

| Scope       | Path           |
|-------------|----------------|
| `server`    | `server/`      |
| `client`    | `client/`      |
| `root`      | repo-root changes (CI, docs, .gitignore, etc.) |

Omit the scope only when the change truly spans the whole repo.

### Summary line

- Imperative mood ("add", not "added" or "adds").
- Lower-case.
- No trailing period.
- ≤ 72 characters.

### Examples

```
feat(server): implement JWT-based authentication APIs
feat(client): build multi-step resource registration form
fix(client): correct map marker color on unavailable status
docs: add contribution and commit conventions
chore(server): bump mongoose to 9.8
```

The module-by-module commit messages listed in `plan.txt` (e.g.,
`chore: initialize monorepo structure for We Help Us`) are the canonical
examples to follow.

---

## 3. Pull request workflow

1. Branch off `develop`: `git checkout -b feature/module-X.Y-slug develop`.
2. Implement **one module at a time**. Do not batch multiple modules
   into a single PR — that bloats review and makes `git bisect` useless.
3. Run the **POST-MODULE CHECKLIST** (below) before committing.
4. Use the exact commit message prescribed by the module spec in
   `plan.txt`. The agent writes this commit, not a human-derived
   paraphrase.
5. Push: `git push -u origin feature/module-X.Y-slug`.
6. Open a PR targeting `develop`. PR title should match the commit summary.
7. After approval, **squash-merge** into `develop` so each module is one
   clean commit on `develop`.
8. After a batch of modules is ready for a release, open a `develop` → `main`
   PR, get a second review, and merge with a merge commit (preserves the
   module history on `main`).

### POST-MODULE CHECKLIST (run after EVERY module)

- [ ] Code tested locally (manual or automated)
- [ ] No console errors / no broken imports
- [ ] Git: stage specific files (no `git add .` or `git add -A`)
- [ ] Git: commit with conventional message — exact text from `plan.txt`
- [ ] Git: push to remote `develop` branch
- [ ] Mark module as done in `progress.txt` (`[x]`, log entry, advance
      `NEXT MODULE TO IMPLEMENT`)
- [ ] No secrets (`.env`) committed — `.env.example` only

---

## 4. Project rules (must hold at all times)

These rules come from `plan.txt` → **KEY DESIGN REMINDERS**. They are
non-negotiable and apply to every PR regardless of scope.

- **Privacy** — *never* expose owner contact information until a resource
  request is `APPROVED` **and** `COLLECTED`. The reveal happens server-side
  (Module 5.2) and is mirrored in the frontend view (Module 4.2).
- **Role escalation** — public registration only creates `OWNER` or
  `VOLUNTEER` accounts. `MODERATOR` and `ADMIN` accounts are created only
  via the protected `POST /api/admin/create-privileged-user` endpoint
  (Module 1.2) or a seed script (Module 9.5). Never widen the registration
  form to allow privileged roles.
- **Photo uploads** — max **5** files per request, **5 MB** each, image
  MIME types only (`jpeg`, `jpg`, `png`, `webp`, `gif`). Enforced on both
  the server (`server/middlewares/upload.js`) and the client
  (`client/src/utils/constants.js → UPLOAD_LIMITS`).
- **Status flow** — `AVAILABLE → RESERVED → IN_USE → AVAILABLE` (after
  return). No skipping states. UI must reflect this.
- **Geospatial** — every location-based query uses a `2dsphere` index.
  Always store user/resource locations as GeoJSON `Point`s.
- **Role-based access** — every protected route enforces auth **at the
  API middleware level AND at the UI route-guard level**. A 403 in the
  network tab is not a substitute for a route guard, and a route guard
  is not a substitute for server-side enforcement.

---

## 5. Local development

See `client/README.md` and `server/README.md` for the per-package
walk-through. The short version:

```bash
# Backend
cd server
cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET, Cloudinary keys
npm install
npm run dev            # nodemon, http://localhost:5000

# Frontend (in another terminal)
cd client
cp .env.example .env
npm install
npm run dev            # vite, http://localhost:5173
# Vite proxies /api and /socket.io to the backend in dev.
```

---

## 6. Reporting issues

- Bugs and feature ideas → GitHub Issues.
- Security issues → email the maintainer directly (see README).
  **Do not** file public issues for suspected vulnerabilities.

---

## 7. License

By contributing, you agree that your contributions will be licensed under
the same license as the project (see `LICENSE`, to be added).