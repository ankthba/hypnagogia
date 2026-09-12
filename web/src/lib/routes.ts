/**
 * The routed pages as code-split chunks, addressable by path.
 *
 * It lives here rather than in App so both App (which lazy-mounts them and prefetches on idle) and
 * the masthead nav (which prefetches on hover) can reach the same loaders without importing each
 * other. Vite gives each `import()` its own chunk and reuses it, so naming a loader twice does not
 * duplicate a byte.
 *
 * `charts` marks the two routes whose chunk drags recharts in with it (365 kB raw, ~103 kB
 * gzipped). Nothing else on the site charts, so those two are prefetched only from a route that has
 * already paid for the library; from Overview, Replay or Methods the reader who never opens a chart
 * page never downloads it.
 */
export interface RouteChunk {
  load: () => Promise<unknown>;
  charts: boolean;
}

export const ROUTE_CHUNKS: Record<string, RouteChunk> = {
  '/': { load: () => import('../pages/Overview'), charts: false },
  '/criticality': { load: () => import('../pages/Criticality'), charts: true },
  '/learning': { load: () => import('../pages/Learning'), charts: true },
  '/replay': { load: () => import('../pages/Replay'), charts: false },
  '/methods': { load: () => import('../pages/Methods'), charts: false },
};

/** Pull one route's chunk now. Used by the nav links on hover, focus and touch-start. */
export function prefetchRoute(path: string): void {
  void ROUTE_CHUNKS[path]?.load();
}
