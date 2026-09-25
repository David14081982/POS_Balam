// H-179: con «Imprimir dos copias» activo, cada comprobante sale dos veces:
// «COPIA CLIENTE» y después «COPIA TIENDA». Apagado, sale una vez y sin marca.
// Los reportes (A4 y ticket por método) siempre salen una vez. Se mide en la
// frontera de transporte: documento enviado a print() y PNG enviado a RawBT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { installPrintTransport } from './test-print-transport.mjs';

const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false }); console.log('FAIL ' + name + ': ' + error.message); }
}
const sha = value => createHash('sha256').update(value).digest('hex');
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const html = remote ? null : fs.readFileSync('index.html');
const server = remote ? null : http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); });
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = remote || 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true } : { channel: 'chrome', headless: true });

async function open(android) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1024, height: 900 },
    ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0', hasTouch: true } : {}) });
  await context.route('**/*', route => route.request().url().startsWith(new URL(url).origin) ? route.continue() : route.abort());
  await context.addInitScript(installPrintTransport, { counter: '__printed' });
  await context.addInitScript(() => {
    window.__intents = [];
    document.addEventListener('click', event => {
      if (event.target.matches('a[href^="intent:"]')) { event.preventDefault(); __intents.push(event.target.href.slice(7).split('#Intent;')[0]); }
    }, true);
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.PrintManager && window.BalamTicket && window.BalamReturnReceipt && window.CONFIG && window.DATA);
  await page.evaluate(() => {
    window.DATA.paymentsForSale = () => [];
    window.__copies = on => { const C = window.CONFIG; C.load(C.prepareMutation('setSetting', ['print.twoCopies', on]).state); };
    window.__render = (folio, kind) => {
      const lineas = [{ productId: 'h179', sku: 'H179-SKU', nombre: 'GUAYABERA H179', talla: 'M', qty: 1, precio: 500, precioOrig: 500, precioBase: 500, promos: [] }];
      const sale = { folio, fecha: '2026-09-25 12:00', vendedor: 'PRUEBA', metodo: 'Tarjeta', estado: kind === 'layaway' || kind === 'payment' ? 'Apartado' : 'Pagado',
        total: 500, descuento: 0, subtotal: 431.03, iva: 68.97, ivaPct: 16, saldo: kind === 'layaway' || kind === 'payment' ? 300 : 0, anticipo: 200, lineas };
      const props = { sale };
      if (kind === 'layaway') props.payment = { id: 'a-' + folio, folio, tipo: 'anticipo', metodo: 'Efectivo', monto: 100, fecha: sale.fecha };
      if (kind === 'payment') props.payment = { id: 'p-' + folio, folio, tipo: 'abono', metodo: 'Efectivo', monto: 100, fecha: sale.fecha };
      if (kind === 'exchange') props.exchange = { folio: 'CMB-' + folio, origenFolio: folio, diferencia: 0, valorNoAprovechado: 0,
        lineas: [{ ...lineas[0], lado: 'devuelto' }, { ...lineas[0], lado: 'entregado' }] };
      if (kind === 'return') props.returnDoc = { id: 'DEV-' + folio, folio, fecha: sale.fecha, metodo: 'Efectivo', total: 500, lineas };
      // Cada comprobante se monta nuevo, como el modal de la app. El aviso de la
      // cola es el que la app ya monta (PrintManager.PrintStatus).
      if (window.__root) window.__root.unmount();
      document.getElementById('h179-host')?.remove();
      const host = Object.assign(document.createElement('div'), { id: 'h179-host' }); document.body.append(host);
      window.__root = ReactDOM.createRoot(host);
      __root.render(React.createElement(React.Fragment, null,
        React.createElement(kind === 'return' ? BalamReturnReceipt : BalamTicket, props),
        React.createElement(UI.ReceiptPrintHelp),
        React.createElement('button', { 'data-testid': 'test-send', onClick: () => UI.printReceipt({ source: 'h179' }) }, 'Imprimir')));
    };
  });
  const render = async (folio, kind = 'sale') => {
    await page.evaluate(([f, k]) => __render(f, k), [folio, kind]);
    await page.waitForFunction(f => document.querySelector('#balam-ticket, #balam-return-receipt')?.textContent.includes(f), folio);
  };
  const pending = () => page.evaluate(() => PrintManager.history().filter(j => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(j.stage)).length);
  return { context, page, errors, render, pending };
}

try {
  // ── Computadora: diálogo del sistema ──────────────────────────────────────
  const pc = await open(false);
  const printed = n => pc.page.waitForFunction(n => window.__printed >= n, n, { timeout: 20000 });
  const artifacts = () => pc.page.evaluate(() => __printArtifacts.map(a => a.text));

  await test('Computadora, ajuste apagado: una sola impresión y sin marca de copia', async () => {
    await pc.render('H179-OFF');
    await pc.page.getByTestId('test-send').click();
    await printed(1); await pc.page.waitForTimeout(800);
    const texts = await artifacts();
    assert.equal(texts.length, 1); assert.ok(!/COPIA (CLIENTE|TIENDA)/.test(texts[0]), 'marca de copia con el ajuste apagado');
    assert.equal(await pc.pending(), 0);
  });
  for (const kind of ['sale', 'layaway', 'payment', 'exchange', 'return']) {
    await test(`Computadora, dos copias: ${kind} sale como COPIA CLIENTE y luego COPIA TIENDA`, async () => {
      await pc.page.evaluate(() => { __copies(true); __printArtifacts.length = 0; __printed = 0; });
      const folio = 'H179-PC-' + kind.toUpperCase();
      await pc.render(folio, kind);
      await pc.page.getByTestId('test-send').click();
      await printed(2); await pc.page.waitForTimeout(800);
      const texts = await artifacts();
      assert.equal(texts.length, 2, 'impresiones: ' + texts.length);
      assert.ok(texts[0].includes('COPIA CLIENTE') && !texts[0].includes('COPIA TIENDA'), 'la primera no es COPIA CLIENTE');
      assert.ok(texts[1].includes('COPIA TIENDA') && !texts[1].includes('COPIA CLIENTE'), 'la segunda no es COPIA TIENDA');
      for (const text of texts) assert.ok(text.includes(folio) && text.includes('GUAYABERA H179'), 'contenido incompleto');
      assert.equal(texts[0].replace('COPIA CLIENTE', ''), texts[1].replace('COPIA TIENDA', ''), 'las copias difieren en algo más que la marca');
      assert.equal(await pc.pending(), 0);
    });
  }
  await test('Computadora, dos copias: la impresión automática también saca las dos', async () => {
    await pc.page.evaluate(() => { __printArtifacts.length = 0; __printed = 0; });
    await pc.render('H179-AUTO');
    await pc.page.evaluate(() => UI.printReceipt({ automatic: true }));
    await printed(2); await pc.page.waitForTimeout(800);
    const texts = await artifacts();
    assert.equal(texts.length, 2); assert.ok(texts[0].includes('COPIA CLIENTE') && texts[1].includes('COPIA TIENDA'));
  });
  await test('Computadora, dos copias: reportes A4 y ticket por método salen una vez, sin marca', async () => {
    await pc.page.evaluate(() => { __printArtifacts.length = 0; __printed = 0; });
    await pc.page.evaluate(() => {
      const report = document.createElement('main'); report.id = 'h179-report'; report.textContent = 'REPORTE H179 A4'; document.body.append(report);
      UI.printReceipt({ element: report, automatic: true, system: true, continuous: false, source: 'reportes-a4', documentType: 'report' });
    });
    await printed(1); await pc.page.waitForTimeout(800);
    await pc.page.evaluate(() => {
      const ticket = document.createElement('main'); ticket.dataset.paymentMethodTicket = 'true'; ticket.textContent = 'REPORTE POR MÉTODO H179'; document.body.append(ticket);
      UI.printReceipt({ element: ticket, source: 'reportes-metodos', documentType: 'payment-method-report' });
    });
    await printed(2); await pc.page.waitForTimeout(800);
    const texts = await artifacts();
    assert.equal(texts.length, 2, 'impresiones: ' + texts.length);
    assert.ok(texts[0].includes('REPORTE H179 A4') && texts[1].includes('REPORTE POR MÉTODO H179'));
    assert.ok(!texts.some(t => /COPIA (CLIENTE|TIENDA)/.test(t)), 'un reporte recibió marca de copia');
  });
  await test('Computadora: sin errores de página', () => assert.deepEqual(pc.errors, []));
  await pc.context.close();

  // ── Tablet Android: RawBT, un toque por copia ─────────────────────────────
  const tab = await open(true);
  const returnFromRawbt = () => tab.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
  });
  const ready = () => tab.page.waitForFunction(() => document.querySelector('[data-testid="receipt-design-status"]')?.textContent.includes('Impresión Bluetooth'), null, { timeout: 30000 });
  await test('Tablet, ajuste apagado: un solo envío a RawBT y nada pendiente', async () => {
    await tab.render('H179-TAB-OFF'); await ready();
    await tab.page.getByTestId('test-send').click();
    await tab.page.waitForFunction(() => __intents.length === 1);
    await returnFromRawbt(); await tab.page.waitForTimeout(500);
    assert.equal(await tab.pending(), 0);
    const job = (await tab.page.evaluate(() => PrintManager.history())).at(-1);
    assert.equal(job.totalCopies, 1); assert.ok(!job.copyLabel);
  });
  await test('Tablet, dos copias: el primer toque envía COPIA CLIENTE y la segunda espera otro toque', async () => {
    await tab.page.evaluate(() => { __copies(true); __intents.length = 0; });
    await tab.render('H179-TAB-ON'); await ready();
    await tab.page.getByTestId('test-send').click();
    await tab.page.waitForFunction(() => __intents.length === 1);
    await tab.page.waitForTimeout(300);
    assert.equal(await tab.page.evaluate(() => __intents.length), 1, 'la segunda copia salió sin gesto');
    const jobs = (await tab.page.evaluate(() => PrintManager.history())).filter(j => j.ticketId === 'H179-TAB-ON');
    assert.equal(jobs.length, 2); assert.equal(jobs[0].copyLabel, 'COPIA CLIENTE'); assert.equal(jobs[1].copyLabel, 'COPIA TIENDA');
    assert.equal(sha(await tab.page.evaluate(() => __intents[0])), jobs[0].payloadHash, 'el PNG enviado no es el preparado para COPIA CLIENTE');
  });
  await test('Tablet, dos copias: al regresar, «Imprimir ticket» envía COPIA TIENDA', async () => {
    await returnFromRawbt();
    await tab.page.getByTestId('print-next').waitFor({ timeout: 30000 });
    assert.ok(/COPIA TIENDA/.test(await tab.page.getByTestId('print-status').textContent()), 'el aviso no dice qué copia sigue');
    await tab.page.getByTestId('print-next').click();
    await tab.page.waitForFunction(() => __intents.length === 2);
    const jobs = (await tab.page.evaluate(() => PrintManager.history())).filter(j => j.ticketId === 'H179-TAB-ON');
    const intents = await tab.page.evaluate(() => __intents.slice());
    assert.equal(sha(intents[1]), jobs[1].payloadHash, 'el PNG enviado no es el preparado para COPIA TIENDA');
    assert.notEqual(intents[0], intents[1], 'las dos copias enviaron el mismo PNG');
    for (const png of intents) {
      const size = await tab.page.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); return i.width; }, png);
      assert.equal(size, 576);
    }
    await returnFromRawbt(); await tab.page.waitForTimeout(500);
    assert.equal(await tab.pending(), 0);
  });
  await test('Tablet: sin errores de página', () => assert.deepEqual(tab.errors, []));
  await tab.context.close();
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-179: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
