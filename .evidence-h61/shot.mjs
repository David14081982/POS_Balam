// Evidencia visual H-61: el filtro de tallas con los catálogos REALES de la
// tienda (los del snapshot de sólo lectura de producción del 31/07/2026).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  let requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/') requested = '/index.html';
  const file = path.join(ROOT, requested);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(8833, '127.0.0.1', r));

const cats = JSON.parse(fs.readFileSync('.evidence-h59-production/remote-readonly-verification.json', 'utf8')).categories;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route(/supabase\.co/, route => route.abort());
await page.goto('http://127.0.0.1:8833/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG);

await page.evaluate((cats) => {
  const snap = window.CONFIG.snapshot();
  const catalogs = Object.assign({}, snap.catalogs);
  Object.keys(cats).forEach(kind => {
    catalogs[kind] = cats[kind].map(r => ({ code: r.code, label: r.label, active: r.active !== false, meta: {} }));
  });
  window.CONFIG.load({ v: 1, catalogs, catalogMeta: snap.catalogMeta, settings: snap.settings });
  localStorage.setItem('balam-page', 'pos');
}, cats);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('[data-testid="pos-size-filter"]', { state: 'attached', timeout: 25000 });

const structure = await page.locator('[data-testid="pos-size-filter"]').evaluate(sel => ({
  global: Array.from(sel.children).filter(n => n.tagName === 'OPTION').map(o => o.textContent.trim()),
  groups: Array.from(sel.querySelectorAll('optgroup')).map(g => ({
    label: g.label,
    sizes: Array.from(g.querySelectorAll('option')).map(o => o.textContent.trim()),
  })),
}));
fs.writeFileSync('.evidence-h61/filtro-catalogos-reales.json', JSON.stringify(structure, null, 2));
console.log('GLOBAL:', structure.global.join(', '));
structure.groups.forEach(g => console.log(`GRUPO "${g.label}" (${g.sizes.length}): ${g.sizes.join(', ')}`));

await page.locator('[data-testid="pos-size-filter"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: '.evidence-h61/pos-filtro-cerrado.png' });
await browser.close();
await new Promise(r => server.close(r));
