import { useEffect, useState } from 'react';

/** Subscribes to a CSS media query. Returns false during SSR / before the first effect. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** True when the browser asks for reduced motion; everything decorative must respect it. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * True on a viewport narrow enough that a chart has to be laid out differently: fewer axis ticks,
 * smaller type, a stacked legend. 700px is the point at which the page's single column drops below
 * roughly 640 CSS pixels of drawable width inside a figure mat.
 */
export function useNarrowViewport(maxPx = 700): boolean {
  return useMediaQuery(`(max-width: ${maxPx}px)`);
}

/** True on a touch screen, where hover does not exist and hit targets must be finger-sized. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
