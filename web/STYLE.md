# Viewer style guide (match aniketh.net)

Source of truth: https://aniketh.net/assets/css/style.css (copy in docs/aniketh_net_style_reference.css).

**Typeface.** EB Garamond everywhere (Google Fonts: `EB+Garamond:ital,wght@0,400;0,500;1,400`),
fallback `Garamond, Georgia, serif`. Body 1.0625rem / line-height 1.7, weight 400. Headings weight
400, line-height 1.15. Page titles and names in *italic* serif. Labels and nav in letterspaced small caps
(`text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem`). Numbers in tables use
`font-variant-numeric: tabular-nums`. No sans-serif, no monospace except inside code blocks (use the
system monospace at 0.85em there).

**Palette (CSS variables; light / dark via `color-scheme` and `:root[data-theme=...]`).**

| token | light | dark |
|---|---|---|
| `--color-bg` | `#faf9f5` (ivory) | `#1a1917` (warm near-black) |
| `--color-bg-alt` | `#f0eee8` | `#22211e` |
| `--color-fg` (ink) | `#262624` | `#e8e6df` |
| `--color-muted` | `#6f695e` | `#a49d90` |
| `--color-border` | `rgba(38,38,36,0.14)` | `rgba(232,230,223,0.16)` |
| `--color-border-hover` | `rgba(38,38,36,0.3)` | `rgba(232,230,223,0.32)` |
| `--color-link` (Prussian blue) | `#2f5575` | `#8fb3d4` |
| `--color-link-hover` | `#4a749b` | `#b3cde5` |
| `--color-link-underline` | `rgba(47,85,117,0.35)` | `rgba(143,179,212,0.38)` |
| `--color-mat` (white card behind figures) | `#ffffff` | `#ffffff` |

Status colours for this viewer only (not on aniketh.net; keep them muted, same warmth):
passed `#4f7a4a` / dark `#8fbf88`; failed/artifact `#9a3f35` / dark `#d98b82`; not-run = `--color-muted`;
regime bands: silent `--color-bg-alt`, critical `rgba(47,85,117,0.12)`, saturated `rgba(154,63,53,0.10)`.
Chart series: ink, Prussian blue, muted; never saturated Tailwind colours.

**Structure.** Hairline rules (`1px solid var(--color-border)`) for structure, no drop shadows, no
rounded cards larger than 2px radius, generous vertical space (`--space-md: 2.5rem`, `--space-lg: 4.5rem`).
Centered column; prose measure 36rem, figures may extend to 64rem. Masthead: site name centered in
italic-free display serif, nav row underneath in small serif links, current page italic + muted.
Selection colour: background ink, text bg. Links: inherit colour, underline with `--color-link-underline`.
Theme toggle in the footer ("colophon"): System / Light / Dark, stored in localStorage key `theme`,
applied as `data-theme` on `<html>` before paint.
