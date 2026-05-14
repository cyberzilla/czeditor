// CZEditor Service Worker — Enables PWA install + offline caching
const CACHE_NAME = 'czeditor-v2.0.1';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './engine.js',
    './editor-ui.js',
    './editor-features.js',
    './manifest.json'
];

// Install: cache core assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for dynamic, cache-first for static assets
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // manifest.json: always from network (never cache)
    if (url.pathname.endsWith('manifest.json')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Lang configs and fonts: cache-first
    if (url.pathname.includes('/lang/') || url.pathname.includes('/font/')) {
        e.respondWith(
            caches.match(e.request).then(cached =>
                cached || fetch(e.request).then(resp => {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                    return resp;
                })
            )
        );
        return;
    }
    // Core assets: network-first with cache fallback
    e.respondWith(
        fetch(e.request).then(resp => {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            return resp;
        }).catch(() => caches.match(e.request))
    );
});