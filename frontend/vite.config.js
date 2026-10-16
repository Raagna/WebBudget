import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site from a subpath
// (username.github.io/repo-name/), not the domain root, so every asset
// URL Vite emits needs that prefix baked in at build time. The GitHub
// Actions workflow (.github/workflows/deploy-pages.yml) sets BASE_PATH to
// "/repo-name/" when building for Pages; local `npm run dev` and any other
// host (Vercel, Netlify, a custom domain) leave it unset and get "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  server: {
    port: 5173,
    // In development the app calls the API at /api on its own origin and
    // Vite forwards it to the backend. A phone on the same Wi-Fi then only
    // needs http://<this-PC>:5173 (run `npm run dev:lan`) - no second port
    // to reach and no CORS setup. Production builds use VITE_API_URL.
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:4000',
    },
  },
});
