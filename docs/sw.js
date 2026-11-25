// service worker for docs/ site (use relative paths so it works on GitHub Pages project sites)
const CACHE_NAME = 'emotion-tracker-v34';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

// Install: precache assets but do NOT skipWaiting here. The new worker waits
// until the page asks it to take over (via the update banner), so the user
// isn't switched to new code mid-session.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // cache: 'reload' bypasses the HTTP cache so we precache fresh files
      cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
    )
  );
});

// Activate: drop old caches and take control of open pages.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to tell the SW to skipWaiting and activate immediately
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  // Only handle this site's own files. Weather lookups and other cross-origin
  // requests go straight to the network, so stale weather is never served from cache.
  if (new URL(event.request.url).origin !== self.location.origin) return;

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
