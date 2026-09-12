import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { REPO_URL, useDataFile } from '../lib/data';
import type { Manifest } from '../types';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/criticality', label: 'Criticality' },
  { to: '/learning', label: 'Learning' },
  { to: '/replay', label: 'Replay' },
  { to: '/methods', label: 'Methods' },
];

export default function Layout() {
  const m = useDataFile<Manifest>('manifest.json');
  const commit = m.state === 'ready' ? m.data.git_commit : null;
  const isHex = commit ? /^[0-9a-f]{7,40}$/i.test(commit) : false;

  return (
    <>
      <header className="masthead">
        <NavLink to="/" className="masthead__name" end>
          hypnagogia
        </NavLink>
        <div className="masthead__tagline">whole-brain Drosophila LIF · replay during simulated sleep</div>
        <nav className="masthead__nav" aria-label="pages">
          {NAV.map((n, i) => (
            <span key={n.to}>
              {i > 0 && ' '}
              <NavLink to={n.to} end={n.to === '/'} className="masthead__nav-link" data-text={n.label}>
                {n.label}
              </NavLink>
            </span>
          ))}
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
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
          <ThemeToggle />
        </div>
        <p className="colophon__note">
          Static viewer. Every number on these pages is read at page-load from <span className="mono">data/*.json</span> and{' '}
          <span className="mono">data/*.bin</span> written by the simulation pipeline. No results are embedded in the site; the
          Methods page carries no numbers of its own either, its parameter table is read from the manifest.
        </p>
      </footer>
    </>
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
