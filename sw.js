// Fuente del service worker H-89. build-offline.mjs sustituye el hash del shell.
const BUILD_HASH = 'ae53f13541729ecb3fff';
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
    cache.addAll(STATIC_PATHS.map(path => new Request(new URL(path, SCOPE_URL).href, { cache: 'no-store' })))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('balam-shell-') && name !== SHELL_CACHE)
      .map(async name => {
        const entries = await (await caches.open(name)).keys();
        // La adopción online conserva cualquier evidencia comercial antes de retirarla.
        if (entries.some(entry => /\.supabase\.co\/(?:rest|functions|graphql)\/v1(?:\/|$)/.test(entry.url))) return;
        await caches.delete(name);
      }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'BALAM_ACTIVATE_UPDATE' || type === 'BALAM_SKIP_WAITING') {
    event.waitUntil(activateWhenPagesSafe().then(accepted => {
      event.ports?.[0]?.postMessage({ type: 'BALAM_UPDATE_RESULT', accepted, generation: BUILD_HASH });
    }));
  }
  if (type === 'BALAM_VERSION' && event.source) {
    event.source.postMessage({ type: 'BALAM_VERSION', buildHash: BUILD_HASH });
  }
});

let activationAttempt = null;
function activateWhenPagesSafe() {
  if (activationAttempt) return activationAttempt;
  activationAttempt = (async () => {
    const pages = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter(client => inScope(new URL(client.url)));
    const results = await Promise.all(pages.map(client => new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = safe => { clearTimeout(timer); channel.port1.close(); resolve(safe); };
      const timer = setTimeout(() => finish(false), 1500);
      channel.port1.onmessage = event => finish(event.data?.protocol === 1
        && event.data.generation === BUILD_HASH && event.data.safe === true);
      client.postMessage({ type: 'BALAM_UPDATE_SAFETY', protocol: 1, generation: BUILD_HASH }, [channel.port2]);
    })));
    if (results.some(safe => !safe)) return false;
    const current = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter(client => inScope(new URL(client.url)));
    if (current.some(client => !pages.some(previous => previous.id === client.id))) return false;
    await self.skipWaiting();
    return true;
  })().finally(() => { activationAttempt = null; });
  return activationAttempt;
}

function inScope(url) {
  return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
}

function relativePath(url) {
  return url.pathname.slice(SCOPE_URL.pathname.length);
}

async function navigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
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
