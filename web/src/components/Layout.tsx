import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/criticality', label: 'Criticality' },
  { to: '/learning', label: 'Learning' },
  { to: '/replay', label: 'Replay' },
  { to: '/methods', label: 'Methods' },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex items-center gap-4 h-14">
          <NavLink to="/" className="font-semibold tracking-tight text-slate-100 whitespace-nowrap">
            hypnagogia
            <span className="ml-2 hidden sm:inline text-xs font-normal text-slate-500">
              whole-brain Drosophila LIF · replay during simulated sleep
            </span>
          </NavLink>
          <nav className="ml-auto flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                    isActive ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-800 py-6 text-xs text-slate-500">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          Static viewer. Every number on these pages is read at page-load from <span className="mono">data/*.json</span> and{' '}
          <span className="mono">data/*.bin</span> written by the simulation pipeline. No values are embedded in the site.
        </div>
      </footer>
    </div>
  );
}
