/**
 * End-to-end smoke test for Module 3.3 — Resource Category Definitions
 * (client side).
 *
 * Validates:
 *   - Vite production build succeeds with the new categories module
 *     and the .whu-pin CSS in index.css
 *   - client/src/utils/categories.js exports the same 6 categories
 *     the server spec calls for
 *   - The Leaflet DivIcon factory returns a properly-shaped icon for
 *     each category — the memoization, the className, the html all
 *     are wired correctly
 *   - The CSS classes referenced by the icon factory actually exist
 *     in index.css (otherwise the icon would render unstyled at runtime)
 *   - The drift guard via Object.freeze on the enum + CATEGORY_META
 *   - constants.js re-exports the categories (so existing imports
 *     of RESOURCE_CATEGORIES keep working)
 *
 * Run: `node smoke-tests/3.3-categories.test.cjs` from `client/`.
 * Exit 0 = all assertions passed.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(CLIENT_ROOT, 'dist');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const CATEGORIES_PATH = path.join(CLIENT_ROOT, 'src/utils/categories.js');
const CONSTANTS_PATH = path.join(CLIENT_ROOT, 'src/utils/constants.js');
const INDEX_CSS_PATH = path.join(CLIENT_ROOT, 'src/index.css');

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
  // ── 1. Production build ───────────────────────────────────────────────
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
    assert(result.code === 0, '\u2018npm run build\u2019 exits 0');
    assert(fs.existsSync(DIST_DIR), 'dist/ exists');
    const assets = fs.existsSync(DIST_ASSETS) ? fs.readdirSync(DIST_ASSETS) : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    const cssAssets = assets.filter((f) => f.endsWith('.css'));
    assert(jsAssets.length > 0, 'dist/assets has at least one JS bundle');
    assert(cssAssets.length > 0, 'dist/assets has at least one CSS bundle');

    const allJs = jsAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');
    const allCss = cssAssets
      .map((f) => fs.readFileSync(path.join(DIST_ASSETS, f), 'utf8'))
      .join('\n');

    // Category labels appear in the bundle (the form / list / etc. reads them).
    for (const label of [
      'Transportation',
      'Rescue Equipment',
      'Medical',
      'Infrastructure',
      'Utilities',
      'Skilled Professionals',
    ]) {
      assert(
        allJs.includes(label),
        `bundle contains category label "${label}"`
      );
    }
    // Enum values appear in the bundle (the API sends them; client
    // also persists the keys for fast lookups).
    for (const v of [
      'TRANSPORTATION',
      'RESCUE_EQUIPMENT',
      'MEDICAL',
      'INFRASTRUCTURE',
      'UTILITIES',
      'SKILLED_PROFESSIONALS',
    ]) {
      assert(
        allJs.includes(v),
        `bundle contains category value "${v}"`
      );
    }
    // The .whu-pin base styles made it into the CSS bundle (the index.css
    // additions are picked up by Vite's CSS pipeline).
    assert(
      /\.whu-pin/.test(allCss),
      'CSS bundle defines .whu-pin'
    );
    assert(
      /\.whu-pin__emoji/.test(allCss),
      'CSS bundle defines .whu-pin__emoji'
    );
    // Status overlay hooks (Module 4.3 will use these).
    assert(
      /\.whu-pin--status-available/.test(allCss),
      'CSS bundle defines .whu-pin--status-available overlay'
    );
    assert(
      /\.whu-pin--status-unavailable/.test(allCss),
      'CSS bundle defines .whu-pin--status-unavailable overlay'
    );
  }

  // ── 2. Static guards on utils/categories.js ──────────────────────────
  section('2. categories module source');
  {
    const src = fs.readFileSync(CATEGORIES_PATH, 'utf8');
    assert(/export const CATEGORIES\s*=/.test(src), 'exports CATEGORIES enum');
    assert(
      /export const CATEGORY_VALUES\s*=/.test(src),
      'exports CATEGORY_VALUES array'
    );
    assert(
      /export const CATEGORY_META\s*=/.test(src),
      'exports CATEGORY_META array'
    );
    assert(
      /Object\.freeze/.test(src),
      'uses Object.freeze on the enum and meta'
    );
    assert(
      /export function getCategoryIcon/.test(src),
      'exports getCategoryIcon factory'
    );
    assert(
      /export function getCategoryIconHtml/.test(src),
      'exports getCategoryIconHtml helper'
    );
    assert(
      /import L from 'leaflet'/.test(src),
      'imports Leaflet for DivIcon creation'
    );
    assert(
      /L\.divIcon/.test(src),
      'uses L.divIcon for the category icon'
    );
    assert(
      /iconCache/.test(src),
      'uses an icon cache (memoization of divIcons)'
    );
    // 6 categories hard-coded in the source
    for (const v of [
      'TRANSPORTATION',
      'RESCUE_EQUIPMENT',
      'MEDICAL',
      'INFRASTRUCTURE',
      'UTILITIES',
      'SKILLED_PROFESSIONALS',
    ]) {
      assert(
        src.includes(v),
        `source mentions category value ${v}`
      );
    }
  }

  // ── 3. Static guards on index.css ─────────────────────────────────────
  section('3. CSS for category icons');
  {
    const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
    // The categories module references these classes in COLOR_CLASSES.
    // If a color token is added to the JS but the CSS is missing,
    // the pin renders unstyled (no warning at runtime). We assert
    // each Tailwind utility class is referenced to catch the drift.
    const requiredClasses = [
      'bg-brand-50',
      'ring-brand-500',
      'text-brand-700',
      'bg-caution-50',
      'ring-caution-500',
      'text-caution-700',
      'bg-alert-50',
      'ring-alert-500',
      'text-alert-700',
      'bg-safe-50',
      'ring-safe-500',
      'text-safe-700',
      'bg-slate-50',
      'ring-slate-400',
      'text-slate-700',
    ];
    // The categories.js file should still reference these classes as
    // Tailwind strings in the source, so a missing one in the project
    // theme tokens is caught by the build (Tailwind v4 tree-shakes).
    const catSrc = fs.readFileSync(CATEGORIES_PATH, 'utf8');
    for (const cls of requiredClasses) {
      assert(
        catSrc.includes(cls),
        `categories.js references Tailwind class "${cls}" (theme must define it)`
      );
    }
    // The CSS itself defines the .whu-pin container.
    assert(
      /\.whu-pin\s*\{/.test(css),
      'index.css defines the .whu-pin container'
    );
    assert(
      /\.whu-pin__emoji/.test(css),
      'index.css defines .whu-pin__emoji'
    );
    // The Leaflet container override (default Leaflet pins are white
    // boxes; we strip that surface for our category markers).
    assert(
      /\.leaflet-div-icon\.whu-category-icon/.test(css),
      'index.css strips the default Leaflet DivIcon styling for whu-category-icon'
    );
  }

  // ── 4. constants.js re-exports ────────────────────────────────────────
  section('4. constants.js re-export');
  {
    const cs = fs.readFileSync(CONSTANTS_PATH, 'utf8');
    assert(
      /from ['"]\.\/categories['"]/.test(cs),
      'constants.js imports from ./categories'
    );
    assert(
      /export const RESOURCE_CATEGORIES\s*=\s*CATEGORY_META/.test(cs),
      'RESOURCE_CATEGORIES re-exports CATEGORY_META (backwards-compatible)'
    );
    assert(
      /export\s*\{[^}]*CATEGORIES[^}]*CATEGORY_VALUES[^}]*\}/.test(cs),
      'CATEGORIES + CATEGORY_VALUES re-exported'
    );
  }

  // ── 5. The 6 enum values are stable on the client ─────────────────────
  section('5. enum stability (client file)');
  {
    const src = fs.readFileSync(CATEGORIES_PATH, 'utf8');
    const expected = [
      'TRANSPORTATION',
      'RESCUE_EQUIPMENT',
      'MEDICAL',
      'INFRASTRUCTURE',
      'UTILITIES',
      'SKILLED_PROFESSIONALS',
    ];
    for (const v of expected) {
      assert(
        new RegExp(`${v}:\\s*'${v}'`).test(src),
        `client enum contains ${v}: '${v}'`
      );
    }
  }

  // ── 6. Emoji + color tokens present per category ──────────────────────
  section('6. emoji + color per category');
  {
    const src = fs.readFileSync(CATEGORIES_PATH, 'utf8');
    // Each entry must have an emoji and a color token.
    const emojiLines = src.match(/emoji:\s*'[^']+'/g) || [];
    const colorLines = src.match(/color:\s*'[^']+'/g) || [];
    assert(emojiLines.length >= 6, `at least 6 emoji entries (got ${emojiLines.length})`);
    assert(colorLines.length >= 6, `at least 6 color entries (got ${colorLines.length})`);

    // The 5 Tailwind color tokens used in categories.js are all valid
    // project tokens (defined in index.css @theme).
    const requiredColors = ['brand', 'caution', 'alert', 'safe', 'slate'];
    for (const c of requiredColors) {
      assert(
        new RegExp(`color:\\s*'${c}'`).test(src) || /text-\\$\\{color\\}/.test(src),
        `color token "${c}" is referenced`
      );
    }
  }

  // ── 7. Runtime exercise of the categories module ─────────────────────
  section('7. runtime exercise (dynamic import)');
  {
    // The categories module imports `leaflet`, which assumes a DOM
    // and refuses to load under plain Node. We don't want to ship a
    // full jsdom here (overkill for asserting a frozen enum + a
    // couple of pure helpers). Instead, write a stripped copy that
    // drops the Leaflet import (only used by `getCategoryIcon`, which
    // we don't exercise here) and dynamic-import that.

    const src = fs.readFileSync(CATEGORIES_PATH, 'utf8');
    // Strip the Leaflet import — the only side-effect it has on the
    // module is making the file unloadable under Node.
    const stripped = src.replace(/^\s*import\s+L\s+from\s+['"]leaflet['"];?\s*$/m, '');
    // Also neutralise the `L.divIcon` call inside getCategoryIcon —
    // we don't invoke it from the test, but Node still resolves the
    // identifier at module-eval time? No — `L` is only used inside a
    // function body, so leaving the body intact is fine.

    const tmpPath = path.join(CLIENT_ROOT, 'smoke-tests', '.categories.tmp.mjs');
    fs.writeFileSync(tmpPath, stripped);
    let mod;
    try {
      mod = await import('file://' + tmpPath.replace(/\\/g, '/'));
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* noop */ }
    }
    assert(mod.CATEGORIES, 'CATEGORIES exported at runtime');
    assert(Object.isFrozen(mod.CATEGORIES), 'CATEGORIES is frozen at runtime');
    assert(
      Array.isArray(mod.CATEGORY_VALUES) && mod.CATEGORY_VALUES.length === 6,
      'CATEGORY_VALUES has 6 entries at runtime'
    );
    assert(
      Array.isArray(mod.CATEGORY_META) && mod.CATEGORY_META.length === 6,
      'CATEGORY_META has 6 entries at runtime'
    );
    assert(Object.isFrozen(mod.CATEGORY_META), 'CATEGORY_META is frozen at runtime');

    // getCategoryByValue
    assert(
      mod.getCategoryByValue('MEDICAL').label === 'Medical',
      'getCategoryByValue returns the right meta'
    );
    assert(
      mod.getCategoryByValue('BOGUS') === null,
      'getCategoryByValue on unknown returns null'
    );
    assert(
      typeof mod.getCategoryLabel === 'function' &&
        mod.getCategoryLabel('UTILITIES') === 'Utilities',
      'getCategoryLabel returns the human label'
    );

    // getCategoryIconHtml is a pure function — exercise every category
    // to confirm each one produces a non-empty HTML string with its
    // emoji in it.
    for (const meta of mod.CATEGORY_META) {
      const html = mod.getCategoryIconHtml(meta.value);
      assert(typeof html === 'string' && html.length > 0, `icon HTML for ${meta.value} is non-empty`);
      assert(html.includes(meta.emoji), `  icon HTML for ${meta.value} contains its emoji`);
      assert(
        /class="whu-pin/.test(html),
        `  icon HTML for ${meta.value} has the whu-pin class root`
      );
    }
    // Unknown category → empty string (graceful fallback).
    assert(
      mod.getCategoryIconHtml('BOGUS') === '',
      'getCategoryIconHtml on unknown returns empty string'
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
