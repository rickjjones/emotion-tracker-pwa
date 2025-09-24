self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open('emotion-tracker-cache').then((cache) => {
            return cache.addAll([
                '/',
                '/src/index.html',
                '/src/app.js',
                '/src/styles.css',
                '/manifest.json',
            ]);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});