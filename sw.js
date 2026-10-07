// Free TV service worker: caches the app shell and the last playlist so the app
// opens instantly and still lists channels when the playlist host is unreachable.
const VERSION = 'freetv-v8';
const SHELL = [
  './',
  'index.html',
  'styles.css?v=8',
  'app.js?v=8',
  'manifest.webmanifest',
  'vendor/hls.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Playlists: answer from the saved copy right away (if there is one) and refresh it
  // in the background, so the app opens fast; the first visit waits for the network.
  if (url.pathname.endsWith('.m3u')) {
    event.respondWith(
      caches.open(VERSION).then((cache) => cache.match(req.url).then((hit) => {
        const net = fetch(req.url)
          .then((res) => {
            if (res.ok) cache.put(req.url, res.clone());
            return res;
          });
        if (hit) {
          event.waitUntil(net.catch(() => {}));
          return hit;
        }
        return net;
      })),
    );
    return;
  }

  // App files: network first so updates show up right away, cached copy when offline.
  // Streams and logos from other sites pass straight through.
  if (url.origin === self.location.origin) {
    event.respondWith(
      // no-cache: always check with the server so a new deploy is picked up immediately.
      fetch(req.url, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req.url, copy)); }
          return res;
        })
        .catch(() => caches.match(req.url, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || Response.error())),
    );
  }
});
