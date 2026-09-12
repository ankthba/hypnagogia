import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';

/**
 * The pages are code-split.
 *
 * Recharts is 396 kB of the bundle and only the Criticality and Learning pages draw with it; the
 * Overview, Replay and Methods pages do not touch it. Loading every page up front put all of that
 * on the critical path of the first paint, on every route. Each route is now its own chunk, and
 * the shared chart library rides along with the first page that actually needs it.
 *
 * The pages the reader is most likely to go to next are prefetched once the browser is idle, so
 * splitting costs nothing on a click.
 */
const Overview = lazy(() => import('./pages/Overview'));
const Criticality = lazy(() => import('./pages/Criticality'));
const Learning = lazy(() => import('./pages/Learning'));
const Replay = lazy(() => import('./pages/Replay'));
const Methods = lazy(() => import('./pages/Methods'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Pull the other routes' chunks in once the browser has nothing better to do. */
function PrefetchRoutes() {
  useEffect(() => {
    const load = () => {
      void import('./pages/Criticality');
      void import('./pages/Learning');
      void import('./pages/Replay');
      void import('./pages/Overview');
      void import('./pages/Methods');
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric(load, { timeout: 4000 });
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      return () => cic?.(id);
    }
    const t = window.setTimeout(load, 2000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

/** What stands in while a route's chunk is in flight. It states what it is, and claims nothing. */
function RouteFallback() {
  return <div className="small muted py-10">loading this page …</div>;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <PrefetchRoutes />
      <Routes>
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Overview />
              </Suspense>
            }
          />
          <Route
            path="/criticality"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Criticality />
              </Suspense>
            }
          />
          <Route
            path="/learning"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Learning />
              </Suspense>
            }
          />
          <Route
            path="/replay"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Replay />
              </Suspense>
            }
          />
          <Route
            path="/methods"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Methods />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
