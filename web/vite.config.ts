import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://ankthba.github.io/hypnagogia/.
// The app uses a HashRouter, so a relative base works from any path (root, /hypnagogia/, file preview)
// and data fetches become ./data/... regardless of whether GITHUB_PAGES is set at build time.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // React is in the shell and is always needed. Recharts is NOT listed here on purpose: the
        // routes are lazy, so leaving it to the chunker keeps it out of the entry graph and it is
        // fetched with the first page that actually charts something.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
