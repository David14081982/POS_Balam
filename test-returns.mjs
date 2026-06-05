// test-returns.mjs — e2e con funciones reales (source vía HTTP para que Babel compile los .jsx).
// Ejercita recordSale → recordReturn: reingreso de stock, reversión de comisión (on/off),
// movimiento 'Devolución', estado parcial/total, validaciones e idempotencia. Sync neutralizado.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import url from 'url';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8799, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' · ' + extra : ''}`); cond ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8799/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.recordReturn && window.CONFIG, null, { timeout: 20000 });

const r = await page.evaluate(() => {
  const D = window.DATA, C = window.CONFIG, out = {};
  // Neutraliza sincronización con la nube (probamos solo la lógica local).
  if (window.STORE) { window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {}; window.STORE.pushRows = () => {}; }
  const round = n => Math.round(n * 100) / 100;

  // Producto con stock en alguna talla
  const p = D.products.find(x => (x.stock || []).some(v => v.stock > 1));
  const e = p.stock.find(v => v.stock > 1); const talla = e.talla;
  const seller = D.sellers.find(s => s.comisionPct > 0);
  out.setup = { sku: p.sku, talla, stock0: e.stock, sellerPct: seller.comisionPct };

  // 1) Venta de 2 piezas (IVA por defecto). Total = precio REAL cobrado (con promo) * 2,
  //    para que el total de la venta sea consistente con el precio de renglón que guarda recordSale.
  const unit = window.PROMOS ? window.PROMOS.lineUnit(p, talla).unit : (Number(p.precio) || 0);
  const total = unit * 2;
  C.setSetting('returns.reverseCommission', true);
  const comAntes = seller.comisionAcum, ventasMesAntes = seller.ventasMes;
  const sale = D.recordSale({ ticket: [{ p, talla, qty: 2 }], sellerIds: [seller.id], client: null, metodo: 'Efectivo', estado: 'Pagado', total, itemCount: 2 });
  out.afterSale = { stock: D.stockOf(p, talla), comAcum: seller.comisionAcum, ganada: round(seller.comisionAcum - comAntes), folio: sale.folio, lineas: sale.lineas.length, precioLinea: sale.lineas[0].precio };

  // 2) Devolver 1 pieza → parcial, stock +1, comisión revertida ~mitad
  const comTrasVenta = seller.comisionAcum, vmTrasVenta = seller.ventasMes;
  const res1 = D.recordReturn({ folio: sale.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: 'Talla', precio: sale.lineas[0].precio }], metodo: 'Efectivo' });
  out.return1 = {
    ok: res1.ok, refund: res1.ok ? res1.ret.total : null,
    stock: D.stockOf(p, talla), estado: sale.estado,
    comRevertida: round(comTrasVenta - seller.comisionAcum),
    ventasMesRevertida: round(vmTrasVenta - seller.ventasMes),
    mov: D.movements[0] && { tipo: D.movements[0].tipo, cant: D.movements[0].cant, ref: D.movements[0].ref },
    returnsLen: D.returns.length, returnedQty: D.returnedQty(sale.folio, p.sku, talla),
  };

  // 3) Idempotencia/validación: intentar devolver 2 más (solo queda 1) → error
  const res2 = D.recordReturn({ folio: sale.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 2, motivo: 'Talla', precio: sale.lineas[0].precio }], metodo: 'Efectivo' });
  out.overReturn = { ok: res2.ok, error: res2.error };

  // 4) Devolver la última pieza → total 'Devuelto', stock restaurado completo
  const res3 = D.recordReturn({ folio: sale.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: 'Defecto', precio: sale.lineas[0].precio }], metodo: 'Tarjeta' });
  out.return2 = { ok: res3.ok, stock: D.stockOf(p, talla), estado: sale.estado, returnedQty: D.returnedQty(sale.folio, p.sku, talla) };

  // 5) reverseCommission OFF: nueva venta, devolver, comisión NO cambia
  C.setSetting('returns.reverseCommission', false);
  const s2 = D.recordSale({ ticket: [{ p, talla, qty: 1 }], sellerIds: [seller.id], client: null, metodo: 'Efectivo', estado: 'Pagado', total: unit, itemCount: 1 });
  const comAntesOff = seller.comisionAcum;
  D.recordReturn({ folio: s2.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: 'Cambio', precio: s2.lineas[0].precio }], metodo: 'Efectivo' });
  out.reverseOff = { comAntes: comAntesOff, comDespues: seller.comisionAcum, sinCambio: round(comAntesOff - seller.comisionAcum) === 0, estado: s2.estado };

  // 6) Catálogo de motivos visible (seed) + apartado no devolvible
  out.reasons = C.codes('return_reason');
  const apart = { folio: 'X', estado: 'Apartado' };
  out.apartadoNoDevolvible = D.isReturnable(apart) === false;
  return out;
});

console.log('\n── setup ──\n', JSON.stringify(r.setup));
console.log('afterSale:', JSON.stringify(r.afterSale));
console.log('return1:', JSON.stringify(r.return1));
console.log('overReturn:', JSON.stringify(r.overReturn));
console.log('return2:', JSON.stringify(r.return2));
console.log('reverseOff:', JSON.stringify(r.reverseOff));
console.log('reasons:', JSON.stringify(r.reasons), '\n');

const precio = r.afterSale.precioLinea;
check('Venta descuenta stock (-2)', r.afterSale.stock === r.setup.stock0 - 2, `${r.setup.stock0}→${r.afterSale.stock}`);
check('Devolución parcial reingresa stock (+1)', r.return1.stock === r.setup.stock0 - 1);
check('Reembolso = precio de 1 pieza', Math.abs(r.return1.refund - precio) < 0.01, `${r.return1.refund} vs ${precio}`);
check('Estado venta → Devolución parcial', r.return1.estado === 'Devolución parcial');
check('Movimiento Devolución (+1)', r.return1.mov && r.return1.mov.tipo === 'Devolución' && r.return1.mov.cant === 1);
check('Comisión revertida (>0, ~mitad de la ganada)', r.return1.comRevertida > 0 && Math.abs(r.return1.comRevertida - r.afterSale.ganada / 2) < 0.02, `rev=${r.return1.comRevertida} ganada=${r.afterSale.ganada}`);
check('returnedQty = 1 tras parcial', r.return1.returnedQty === 1);
check('Sobre-devolución rechazada', r.overReturn.ok === false && !!r.overReturn.error);
check('Devolución total → Devuelto', r.return2.estado === 'Devuelto');
check('Stock totalmente restaurado', r.return2.stock === r.setup.stock0);
check('returnedQty = 2 tras total', r.return2.returnedQty === 2);
check('reverseCommission OFF no toca comisión', r.reverseOff.sinCambio === true, `${r.reverseOff.comAntes}→${r.reverseOff.comDespues}`);
check('Motivos seed presentes (Talla/Defecto)', r.reasons.includes('Talla') && r.reasons.includes('Defecto'));
check('Apartado no es devolvible', r.apartadoNoDevolvible === true);
check('Sin errores de página (pageerror=0)', errs.length === 0, errs.join(' | '));

await b.close(); server.close();
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
