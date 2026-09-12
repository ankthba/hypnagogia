/** @type {import('tailwindcss').Config} */
// Tailwind is kept for layout utilities only (flex, grid, gap, spacing). Every colour comes from
// the CSS variables declared in src/index.css so the palette follows the theme; the entries below
// let a utility like `text-muted` or `border-rule` resolve to those variables. There is no
// sans-serif face anywhere: `font-sans` is EB Garamond too, so nothing can fall back to system-ui.
const serif = ['"EB Garamond"', 'Garamond', 'Georgia', 'serif'];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    fontFamily: {
      sans: serif,
      serif: serif,
      display: serif,
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
    },
    // STYLE.md: no radius above 2px and no drop shadows. Declared at the theme root (not under
    // `extend`) so rounded-xl / rounded-full / shadow-* cannot reintroduce them.
    borderRadius: {
      none: '0',
      DEFAULT: '2px',
      sm: '2px',
      md: '2px',
      lg: '2px',
      full: '2px',
    },
    boxShadow: {
      none: 'none',
      DEFAULT: 'none',
    },
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-alt': 'var(--color-bg-alt)',
        fg: 'var(--color-fg)',
        muted: 'var(--color-muted)',
        rule: 'var(--color-border)',
        'rule-hover': 'var(--color-border-hover)',
        link: 'var(--color-link)',
        'link-hover': 'var(--color-link-hover)',
        mat: 'var(--color-mat)',
        passed: 'var(--color-passed)',
        failed: 'var(--color-failed)',
        // Preflight paints placeholder text with colors.gray.400; point it at the muted token.
        gray: { 400: 'var(--color-muted)' },
      },
      // Preflight's `*, ::before, ::after { border-color }` reads this, so a bare `border` utility
      // gets the hairline token instead of Tailwind grey.
      borderColor: {
        DEFAULT: 'var(--color-border)',
      },
      maxWidth: {
        measure: 'var(--measure)',
        wide: 'var(--measure-wide)',
      },
    },
  },
  plugins: [],
};
