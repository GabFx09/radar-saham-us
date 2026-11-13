/* Service worker: app shell cache-first, data network-first (fallback cache saat offline) */
const VERSION = 'v7';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'geo.js', 'quant.js', 'siklus.js', 'term.js', 'makro.js', 'ext.js', 'terminal.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Data screener & riwayat harga: network-first
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // App shell & font: stale-while-revalidate
  if (url.origin === location.origin || url.host.includes('fonts.g')) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
            return res;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
  }
});
