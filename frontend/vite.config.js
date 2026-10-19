import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME } from './src/brand.js';
import { lanHttps } from './lan-https.js';

// GitHub Pages serves a project site from a subpath
// (username.github.io/repo-name/), not the domain root, so every asset
// URL Vite emits needs that prefix baked in at build time. The GitHub
// Actions workflow (.github/workflows/deploy-pages.yml) sets BASE_PATH to
// "/repo-name/" when building for Pages; local `npm run dev` and any other
// host (Vercel, Netlify, a custom domain) leave it unset and get "/".
export default defineConfig({
  plugins: [
    react(),
    // HTTPS with a phone-trustable certificate, only for `--mode lan`
    // (npm run preview:lan). See lan-https.js and README "Phone testing".
    lanHttps(),
    // Installable app: manifest + a Workbox service worker. The plugin
    // takes scope and start_url from `base`, so it follows BASE_PATH too.
    VitePWA({
      // A new version activates on the next launch. No forced reload, so
      // a half-typed transaction is never wiped by an update.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: './',
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'Household budget: scan receipts and check what is safe to spend.',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#173a2f', // rail
        background_color: '#f4f6f2', // ground, shown on the launch splash
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the home-screen icon (Android) to jump straight in.
        // ?add=1 opens the add/scan form (see pages/Transactions.jsx).
        shortcuts: [
          { name: 'Scan a receipt', short_name: 'Scan', url: './#/transactions?add=1' },
          { name: 'Safe to spend', short_name: 'Dashboard', url: './#/' },
        ],
      },
      workbox: {
        // The app shell only: HTML, the hashed JS/CSS bundles and the font
        // (icons are added from includeAssets + the manifest). pdf.js, used
        // only when someone picks a PDF bill, is left out so installing
        // doesn't download ~1.7 MB nobody may need; it still loads from the
        // network on demand.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        globIgnores: ['**/pdf-*.js', '**/pdf.worker*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//, /\/lan-ca\.crt$/],
        cleanupOutdatedCaches: true,
        // Money data is never cached: every /api request (same-origin in
        // dev, VITE_API_URL's host in production) goes to the network,
        // and fails rather than showing a stale balance when offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  base: process.env.BASE_PATH || '/',
  server: {
    port: 5173,
    // In development the app calls the API at /api on its own origin and
    // Vite forwards it to the backend. A phone on the same Wi-Fi then only
    // needs http://<this-PC>:5173 (run `npm run dev:lan`) - no second port
    // to reach and no CORS setup. Production builds use VITE_API_URL
    // (`/api` in the lan build, which `vite preview` proxies the same way).
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:4000',
    },
  },
});
