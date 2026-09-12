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
