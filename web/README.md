# hypnagogia - results viewer

Static viewer for the whole-brain *Drosophila* leaky integrate-and-fire replay
simulation. Served from GitHub Pages at <https://ankthba.github.io/hypnagogia/>.

## No fake data

The site contains **no results of its own**. Every number, table, curve, and
raster is read at page-load from `public/data/*.json` and `public/data/**/*.bin`,
which are written by `scripts/export_web.py` from real simulation outputs
according to [`DATA_CONTRACT.md`](./DATA_CONTRACT.md). There is no demo mode,
no sample JSON, no placeholder values. If a file is missing or a stage has not
run, the page renders an explicit "Not yet run" panel naming the file and the
script that produces it. Failures (`failed`, `artifact`) are rendered as
prominently as successes.

`public/data/` is git-ignored except for `.gitkeep`; the pipeline populates it.
The Methods page's prose is documentation of the model, not a result; its
parameter table is read from `manifest.json`.

## Develop

```sh
cd web
npm ci            # or npm install
npm run dev       # http://localhost:5173/  (hash routes: /#/criticality etc.)
```

Put exported files in `web/public/data/` (e.g. run `python scripts/export_web.py`
from the repo root) and reload.

## Build

```sh
npm run build                 # tsc --noEmit && vite build  ->  web/dist  (base '/')
GITHUB_PAGES=1 npm run build  # base '/hypnagogia/' for GitHub Pages
npm run preview
```

Deployment is automated by `.github/workflows/deploy-pages.yml` on push to
`main`.

## Layout

- `src/lib/data.ts`   - same-origin fetch of data files, stage metadata (file + producing script)
- `src/lib/binary.ts` - raw little-endian typed-array loaders for raster / trace sidecars
- `src/types.ts`      - TypeScript mirror of DATA_CONTRACT.md
- `src/pages/`        - Overview, Criticality, Learning, Replay, Methods
- `src/components/`   - status banners, not-run panel, provenance footer, tables, charts (Recharts + canvas raster)
