// ============================================================
//  Tavla V2 – Service Worker  (v3)
//  Strateji:
//    • Statik assets (HTML/JS/CSS/ikonlar): Cache-first
//    • API (/api/*) ve WebSocket: Network-only / bypass
//    • HTML navigasyon: Stale-while-revalidate
//    • Çevrimdışı: fallback sayfası
// ============================================================

const CACHE_VERSION = 'v3';
const CACHE_NAME    = `tavla-v2-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/game.js',
  '/style.css',
  '/analyze.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .catch(err => console.warn('[SW] Precache hatası:', err))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('tavla-v2-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // WebSocket bypass
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // API: her zaman network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Çevrimdışı: API erişilemez' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        })
      )
    );
    return;
  }

  // Farklı origin bypass
  if (url.origin !== self.location.origin) return;

  // Sadece GET
  if (request.method !== 'GET') return;

  // Statik dosyalar: cache-first
  if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML ve diğer: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Stratejiler ───────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  } catch {
    return new Response('Çevrimdışı', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(r => { if (r.ok) cache.put(request, r.clone()); return r; })
    .catch(() => null);
  return cached || await fetchPromise || offlinePage();
}

function offlinePage() {
  return new Response(`<!DOCTYPE html><html lang="tr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tavla V2 – Çevrimdışı</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
justify-content:center;background:linear-gradient(-45deg,#020617,#1e1b4b,#2e1065,#0f172a);
color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center;gap:16px;padding:24px}
.icon{font-size:64px}.title{font-size:22px;font-weight:700;color:#f59e0b}
p{font-size:13px;opacity:.6;max-width:280px;line-height:1.6}
button{margin-top:8px;padding:12px 28px;border-radius:12px;
background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);
color:#f59e0b;font-size:14px;cursor:pointer;font-weight:600}
</style></head><body>
<div class="icon">🎲</div>
<div class="title">Bağlantı Yok</div>
<p>Tavla V2'ye bağlanmak için internet bağlantısı gerekiyor.</p>
<button onclick="location.reload()">🔄 Tekrar Dene</button>
</body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=utf-8' }, status: 503 });
}

// ── Push Notifications (hazır altyapı) ────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const d = event.data.json();
  self.registration.showNotification(d.title || 'Tavla V2', {
    body: d.body || '', icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png', vibrate: [200, 100, 200],
    data: { url: d.url || '/' }
  });
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
