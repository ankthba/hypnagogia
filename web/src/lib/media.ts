import { useCallback, useEffect, useRef, useState } from 'react';

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
 *
 * Prefer `useNarrowBox` inside a chart: the viewport is not what a chart is drawn into. Once the
 * map rail takes ~400px and `.cols-2` splits what is left, a figure mat is ~400px wide at a 1440px
 * window, and a chart that asks the *window* whether it is narrow keeps the wide tick density and
 * the wide label geometry inside a box half the width they were designed for.
 */
export function useNarrowViewport(maxPx = 700): boolean {
  return useMediaQuery(`(max-width: ${maxPx}px)`);
}

/**
 * The same decision, made from the width of the box the chart is actually drawn into.
 *
 * Returns a ref to put on the chart's own wrapper and whether that wrapper is narrow. Until the
 * first measurement lands (the render before the observer fires) it falls back to the viewport
 * query, so the first paint is never wrong by more than one frame in the direction the old
 * viewport-only rule would have been wrong anyway.
 */
export function useNarrowBox(maxPx = 700): { ref: (el: HTMLElement | null) => void; narrow: boolean; width: number } {
  const [width, setWidth] = useState(0);
  const viewportNarrow = useMediaQuery(`(max-width: ${maxPx}px)`);
  const stop = useRef<(() => void) | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!el) return;
    // Coalesced to one update per frame: dragging a window edge otherwise re-renders the chart
    // once per observed pixel.
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((entries) => {
      pending = Math.floor(entries[0].contentRect.width);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setWidth((w) => (w === pending ? w : pending));
      });
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    stop.current = () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  useEffect(() => () => stop.current?.(), []);
  return { ref, narrow: width > 0 ? width <= maxPx : viewportNarrow, width };
}

/**
 * The current device pixel ratio, as state.
 *
 * It changes when the window is dragged to a display of a different density, or when the browser
 * is zoomed. Sampling it only at draw time is not enough: a canvas whose CSS size has not changed
 * never re-renders, so its backing store stays at the old ratio and the picture goes blurry (or is
 * needlessly oversampled) until something else happens to redraw it. There is no `resize`-style
 * event for it, so the idiom is a `(resolution: Ndppx)` media query re-subscribed at each change.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList | null = null;
    const onChange = () => {
      setDpr(window.devicePixelRatio || 1);
      resub();
    };
    const resub = () => {
      mq?.removeEventListener('change', onChange);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onChange);
    };
    setDpr(window.devicePixelRatio || 1);
    resub();
    return () => mq?.removeEventListener('change', onChange);
  }, []);
  return dpr;
}

/**
 * The ratio a canvas backing store is actually allocated at.
 *
 * The true ratio drives the *subscription* (a 3x phone must still repaint when it changes), but a
 * backing store is capped at 2x: in the single-column layout the map is the full width of the page
 * and ~520px tall, which at 3x is a 4182 x 1632 bitmap - and the map allocates two of them (the
 * visible canvas and the cached background), on a page that mounts two maps. Above 2x the extra
 * samples are past what the eye resolves at reading distance and cost tens of megabytes.
 */
export function useCanvasPixelRatio(max = 2): number {
  return Math.min(useDevicePixelRatio(), max);
}

/**
 * The viewport height in CSS pixels, tracked. Used to budget a fixed-height canvas against the
 * screen it has to fit on rather than against a constant, so a sticky panel does not end up taller
 * than the rail that holds it and grow a scrollbar of its own.
 */
export function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setH(window.innerHeight);
      });
    };
    on();
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return h;
}

/** True on a touch screen, where hover does not exist and hit targets must be finger-sized. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
