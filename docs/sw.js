/* Service worker: app shell cache-first, data network-first (fallback cache saat offline) */
const VERSION = 'v25';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'geo.js', 'quant.js', 'siklus.js', 'term.js', 'makro.js', 'ext.js', 'pesan.js', 'porto.js', 'ipo.js', 'live.js', 'rebal.js', 'aliran.js', 'dunia.js', 'etf.js', 'dca.js', 'pajak.js', 'kekayaan.js', 'terminal.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
        const net = fetch(req, url.origin === location.origin ? { cache: 'no-cache' } : undefined)
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

/* ---------------- notifikasi push (dikirim GitHub Actions lewat Web Push) */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Radar Saham', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Radar Saham', {
      body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || 'radar',
      renotify: true, data: { url: d.url || './#/pesan' },
    });
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push' }));
    if (self.navigator && self.navigator.setAppBadge) { try { await self.navigator.setAppBadge(); } catch (err) { /* */ } }
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#/pesan', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
