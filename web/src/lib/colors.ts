import { useEffect, useState } from 'react';
import type { Classification, StageStatus } from '../types';

/**
 * Presentation colours. Everything here is a CSS variable reference so the theme (light / dark,
 * and the white figure mat that forces light) resolves it at the point of use: inline SVG
 * (Recharts, the forest plot) and inline styles both accept `var(--x)`. Only the canvas raster
 * needs literal colours; it resolves them with `resolveColors` at draw time.
 */

/** Criticality classification labels the legend, bands and markers support; a superset of the contract enum. */
export type ClassLabel = Classification | 'subcritical' | 'not_run';

export const CLASS_LABELS: ClassLabel[] = ['silent', 'subcritical', 'critical', 'saturated', 'indeterminate', 'not_run'];

/** Marker / text colour per classification. */
export const CLASS_COLORS: Record<ClassLabel, string> = {
  silent: 'var(--color-class-silent)',
  subcritical: 'var(--color-class-subcritical)',
  critical: 'var(--color-class-critical)',
  saturated: 'var(--color-class-saturated)',
  indeterminate: 'var(--color-class-indeterminate)',
  not_run: 'var(--color-class-not-run)',
};

/**
 * The same classifications as *text* colour.
 *
 * `CLASS_COLORS` is tuned for 5px markers and background bands, where a light warm grey is right.
 * Two of those hues are unreadable as small body text: silent is 2.9:1 on the white figure mat and
 * indeterminate 2.2:1, both below the 4.5:1 floor and below even the 3:1 large-text floor. These
 * are the darkened variants (defined next to the marker hues in index.css), used wherever the
 * classification is written as a word rather than drawn as a dot.
 */
export const CLASS_INK: Record<ClassLabel, string> = {
  silent: 'var(--color-class-silent-ink)',
  subcritical: 'var(--color-class-subcritical-ink)',
  critical: 'var(--color-class-critical-ink)',
  saturated: 'var(--color-class-saturated-ink)',
  indeterminate: 'var(--color-class-indeterminate-ink)',
  not_run: 'var(--color-class-not-run-ink)',
};

/** Background band per classification (drawn behind each sigma on the sweep charts). */
export const CLASS_BAND: Record<ClassLabel, string> = {
  silent: 'var(--band-silent)',
  subcritical: 'var(--band-subcritical)',
  critical: 'var(--band-critical)',
  saturated: 'var(--band-saturated)',
  indeterminate: 'var(--band-indeterminate)',
  not_run: 'var(--band-not-run)',
};

/** For marks and bands: dots, swatches, ReferenceArea fills. Not for text. */
export function classColor(cls: string | null | undefined): string {
  return CLASS_COLORS[cls as ClassLabel] ?? CLASS_COLORS.indeterminate;
}

/** For the classification written as a word. Same hue family, dark enough to read. */
export function classInk(cls: string | null | undefined): string {
  return CLASS_INK[cls as ClassLabel] ?? CLASS_INK.indeterminate;
}

export function classBand(cls: string | null | undefined): string {
  return CLASS_BAND[cls as ClassLabel] ?? CLASS_BAND.indeterminate;
}

export const STATUS_STYLE: Record<StageStatus, { label: string; icon: string; tone: string }> = {
  passed: { label: 'passed', icon: '✓', tone: 'passed' },
  failed: { label: 'failed', icon: '✗', tone: 'failed' },
  artifact: { label: 'artifact', icon: '!', tone: 'artifact' },
  running: { label: 'running', icon: '…', tone: 'running' },
  not_run: { label: 'not run', icon: '·', tone: 'not_run' },
};

/** Chart series: ink, Prussian blue, muted, and the status colours where they mean something. */
export const SERIES = {
  A: 'var(--color-fg)', // ensemble A / odor A: ink
  B: 'var(--color-link)', // ensemble B / odor B: Prussian blue
  other: 'var(--color-muted)',
  threshold: 'var(--color-failed)',
  grid: 'var(--color-border)',
  axis: 'var(--color-muted)',
  ink: 'var(--color-fg)',
  mat: 'var(--color-mat)',
  passed: 'var(--color-passed)',
  failed: 'var(--color-failed)',
};

/** Per-seed palette for overlaid CCDFs: ink, blue, muted, then the quieter status hues. */
const SEED_PALETTE = [
  'var(--color-fg)',
  'var(--color-link)',
  'var(--color-muted)',
  'var(--color-passed)',
  'var(--color-failed)',
  'var(--color-class-subcritical)',
  'var(--color-link-hover)',
  'var(--color-border-hover)',
];
export function seedColor(i: number) {
  return SEED_PALETTE[i % SEED_PALETTE.length];
}

/** Recharts tooltip box, drawn on the mat. */
export const TOOLTIP_STYLE = {
  background: 'var(--color-mat)',
  border: '1px solid var(--color-border-hover)',
  borderRadius: 2,
  color: 'var(--color-fg)',
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '4px 8px',
};

export const CHART_FONT = '"EB Garamond", Garamond, Georgia, serif';

/**
 * Resolve `var(--x)` strings to literal CSS colours as they compute on `el` (so a probe inside
 * the white mat reads the light palette). Custom properties hold `light-dark(...)` unresolved,
 * so the value is read back through a `color` property rather than getPropertyValue.
 */
export function resolveColors<K extends string>(el: Element, vars: Record<K, string>): Record<K, string> {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  el.appendChild(probe);
  const out = {} as Record<K, string>;
  for (const k of Object.keys(vars) as K[]) {
    probe.style.color = vars[k];
    out[k] = getComputedStyle(probe).color || vars[k];
  }
  el.removeChild(probe);
  return out;
}

/**
 * A counter that changes whenever the resolved theme may have changed (the colophon toggle
 * rewrote data-theme, or the system preference flipped). Canvas drawing effects list it as a
 * dependency so they repaint with the new palette.
 */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', bump);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', bump);
    };
  }, []);
  return v;
}
