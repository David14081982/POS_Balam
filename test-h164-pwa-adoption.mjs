// H164: real service-worker adoption; technical fixtures only, no Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const client = await fs.readFile('balam/pwa.jsx', 'utf8');
const worker = await fs.readFile('balam/pwa-sw.js', 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const evidence = { sourceSha256: { client: digest(client), worker: digest(worker) },
  cases: [], remoteBusinessWrites: 0, physical: false };
let generation = 'h164-adoption-before', plainShell = false, browser;
const selection = process.env.BALAM_PWA_ADOPTION_CASE;
const html = `<!doctype html><meta charset="utf-8"><meta name="fixture-generation" content="__GEN__"><title>H164 adoption probe</title><script>
  window.React = {createElement:()=>null,useEffect:()=>{},useState:()=>[null,()=>{}]};
  window.fixture = {activity:0,busy:false,reconciling:false,message:'',errors:[]};
  window.CORE = {activityStatus:()=>({active:fixture.activity})};
  window.STORE = {syncStatus:()=>({...fixture})};
  window.CONFIG = {ready:true,get:()=>""}; // confirmed empty logo, not pending authority
  Object.defineProperty(navigator,'standalone',{value:true});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(window.beginConfirmationOnControllerChange){fixture.busy=true;window.raceObserved=true;}
  });
</script><script src="pwa-client.js"></script><body><p>Technical fixture</p></body>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/POS_Balam/sw.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return response.end(worker.replaceAll('__BALAM_BUILD_HASH__', generation));
  }
  if (url.pathname === '/POS_Balam/pwa-client.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return response.end(client);
  }
  if (url.pathname === '/POS_Balam/legacy.html') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); return response.end('<!doctype html><title>Uncoordinated historical page</title>');
  }
  if (url.pathname.endsWith('.webmanifest')) {
    response.setHeader('Content-Type', 'application/manifest+json'); return response.end('{}');
  }
  if (url.pathname.endsWith('.png')) {
    response.setHeader('Content-Type', 'image/png'); return response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public,max-age=600');
  response.end(plainShell ? '<!doctype html><meta name="fixture-generation" content="' + generation + '"><title>Cache probe</title>' : html.replace('__GEN__', generation));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/POS_Balam/`;
const changed = page => page.evaluate(() => window.dispatchEvent(new Event('syncstatuschange')));
const waiting = page => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
const currentGeneration = page => page.evaluate(() => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', listener); reject(new Error('Worker generation response timed out')); }, 5000);
  const listener = event => {
    if (event.data?.type === 'BALAM_VERSION') {
      clearTimeout(timer); navigator.serviceWorker.removeEventListener('message', listener); resolve(event.data.buildHash);
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  navigator.serviceWorker.controller.postMessage({ type: 'BALAM_VERSION' });
}));
const pass = (name, details = {}) => { evidence.cases.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
try {
  browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true }
    : { channel: 'chrome', headless: true });
  if (!selection || selection === 'http') {
    plainShell = true; generation = 'h164-http-before';
    const isolated = await browser.newContext({ serviceWorkers: 'allow' }), page = await isolated.newPage();
    await page.goto(base + 'legacy.html');
    const warmed = await page.evaluate(async () => (await fetch('index.html')).text());
    assert.ok(warmed.includes('h164-http-before'));
    generation = 'h164-http-precache';
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cached = await page.evaluate(async () => (await (await caches.open('balam-shell-h164-http-precache')).match(new URL('index.html', location.href).href)).text());
    assert.ok(cached.includes('h164-http-precache'), 'Precache must not retain the earlier HTTP cache response');
    generation = 'h164-http-navigation';
    await page.goto(base + 'index.html');
    assert.equal(await page.locator('meta[name="fixture-generation"]').getAttribute('content'), generation);
    pass('PWA HTTP freshness: precache and navigation bypass stale cache at the same URL');
    await isolated.close(); plainShell = false; generation = 'h164-adoption-before';
  }
  if (selection !== 'http') {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const a = await context.newPage(); await a.goto(base + 'index.html');
  await a.waitForFunction(() => window.PWA?.getState().ready && !!navigator.serviceWorker.controller);
  const b = await context.newPage(); await b.goto(base + 'index.html');
  await b.waitForFunction(() => window.PWA?.getState().ready && !!navigator.serviceWorker.controller);
  assert.equal(await a.evaluate(() => PWA.getState().standalone), true);

  if (selection !== 'lifecycle') {
  const guards = await a.evaluate(() => {
    fixture.reconciling = true; const refreshing = PWA.reloadSafety();
    fixture.reconciling = false; fixture.errors = [{ code: 'ONLINE_RESULT_UNKNOWN' }];
    const uncertain = PWA.reloadSafety(); fixture.errors = [];
    fixture.message = 'Estamos confirmando la operación. No la repitas.';
    const unknownMessage = PWA.reloadSafety(); fixture.message = '';
    fixture.hasUnresolvedRequests = true; const otherSession = PWA.reloadSafety(); fixture.hasUnresolvedRequests = false;
    return { refreshing, uncertain, unknownMessage, otherSession, released: PWA.reloadSafety() };
  });
  assert.equal(guards.refreshing.safe, false);
  assert.equal(guards.uncertain.safe, false);
  assert.equal(guards.unknownMessage.safe, false);
  assert.equal(guards.otherSession.safe, false);
  assert.equal(guards.released.safe, true);
  pass('PWA guards: remote reconstruction and uncertain receipt prevent reload');
  }

  if (selection !== 'guards') {
  const legacy = await context.newPage(); await legacy.goto(base + 'legacy.html');
  await a.evaluate(async () => {
    localStorage.setItem('balam_device_id', 'qa-stable-identity');
    localStorage.setItem('balam_auth', 'qa-auth-marker');
    localStorage.setItem('balam_sync_queue', '[]');
    await (await caches.open('balam-shell-old-evidence')).put(
      'https://fixture.supabase.co/rest/v1/products', new Response('legacy evidence bytes'));
    window.beginConfirmationOnControllerChange = true;
  });
  await b.evaluate(() => { fixture.busy = true; });
  let navigationsA = 0, navigationsB = 0;
  a.on('framenavigated', frame => { if (frame === a.mainFrame()) navigationsA++; });
  b.on('framenavigated', frame => { if (frame === b.mainFrame()) navigationsB++; });
  generation = 'h164-adoption-after';
  await a.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await a.waitForFunction(() => PWA.getState().updateAvailable);
  const blocked = await a.evaluate(() => PWA.activateUpdate());
  evidence.coordinationDiagnostic = { blocked, workers: await Promise.all(context.serviceWorkers().map(async entry => {
    try { return await entry.evaluate(async () => ({ generation: BUILD_HASH, clients: (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map(c => ({ url: c.url, type: c.type })) })); }
    catch (error) { return { error: error.message }; }
  })), pageState: await a.evaluate(async () => ({ state: PWA.getState(), fixture, active: (await navigator.serviceWorker.getRegistration()).active?.state, waiting: (await navigator.serviceWorker.getRegistration()).waiting?.state })) };
  assert.equal(blocked.safe, false);
  assert.equal(await waiting(a), true, JSON.stringify(evidence.coordinationDiagnostic));
  assert.equal(navigationsA + navigationsB, 0);
  await b.evaluate(() => { fixture.busy = false; });
  const noLegacyAck = await a.evaluate(() => PWA.activateUpdate());
  assert.equal(noLegacyAck.safe, false);
  assert.equal(await waiting(a), true);
  assert.equal(await legacy.title(), 'Uncoordinated historical page');
  const reloadB = b.waitForEvent('framenavigated', frame => frame === b.mainFrame());
  await legacy.close();
  await changed(b);
  await reloadB;
  await b.waitForFunction(() => window.PWA?.getState().ready && !!navigator.serviceWorker.controller);
  await a.waitForFunction(() => window.raceObserved === true);
  assert.equal(await currentGeneration(a), generation);
  assert.equal(await currentGeneration(b), generation);
  assert.equal(navigationsB, 1);
  assert.equal(navigationsA, 0);
  pass('PWA automatic adoption: two pages agree; an unknown historical page is never forced', { generation, peerReloads: navigationsB });

  assert.equal(await a.evaluate(() => fixture.busy), true);
  const beforeRelease = await a.evaluate(async () => ({
    identity: localStorage.getItem('balam_device_id'), auth: localStorage.getItem('balam_auth'),
    queue: localStorage.getItem('balam_sync_queue'),
    evidence: await (await (await caches.open('balam-shell-old-evidence')).match('https://fixture.supabase.co/rest/v1/products')).text(),
  }));
  await a.evaluate(() => { fixture.busy = false; window.beginConfirmationOnControllerChange = false; });
  await changed(a);
  await a.waitForFunction(() => window.PWA?.getState().ready && !window.raceObserved);
  assert.equal(navigationsA, 1);
  assert.deepEqual(beforeRelease, { identity: 'qa-stable-identity', auth: 'qa-auth-marker', queue: '[]', evidence: 'legacy evidence bytes' });
  assert.deepEqual(await a.evaluate(() => [localStorage.getItem('balam_device_id'), localStorage.getItem('balam_auth'), localStorage.getItem('balam_sync_queue')]),
    ['qa-stable-identity', 'qa-auth-marker', '[]']);
  pass('PWA controller change: a newly started confirmation postpones reload; identity and legacy evidence survive', { reloads: navigationsA });
  }
  await context.close();
  }
} catch (error) {
  evidence.failure = error.message; throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  const output = process.env.BALAM_TEST_OUTPUT || '.evidence-h164';
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(output + '/pwa-adoption.json', JSON.stringify(evidence, null, 2));
  await fs.writeFile(output + '/pwa-adoption-' + (selection || 'all') + '.json', JSON.stringify(evidence, null, 2));
}
