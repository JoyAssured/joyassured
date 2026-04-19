const CACHE_NAME = 'joyassured-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/client.html',
  '/worker.html',
  '/admin.html',
  '/style.css',
  '/app.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap'
];

// Install Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate & Cleanup Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Strategy: Network First, then Cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
