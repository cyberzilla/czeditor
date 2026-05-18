// CZEditor Service Worker — Enables PWA install + offline caching
const CACHE_NAME = 'czeditor-v2.6.1';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './themes/dark.css',
    './themes/light.css',
    './script.js',
    './engine.js',
    './editor-ui.js',
    './editor-view.js',
    './editor-view.css',
    './editor-model.js',
    './editor-features.js',
    './filesystem.js',
    './i18n.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    // i18n translations
    './i18n/en.json',
    './i18n/id.json',
    // Language registry (individual lang files are cached dynamically)
    './lang/registry.json',
    // Fonts
    './font/config.json',
    './font/MapleMono-Regular.ttf.woff2',
    './font/MapleMono-Italic.ttf.woff2',
    './font/MapleMono-Thin.ttf.woff2',
    './font/MapleMono-ThinItalic.ttf.woff2',
    './font/MapleMono-ExtraLight.ttf.woff2',
    './font/MapleMono-ExtraLightItalic.ttf.woff2',
    './font/MapleMono-Light.ttf.woff2',
    './font/MapleMono-LightItalic.ttf.woff2',
    './font/MapleMono-Medium.ttf.woff2',
    './font/MapleMono-MediumItalic.ttf.woff2',
    './font/MapleMono-SemiBold.ttf.woff2',
    './font/MapleMono-SemiBoldItalic.ttf.woff2',
    './font/MapleMono-Bold.ttf.woff2',
    './font/MapleMono-BoldItalic.ttf.woff2',
    './font/MapleMono-ExtraBold.ttf.woff2',
    './font/MapleMono-ExtraBoldItalic.ttf.woff2'
];

// Install: cache core assets + dynamically cache all lang files from registry
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await cache.addAll(ASSETS);
            // Dynamically cache all language config files from registry
            try {
                const resp = await fetch('./lang/registry.json');
                if (resp.ok) {
                    const registry = await resp.json();
                    const langUrls = registry.map(lang => `./lang/${lang.id}.json`);
                    await cache.addAll(langUrls);
                }
            } catch (e) { /* registry fetch failed, lang files will be cached on demand */ }
        })
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