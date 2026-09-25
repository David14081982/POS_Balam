// H-178: el ticket de una venta normal no imprime «Método de pago», «Historial
// de pagos» ni el código de barras decorativo. Apartados, abonos, liquidaciones,
// cambios y cortesías conservan su documento completo. Monta el mismo
// BalamTicket del artefacto distribuido y lee lo que llega al papel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false }); console.log('FAIL ' + name + ': ' + error.message); }
}
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const html = remote ? null : fs.readFileSync('index.html');
const server = remote ? null : http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); });
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = remote || 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true } : { channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(new URL(url).origin) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.BalamTicket && window.UI && window.UI.receiptGraphic && window.CONFIG && window.DATA);
  const docs = await page.evaluate(async () => {
    const C = window.CONFIG;
    for (const [key, value] of [['ticket.footer', '¡Gracias por su compra! Máximo 7 días para cambios.'],
      ['ticket.tagline', 'Piezas artesanales únicas.'], ['ticket.website', 'BALAMGUAYABERAS.MX']])
      C.load(C.prepareMutation('setSetting', [key, value]).state);
    // Historial de pagos por folio, como lo entrega la proyección confirmada.
    const pagos = {};
    window.DATA.paymentsForSale = folio => (pagos[folio] || []).slice();
    const line = { productId: 'h178', sku: '3-TB-MC-MNT-MAO-BL-N:M', nombre: 'TIRA BORDADA', talla: 'M', qty: 1,
      precio: 350, precioOrig: 350, precioBase: 350, promos: [], ornamento: 'APLICACION', ornColors: ['MULTICOLORES'] };
    const venta = extra => ({ folio: 'BG-260922-0003', fecha: '2026-09-22 10:48', vendedor: 'PRUEBA', metodo: 'Tarjeta',
      estado: 'Pagado', total: 350, descuento: 0, subtotal: 301.72, iva: 48.28, ivaPct: 16, ivaIncluded: true,
      anticipo: 350, saldo: 0, lineas: [line], ...extra });
    const pago = (folio, tipo, metodo, monto, id) => ({ id: id || folio + '-' + tipo, folio, tipo, metodo, monto, fecha: '2026-09-22 10:48' });
    const cases = {
      contado: () => { const sale = venta(); pagos[sale.folio] = [pago(sale.folio, 'venta', 'Tarjeta', 350)]; return { sale }; },
      mixto: () => { const sale = venta({ folio: 'BG-260922-0004', metodo: 'Mixto' }); pagos[sale.folio] = [pago(sale.folio, 'venta', 'Mixto', 350)]; return { sale }; },
      // Reimpresión desde Reportes de una venta que después tuvo un cambio cobrado.
      reimpresionConCambio: () => { const sale = venta({ folio: 'BG-260922-0005' });
        pagos[sale.folio] = [pago(sale.folio, 'venta', 'Tarjeta', 350), pago(sale.folio, 'cambio', 'Efectivo', 100)]; return { sale }; },
      anticipo: () => { const sale = venta({ folio: 'BG-260922-0006', metodo: 'Apartado', estado: 'Apartado', anticipo: 100, saldo: 250 });
        const p = pago(sale.folio, 'anticipo', 'Efectivo', 100); pagos[sale.folio] = [p]; return { sale, payment: p }; },
      abono: () => { const sale = venta({ folio: 'BG-260922-0007', metodo: 'Apartado', estado: 'Apartado', anticipo: 200, saldo: 150 });
        const p = pago(sale.folio, 'abono', 'Tarjeta', 100); pagos[sale.folio] = [pago(sale.folio, 'anticipo', 'Efectivo', 100), p]; return { sale, payment: p }; },
      liquidacion: () => { const sale = venta({ folio: 'BG-260922-0008', metodo: 'Apartado', anticipo: 350, saldo: 0 });
        const p = pago(sale.folio, 'liquidacion', 'Efectivo', 250); pagos[sale.folio] = [pago(sale.folio, 'anticipo', 'Efectivo', 100), p]; return { sale, payment: p }; },
      // Reimpresión de un apartado ya liquidado: sigue siendo documento de apartado.
      reimpresionApartado: () => { const sale = venta({ folio: 'BG-260922-0009', metodo: 'Apartado' });
        pagos[sale.folio] = [pago(sale.folio, 'anticipo', 'Efectivo', 100), pago(sale.folio, 'liquidacion', 'Efectivo', 250)]; return { sale }; },
      cambio: () => { const sale = venta({ folio: 'BG-260922-0010' }); const p = pago('CMB-260922-0001', 'cambio', 'Efectivo', 100);
        pagos[sale.folio] = [pago(sale.folio, 'venta', 'Tarjeta', 350), { ...p, folio: sale.folio }];
        return { sale, payment: p, exchange: { folio: 'CMB-260922-0001', origenFolio: sale.folio, diferencia: 100, valorNoAprovechado: 0,
          lineas: [{ lado: 'devuelto', nombre: 'TIRA BORDADA', talla: 'M', qty: 1, precio: 350 }, { lado: 'entregado', nombre: 'TIRA BORDADA', talla: 'L', qty: 1, precio: 450 }] } }; },
      cortesia: () => { const sale = venta({ folio: 'BG-260922-0011', metodo: 'Cortesía', total: 0, anticipo: 0, valorRegalado: 350 });
        pagos[sale.folio] = []; return { sale }; },
    };
    const host = document.createElement('div'); document.body.append(host);
    const root = ReactDOM.createRoot(host), out = {};
    for (const [name, build] of Object.entries(cases)) {
      const props = build();
      root.render(React.createElement(BalamTicket, props));
      for (let i = 0; i < 100 && !document.querySelector(`#balam-ticket[data-document-id="${props.exchange ? props.exchange.folio : props.sale.folio}"]`); i++) await new Promise(r => setTimeout(r, 20));
      await document.fonts.ready;
      const ticket = document.getElementById('balam-ticket');
      out[name] = { text: ticket.innerText, bars: ticket.querySelectorAll('div[style*="height: 40px"]').length, height: ticket.getBoundingClientRect().height };
      if (name === 'contado' || name === 'reimpresionApartado') {
        const png = await UI.receiptGraphic(UI.captureReceipt(ticket));
        const img = new Image(); img.src = png; await img.decode();
        out[name].png = { width: img.width, height: img.height };
      }
    }
    root.unmount();
    return out;
  });

  const trimmed = doc => {
    assert.ok(!/Método de pago/i.test(doc.text), 'imprime «Método de pago»');
    assert.ok(!/Historial de pagos/i.test(doc.text), 'imprime «Historial de pagos»');
    assert.ok(!/Total pagado/i.test(doc.text), 'imprime «Total pagado»');
    assert.equal(doc.bars, 0, 'imprime el código de barras decorativo');
  };
  const complete = doc => {
    assert.ok(/Historial de pagos/i.test(doc.text) && /Total pagado/i.test(doc.text), 'perdió el historial de pagos');
    assert.equal(doc.bars, 44, 'perdió el código de barras decorativo');
  };
  await test('Venta normal: sin método de pago, historial ni código de barras', () => trimmed(docs.contado));
  await test('Venta normal: conserva encabezado, detalle, totales, pie y página web', () => {
    for (const text of ['BALAM', 'BG-260922-0003', 'PRUEBA', 'Detalle de compra', 'TIRA BORDADA', '3-TB-MC-MNT-MAO-BL-N:M',
      'Ornamento: APLICACION · MULTICOLORES', 'Importe', '$301.72', 'IVA (16%)', '$48.28', 'Total a pagar', '$350.00',
      '¡Gracias por su compra!', 'Piezas artesanales únicas.', 'BALAMGUAYABERAS.MX'])
      assert.ok(docs.contado.text.toLowerCase().includes(text.toLowerCase()), text);
  });
  await test('Venta con pago mixto: mismo ticket corto', () => trimmed(docs.mixto));
  await test('Reimpresión de venta con un cambio posterior: mismo ticket corto', () => trimmed(docs.reimpresionConCambio));
  await test('Anticipo de apartado: conserva historial y código de barras', () => complete(docs.anticipo));
  await test('Abono de apartado: conserva historial y código de barras', () => complete(docs.abono));
  await test('Liquidación de apartado: conserva historial y código de barras', () => complete(docs.liquidacion));
  await test('Reimpresión de apartado liquidado: conserva método, historial y código de barras', () => {
    complete(docs.reimpresionApartado); assert.ok(/Método de pago/i.test(docs.reimpresionApartado.text));
  });
  await test('Cambio: conserva método de pago, historial y código de barras', () => {
    complete(docs.cambio); assert.ok(/Método de pago/i.test(docs.cambio.text) && /Cambio de mercancia/i.test(docs.cambio.text));
  });
  await test('Cortesía: conserva «Cortesía» y el código de barras', () => {
    assert.ok(/Método de pago/i.test(docs.cortesia.text) && /Cortesía/.test(docs.cortesia.text)); assert.equal(docs.cortesia.bars, 44);
  });
  await test('El PNG RawBT de la venta normal es más corto que el documento completo', () => {
    assert.equal(docs.contado.png.width, 576);
    // Antes de H-178 la diferencia era 151 px (una fila de historial); ahora ~795 px.
    assert.ok(docs.reimpresionApartado.png.height - docs.contado.png.height > 500, JSON.stringify({ venta: docs.contado.png, completo: docs.reimpresionApartado.png }));
    console.log('     alto PNG venta normal ' + docs.contado.png.height + ' px · documento completo ' + docs.reimpresionApartado.png.height + ' px');
  });
  await test('Sin errores de página', () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-178: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
