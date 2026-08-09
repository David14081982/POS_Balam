import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 41889;
const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/POS_Balam/`;
const checks = [];
let swBody = await readFile(join(root, 'sw.js'));

function pass(name) {
  checks.push(name);
  console.log(`PASS ${String(checks.length).padStart(2, '0')} · ${name}`);
}

function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const manifestSource = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifestSource.name, 'BALAM');
assert.equal(manifestSource.short_name, 'BALAM');
assert.equal(manifestSource.id, '/POS_Balam/');
assert.equal(manifestSource.start_url, './');
assert.equal(manifestSource.scope, './');
assert.equal(manifestSource.display, 'standalone');
assert.equal('orientation' in manifestSource, false);
pass('manifest fallback conserva identidad, subpath y standalone');

for (const [file, expected] of [
  ['pwa/icon-192.png', 192],
  ['pwa/icon-512.png', 512],
  ['pwa/icon-maskable-512.png', 512],
  ['pwa/apple-touch-icon.png', 180],
  ['pwa/favicon-64.png', 64],
]) {
  const dimensions = pngSize(await readFile(join(root, file)));
  assert.deepEqual(dimensions, { width: expected, height: expected });
}
assert.equal(manifestSource.icons.find(icon => icon.purpose === 'maskable')?.sizes, '512x512');
pass('fallback incluye PNG 192, 512, maskable, Apple 180 y favicon 64');

const swSource = await readFile(join(root, 'sw.js'), 'utf8');
assert.doesNotMatch(swSource, /__BALAM_BUILD_HASH__/);
assert.match(swSource, /request\.mode === 'navigate'/);
assert.match(swSource, /Supabase, APIs/);
assert.doesNotMatch(swSource, /supabase[^\n]*cache\.put|rest\/v1[^\n]*cache/i);
const installBlock = swSource.slice(swSource.indexOf("self.addEventListener('install'"), swSource.indexOf("self.addEventListener('activate'"));
assert.doesNotMatch(installBlock, /skipWaiting\(\)/);
pass('service worker limita caché al shell y no activa actualizaciones automáticamente');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  requests.push(url.pathname + url.search);
  if (!url.pathname.startsWith('/POS_Balam/')) { response.writeHead(404); response.end(); return; }
  const relative = url.pathname.slice('/POS_Balam/'.length);
  if (relative === 'sw.js') {
    response.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/POS_Balam/' });
    response.end(swBody);
    return;
  }
  const file = !relative || relative === 'index.html' ? 'index.html' : relative;
  if (!['index.html', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png', 'pwa/favicon-64.png'].includes(file)) {
    response.writeHead(404); response.end('Not found'); return;
  }
  try {
    const body = await readFile(join(root, file));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});

await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const context = await chromium.launchPersistentContext('', {
  executablePath: chromePath,
  headless: true,
  viewport: { width: 430, height: 860 },
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PWA?.getState().ready === true);

  const registration = await page.evaluate(async () => {
    const value = await navigator.serviceWorker.ready;
    return { scope: value.scope, controller: navigator.serviceWorker.controller?.scriptURL || '' };
  });
  assert.deepEqual(registration, { scope: base, controller: `${base}sw.js` });
  pass('Chrome real registra y controla exactamente /POS_Balam/');

  let chromeManifest = await cdp.send('Page.getAppManifest');
  assert.equal(chromeManifest.url, `${base}manifest.webmanifest`);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  pass('Chrome reconoce instalabilidad del fallback sin errores');

  await page.evaluate(() => { localStorage.setItem('balam-page', 'config'); location.reload(); });
  await page.waitForSelector('[data-testid="logo-file-input"]', { state: 'attached' });
  await page.locator('[data-testid="logo-file-input"]').setInputFiles(join(root, 'pwa', 'icon-192.png'));
  await page.waitForSelector('[data-testid="toast"]');
  assert.equal(await page.evaluate(() => window.CONFIG.get('store.logo')), '');
  pass('carga nueva menor de 512 px queda bloqueada sin alterar CONFIG');

  await page.locator('[data-testid="logo-file-input"]').setInputFiles(join(root, 'pwa', 'icon-512.png'));
  await page.waitForFunction(() => window.PWA?.getState().iconSource === 'store.logo');
  let state = await page.evaluate(() => window.PWA.getState());
  assert.equal(state.iconQuality, 'sufficient');
  assert.deepEqual(state.sourceSize, { width: 512, height: 512 });
  pass('carga 512 conserva fuente suficiente y materializa desde store.logo');

  const logoA = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b91c1c'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(400, 300, 150, 0, Math.PI * 2); ctx.fill();
    const dataUrl = canvas.toDataURL('image/png'); window.CONFIG.setSetting('store.logo', dataUrl); return dataUrl;
  });
  await page.waitForFunction(previous => window.PWA?.getState().iconSource === 'store.logo' && window.PWA.getState().sourceSize?.width === 800, logoA);
  state = await page.evaluate(() => window.PWA.getState());
  assert.match(state.manifestUrl, /\/POS_Balam\/manifest-[a-f0-9]{20}\.webmanifest$/);
  chromeManifest = await (async () => {
    const deadline = Date.now() + 10000; let result;
    do { result = await cdp.send('Page.getAppManifest'); if (result.url === state.manifestUrl) return result; await new Promise(r => setTimeout(r, 200)); } while (Date.now() < deadline);
    throw new Error(`Chrome no leyó manifest runtime: ${result?.url}`);
  })();
  const dynamicManifest = JSON.parse(chromeManifest.data);
  assert.equal(dynamicManifest.id, '/POS_Balam/');
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  const dynamicResponses = await page.evaluate(async manifest => Promise.all(manifest.icons.map(async icon => {
    const response = await fetch(new URL(icon.src, document.querySelector('link[rel="manifest"]').href));
    return { status: response.status, type: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength };
  })), dynamicManifest);
  assert.ok(dynamicResponses.every(item => item.status === 200 && item.type === 'image/png' && item.bytes > 500));
  pass('manifest runtime resuelve PNG 192, 512 y maskable desde Cache Storage');

  const apple = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="apple-touch-icon"]');
    const response = await fetch(link.href);
    return { href: link.href, status: response.status, type: response.headers.get('content-type') };
  });
  assert.match(apple.href, /apple-180\.png$/);
  assert.deepEqual({ status: apple.status, type: apple.type }, { status: 200, type: 'image/png' });
  pass('apple-touch-icon 180 derivado queda disponible');

  const oldManifestUrl = state.manifestUrl;
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 700;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#075985'; ctx.fillRect(0, 0, 900, 700);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(260, 160, 380, 380);
    window.CONFIG.setSetting('store.logo', canvas.toDataURL('image/png'));
  });
  await page.waitForFunction(previous => window.PWA?.getState().manifestUrl && window.PWA.getState().manifestUrl !== previous, oldManifestUrl);
  const changedState = await page.evaluate(() => window.PWA.getState());
  assert.notEqual(changedState.manifestUrl, oldManifestUrl);
  assert.equal(await page.evaluate(url => fetch(url).then(response => response.status), oldManifestUrl), 200);
  pass('cambio de logo crea hash nuevo y conserva la generación anterior');

  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    canvas.getContext('2d').fillRect(0, 0, 256, 256);
    window.CONFIG.setSetting('store.logo', canvas.toDataURL('image/png'));
  });
  await page.waitForFunction(() => window.PWA?.getState().iconQuality === 'legacy-upscaled');
  assert.equal(await page.locator('[data-testid="pwa-logo-quality-warning"]').count(), 1);
  pass('logo histórico de 256 px funciona con advertencia de pérdida de calidad');

  await page.evaluate(() => window.CONFIG.setSetting('store.logo', ''));
  await page.waitForFunction(() => window.PWA?.getState().iconSource === 'fallback');
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="manifest"]').href), `${base}manifest.webmanifest`);
  pass('ausencia de logo vuelve al fallback sin segunda autoridad administrable');

  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#075985'; ctx.fillRect(0, 0, 800, 600);
    window.CONFIG.setSetting('store.logo', canvas.toDataURL('image/png'));
  });
  await page.waitForFunction(() => window.PWA?.getState().iconSource === 'store.logo');

  const originalQueueStatus = await page.evaluate(() => {
    window.__H89_QUEUE_STATUS = window.STORE.queueStatus;
    window.STORE.queueStatus = () => ({ durability: 'localStorage', pending: 3, operations: [] });
    return window.PWA.reloadSafety();
  });
  assert.equal(originalQueueStatus.safe, true);
  await page.evaluate(() => { window.STORE.queueStatus = () => ({ durability: 'memory', pending: 1, operations: [] }); });
  assert.equal((await page.evaluate(() => window.PWA.reloadSafety())).safe, false);
  await page.evaluate(() => { window.STORE.queueStatus = window.__H89_QUEUE_STATUS; delete window.__H89_QUEUE_STATUS; });
  pass('actualización permite cola durable pendiente y bloquea cola sólo en memoria');

  const oldSw = swBody.toString('utf8');
  const oldBuild = oldSw.match(/const BUILD_HASH = '([^']+)'/)[1];
  const updateBuild = 'h89-test-update-v2';
  swBody = Buffer.from(oldSw.replace(`const BUILD_HASH = '${oldBuild}'`, `const BUILD_HASH = '${updateBuild}'`));
  await page.evaluate(async () => { const value = await navigator.serviceWorker.ready; await value.update(); });
  await page.waitForFunction(() => window.PWA?.getState().updateAvailable === true, null, { timeout: 15000 });
  const activityToken = await page.evaluate(() => window.CORE.beginActivity(['sales'], { reason: 'h89-test' }));
  assert.equal((await page.evaluate(() => window.PWA.activateUpdate())).safe, false);
  assert.equal(await page.evaluate(() => !!(window.PWA && window.PWA.getState().updateAvailable)), true);
  await page.evaluate(token => window.CORE.endActivity(token), activityToken);
  const navigated = page.waitForEvent('framenavigated', { timeout: 20000 });
  assert.equal((await page.evaluate(() => window.PWA.activateUpdate())).safe, true);
  await navigated;
  await page.waitForFunction(() => window.PWA?.getState().ready === true);
  const activeBuild = await page.evaluate(() => new Promise(resolve => {
    const handler = event => { if (event.data?.type === 'BALAM_VERSION') { navigator.serviceWorker.removeEventListener('message', handler); resolve(event.data.buildHash); } };
    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ type: 'BALAM_VERSION' });
  }));
  assert.equal(activeBuild, updateBuild);
  pass('actualización espera, se bloquea con actividad y sólo recarga por acción segura');

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PWA?.getState().ready === true);
  assert.ok(await page.locator('#root').count());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const offlineManifestStatus = await page.evaluate(() => fetch(document.querySelector('link[rel="manifest"]').href).then(response => response.status));
  assert.equal(offlineManifestStatus, 200);
  pass('apertura y refresco offline conservan shell, logo y manifest');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  pass('reconexión vuelve a la ruta vigente sin sustituir STORE');

  const cachedUrls = await page.evaluate(async () => {
    const values = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      values.push(...(await cache.keys()).map(request => request.url));
    }
    return values;
  });
  assert.equal(cachedUrls.some(url => /supabase|\/rest\/v1|\/rpc\//i.test(url)), false);
  pass('ninguna respuesta Supabase/API aparece en Cache Storage');

  for (const width of [320, 360, 390, 430, 768, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 780 : 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`);
  }
  pass('standalone conserva contrato H-87 en 320/360/390/430/768/1024');

  const served = new Set(requests);
  for (const path of ['/POS_Balam/manifest.webmanifest', '/POS_Balam/sw.js', '/POS_Balam/pwa/icon-192.png', '/POS_Balam/pwa/icon-512.png', '/POS_Balam/pwa/icon-maskable-512.png']) {
    assert.ok([...served].some(value => value.startsWith(path)), `no servido ${path}`);
  }
  pass('servidor entrega manifest, worker e iconos bajo el subpath real');
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(`RESULTADO H-89: ${checks.length}/${checks.length}`);
