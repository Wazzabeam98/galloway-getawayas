// Galloway Getaways service worker.
//
// WHAT IT CACHES, AND ONLY THAT: the site's own static build files
// (/_next/static — fingerprinted, never change), the app icons, and one
// offline page. Nothing else is ever put in the cache:
//
//   - no page HTML (signed-in pages, prices and availability all live in
//     pages, and a cached one would show yesterday's price or someone else's
//     account) — pages always come from the network; only when the network
//     is unreachable is the offline page shown instead
//   - no /api, no /_next/image, no /_next/data
//   - nothing from another origin — Supabase, Stripe, Mapbox are never touched
//   - nothing but GET
//
// Requests it does not recognise are left alone entirely (no respondWith), so
// the browser handles them exactly as it would with no service worker.
//
// Also shows push notifications and opens the right page when one is tapped.

const VERSION = 'v1';
const STATIC_CACHE = 'gg-static-' + VERSION;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];
const MAX_STATIC_ENTRIES = 200;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('gg-') && k !== STATIC_CACHE).map((k) => caches.delete(k)));
        if (self.registration.navigationPreload) {
            try { await self.registration.navigationPreload.enable(); } catch (e) { /* optional */ }
        }
        await self.clients.claim();
    })());
});

function isStaticAsset(url) {
    return url.origin === self.location.origin
        && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === OFFLINE_URL);
}

async function trim(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_STATIC_ENTRIES) return;
    await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Pages: always the network. The offline page only when there is none.
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const preloaded = await event.preloadResponse;
                if (preloaded) return preloaded;
                return await fetch(req);
            } catch (e) {
                const cache = await caches.open(STATIC_CACHE);
                return (await cache.match(OFFLINE_URL)) || Response.error();
            }
        })());
        return;
    }

    if (!isStaticAsset(url)) return;

    // Fingerprinted build files and icons: cache first.
    event.respondWith((async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {});
        }
        return res;
    })());
});

// ---------------------------------------------------------------- push

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    const title = data.title || 'Galloway Getaways';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
    event.waitUntil((async () => {
        const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of open) {
            if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                await client.focus();
                if ('navigate' in client) {
                    try { await client.navigate(target); } catch (e) { /* uncontrolled */ }
                }
                return;
            }
        }
        await self.clients.openWindow(target);
    })());
});
