const CACHE = 'voicenote-shell-v1';
const CDN_CACHE = 'voicenote-cdn-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    // the transformers.js library itself — cache-first at runtime so the app
    // still loads offline even if the browser's own HTTP cache evicts it.
    // Model weight files (a different host) are left alone — transformers.js
    // manages their caching itself.
    e.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      })
    );
  }
});
