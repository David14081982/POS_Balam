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

const out = await page.evaluate(async () => {
  const D = window.DATA;
  const pushed = [], settled = [];
  window.STORE.pushSale = (sale, effects) => pushed.push(JSON.parse(JSON.stringify({ sale, effects: effects || {} })));
  window.STORE.settleLayaway = async (draft, effects) => {
    settled.push(JSON.parse(JSON.stringify({ sale: draft, effects: effects || {} })));
    const remoteProducts = (draft.lineas || []).map(line => {
      const current = D.products.find(p => p.id === line.productId);
      const remote = JSON.parse(JSON.stringify(current));
      const variant = remote.stock.find(v => v.talla === line.talla);
      variant.stock -= Number(line.qty) || 0;
      remote._syncVersion = (Number(current._syncVersion) || 0) + 1;
      return remote;
    });
    const remoteSellers = (effects.sellerEffects || []).map(effect => {
      const current = D.sellers.find(s => s.id === effect.id);
      return Object.assign({}, current, {
        ventasMes: effect.after_ventas_mes, ventasNum: effect.after_ventas_num,
        comisionAcum: effect.after_comision_acum,
        _syncVersion: (Number(current._syncVersion) || 0) + 1,
      });
    });
    const result = D.applySaleCommitResult('h03-commit-' + draft.folio, draft.folio, {
      sale: draft, products: remoteProducts,
      payments: D.paymentsForSale(draft.folio).concat(effects.payment),
      movements: (draft.lineas || []).map((line, i) => ({
        id: 65010 + i, fecha: effects.payment.fecha, tipo: 'Venta',
        producto: line.nombre, productId: line.productId, sku: line.sku,
        talla: line.talla, cant: -line.qty, ref: draft.folio,
      })),
      sellers: remoteSellers, stockReserved: true, stockIdempotent: false,
      reservationOperationId: draft._operationId,
    });
    return { ok: result.ok === true };
  };
  window.STORE.pushReturn = () => {};
  window.STORE.pushRows = () => {};
  const stock = window.CONFIG.codes('size_letter').concat(window.CONFIG.codes('size_number')).map(talla => ({ talla, escala: 'L', stock: 50 }));
  const p = D.hydrate({ id: 'h03-p', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: 'H03', nombre: 'H-03', precio: 1000, costo: 300, stock });
  const seller = { id: 'h03-s', nombre: 'H03 Seller', comisionPct: 5, ventasMes: 0, ventasNum: 0, comisionAcum: 0, active: true };
  const client = { id: 'h03-c', nombre: 'H03 Client', tel: '1', compras: 0, total: 0, generic: false };
  D.products.push(p); D.sellers.push(seller); D.clients.push(client);
  const talla = p.stock[0].talla, ticket = [{ p, talla, qty: 1 }];
  const mk = x => D.recordSale({ ticket, sellerIds: [seller.id], client, itemCount: 1, ivaPct: 16, ivaIncluded: false, ...x });

  const normal = mk({ metodo: 'Efectivo', estado: 'Pagado', total: 1000, anticipo: 1000, pagoEfectivo: 1000, pagoOtro: 0 });
  p.precio = 1200;
  const promosOriginal = window.PROMOS;
  window.PROMOS = { lineUnit: () => ({ unit: 1150 }) };
  const tax = mk({ metodo: 'Tarjeta', estado: 'Pagado', total: 1150, anticipo: 1150, pagoEfectivo: 0, pagoOtro: 1150 });
  window.PROMOS = promosOriginal;
  p.precio = 1000;
  D.saveProducts(false);
  const lay = mk({ metodo: 'Apartado', estado: 'Apartado', total: 1000, anticipo: 300, pagoEfectivo: 0, pagoOtro: 0 });
  const layBefore = { total: lay.total, anticipo: lay.anticipo, saldo: lay.saldo };
  const abono = await Promise.resolve(D.registrarPagoApartado(lay.folio, { monto: 200, metodo: 'Tarjeta', detalle: { tarjeta: 200 } }));
  const layMid = { estado: lay.estado, anticipo: lay.anticipo, saldo: lay.saldo };
  const liquida = await Promise.resolve(D.registrarPagoApartado(lay.folio, { monto: 500, metodo: 'Transferencia', detalle: { transferencia: 500 } }));
  const layConfirmed = D.sales.find(s => s.folio === lay.folio);
  const layAfter = { estado: layConfirmed.estado, anticipo: layConfirmed.anticipo, saldo: layConfirmed.saldo };
  const mixed = mk({ metodo: 'Mixto', estado: 'Pagado', total: 1000, anticipo: 1000, pagoEfectivo: 400, pagoOtro: 600, pagoDetalle: { efectivo: 400, transferencia: 600 } });
  const discounted = D.recordSale({
    ticket, additionalDiscounts: [{
      id: 'h52-50', benefitCode: 'EMP50', benefitName: 'Empleado 50%',
      origin: 'Empleado', benefitType: 'percentage', value: 50,
      scope: 'ticket', combinable: false, reason: 'Prueba H-52',
      appliedBy: 'h52@balam.mx', appliedAt: '2026-07-30T12:00:00-07:00',
    }],
    sellerIds: [seller.id], client, itemCount: 1, metodo: 'Efectivo',
    estado: 'Pagado', anticipo: 500, pagoEfectivo: 500, pagoOtro: 0,
  });
  // H-65: al confirmar la liquidación, DATA reconstruye sus colecciones desde la
  // caché durable (relevo entre pestañas). La referencia inicial deja de ser la
  // fila viva; el total del cliente se lee siempre del catálogo vigente.
  const clienteVivo = () => D.clients.find(c => c.id === client.id);
  const clientTotalBeforeReturns = clienteVivo().total;

  const invalid = [];
  for (const args of [
    { pagoEfectivo: -1, pagoOtro: 1001 },
    { pagoEfectivo: 1001, pagoOtro: -1 },
    { pagoEfectivo: 400, pagoOtro: 500 },
    { pagoEfectivo: NaN, pagoOtro: 1000 },
  ]) {
    try { mk({ metodo: 'Mixto', estado: 'Pagado', total: 1000, anticipo: 1000, ...args }); invalid.push(false); }
    catch (_) { invalid.push(true); }
  }
  const retTax = D.recordReturn({ folio: tax.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, precio: 1 }] });
  const retLay = D.recordReturn({ folio: lay.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, precio: 1 }] });
  const retDiscounted = D.recordReturn({ folio: discounted.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, precio: 9999 }] });
  return { normal, tax, discounted, layBefore, layMid, layAfter, abono, liquida, layPayments: D.paymentsForSale(lay.folio), mixed, mixedPayments: D.paymentsForSale(mixed.folio), invalid, retTax, retLay, retDiscounted, clientTotalBeforeReturns, clientTotalAfterReturns: clienteVivo().total, pushed, settled };
});

check('CASO 1: venta normal = $1,000 en venta local', out.normal.total === 1000);
check('FINANZAS: $1,200 − $50 = total $1,150', out.tax.descuento === 50 && out.tax.total === 1150);
check('FINANZAS: $1,150 = importe $991.38 + IVA $158.62', out.tax.subtotal === 991.38 && out.tax.iva === 158.62);
check('Devolución usa los $1,150 realmente cobrados', out.tax.lineas[0].precio === 1150 && out.retTax.ok && out.retTax.ret.total === 1150);
check('CASOS 1–4/H-52: cliente acumula totales finales', out.clientTotalBeforeReturns === 4650, String(out.clientTotalBeforeReturns));
check('H-52: descuento adicional queda separado y total final $500', out.discounted.descuento === 0 && out.discounted.descuentoAdicional === 500 && out.discounted.total === 500);
check('H-52: comisión se calcula sobre los $500 realmente pagados', out.discounted.comision === 21.55);
check('H-52: Devolución reconoce los $500 realmente pagados', out.retDiscounted.ok && out.retDiscounted.ret.total === 500);
check('CASO 3: apartado persiste anticipo $300 y saldo $700', out.layBefore.anticipo === 300 && out.layBefore.saldo === 700);
check('CASO 3: abono parcial $200 deja saldo $500', out.abono.ok && out.layMid.estado === 'Apartado' && out.layMid.anticipo === 500 && out.layMid.saldo === 500);
check('CASO 3: liquidación deja anticipo total y saldo cero', out.layAfter.estado === 'Pagado' && out.layAfter.anticipo === 1000 && out.layAfter.saldo === 0);
check('CASO 3: historial identifica efectivo/tarjeta/transferencia', out.layPayments.length === 3 && out.layPayments[0].efectivo === 300 && out.layPayments[1].tarjeta === 200 && out.layPayments[2].transferencia === 500);
check('CASO 3/5: apartado liquidado devuelve $1,000', out.retLay.ok && out.retLay.ret.total === 1000, out.retLay.error || '');
check('CASO 5: cliente revierte exactamente ambas devoluciones', out.clientTotalAfterReturns === 2000, String(out.clientTotalAfterReturns));
check('CASO 4: mixto $400 + $600 persiste completo', out.mixed.pagoEfectivo === 400 && out.mixed.pagoOtro === 600);
check('CASO 4: historial identifica efectivo $400 + transferencia $600', out.mixedPayments.length === 1 && out.mixedPayments[0].efectivo === 400 && out.mixedPayments[0].transferencia === 600);
check('CASO 4: negativo/excedido/incompleto/NaN rechazados', out.invalid.every(Boolean));
check('Sync: snapshots enviados por pushSale', out.pushed.some(x => x.sale.folio === out.tax.folio && x.sale.total === 1150 && x.sale.subtotal === 991.38 && x.sale.iva === 158.62) && out.pushed.some(x => x.sale.anticipo === 300 && x.sale.saldo === 700));
check('H-04: venta incluye pago, cliente y comisión en la misma operación', out.pushed.some(x =>
  x.sale.folio === out.normal.folio
  && x.effects.payments?.length === 1
  && x.effects.clientEffect?.compras_delta === 1
  && x.effects.sellerEffects?.length === 1));
check('H-65: la liquidación viaja por la autoridad atómica con pago final y comisión', out.settled.some(x =>
  x.sale.folio === out.liquida.sale.folio
  && x.sale.estado === 'Pagado'
  && x.effects.payment?.tipo === 'liquidacion'
  && x.effects.sellerEffects?.length === 1));

await browser.close(); server.close();
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
