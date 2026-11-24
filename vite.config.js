import { defineConfig } from 'vite';

// Relative base so the built index.html works from any path
// (Cloudflare Pages root, a subdirectory, or opened via a static file server).
export default defineConfig({
  base: './',
  // Inline (empty) PostCSS config: prevents Vite from walking up the
  // directory tree and loading an unrelated postcss.config from a parent
  // folder. This project has no PostCSS plugins by design.
  css: { postcss: { plugins: [] } },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split three.js into its own chunk for cleaner caching.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
