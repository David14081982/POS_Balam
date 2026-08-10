// H-90 · salida térmica ejecutiva sobre el bundle distribuido.
// Supabase queda bloqueado; no existe escritura remota.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const REMOTE_URL = /^https?:\/\//.test(process.argv[2] || '') ? process.argv[2] : '';
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = REMOTE_URL ? null : http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.join(ROOT, requestPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
if (server) await new Promise(resolve => server.listen(8875, '127.0.0.1', resolve));

let pass = 0, fail = 0;
const errors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto(REMOTE_URL || 'http://127.0.0.1:8875/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.ReportsScreen && window.UI, null, { timeout: 30000 });

  const seeded = await page.evaluate(() => {
    const D = window.DATA;
    D.payments.length = 0; D.returns.length = 0; D.sales.length = 0; D.exchanges.length = 0;
    const component = (methodCode, methodLabel, amount) => ({ methodCode, methodLabel, amount });
    D.payments.push(
      { id: 'sale-mixed', folio: 'V-1', fecha: '2026-08-09 09:00', tipo: 'venta', metodo: 'Mixto', monto: 1500,
        components: [component('Efectivo', 'Efectivo', 300), component('Tarjeta', 'Tarjeta', 500),
          component('MP', 'Mercado Pago', 400), component('Transferencia', 'Transferencia', 300)] },
      { id: 'lay-1', folio: 'A-1', fecha: '2026-08-09 10:00', tipo: 'anticipo', metodo: 'Tarjeta', monto: 500,
        components: [component('Tarjeta', 'Tarjeta', 500)] },
      { id: 'lay-2', folio: 'A-1', fecha: '2026-08-09 11:00', tipo: 'abono', metodo: 'Efectivo', monto: 500,
        components: [component('Efectivo', 'Efectivo', 500)] },
      { id: 'lay-3', folio: 'A-1', fecha: '2026-08-09 12:00', tipo: 'liquidacion', metodo: 'Transferencia', monto: 1000,
        components: [component('Transferencia', 'Transferencia', 1000)] },
      { id: 'exchange-1', folio: 'C-1', fecha: '2026-08-09 13:00', tipo: 'cambio', metodo: 'Mixto', monto: 850,
        components: [component('Efectivo', 'Efectivo', 100), component('Tarjeta', 'Tarjeta', 250),
          component('Transferencia', 'Transferencia', 150), component('MP', 'Mercado Pago', 350)] },
      { id: 'legacy-mixed', folio: 'L-1', fecha: '2026-08-09 14:00', tipo: 'venta', metodo: 'Mixto', monto: 100,
        efectivo: 40, tarjeta: 0, transferencia: 0, otro: 60 },
    );
    const numerous = Array.from({ length: 16 }, (_, index) => component(
      `DYN-${String(index + 1).padStart(2, '0')}`,
      index === 15 ? 'Método corporativo configurable con denominación extraordinariamente extensa' : `Método dinámico ${index + 1}`,
      1000000,
    ));
    D.payments.push({ id: 'sale-many', folio: 'V-2', fecha: '2026-08-09 15:00', tipo: 'venta', metodo: 'Mixto', monto: 16000000, components: numerous });
    D.returns.push({ id: 'return-1', folio: 'V-1', fecha: '2026-08-09 16:00', total: 500, metodo: 'Mixto',
      components: [component('Efectivo', 'Efectivo', 200), component('Tarjeta', 'Tarjeta', 300)] });
    D.sales.push({ id: 'courtesy-1', folio: 'K-1', fecha: '2026-08-09 17:00', metodo: 'Cortesía', total: 0 });
    D.exchanges.push(
      { id: 'exchange-zero', fecha: '2026-08-09 18:00', diferencia: 0, valorNoAprovechado: 0 },
      { id: 'exchange-unused', fecha: '2026-08-09 19:00', diferencia: -300, valorNoAprovechado: 300 },
    );
    const original = D.paymentMethodReport;
    window.__reportCalls = 0;
    D.paymentMethodReport = (...args) => { window.__reportCalls += 1; return original(...args); };
    const host = document.createElement('div'); host.id = 'h90-ticket-host'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(window.ReportsScreen, {}));
    return true;
  });
  check('1. escenario monetario sembrado sin red', seeded === true);
  await page.waitForTimeout(350);
  await page.getByTestId('reports-tab-metodos').click();
  await page.waitForTimeout(300);

  // Personalizado: conserva exactamente las fechas seleccionadas en las tres salidas.
  const dates = page.locator('section[data-testid="payment-method-report"] input[type="date"]');
  await dates.nth(0).fill('2026-08-01');
  await dates.nth(1).fill('2026-08-09');
  await page.waitForTimeout(300);
  const expected = await page.evaluate(() => {
    const report = window.DATA.paymentMethodReport({ from: '2026-08-01', to: '2026-08-09' });
    const fmt = window.UI.fmt;
    return {
      entries: fmt(report.entries), refunds: fmt(report.refunds), net: fmt(report.net),
      distributed: fmt(report.reconciliation.distributedNet), undistributed: fmt(report.undistributed),
      operations: report.operations, origins: report.origins, exchangeEntries: fmt(report.exchangeEntries),
      fingerprint: JSON.stringify({ payments: window.DATA.payments, returns: window.DATA.returns,
        sales: window.DATA.sales, exchanges: window.DATA.exchanges, movements: window.DATA.movements }),
    };
  });
  const screenText = await page.getByTestId('payment-method-report').innerText();
  check('2. pantalla muestra cifras y conciliación H-90', [expected.entries, expected.refunds, expected.net, expected.undistributed].every(value => screenText.includes(value)) && /Conciliación correcta/i.test(screenText));
  check('3. pantalla usa semántica explícita de movimientos de apartados', screenText.includes('Movimientos de apartados') && screenText.includes(String(expected.origins.layaways)));
  check('4. pantalla muestra operaciones únicas y entradas por cambios', screenText.includes(`Operaciones económicas: ${expected.operations}`) && screenText.includes(expected.exchangeEntries));

  const a4Promise = context.waitForEvent('page');
  await page.getByTestId('payment-method-print').click();
  const a4 = await a4Promise; await a4.waitForLoadState('domcontentloaded'); await a4.waitForTimeout(250);
  const a4Text = await a4.locator('body').innerText();
  check('5. A4 conserva el contrato y autoimpresión existente', [expected.entries, expected.refunds, expected.net, expected.undistributed, expected.exchangeEntries].every(value => a4Text.includes(value)) && await a4.evaluate(() => window.__printed) === 1);
  check('6. A4 imprime el periodo personalizado exacto', a4Text.includes('2026-08-01 – 2026-08-09'));

  const ticketPromise = context.waitForEvent('page');
  await page.getByTestId('payment-method-ticket').click();
  const ticket = await ticketPromise; await ticket.waitForLoadState('domcontentloaded');
  await ticket.setViewportSize({ width: 320, height: 800 });
  const ticketText = await ticket.locator('main').innerText();
  check('7. ticket contiene las mismas cifras monetarias que pantalla/A4', [expected.entries, expected.refunds, expected.net, expected.undistributed, expected.distributed].every(value => ticketText.includes(value)));
  check('8. ticket contiene los mismos metadatos H-90', ticketText.includes(`Operaciones: ${expected.operations}`) && ticketText.includes(expected.exchangeEntries) && ticketText.includes(`Movimientos de apartados\n${expected.origins.layaways}`));
  check('9. ticket conserva el periodo personalizado exacto', ticketText.includes('2026-08-01 – 2026-08-09'));
  check('10. método configurable largo se conserva completo', ticketText.includes('Método corporativo configurable con denominación extraordinariamente extensa'));
  check('11. importes de millones se conservan', ticketText.includes('$1,000,000.00'));
  check('12. importe histórico sin distribución y motivo son explícitos', /IMPORTE SIN DISTRIBUCIÓN/.test(ticketText) && /Detalle histórico insuficiente/.test(ticketText));
  check('13. cortesía informa cero ingreso', /OPERACIONES SIN INGRESO/.test(ticketText) && /Ingreso: \$0\.00/.test(ticketText));

  const beforePrint = await ticket.evaluate(() => window.__printed);
  const callsBeforePrint = await page.evaluate(() => window.__reportCalls);
  check('14. abrir ticket no autoimprime', beforePrint === 0, String(beforePrint));
  await ticket.getByRole('button', { name: 'Imprimir ticket' }).click();
  await ticket.getByRole('button', { name: 'Imprimir ticket' }).click();
  const afterPrint = await ticket.evaluate(() => window.__printed);
  const callsAfterPrint = await page.evaluate(() => window.__reportCalls);
  check('15. cancelar/reintentar permite imprimir otra vez', afterPrint === 2, String(afterPrint));
  check('16. reimprimir el snapshot no recalcula H-90', callsAfterPrint === callsBeforePrint, `${callsBeforePrint}→${callsAfterPrint}`);

  const layout = await ticket.evaluate(() => ({
    viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    height: document.querySelector('main').scrollHeight, viewportHeight: innerHeight,
    last: document.querySelector('footer').getBoundingClientRect().bottom,
  }));
  check('17. 80 mm no produce overflow horizontal a 320 px', layout.documentWidth <= layout.viewport, JSON.stringify(layout));
  check('18. muchos métodos producen tira larga sin recorte', layout.height > layout.viewportHeight && layout.last > layout.viewportHeight, JSON.stringify(layout));
  await ticket.emulateMedia({ media: 'print' });
  const printLayout = await ticket.evaluate(() => ({
    mainWidth: document.querySelector('main').getBoundingClientRect().width,
    documentWidth: document.documentElement.scrollWidth,
    footerVisible: getComputedStyle(document.querySelector('footer')).display !== 'none',
    toolsHidden: getComputedStyle(document.querySelector('.tools')).display === 'none',
  }));
  check('19. medio print conserva 80 mm, pie y oculta herramientas', printLayout.mainWidth <= 303 && printLayout.documentWidth <= 320 && printLayout.footerVisible && printLayout.toolsHidden, JSON.stringify(printLayout));

  const afterFingerprint = await page.evaluate(() => JSON.stringify({ payments: window.DATA.payments, returns: window.DATA.returns,
    sales: window.DATA.sales, exchanges: window.DATA.exchanges, movements: window.DATA.movements }));
  check('20. abrir/reimprimir no crea ni modifica movimientos', afterFingerprint === expected.fingerprint);
  check('21. cero excepciones de página', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  if (server) server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
