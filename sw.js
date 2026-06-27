/* Service worker — offline shell for the sealed dossier.
   Code/markup (html/js/css/xml/manifest) is network-first so a new deploy is
   picked up immediately, with the cache as the offline fallback. Heavy media
   (audio/video/images) is cache-first and only cached after first fetch. */
const CACHE = 'dossier-v2';
const SHELL = [
  '/',
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

const netFirst = (req) =>
  fetch(req).then((res) => { cachePut(req, res.clone()); return res; })
    .catch(() => caches.match(req));

const cacheFirst = (req) =>
  caches.match(req).then((cached) => cached || fetch(req).then((res) => { cachePut(req, res.clone()); return res; }));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: always try the network, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(netFirst(req).then((r) => r || caches.match('/')));
    return;
  }

  if (url.origin === location.origin) {
    // Code/markup: network-first (deploys land immediately; cache is offline backup).
    if (/\.(?:js|css|html|json|webmanifest|xml)$/.test(url.pathname)) {
      e.respondWith(netFirst(req));
      return;
    }
    // Media and everything else same-origin: cache-first.
    e.respondWith(cacheFirst(req));
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
