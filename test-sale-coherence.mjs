// H-03 — contrato monetario end-to-end sobre el motor real del bundle.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8812, '127.0.0.1', r));
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`); cond ? pass++ : fail++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8812/', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.recordSale && window.DATA.recordReturn);

const out = await page.evaluate(() => {
  const D = window.DATA;
  const pushed = [];
  window.STORE.pushSale = s => pushed.push(JSON.parse(JSON.stringify(s)));
  window.STORE.pushReturn = () => {};
  window.STORE.pushRows = () => {};
  const stock = window.CONFIG.codes('size_letter').concat(window.CONFIG.codes('size_number')).map(talla => ({ talla, escala: 'L', stock: 50 }));
  const p = D.hydrate({ id: 'h03-p', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: 'H03', nombre: 'H-03', precio: 1000, costo: 300, stock });
  const seller = { id: 'h03-s', nombre: 'H03 Seller', comisionPct: 5, ventasMes: 0, ventasNum: 0, comisionAcum: 0, active: true };
  const client = { id: 'h03-c', nombre: 'H03 Client', tel: '1', compras: 0, total: 0, generic: false };
  D.products.push(p); D.sellers.push(seller); D.clients.push(client);
  const talla = p.stock[0].talla, ticket = [{ p, talla, qty: 1 }];
  const mk = x => D.recordSale({ ticket, sellerIds: [seller.id], client, itemCount: 1, ivaPct: 16, ivaIncluded: false, ...x });

  const normal = mk({ metodo: 'Efectivo', estado: 'Pagado', subtotal: 1000, iva: 0, total: 1000, anticipo: 1000, pagoEfectivo: 1000, pagoOtro: 0 });
  const tax = mk({ metodo: 'Tarjeta', estado: 'Pagado', subtotal: 1000, iva: 160, total: 1160, anticipo: 1160, pagoEfectivo: 0, pagoOtro: 1160 });
  const lay = mk({ metodo: 'Apartado', estado: 'Apartado', subtotal: 1000, iva: 0, total: 1000, anticipo: 300, pagoEfectivo: 0, pagoOtro: 0 });
  const layBefore = { total: lay.total, anticipo: lay.anticipo, saldo: lay.saldo };
  D.completarApartado(lay.folio);
  const layAfter = { estado: lay.estado, anticipo: lay.anticipo, saldo: lay.saldo };
  const mixed = mk({ metodo: 'Mixto', estado: 'Pagado', subtotal: 1000, iva: 0, total: 1000, anticipo: 1000, pagoEfectivo: 400, pagoOtro: 600 });
  const clientTotalBeforeReturns = client.total;

  const invalid = [];
  for (const args of [
    { pagoEfectivo: -1, pagoOtro: 1001 },
    { pagoEfectivo: 1001, pagoOtro: -1 },
    { pagoEfectivo: 400, pagoOtro: 500 },
    { pagoEfectivo: NaN, pagoOtro: 1000 },
  ]) {
    try { mk({ metodo: 'Mixto', estado: 'Pagado', subtotal: 1000, iva: 0, total: 1000, anticipo: 1000, ...args }); invalid.push(false); }
    catch (_) { invalid.push(true); }
  }
  const retTax = D.recordReturn({ folio: tax.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, precio: 1 }] });
  const retLay = D.recordReturn({ folio: lay.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, precio: 1 }] });
  return { normal, tax, layBefore, layAfter, mixed, invalid, retTax, retLay, clientTotalBeforeReturns, clientTotalAfterReturns: client.total, pushed };
});

check('CASO 1: venta normal = $1,000 en venta local', out.normal.total === 1000);
check('CASO 2: subtotal $1,000 + IVA $160 = total $1,160', out.tax.subtotal === 1000 && out.tax.iva === 160 && out.tax.total === 1160);
check('CASO 2: línea/devolución usan $1,160 cobrado', out.tax.lineas[0].precio === 1160 && out.retTax.ok && out.retTax.ret.total === 1160);
check('CASOS 1–4: cliente acumula totales finales', out.clientTotalBeforeReturns === 4160, String(out.clientTotalBeforeReturns));
check('CASO 3: apartado persiste anticipo $300 y saldo $700', out.layBefore.anticipo === 300 && out.layBefore.saldo === 700);
check('CASO 3: liquidación deja anticipo total y saldo cero', out.layAfter.estado === 'Pagado' && out.layAfter.anticipo === 1000 && out.layAfter.saldo === 0);
check('CASO 3/5: apartado liquidado devuelve $1,000', out.retLay.ok && out.retLay.ret.total === 1000);
check('CASO 5: cliente revierte exactamente ambas devoluciones', out.clientTotalAfterReturns === 2000, String(out.clientTotalAfterReturns));
check('CASO 4: mixto $400 + $600 persiste completo', out.mixed.pagoEfectivo === 400 && out.mixed.pagoOtro === 600);
check('CASO 4: negativo/excedido/incompleto/NaN rechazados', out.invalid.every(Boolean));
check('Sync: snapshots enviados por pushSale', out.pushed.some(s => s.folio === out.tax.folio && s.total === 1160 && s.iva === 160) && out.pushed.some(s => s.anticipo === 300 && s.saldo === 700));

await browser.close(); server.close();
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
