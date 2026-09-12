import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { prefetchRoute } from '../lib/routes';
import { REPO_URL, useDataFile } from '../lib/data';
import { MapSourceProvider } from '../lib/mapSource';
import { useMediaQuery, usePrefersReducedMotion } from '../lib/media';
import MapPanel from './MapPanel';
import FlyOrnament from './FlyOrnament';
import type { Manifest } from '../types';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/criticality', label: 'Criticality' },
  { to: '/learning', label: 'Learning' },
  { to: '/replay', label: 'Replay' },
  { to: '/methods', label: 'Methods' },
];

/** Where the map goes when there is no room for a rail: each page drops this after its intro. */
export const MAP_SLOT_ID = 'map-slot';

/** Rendered by every page immediately after its intro prose; empty (and hidden) in the wide layout. */
export function MapSlot() {
  return <div id={MAP_SLOT_ID} className="map-slot" />;
}

/**
 * Masthead and nav across the top; below them a two-column body: the page content on the left and
 * the neuron map in a sticky rail on the right. Below 1100px there is no room for two columns, so
 * the rail is not squeezed: the map moves into the page itself, as a full-width block directly
 * after the page intro (the slot each page renders there).
 */
export default function Layout() {
  const m = useDataFile<Manifest>('manifest.json');
  const commit = m.state === 'ready' ? m.data.git_commit : null;
  const isHex = commit ? /^[0-9a-f]{7,40}$/i.test(commit) : false;
  const fly = useFlySetting();
  const twoColumn = useMediaQuery('(min-width: 1100px)');

  return (
    <MapSourceProvider>
      {/* The inner box holds the reading measure; the header itself takes the shell's geometry from
          1100px up, so the title and nav centre over the text column and not over the map rail. */}
      <header className="masthead">
        <div className="masthead__inner">
          <NavLink to="/" className="masthead__name" end>
            hypnagogia
          </NavLink>
          <div className="masthead__tagline">whole-brain Drosophila LIF · replay during simulated sleep</div>
          <nav className="masthead__nav" aria-label="pages">
            {NAV.map((n, i) => (
              <span key={n.to}>
                {i > 0 && ' '}
                {/* The two chart routes are no longer prefetched on idle from a chart-free page
                    (they drag recharts in with them), so the intent to navigate is what pulls the
                    chunk: by the time the click lands it is usually already there. */}
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  className="masthead__nav-link"
                  data-text={n.label}
                  onPointerEnter={() => prefetchRoute(n.to)}
                  onFocus={() => prefetchRoute(n.to)}
                  onTouchStart={() => prefetchRoute(n.to)}
                >
                  {n.label}
                </NavLink>
              </span>
            ))}
          </nav>
        </div>
      </header>

      <div className="shell" data-two-column={twoColumn ? 'true' : 'false'}>
        <main className="page">
          <Outlet />
        </main>
        {twoColumn ? <Rail /> : <InlineMap />}
      </div>

      <footer className="colophon">
        <div className="colophon__meta">
          <span>
            source:{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              github.com/ankthba/hypnagogia
            </a>
            {commit && (
              <>
                {' '}
                · build{' '}
                {isHex ? (
                  <a href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noreferrer" className="mono">
                    {commit.slice(0, 12)}
                  </a>
                ) : (
                  <span className="mono">{commit}</span>
                )}
              </>
            )}
          </span>
          <span className="colophon__switches">
            <FlyToggle setting={fly} />
            <ThemeToggle />
          </span>
        </div>
        <p className="colophon__note">
          Static viewer. Every number on these pages is read at page-load from <span className="mono">data/*.json</span> and{' '}
          <span className="mono">data/*.bin</span> written by the simulation pipeline. No results are embedded in the site; the
          Methods page carries no numbers of its own either, its parameter table is read from the manifest. The fly is the one
          drawing on this site that is not data.
        </p>
      </footer>

      {fly.on && <FlyOrnament />}
    </MapSourceProvider>
  );
}

/**
 * The sticky right-hand rail.
 *
 * It has no scrollbar of its own and no height cap: it is exactly as tall as the panel inside it
 * and it scrolls with the page. That leaves one thing to get right. A box taller than the viewport
 * that is stuck to the *top* pins immediately and its bottom, which carries the provenance line,
 * can then never be scrolled into view. So the offset is computed: while the panel fits, it is
 * pinned a small margin below the top of the viewport as before; when it is taller, the offset
 * becomes negative by exactly the overflow, so the rail travels with the page until its bottom
 * reaches the bottom of the viewport and pins there. Everything in it is reachable, nothing scrolls
 * inside itself, and the page's own scroll is never intercepted.
 */
function Rail() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const margin = 16;
      const overflow = el.offsetHeight + 2 * margin - window.innerHeight;
      el.style.setProperty('--rail-top', overflow > 0 ? `${margin - overflow}px` : `${margin}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [el]);
  return (
    <aside ref={setEl} className="rail" aria-label="neuron map">
      <MapPanel />
    </aside>
  );
}

/**
 * The map in the single-column layout. It is portalled into the page's own slot so it lands after
 * the intro rather than below every figure on the page; a page that renders no slot (or a route
 * still mounting) gets it at the end of the shell, which is where the aside used to sit.
 */
function InlineMap() {
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // the slot belongs to the page, so it exists only after the route's own commit
    const raf = requestAnimationFrame(() => setSlot(document.getElementById(MAP_SLOT_ID)));
    return () => {
      cancelAnimationFrame(raf);
      setSlot(null);
    };
  }, [pathname]);
  const panel = (
    <section className="rail rail--inline" aria-label="neuron map">
      <MapPanel />
    </section>
  );
  return slot ? createPortal(panel, slot) : panel;
}

// ---------------------------------------------------------------- the fly switch

interface FlySetting {
  on: boolean;
  wanted: boolean;
  forcedOff: boolean;
  set: (v: boolean) => void;
}

/**
 * The fly is on by default and remembered in localStorage, but a browser asking for reduced motion
 * turns it off outright: it is decoration, and decoration does not get to override that.
 */
function useFlySetting(): FlySetting {
  const reduce = usePrefersReducedMotion();
  // On a phone or any touch screen the fly is noise in a small viewport, so it starts off there.
  // An explicit choice, either way, is remembered and wins over the default.
  const smallOrTouch = useMediaQuery('(max-width: 899px), (pointer: coarse)');
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem('fly');
    } catch {
      return null;
    }
  });
  const wanted = stored === 'on' ? true : stored === 'off' ? false : !smallOrTouch;
  const setWanted = (v: boolean) => setStored(v ? 'on' : 'off');
  const set = (v: boolean) => {
    setWanted(v);
    try {
      localStorage.setItem('fly', v ? 'on' : 'off');
    } catch {
      /* storage unavailable: the setting still applies for this page */
    }
  };
  return { on: wanted && !reduce, wanted, forcedOff: reduce, set };
}

function FlyToggle({ setting }: { setting: FlySetting }) {
  const label = setting.forcedOff ? 'off (reduced motion)' : setting.wanted ? 'on' : 'off';
  return (
    <span className="theme-toggle" role="group" aria-label="fly ornament">
      <button
        type="button"
        className="theme-toggle__option"
        data-text={`fly: ${label}`}
        aria-pressed={setting.on}
        disabled={setting.forcedOff}
        title={setting.forcedOff ? 'this browser asks for reduced motion, so the fly stays off' : 'the fly is decoration only'}
        onClick={() => setting.set(!setting.wanted)}
      >
        fly: {label}
      </button>
    </span>
  );
}

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

/** System / Light / Dark. The inline script in index.html applied the stored choice before first paint;
 *  this control only rewrites the attribute and the stored key. */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === 'undefined' ? 'system' : readTheme()));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {
      /* storage unavailable: the attribute still applies for this page */
    }
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="colour theme">
      {(['system', 'light', 'dark'] as Theme[]).map((t) => {
        const label = t[0].toUpperCase() + t.slice(1);
        return (
          <button key={t} type="button" className="theme-toggle__option" data-text={label} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
