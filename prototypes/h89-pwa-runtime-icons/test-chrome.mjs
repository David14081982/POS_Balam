import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(here, 'evidence');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 41789;
const origin = `http://127.0.0.1:${port}`;
const appUrl = `${origin}/POS_Balam/`;
const checks = [];

function ok(name, detail = '') {
  checks.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` · ${detail}` : ''}`);
}

async function waitManifest(cdp, expectedPart) {
  const deadline = Date.now() + 15000;
  let result;
  while (Date.now() < deadline) {
    result = await cdp.send('Page.getAppManifest');
    if (result.url?.includes(expectedPart) && result.data) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Manifest no observado por Chrome: ${JSON.stringify(result)}`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  let file;
  if (url.pathname === '/POS_Balam/' || url.pathname === '/POS_Balam/index.html') file = 'index.html';
  else if (url.pathname === '/POS_Balam/sw.js') file = 'sw.js';
  else {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
    return;
  }
  const body = await readFile(join(here, file));
  response.writeHead(200, {
    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/POS_Balam/'
  });
  response.end(body);
});

await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
await mkdir(evidenceDir, { recursive: true });

const context = await chromium.launchPersistentContext('', {
  executablePath: chromePath,
  headless: true,
  viewport: { width: 430, height: 860 },
  args: ['--no-first-run', '--no-default-browser-check']
});

try {
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const first = await page.waitForFunction(() => window.__H89?.result).then(handle => handle.jsonValue());

  assert.match(first.manifestUrl, /\/POS_Balam\/manifest-[a-f0-9]{16}\.webmanifest$/);
  ok('manifest virtual bajo /POS_Balam/', first.manifestUrl);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, controller: navigator.serviceWorker.controller?.scriptURL || '' };
  });
  assert.equal(scope.scope, `${origin}/POS_Balam/`);
  assert.equal(scope.controller, `${origin}/POS_Balam/sw.js`);
  ok('service worker controla el scope', JSON.stringify(scope));

  const manifestA = await waitManifest(cdp, first.hash);
  const parsedA = JSON.parse(manifestA.data);
  assert.equal(parsedA.display, 'standalone');
  assert.equal(parsedA.id, '/POS_Balam/');
  assert.equal(parsedA.scope, './');
  assert.equal(parsedA.icons.find(icon => icon.sizes === '192x192')?.purpose, 'any');
  assert.equal(parsedA.icons.find(icon => icon.sizes === '512x512' && icon.purpose === 'any')?.type, 'image/png');
  assert.equal(parsedA.icons.find(icon => icon.sizes === '512x512' && icon.purpose === 'maskable')?.type, 'image/png');
  ok('Chrome leyó iconos 192, 512 y maskable', first.hash);

  const installabilityA = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityA.installabilityErrors, []);
  ok('Chrome reconoce instalabilidad', '0 errores');

  const manifestIconsA = await cdp.send('Page.getManifestIcons');
  assert.ok(manifestIconsA.primaryIcon?.length > 100);
  ok('Chrome obtuvo el icono primario desde Cache Storage', `${manifestIconsA.primaryIcon.length} caracteres`);

  await page.screenshot({ path: join(evidenceDir, '01-brand-a-browser.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await page.waitForFunction(() => window.__H89?.result).then(handle => handle.jsonValue());
  assert.equal(afterReload.hash, first.hash);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  ok('sobrevive a recarga', afterReload.hash);

  const changed = await page.evaluate(() => window.__H89.materialize('b'));
  assert.notEqual(changed.hash, first.hash);
  const manifestB = await waitManifest(cdp, changed.hash);
  assert.equal(JSON.parse(manifestB.data).short_name, 'BALAM');
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  ok('cambio de logo actualiza manifest y hashes', `${first.hash} → ${changed.hash}`);

  const cacheState = await page.evaluate(async ({ oldResult, newResult }) => {
    const cache = await caches.open(window.__H89.cacheName);
    const urls = (await cache.keys()).map(request => request.url);
    return {
      oldManifest: urls.includes(oldResult.manifestUrl),
      newManifest: urls.includes(newResult.manifestUrl),
      oldIcons: Object.values(oldResult.paths).every(path => urls.includes(`${location.origin}/POS_Balam/${path}`)),
      newIcons: Object.values(newResult.paths).every(path => urls.includes(`${location.origin}/POS_Balam/${path}`))
    };
  }, { oldResult: first, newResult: changed });
  assert.deepEqual(cacheState, { oldManifest: true, newManifest: true, oldIcons: true, newIcons: true });
  ok('generación anterior y nueva coexisten', JSON.stringify(cacheState));

  await page.reload({ waitUntil: 'domcontentloaded' });
  const persistedB = await page.waitForFunction(() => window.__H89?.result).then(handle => handle.jsonValue());
  assert.equal(persistedB.hash, changed.hash);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  ok('logo nuevo sobrevive a actualización/recarga', persistedB.hash);

  const workerUpdate = await page.evaluate(async result => {
    const previous = navigator.serviceWorker.controller?.scriptURL || '';
    const changedController = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SW_UPDATE_TIMEOUT')), 10000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timer);
        resolve(navigator.serviceWorker.controller?.scriptURL || '');
      }, { once: true });
    });
    await navigator.serviceWorker.register('/POS_Balam/sw.js?v=2', { scope: '/POS_Balam/' });
    const current = await changedController;
    const urls = [result.manifestUrl, ...Object.values(result.paths).map(path => `${location.origin}/POS_Balam/${path}`)];
    const statuses = await Promise.all(urls.map(url => fetch(url).then(response => response.status)));
    return { previous, current, statuses };
  }, persistedB);
  assert.match(workerUpdate.current, /\/POS_Balam\/sw\.js\?v=2$/);
  assert.deepEqual(workerUpdate.statuses, [200, 200, 200, 200]);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
  ok('recursos sobreviven a actualización del service worker', JSON.stringify(workerUpdate));

  await page.screenshot({ path: join(evidenceDir, '02-brand-b-browser.png'), fullPage: true });
  const report = {
    chrome: await page.evaluate(() => navigator.userAgent),
    appUrl,
    scope,
    first,
    changed,
    cacheState,
    installabilityA,
    manifestErrorsA: manifestA.errors,
    checks
  };
  await writeFile(join(evidenceDir, 'chrome-installability.json'), JSON.stringify(report, null, 2));
  console.log(`RESULT ${checks.length}/${checks.length}`);
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
