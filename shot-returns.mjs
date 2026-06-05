// shot-returns.mjs — captura la pantalla de Devoluciones (picker + detalle) desde el source vía HTTP.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p); if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8801, '127.0.0.1', r));
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8801/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 20000 });
// Crea una venta con renglones para que el picker tenga algo real que devolver.
await page.evaluate(() => {
  if (window.STORE) { window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {}; }
  const D = window.DATA; const p = D.products.find(x => (x.stock || []).some(v => v.stock > 1)); const e = p.stock.find(v => v.stock > 1);
  const s = D.sellers.find(x => x.comisionPct > 0);
  const u = window.PROMOS ? window.PROMOS.lineUnit(p, e.talla).unit : p.precio;
  D.recordSale({ ticket: [{ p, talla: e.talla, qty: 2 }], sellerIds: [s.id], client: D.clients[0], metodo: 'Tarjeta', estado: 'Pagado', total: u * 2, itemCount: 2 });
});
// Navega a Devoluciones
await page.evaluate(() => { const btns = [...document.querySelectorAll('nav button')]; const b = btns.find(x => x.textContent.includes('Devoluciones')); b && b.click(); });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shot-returns-picker.png' });
// Abre el primer folio
await page.evaluate(() => { const b = document.querySelector('.lg\\:col-span-2 button'); b && b.click(); });
await page.waitForTimeout(700);
// Marca el primer artículo (revela motivo + cantidad)
await page.evaluate(() => { const cb = document.querySelector('section button'); cb && cb.click(); });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shot-returns-detail.png' });
console.log('pageerrors:', errs.length, errs.join(' | '));
await b.close(); server.close();
