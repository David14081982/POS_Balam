const RUNTIME_CACHE = 'h89-runtime-brand-v1';
const SCOPE_PATH = '/POS_Balam/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  const relative = url.pathname.slice(SCOPE_PATH.length);
  if (!relative.startsWith('runtime/') && !/^manifest-[a-f0-9]+\.webmanifest$/.test(relative)) return;
  event.respondWith(caches.open(RUNTIME_CACHE).then(async cache => {
    const response = await cache.match(event.request);
    return response || new Response('Runtime PWA asset not materialized', { status: 404 });
  }));
});
