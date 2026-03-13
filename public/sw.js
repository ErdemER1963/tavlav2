// Service Worker — Tavla V2 PWA
const CACHE_NAME = 'tavla-v2-cache-v1';

// Cache'lenecek statik dosyalar
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: statik dosyaları cache'le
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate: eski cache'leri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: WebSocket isteklerini atla, diğerlerini cache'ten sun
self.addEventListener('fetch', event => {
  // WebSocket ve API isteklerini service worker'dan geçirme
  const url = new URL(event.request.url);
  if (url.protocol === 'ws:' || url.protocol === 'wss:' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Başarılı GET isteklerini cache'e ekle
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
