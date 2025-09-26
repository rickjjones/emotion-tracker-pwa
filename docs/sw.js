// service worker for docs/ site (use relative paths so it works on GitHub Pages project sites)
const CACHE_NAME = 'emotion-tracker-v6';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icon-192x192.svg',
  'icon-512x512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Notify clients when there's a new service worker activated
self.addEventListener('activate', event => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
    })
  );
});

// Allow the page to tell the SW to skipWaiting and activate immediately
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  // For navigation requests, try network then fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
      if (event.request.method === 'GET' && resp && resp.status === 200) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return resp;
    }).catch(() => caches.match('index.html')))
  );
});
