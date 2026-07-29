/**
 * Shared `navLinkClass(isActive)` helper used by both the desktop top nav
 * (MainLayout.jsx) and the mobile hamburger drawer (MobileNavDrawer.jsx).
 *
 * The previous module baked this into MainLayout's bottom-of-file — but
 * Module 9.1 added a second consumer, so it now lives in /utils so both
 * components can render identical state for the active route.
 *
 * The mobile drawer renders this with extra vertical padding (py-3)
 * because each entry is now the primary touch surface; the desktop
 * caller still uses the original py-1.5.
 */
export function navLinkClass(isActive) {
  return [
    'rounded-md px-3 py-1.5 text-sm font-medium',
    isActive
      ? 'bg-slate-900 text-white'
      : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');
}

/**
 * Same styling but with a taller touch target (44px) used inside the
 * mobile drawer so a thumb can reach every link comfortably.
 */
export function navLinkClassMobile(isActive) {
  return [
    'flex items-center gap-3 rounded-md px-4 py-3 text-base font-medium',
    isActive
      ? 'bg-slate-900 text-white'
      : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');
}
