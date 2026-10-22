// Service worker for the installed app (see README "Install on your phone").
//
// Deliberately small, and written so it works on any host and under any base path
// (GitHub Pages /WebBudget/, a custom domain, or a self-hosted box):
//   - API calls are never touched: cross-origin requests (the API on Render) and any
//     same-origin /api/ path (a self-hosted API behind the same domain) go straight to
//     the network, so money data is always live and never cached here.
//   - Page loads are network-first, so a new deploy shows up on the next open; the
//     cached copy is only used when the phone is offline.
//   - Built files under assets/ have content hashes in their names, so they're cached
//     forever (cache-first) and trimmed to the most recent few.

const CACHE = 'ledger-shell-v1';
const MAX_ASSETS = 80;
const SHELL = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => r.url.includes('/assets/'));
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    trim(cache);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API on another host, fonts CDNs, etc.
  if (!url.href.startsWith(self.registration.scope)) return;
  if (url.pathname.includes('/api/')) return; // a same-origin API when self-hosted

  if (request.mode === 'navigate') {
    // HashRouter: every screen is the same index page, so one cached copy covers them all.
    event.respondWith(networkFirst(request, SHELL));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request, request));
  }
});
