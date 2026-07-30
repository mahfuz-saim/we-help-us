import { useEffect, useState } from 'react';

/**
 * Return whether a CSS media query currently matches the viewport.
 *
 * The hook is SSR-safe and listens for viewport changes, so layouts can
 * switch cleanly when a device rotates or a browser is resized.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(query);
    const handleChange = (event) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);

    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, [query]);

  return matches;
}

/** Tailwind's md breakpoint is 768px in the v4 default theme. */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 768px)');
}
