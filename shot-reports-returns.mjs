// shot-reports-returns.mjs — crea devoluciones reales y captura Reportes → pestaña Devoluciones.
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
await new Promise(r => server.listen(8803, '127.0.0.1', r));
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 1180 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8803/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.recordReturn, null, { timeout: 20000 });

const setup = await page.evaluate(() => {
  const D = window.DATA;
  if (window.STORE) { window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {}; window.STORE.pushRows = () => {}; }
  const prods = D.products.filter(p => (p.stock || []).some(v => v.stock > 0)).slice(0, 4);
  const seller = D.sellers.find(s => s.comisionPct > 0);
  const motivos = ['Talla', 'Defecto', 'Cambio', 'Talla'];
  prods.forEach((p, i) => {
    const e = p.stock.find(v => v.stock > 0); const talla = e.talla;
    const u = window.PROMOS ? window.PROMOS.lineUnit(p, talla).unit : (Number(p.precio) || 0);
    const sale = D.recordSale({ ticket: [{ p, talla, qty: 1 }], sellerIds: [seller.id], client: D.clients[0], metodo: 'Tarjeta', estado: 'Pagado', total: u, itemCount: 1 });
    D.recordReturn({ folio: sale.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: motivos[i], precio: sale.lineas[0].precio }], metodo: 'Efectivo' });
  });
  return { returns: D.returns.length, exportFn: typeof window.XLSXIO.exportReturns };
});

// Reportes
await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.textContent.includes('Reportes')); b && b.click(); });
await page.waitForTimeout(700);
// Pestaña Devoluciones (dentro de main, no el sidebar)
await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'Devoluciones'); b && b.click(); });
await page.waitForTimeout(700);
await page.screenshot({ path: 'shot-rep-returns.png', fullPage: true });
console.log('setup:', JSON.stringify(setup), '| pageerrors:', errs.length, errs.join(' | '));
await b.close(); server.close();
