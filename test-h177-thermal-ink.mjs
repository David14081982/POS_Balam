// H-177: la impresora Bluetooth corta el ticket de venta a mitad por energía.
// El PNG RawBT real debe pedir menos tinta que el reporte que sí sale completo,
// en total y en su franja de 8 mm más oscura, sin perder contenido.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

// Referencia física del 19/09/2026: el reporte por método salió completo en
// papel con la salida anterior (umbral 200): 70,101 puntos y 9,667 en 8 mm.
// El ticket de venta se detuvo a ~38,500 puntos sin cargador y ~71,200 con él.
const PROVEN_INK = 70101, PROVEN_PEAK = 9667;
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false }); console.log('FAIL ' + name + ': ' + error.message); }
}
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const html = remote ? null : fs.readFileSync('index.html');
const reportCss = fs.readFileSync('balam/reports.jsx', 'utf8').match(/<title>Reporte por método de pago · BALAM<\/title><style>([\s\S]*?)<\/style>/)[1];
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
  await page.waitForFunction(() => window.BalamTicket && window.UI && window.UI.receiptGraphic && window.CONFIG);
  const result = await page.evaluate(async reportCss => {
    const stats = async png => {
      const img = new Image(); img.src = png; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data, rows = new Array(img.height).fill(0);
      let gray = 0;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const v = data[(y * img.width + x) * 4]; if (v !== 0 && v !== 255) gray++; if (v < 128) rows[y]++;
      }
      let peak = 0; for (let y = 0; y + 64 <= rows.length; y++) { let s = 0; for (let k = 0; k < 64; k++) s += rows[y + k]; peak = Math.max(peak, s); }
      return { width: img.width, height: img.height, ink: rows.reduce((a, b) => a + b, 0), peak, gray, rows, canvas };
    };
    // Logo oscuro como el de la tienda.
    const logo = document.createElement('canvas'); logo.width = logo.height = 256; const g = logo.getContext('2d');
    g.fillStyle = '#1f2a24'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#9aa39c'; g.beginPath(); g.ellipse(128, 140, 70, 50, 0, 0, 7); g.fill();
    const C = window.CONFIG; C.load(C.prepareMutation('setSetting', ['store.logo', logo.toDataURL()]).state);
    const host = document.createElement('div'); document.body.append(host);
    const lines = ['TIRA BORDADA', 'JAVIER', 'INDIANA CRUDO'].map((name, i) => ({ productId: 'h177-' + i, sku: '3-TB-MC-MNT-MAO-BL-N:M', nombre: name,
      talla: 'M', qty: 1, precio: 500, precioOrig: 500, precioBase: 500, promos: [], ornamento: 'APLICACION', ornColors: ['MC'] }));
    const sale = { folio: 'BG-260917-0002', fecha: '2026-09-17 12:39', vendedor: 'PRUEBA', metodo: 'Tarjeta', estado: 'Pagado', total: 2120,
      descuento: 0, subtotal: 1827.59, iva: 292.41, ivaPct: 16, saldo: 0, lineas: lines };
    ReactDOM.createRoot(host).render(React.createElement(BalamTicket, { sale }));
    for (let i = 0; i < 100 && !document.querySelector('#balam-ticket img')?.complete; i++) await new Promise(r => setTimeout(r, 30));
    await document.fonts.ready;
    const ticket = document.getElementById('balam-ticket');
    const saleStats = await stats(await UI.receiptGraphic(UI.captureReceipt(ticket)));
    const logoBox = ticket.querySelector('img').getBoundingClientRect(), ticketBox = ticket.getBoundingClientRect();
    const win = window.open('', '_blank');
    win.document.write(`<!doctype html><html><head><style>${reportCss}</style></head><body><main data-payment-method-ticket><header class="brand tk-block"><strong>BALAM</strong><h1>REPORTE POR MÉTODO DE PAGO</h1></header><section class="meta tk-block"><p><strong>Periodo:</strong><br>2026-09-19</p><p><strong>Generado:</strong><br>19/9/2026</p></section><p class="empty tk-block">Sin movimientos monetarios en el periodo.</p><section class="totals tk-block"><div class="money"><span>TOTAL ENTRADAS</span><strong>$0.00</strong></div><div class="money"><span>DEVOLUCIONES</span><strong>$0.00</strong></div><div class="money grand"><span>NETO</span><strong>$0.00</strong></div></section><section class="summary tk-block"><p><strong>Operaciones:</strong> 0</p><p><strong>Método principal:</strong><br>Sin movimientos</p></section><section class="origins tk-block"><h2>ORIGEN DE OPERACIONES</h2><div class="count"><span>Ventas</span><strong>0</strong></div><div class="count"><span>Movimientos de apartados</span><strong>0</strong></div><div class="count"><span>Cambios cobrados</span><strong>0</strong></div><div class="count"><span>Devoluciones</span><strong>0</strong></div><p>Importe informativo; ya está incluido en Total entradas.</p></section><section class="reconciliation tk-block"><p>CONCILIACIÓN: CORRECTA</p><p>Σ métodos $0.00 + sin distribución $0.00 = neto $0.00</p></section><footer class="foot tk-block">Reporte ejecutivo · BALAM<div>BALAMGUAYABERAS.MX</div></footer></main></body></html>`);
    win.document.close(); await new Promise(r => setTimeout(r, 300));
    const reportStats = await stats(await UI.receiptGraphic(UI.captureReceipt(win.document.querySelector('main'))));
    win.close();
    // Densidad del logo dentro del PNG (misma escala que receiptGraphic: 576 / ancho útil).
    const scaleY = saleStats.height / ticketBox.height;
    const y0 = Math.round((logoBox.top - ticketBox.top) * scaleY) + 4, y1 = Math.round((logoBox.bottom - ticketBox.top) * scaleY) - 4;
    const logoRows = saleStats.rows.slice(y0, y1), logoWidth = logoBox.width * scaleY;
    const logoInk = logoRows.reduce((a, b) => a + b, 0) / (logoRows.length * logoWidth);
    return { sale: { width: saleStats.width, height: saleStats.height, ink: saleStats.ink, peak: saleStats.peak, gray: saleStats.gray },
      report: { ink: reportStats.ink, peak: reportStats.peak }, logoInk, text: ticket.textContent,
      tail: saleStats.rows.slice(-Math.round(saleStats.height * 0.12)).reduce((a, b) => a + b, 0) };
  }, reportCss);

  await test('PNG RawBT de 576 puntos, sólo blanco y negro', () => {
    assert.equal(result.sale.width, 576); assert.equal(result.sale.gray, 0);
  });
  await test('El ticket de venta pide menos tinta total que el reporte que salió completo', () => {
    assert.ok(result.sale.ink < PROVEN_INK, JSON.stringify({ sale: result.sale.ink, proven: PROVEN_INK }));
  });
  await test('Ninguna franja de 8 mm es más oscura que la del reporte que salió completo', () => {
    assert.ok(result.sale.peak < PROVEN_PEAK, JSON.stringify({ sale: result.sale.peak, proven: PROVEN_PEAK }));
  });
  await test('El reporte por método también baja su tinta', () => {
    assert.ok(result.report.ink < PROVEN_INK && result.report.peak <= PROVEN_PEAK, JSON.stringify(result.report));
  });
  await test('El logo se imprime tramado, no como bloque negro sólido', () => {
    assert.ok(result.logoInk > 0.2 && result.logoInk <= 0.55, String(result.logoInk));
  });
  await test('El contenido llega completo hasta el pie', () => {
    for (const text of ['BG-260917-0002', 'TIRA BORDADA', 'JAVIER', 'INDIANA CRUDO', '2,120.00']) assert.ok(result.text.includes(text), text);
    assert.ok(result.tail > 0, 'el pie no tiene tinta');
  });
  await test('La línea de ornamento no muestra caracteres extraños', () => {
    assert.ok(!result.text.includes('Â'), 'contiene Â');
    assert.ok(result.text.includes('Ornamento: APLICACION · MC'), result.text.match(/Ornamento:[^$]{0,40}/)?.[0]);
  });
  await test('Sin errores de página', () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-177: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
