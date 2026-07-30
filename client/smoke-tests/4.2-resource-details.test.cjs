/**
 * End-to-end smoke test for Module 4.2 — Resource Details Page (client).
 *
 * What this validates:
 *   1. Vite production build succeeds with the new ResourceDetailsPage,
 *      useResource hook, and the updated SearchPage (now uses Link).
 *   2. App.jsx imports ResourceDetailsPage AND /resources/:id sits
 *      inside the auth-only ProtectedRoute.
 *   3. SearchPage renders cards as <Link to="/resources/:id"> so a
 *      user can drill into the details page.
 *   4. useResource.js exports the hook, uses useQuery, GETs the right
 *      URL, and respects the `enabled` flag.
 *   5. ResourceDetailsPage source defines Header/PhotoGallery/
 *      Description/DetailsGrid/ActionRow/VolunteerRequestCTA/
 *      LoadingState/ErrorBanner and renders every public field on
 *      the response. Privacy boundary: the page source does NOT
 *      access resource.owner.email / owner.phone / owner.name /
 *      resource.owner.
 *   6. Action row renders the volunteer-only "Request this resource"
 *      CTA (disabled — the request workflow ships in Phase 5).
 *
 * Run: `node smoke-tests/4.2-resource-details.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PAGE_PATH = path.join(CLIENT_ROOT, 'src/pages/ResourceDetailsPage.jsx');
const HOOK_PATH = path.join(CLIENT_ROOT, 'src/hooks/useResource.js');
const SEARCH_PATH = path.join(CLIENT_ROOT, 'src/pages/SearchPage.jsx');
const APP_PATH = path.join(CLIENT_ROOT, 'src/App.jsx');

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
    const assets = fs.existsSync(DIST_ASSETS) ? fs.readdirSync(DIST_ASSETS) : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    const cssAssets = assets.filter((f) => f.endsWith('.css'));
    assert(jsAssets.length > 0, 'dist/assets has at least one JS bundle');
    assert(cssAssets.length > 0, 'dist/assets has at least one CSS bundle');

    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // Page name + route are referenced.
    assert(
      /ResourceDetailsPage|['"`]resources\/:id['"`]/.test(allJs),
      'bundle references the new details page/route'
    );
    // Page copy.
    for (const label of [
      'Back to resources',
      'Description',
      'Details',
      'Need this resource',
      'Request this resource',
    ]) {
      assert(allJs.includes(label), `bundle contains copy "${label}"`);
    }
  }

  // ── 2. App.jsx wiring ───────────────────────────────────────────────
  section('2. App.jsx router wiring');
  {
    const appSrc = fs.readFileSync(APP_PATH, 'utf8');
    assert(
      /import\s+ResourceDetailsPage\s+from\s+['"]\.\/pages\/ResourceDetailsPage\.jsx['"]/.test(appSrc),
      'App.jsx imports ResourceDetailsPage'
    );
    assert(
      /path\s*=\s*['"]resources\/:id['"]/.test(appSrc),
      'App.jsx registers the /resources/:id route'
    );
    // Must be inside an auth-only ProtectedRoute (no `roles` prop).
    const guard = appSrc.match(
      /<Route\s+element=\{<ProtectedRoute\s*\/>\}>([\s\S]*?)<\/Route>/
    );
    assert(guard, 'auth-only ProtectedRoute exists');
    assert(
      /path\s*=\s*['"]resources\/:id['"]/.test(guard[1]),
      '/resources/:id sits under the auth-only ProtectedRoute'
    );
    // Profile + search still live there too (regression guards).
    assert(
      /path\s*=\s*['"]profile['"]/.test(guard[1]),
      '/profile still sits under the auth-only ProtectedRoute'
    );
    assert(
      /path\s*=\s*['"]resources['"]/.test(guard[1]),
      '/resources still sits under the auth-only ProtectedRoute'
    );
  }

  // ── 3. SearchPage cards are now clickable Link elements ─────────────
  section('3. SearchPage cards link to /resources/:id');
  {
    const src = fs.readFileSync(SEARCH_PATH, 'utf8');
    assert(
      /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*['"]react-router-dom['"]/.test(src),
      'SearchPage imports Link from react-router-dom'
    );
    // The card renders a <Link to={`/resources/${resource.id}`}>.
    assert(
      /to=\{`\/resources\/\$\{resource\.id\}`\}/.test(src),
      'ResourceCard builds a /resources/<id> link'
    );
    // Confirm the previous "no link" wording is gone.
    assert(
      !/Cards aren['`]t clickable/i.test(src),
      'SearchPage no longer says "cards aren\'t clickable"'
    );
    // And confirm SearchPage still does NOT touch owner contact info.
    // Strip comments first so documentation doesn't trip the regex.
    const searchCodeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/\bresource\.ownerId\b/.test(searchCodeOnly),
      'SearchPage still does NOT access resource.ownerId'
    );
    assert(!/owner\.email/.test(searchCodeOnly), 'SearchPage still does NOT access owner.email');
    assert(!/owner\.phone/.test(searchCodeOnly), 'SearchPage still does NOT access owner.phone');
    assert(!/\bresource\.owner\b/.test(searchCodeOnly), 'SearchPage still does NOT access resource.owner');
  }

  // ── 4. useResource.js source guards ─────────────────────────────────
  section('4. useResource.js source guards');
  {
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    assert(/export function useResource\b/.test(src), 'exports useResource');
    assert(
      /from\s+['"]@tanstack\/react-query['"]/.test(src),
      'imports @tanstack/react-query'
    );
    assert(/useQuery\s*\(/.test(src), 'uses useQuery');
    assert(
      /api\.get\(`?\/resources\/\$\{id\}`?\)?/.test(src) ||
        /api\.get\(['"]\/resources\//.test(src),
      'GETs /api/resources/<id>'
    );
    // Stable queryKey.
    assert(
      /queryKey:\s*\[\s*['"]resource['"]\s*,\s*id/.test(src),
      'queryKey is ["resource", id]'
    );
    // enabled flag respected.
    assert(/Boolean\(id\)/.test(src), 'enabled defaults to Boolean(id)');
    // Privacy: the hook itself does not pull the owner object — only
    // /api/resources/:id. There must be NO api.get('/users/:id') or
    // owner-fetch pattern.
    assert(!/api\.get\(['"]\/users/.test(src), 'hook does NOT fetch /users/:id');
    assert(!/api\.get\(['"]\/auth\/me/.test(src), 'hook does NOT fetch /auth/me');
  }

  // ── 5. ResourceDetailsPage source guards ────────────────────────────
  section('5. ResourceDetailsPage.jsx source guards');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');

    // Sub-components present. Description as a standalone component
    // has been folded into DetailsGrid (rendered as the first row),
    // so it's no longer a top-level function — DescriptionRow IS.
    // Use a word-boundary regex so we don't false-positive on
    // "DescriptionRow" containing the substring "Description".
    for (const name of [
      'BackBar',
      'Header',
      'PhotoGallery',
      'DetailsGrid',
      'ActionRow',
      'VolunteerRequestCTA',
      'LoadingState',
      'ErrorBanner',
    ]) {
      assert(
        new RegExp(`\\bfunction\\s+${name}\\b`).test(src),
        `page defines ${name}`
      );
    }
    assert(
      /\bfunction\s+DescriptionRow\b/.test(src),
      'page defines DescriptionRow (folded into DetailsGrid)'
    );

    // Hook + auth wired.
    assert(/useResource\s*\(/.test(src), 'page calls useResource');
    assert(/useAuth\s*\(/.test(src), 'page calls useAuth');
    assert(/useParams\s*\(/.test(src), 'page reads useParams (id)');
    assert(
      /import\s*\{[^}]*Link[^}]*\}\s*from\s*['"]react-router-dom['"]/.test(src),
      'page imports Link from react-router-dom'
    );

    // Detail fields rendered.
    assert(/getCategoryLabel\(/.test(src), 'page renders category label');
    assert(/getCategoryEmoji\(/.test(src), 'page renders category emoji');
    assert(/RESOURCE_STATUS/.test(src), 'page reads RESOURCE_STATUS');
    assert(/formatDistance\(/.test(src), 'page formats distance');
    assert(/haversineMeters\(/.test(src), 'page computes distance');
    assert(/resource\.photos/.test(src), 'page reads photos from response');
    assert(/resource\.description/.test(src), 'page reads description');
    assert(/resource\.title/.test(src), 'page reads title');
    assert(/resource\.capacity/.test(src), 'page reads capacity');

    // Description is rendered as the FIRST row of the Details card
    // (before Category). Source order is what we assert here — the
    // DescriptionRow push must precede the Category push in the
    // DetailsGrid body.
    const descRowIdx = src.indexOf("label: 'Description'");
    const categoryRowIdx = src.indexOf("label: 'Category'");
    assert(
      descRowIdx > 0 && categoryRowIdx > 0 && descRowIdx < categoryRowIdx,
      'Description row is rendered BEFORE Category in the Details card'
    );
    // And: the standalone <Description /> component no longer lives
    // as a top-level <section> above the grid. We assert by searching
    // for the JSX call site "<Description text=" — if present at the
    // top level, that would render a duplicate description block.
    assert(
      !/<Description\s+text=/.test(src),
      'page no longer renders a standalone <Description text=… /> section above the grid'
    );
    // See-more toggle on long descriptions.
    assert(/See more/.test(src),
      'DescriptionRow renders a "See more" toggle for long text');
    assert(/See less/.test(src),
      'DescriptionRow flips the toggle label to "See less" when expanded');
    assert(/line-clamp-3/.test(src),
      'DescriptionRow clamps long text to 3 lines via line-clamp-3');
    assert(/aria-expanded/.test(src),
      'See more button exposes aria-expanded for screen readers');

    // Map-on-load: page must default to map AND re-assert the map
    // view once the resource arrives with a real location, so the
    // user never briefly sees the photo placeholder on first load.
    assert(/useState\(\s*['"]map['"]\s*\)/.test(src),
      'photo/map toggle defaults to "map"');
    assert(
      /if\s*\(\s*hasLocation\s*\)\s*\{[\s\S]*?setViewMode\(\s*['"]map['"]\s*\)/.test(src),
      'page re-asserts map view when the resource arrives with a location'
    );
    assert(
      /if\s*\(\s*!\s*resource\s*\)\s*return/.test(src),
      'photo/map effect short-circuits while the resource is still loading'
    );
    assert(/resource\.condition/.test(src), 'page reads condition');
    assert(/resource\.areaId/.test(src), 'page reads areaId');
    assert(/resource\.areaName/.test(src), 'page reads areaName (server-populated area label)');
    assert(/resource\.location/.test(src), 'page reads location');
    // createdAt intentionally no longer read — the "Listed" row was
    // removed from the Details card so the section stays focused on
    // decision-relevant fields. updatedAt still renders in the header
    // ("updated <date>"), so we keep that assertion.
    assert(/resource\.updatedAt/.test(src), 'page reads updatedAt');
    assert(/resource\.ownerName/.test(src), 'page reads ownerName (server-populated owner label)');

    // Address chain (district > upazila > ...) — the page fetches the
    // full ancestor chain and renders it via the existing
    // useAreaChain hook. Verify the wiring.
    assert(/useAreaChain/.test(src),
      'page calls useAreaChain to resolve the address hierarchy');
    assert(/areaChainLabel/.test(src),
      'page renders an areaChainLabel (district › upazila › …)');

    // Photo / map toggle — when the resource has a location, the
    // page exposes a "Show on map" toggle that swaps the gallery
    // for a Leaflet map pinned to the coordinate.
    assert(/Show on map/.test(src),
      'page renders a "Show on map" toggle');
    assert(/MapContainer/.test(src),
      'page mounts a react-leaflet MapContainer for the pinned location');
    assert(/TileLayer/.test(src),
      'page mounts a TileLayer (OSM) inside the map view');

    // Layout polish (Module 4.2 iteration):
    //   - Map is the DEFAULT view (with photo as fallback when no
    //     location is set). The toggle row lists "Show on map" on
    //     the LEFT and "Photo" on the RIGHT (read order matches the
    //     default view).
    //   - The right column (photo gallery / map pin) is a fixed 4:3
    //     frame so it never stretches when the Details card grows
    //     taller. Both the empty-state placeholder and the active
    //     photo card use `aspect-[4/3]`; the map pin wrapper does
    //     the same. The grid switches from items-stretch to
    //     items-start so neither column tries to drag the other.
    //   - The "Status" and "Listed" rows are intentionally removed
    //     from the Details card so it stays focused on decision-
    //     relevant fields (status still surfaces via the header
    //     badge).
    //   - The bottom booking CTA (VolunteerRequestCTA / owner view
    //     / moderator view) lives as a full-width row below the
    //     two-column grid. Title + paragraph + button are all
    //     centre-aligned.
    // (default-to-map is asserted above in section 5 with the
    // stronger "re-asserts on resource arrival" check.)
    // Toggle order — the button labelled "Show on map" renders BEFORE
    // the button labelled "Photo" in the source. We scan for the
    // inner <button>...</button> nodes and confirm their relative
    // position. We restrict the search to AFTER the useState
    // initializer (which contains 'map' as a default) so the
    // assertion reflects the toggle row, not the state hook.
    const toggleRowStart = src.indexOf('aria-pressed={viewMode === \'map\'}');
    const toggleRowEnd = src.indexOf('aria-pressed={viewMode === \'photo\'}');
    assert(
      toggleRowStart > 0 && toggleRowEnd > 0,
      'toggle row contains both map + photo buttons'
    );
    assert(
      toggleRowStart < toggleRowEnd,
      '"Show on map" toggle button is rendered to the LEFT of "Photo"'
    );
    assert(/aspect-\[4\/3\]/.test(src),
      'photo gallery / map pin uses aspect-[4/3] for a fixed 4:3 frame');
    assert(!/items-stretch/.test(src),
      'two-column grid no longer uses items-stretch (right column is fixed-aspect)');
    assert(!/max-w-2xl/.test(src),
      'booking CTA no longer wraps in a max-w-2xl container (full-width row)');
    assert(
      !/label:\s*['"]Status['"]/.test(src),
      'Details card no longer renders a "Status" row (badge in header)'
    );
    assert(
      !/label:\s*['"]Listed['"]/.test(src),
      'Details card no longer renders a "Listed" row'
    );
    // Booking CTA centred. We assert the three ActionRow / CTA
    // branches all carry text-center (volunteer default, volunteer
    // unverified, volunteer created, owner-of-resource, moderator).
    // The patterns we use are the inner card class lists.
    const centredCardCount = (
      src.match(/rounded-lg border border-\S+ bg-\S+ p-4 text-center/g) || []
    ).length;
    assert(
      centredCardCount >= 4,
      `at least 4 booking-CTA cards carry text-center (got ${centredCardCount})`
    );
    // The full-width row wraps <ActionRow /> OUTSIDE the DetailsGrid
    // grid container — i.e. not as a child of the md:grid-cols-2 row.
    // We check structurally: the ActionRow call site lives after the
    // closing </div> of the grid in the source. Easier proxy: the
    // ActionRow call no longer sits adjacent to the DetailsGrid call
    // inside a single `space-y-6` left-column wrapper.
    const actionRowContext = src.match(
      /<DetailsGrid[\s\S]*?<\/DetailsGrid>\s*<div[\s\S]{0,300}?<ActionRow[\s\S]*?<\/ActionRow>/
    );
    assert(
      !actionRowContext,
      'ActionRow no longer renders as a sibling of DetailsGrid inside a left-column wrapper'
    );

    // 404 handling — page should bounce to /resources when the
    // server reports the id is unknown.
    assert(
      /navigate\(\s*['"]\/resources['"]/.test(src),
      'page navigates to /resources on 404'
    );

    // Privacy boundary — owner contact info MUST NOT appear in
    // CODE (not comments). We strip JS comments first so the
    // documentation block above the function doesn't trip the
    // assertion.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert(
      !/\bowner\.email\b/.test(codeOnly),
      'page does NOT access owner.email'
    );
    assert(
      !/\bowner\.phone\b/.test(codeOnly),
      'page does NOT access owner.phone'
    );
    assert(
      !/\bowner\.name\b/.test(codeOnly),
      'page does NOT access owner.name'
    );
    assert(
      !/\bresource\.owner\b/.test(codeOnly),
      'page does NOT access resource.owner (the populated doc)'
    );

    // Action row copy.
    assert(
      /Request this resource/.test(src),
      'page renders the "Request this resource" button (volunteer-only)'
    );
    // Module 5.2 wires the request lifecycle — the button is now live
    // and only disabled when the resource is not AVAILABLE (or the
    // volunteer is not verified). The CTA must not be pinned to a
    // 'ships in Phase 5' copy.
    assert(
      !/Request workflow ships in Phase 5/.test(src),
      'page no longer advertises the request CTA as a Phase 5 placeholder'
    );
    assert(
      /isVerified\s*===\s*true/.test(src) || /isVerified\s*===\s*true/.test(src),
      'page recognises the verified-volunteer gate (user.isVerified)'
    );
    assert(
      /['"`]AVAILABLE['"`]/.test(src),
      'page checks resource.status === AVAILABLE before letting the request fire'
    );
    // The hook used to wire the request is exported from useMyRequests.
    assert(
      /useCreateRequest\s*\(/.test(src),
      'page calls useCreateRequest to POST /api/requests'
    );
    // Owner-of-resource branch exists.
    assert(
      /resource\.ownerId\s*===\s*user\.id/.test(src) ||
        /resource\.ownerId\s*===\s*user\?\.id/.test(src),
      'page detects when the signed-in OWNER owns this resource'
    );
  }

  // ── 6. Constants used by the page resolve correctly ────────────────
  section('6. constants + utils used by the page');
  {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');
    assert(
      /from\s+['"]\.\.\/utils\/constants['"]/.test(src),
      'page imports from utils/constants'
    );
    assert(
      /from\s+['"]\.\.\/utils\/categories['"]/.test(src),
      'page imports from utils/categories'
    );
    assert(
      /from\s+['"]\.\.\/utils\/distance['"]/.test(src),
      'page imports from utils/distance'
    );
    assert(
      /from\s+['"]\.\.\/hooks\/useResource['"]/.test(src),
      'page imports from hooks/useResource'
    );
    assert(
      /from\s+['"]\.\.\/context\/AuthContext['"]/.test(src),
      'page imports from context/AuthContext'
    );
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = exitCode;
  }
})();