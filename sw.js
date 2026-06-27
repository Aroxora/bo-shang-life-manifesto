/* Service worker — offline shell for the sealed dossier.
   Bump CACHE to invalidate. The heavy media (audio/video) is intentionally
   left to the network and cached only after it is first fetched. */
const CACHE = 'dossier-v1';
const SHELL = [
  '/',
  '/index.html',
  '/zh.html',
  '/styles.css',
  '/script.js',
  '/404.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/tts/witness-poster.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: network-first, fall back to cached shell (offline reading).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { cachePut(req, res.clone()); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  // Same-origin assets: cache-first, refresh in background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => { cachePut(req, res.clone()); return res; }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Cross-origin (fonts): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => { cachePut(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    })
  );
});

function cachePut(req, res) {
  if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
    caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
  }
}
