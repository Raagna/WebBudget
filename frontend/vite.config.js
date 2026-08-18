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
  server: { port: 5173 },
});
