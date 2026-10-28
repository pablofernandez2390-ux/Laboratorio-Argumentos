/* Laboratorio de argumentos — service worker.
   Estrategia: red primero (para que las actualizaciones lleguen apenas hay conexión)
   y, si no hay red, lo último guardado. Los datos del usuario NO pasan por acá:
   viven en IndexedDB. Al publicar una versión nueva, cambiá VERSION. */
const VERSION = '0.1.0';
const CACHE = 'laboratorio-argumentos-' + VERSION;
const FILES = ['./', 'index.html', 'styles.css', 'logic.js', 'db.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('laboratorio-argumentos-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined) || Response.error())
      )
  );
});
