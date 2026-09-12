// Read-only diagnosis of the generated artifact. No application changes or live services.
// Run from repository root: node .evidence-h164-sync-diagnosis/reproduce-pwa-hidden-dialog.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const body = readFileSync('index.html');
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const result = {
  at: new Date().toISOString(),
  artifactSha256: createHash('sha256').update(body).digest('hex'),
  cases: [], errors: [], externalBlocked: 0,
};
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, serviceWorkers: 'block',
  });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base + '/')) return route.continue();
    result.externalBlocked++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(String(error)));
  await page.addInitScript(() => {
    if (!localStorage.getItem('balam-page')) localStorage.setItem('balam-page', 'dashboard');
    localStorage.setItem('balam-sidebar', '0');
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.App && window.DATA && window.PWA);
  for (const id of ['dashboard', 'inventario', 'clientes', 'dashboard']) {
    // App restores its normal navigation state. No component or business stubs.
    await page.evaluate(next => localStorage.setItem('balam-page', next), id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.App && window.DATA && window.PWA);
    await page.waitForTimeout(400);
    result.cases.push({ id, ...await page.evaluate(() => ({
      header: document.querySelector('header h1')?.textContent,
      safety: window.PWA.reloadSafety(),
      activity: window.CORE.activityStatus(),
      queue: window.STORE.queueStatus().durability,
      dialogs: [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label'), text: element.textContent,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          withinViewport: rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0,
          closeButtons: element.querySelectorAll('button').length,
          transform: getComputedStyle(element).transform,
        };
      }),
    })) });
  }
  assert.equal(result.cases[0].safety.safe, true);
  for (const item of result.cases.slice(1, 3)) {
    assert.equal(item.activity.active, 0);
    assert.equal(item.safety.safe, false);
    assert.equal(item.safety.reason, 'Cierra el diálogo abierto antes de actualizar.');
    assert.equal(item.dialogs.length, 1);
    assert.equal(item.dialogs[0].withinViewport, false);
    assert.equal(item.dialogs[0].text, '');
    assert.equal(item.dialogs[0].closeButtons, 0);
  }
  assert.equal(result.cases[3].safety.safe, true);
  assert.deepEqual(result.errors, []);
  mkdirSync('.evidence-h164-sync-diagnosis', { recursive: true });
  writeFileSync('.evidence-h164-sync-diagnosis/pwa-hidden-dialog.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
