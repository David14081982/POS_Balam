// Fuente del service worker H-89. build-offline.mjs sustituye el hash del shell.
const BUILD_HASH = 'cf0ade3f0387ff298b09';
const SHELL_CACHE = `balam-shell-${BUILD_HASH}`;
const BRAND_CACHE = 'balam-pwa-brand-v1';
const SCOPE_URL = new URL('./', self.location.href);
const STATIC_PATHS = [
  'index.html',
  'manifest.webmanifest',
  'pwa/icon-192.png',
  'pwa/icon-512.png',
  'pwa/icon-maskable-512.png',
  'pwa/apple-touch-icon.png',
  'pwa/favicon-64.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => (
    cache.addAll(STATIC_PATHS.map(path => new URL(path, SCOPE_URL).href))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('balam-shell-') && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'BALAM_SKIP_WAITING') self.skipWaiting();
  if (type === 'BALAM_VERSION' && event.source) {
    event.source.postMessage({ type: 'BALAM_VERSION', buildHash: BUILD_HASH });
  }
});

function inScope(url) {
  return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
}

function relativePath(url) {
  return url.pathname.slice(SCOPE_URL.pathname.length);
}

async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) return response;
  } catch (error) { /* offline: shell below */ }
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(new URL('index.html', SCOPE_URL).href)) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (!inScope(url) || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }

  const path = relativePath(url);
  if (/^manifest-[a-f0-9]+\.webmanifest$/.test(path) || path.startsWith('pwa/runtime/')) {
    event.respondWith(caches.open(BRAND_CACHE).then(async cache => (
      (await cache.match(request)) || new Response('PWA brand resource unavailable', { status: 404 })
    )));
    return;
  }

  if (STATIC_PATHS.includes(path)) {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (
      (await cache.match(request)) || fetch(request)
    )));
  }
  // Supabase, APIs y todo recurso no permitido siguen su ruta de red normal.
});
