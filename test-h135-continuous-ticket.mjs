// H-135: PDF real de una sola página, longitud variable y contenido completo.
// La app corre aislada; toda petición remota se bloquea. No usa datos productivos.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const evidence = process.env.BALAM_TICKET_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h135-'));
fs.mkdirSync(evidence, { recursive: true });
const server = remote ? null : createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || (remote && url.origin === new URL(remote).origin)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => { window.print = () => { window.__printCalls = (window.__printCalls || 0) + 1; }; });
  await page.goto(remote || `http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => window.BalamTicket && window.BalamReturnReceipt && window.DATA);
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'h135-host'; document.body.append(host);
    window.__ticketRoot = ReactDOM.createRoot(host);
    window.__businessBefore = JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns]);
  });
  async function render(count, kind = 'sale', snapshot = true) {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(({ count, kind, snapshot }) => {
      const lines = Array.from({ length: count }, (_, i) => ({
        productId: `h135-reference-${i}`, line_id: `h135-line-${i}`, sku: `1-PRE-ML-POL-TRA-AMAR-${38 + i}`,
        nombre: `PRENDA DE PRUEBA ${i + 1}`, talla: String(38 + i), qty: 1, precio: 1250, precioOrig: 1250,
        precioBase: 1250, promos: [], ornamento: 'ALFORZAS', ornColors: ['AZUL MARINO'],
      }));
      const sale = {
        folio: 'PRUEBA-H135', fecha: '2026-09-05 12:00', vendedor: 'PRUEBA', metodo: 'Efectivo',
        estado: kind === 'payment' ? 'Apartado' : 'Pagado', total: count * 1250, descuento: 0,
        subtotal: count * 1250 / 1.16, iva: count * 1250 * 0.16 / 1.16, ivaPct: 16,
        ivaIncluded: true, saldo: kind === 'payment' ? count * 1250 - 100 : 0, lineas: lines,
      };
      if (snapshot) sale.receiptSnapshot = { version: 1, sellerName: 'PRUEBA', store: {
        name: 'Balam Guayaberas', rfc: 'XAXX010101000', address: 'C. Guerrero, Av. Jalisco esquina Centro, Cp. 83000',
        phone: '662 473 3832', footer: '¡Gracias por su compra! Máximo 7 días para cambios.',
        tagline: 'Piezas artesanales únicas, cuidando la tradición y el detalle en cada fibra.',
      }, lines: lines.map(line => ({ name: line.nombre, sku: line.sku, sizeLabel: line.talla,
        colorLabel: 'AZUL MARINO', ornamentLabel: line.ornamento, ornamentColors: [{ label: 'AZUL MARINO' }] })) };
      const payment = { id: 'h135-payment', folio: sale.folio, fecha: sale.fecha, tipo: 'abono', metodo: 'Efectivo', monto: 100 };
      const props = { sale };
      if (kind === 'payment') props.payment = payment;
      if (kind === 'exchange') props.exchange = { folio: 'CMB-PRUEBA-H135', origenFolio: sale.folio,
        diferencia: 0, lineas: [{ ...lines[0], lado: 'devuelto' }, { ...lines[0], lado: 'entregado' }] };
      if (kind === 'return') props.returnDoc = { id: 'DEV-PRUEBA-H135', folio: sale.folio, fecha: sale.fecha,
        metodo: 'Efectivo', total: sale.total, lineas: lines };
      window.__ticketRoot.render(React.createElement(kind === 'return' ? BalamReturnReceipt : BalamTicket, props));
    }, { count, kind, snapshot });
    const id = kind === 'return' ? 'balam-return-receipt' : 'balam-ticket';
    await page.locator('#' + id).waitFor({ state: 'attached' });
    await page.waitForFunction(({ id, count }) => document.getElementById(id).textContent.includes(`PRENDA DE PRUEBA ${count}`), { id, count });
    await page.evaluate(() => document.fonts.ready);
    // El mismo beforeprint que activa Chrome al abrir el diálogo; page.pdf lo emite también.
    await page.emulateMedia({ media: 'print' });
    return id;
  }
  async function pdfCase(name, id, count) {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    fs.writeFileSync(path.join(evidence, name + '.pdf'), pdf);
    const raw = pdf.toString('latin1');
    const pages = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length;
    const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    const widths = boxes.map(m => (Number(m[3]) - Number(m[1])) * 25.4 / 72);
    const heights = boxes.map(m => (Number(m[4]) - Number(m[2])) * 25.4 / 72);
    const layout = await page.evaluate(id => {
      const ticket = document.getElementById(id), rect = ticket.getBoundingClientRect();
      return { width: rect.width * 25.4 / 96, height: rect.height * 25.4 / 96,
        text: ticket.innerText, parent: ticket.parentElement.tagName,
        hiddenApp: getComputedStyle(document.getElementById('root')).display === 'none',
        overflow: ticket.scrollWidth > Math.ceil(rect.width) };
    }, id);
    check(name + ': una página de ancho 80 mm', pages === 1 && widths.length > 0 && widths.every(w => Math.abs(w - 80) < 0.4), { pages, widths, heights });
    check(name + ': altura ajustada sin recortar ni reducir contenido', heights.length > 0 && heights.every(h => h >= layout.height - 0.4 && h <= layout.height + 3), { ticketMm: layout.height });
    check(name + ': documento completo y sin desbordamiento', layout.parent === 'BODY' && layout.hiddenApp && !layout.overflow
      && Array.from({ length: count }, (_, i) => `PRENDA DE PRUEBA ${i + 1}`).every(s => layout.text.includes(s))
      && (id === 'balam-return-receipt' ? /REEMBOLSO/.test(layout.text) : /BALAMGUAYABERAS.COM/.test(layout.text)));
    return { name, pages, widths, heights, layout };
  }
  const metrics = [];
  for (const [name, count, kind, snapshot] of [
    ['venta-tres-productos', 3, 'sale', true], ['venta-larga', 24, 'sale', true],
    ['venta-corta-despues-de-larga', 1, 'sale', true], ['venta-historica-v1', 6, 'sale', false],
    ['abono', 6, 'payment', true], ['cambio', 6, 'exchange', true], ['devolucion', 12, 'return', true],
  ]) metrics.push(await pdfCase(name, await render(count, kind, snapshot), count));
  check('la altura vuelve a reducirse al cambiar de venta', metrics[2].heights[0] < metrics[1].heights[0]);
  await render(3);
  const repeated = await pdfCase('reimpresion', 'balam-ticket', 3);
  check('reimpresión conserva las dimensiones', Math.abs(repeated.heights[0] - metrics[0].heights[0]) < 0.4);
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metric = await pdfCase('ancho-pantalla-' + width, await render(3), 3);
    check('pantalla ' + width + ': mismo tamaño físico', Math.abs(metric.heights[0] - metrics[0].heights[0]) < 0.4);
  }
  await page.emulateMedia({ media: 'screen' });
  check('imprimir no modifica ventas, pagos, stock ni movimientos', await page.evaluate(() =>
    window.__businessBefore === JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns])));
  await page.evaluate(() => { window.__ticketRoot.unmount(); });
  const leftover = await page.evaluate(() => [...document.querySelectorAll('style')].some(s => /@page\s+balam-(ticket|return-receipt)/.test(s.textContent)));
  check('cerrar el comprobante retira el formato temporal', !leftover);
  check('sin excepciones de navegador', errors.length === 0, errors);
  fs.writeFileSync(path.join(evidence, 'metrics.json'), JSON.stringify({ metrics, results }, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} verificaciones · ${evidence}`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
