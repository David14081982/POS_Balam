// H-180: actual document at the browser transport boundary; no OS printer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { installPrintTransport } from './test-print-transport.mjs';

const remote = process.argv.find(arg => /^https?:/.test(arg));
const evidence = process.env.BALAM_PRINT_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h180-'));
fs.mkdirSync(evidence, { recursive: true });
const html = remote ? null : fs.readFileSync('index.html');
const server = remote ? null : createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
if (server) await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = remote || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
const results = [];
const sha = value => createHash('sha256').update(value).digest('hex');
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ': ' + e.message); }
}
try {
  for (const [name, userAgent, touch] of [
    ['windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 0],
    ['android', 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 5],
    ['android-desktop', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 5],
  ]) {
    const context = await browser.newContext({ userAgent, hasTouch: touch > 0, viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url().startsWith(new URL(url).origin) ? route.continue() : route.abort());
    await context.addInitScript(installPrintTransport, { counter: '__native', hold: true });
    await context.addInitScript(touch => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => touch });
      window.__intents = [];
      document.addEventListener('click', event => {
        if (event.target.matches('a[href^="intent:"]')) { event.preventDefault(); __intents.push(event.target.href); }
      }, true);
    }, touch);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.PrintManager && window.BalamTicket && window.CONFIG);
    await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      window.__root = ReactDOM.createRoot(host);
      window.__business = JSON.stringify([DATA.sales, DATA.products, DATA.payments, DATA.movements]);
      window.__render = (folio, count = 3, auto = false) => {
        const sale = { folio, fecha: '2026-09-30 12:00', vendedor: 'PRUEBA', metodo: 'Tarjeta', estado: 'Pagado',
          total: count * 500, subtotal: count * 500 / 1.16, iva: count * 500 * .16 / 1.16, descuento: 0, saldo: 0,
          lineas: Array.from({ length: count }, (_, i) => ({ productId: 'h180-' + i, sku: 'H180-' + i,
            nombre: 'PRENDA H180 ' + (i + 1), talla: 'M', qty: 1, precio: 500 })) };
        function Receipt() {
          UI.useReceiptAutoPrint();
          return React.createElement(React.Fragment, null, React.createElement(BalamTicket, { sale }),
            React.createElement(UI.ReceiptPrintHelp), React.createElement(PrintManager.PrintStatus),
            React.createElement('button', { 'data-testid': 'h180-send', onClick: () => UI.printReceipt() }, 'Imprimir'));
        }
        CONFIG.load(CONFIG.prepareMutation('setSetting', ['print.auto', auto]).state);
        __root.render(React.createElement(Receipt, { key: folio }));
      };
    });
    const render = async (folio, count = 3, auto = false) => {
      await page.evaluate(args => __render(...args), [folio, count, auto]);
      await page.waitForFunction(f => document.getElementById('balam-ticket')?.textContent.includes(f), folio);
    };
    const end = () => page.evaluate(() => document.querySelector('iframe[data-print-job-id]')?.contentWindow.dispatchEvent(new Event('afterprint')));
    await render('H180-MANUAL');
    // Independent reference uses the already available system renderer before sending.
    const reference = await page.evaluate(async () => {
      const frame = await UI.receiptFrame(UI.captureReceipt(document.getElementById('balam-ticket')));
      const result = { text: frame.contentDocument.body.innerText, height: frame.dataset.pageHeight,
        width: frame.contentDocument.body.firstElementChild.getBoundingClientRect().width };
      frame.remove(); return result;
    });
    await test(`${name}: manual usa sistema sin abrir aplicaciones`, async () => {
      await page.getByTestId('h180-send').click();
      const jobs = await page.evaluate(() => PrintManager.history());
      assert.equal(jobs.at(-1)?.transport, 'browser');
      await page.waitForFunction(() => __native === 1);
      assert.equal(await page.evaluate(() => __intents.length), 0);
    });
    // A failed transport selection must not make the remaining cases hang on RawBT.
    if (await page.evaluate(() => PrintManager.history().at(-1)?.transport !== 'browser')) { await context.close(); continue; }
    await test(`${name}: documento íntegro, misma geometría y hash entregado`, async () => {
      const sent = await page.evaluate(() => {
        const frame = document.querySelector('iframe[data-print-job-id]');
        return { job: PrintManager.history().at(-1), artifact: __printArtifacts.at(-1),
          width: frame.contentDocument.body.firstElementChild.getBoundingClientRect().width, height: frame.dataset.pageHeight };
      });
      assert.equal(sent.artifact.text, reference.text);
      assert.equal(sent.height, reference.height); assert.equal(sent.width, reference.width);
      assert.ok(Math.abs(sent.width - 80 * 96 / 25.4) < .1);
      assert.equal(sha(sent.artifact.html), sent.job.payloadHash);
      assert.ok(sent.artifact.text.includes('PRENDA H180 3'));
      fs.writeFileSync(path.join(evidence, name + '-manual.html'), sent.artifact.html);
    });
    await test(`${name}: foco no libera el diálogo ni confirma papel`, async () => {
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).stage), 'SEND_STARTED');
      await end();
      const job = await page.evaluate(() => PrintManager.history().at(-1));
      assert.equal(job.stage, 'COMPLETED'); assert.equal(job.physicalPrintConfirmed, false);
      assert.equal(await page.locator('iframe[data-print-job-id]').count(), 0);
    });
    await test(`${name}: print.auto abre el diálogo al montar el comprobante confirmado`, async () => {
      await render('H180-AUTO', 24, true);
      await page.waitForFunction(() => __native === 2);
      const sent = await page.evaluate(() => ({ job: PrintManager.history().at(-1), artifact: __printArtifacts.at(-1) }));
      assert.equal(sent.job.transport, 'browser'); assert.equal(sent.job.printerTarget, 'system-dialog');
      assert.ok(sent.artifact.text.includes('H180-AUTO') && sent.artifact.text.includes('PRENDA H180 24'));
      assert.equal(sha(sent.artifact.html), sent.job.payloadHash);
      fs.writeFileSync(path.join(evidence, name + '-long.html'), sent.artifact.html);
      await end();
    });
    await test(`${name}: print.auto apagado espera el botón y el doble clic no duplica`, async () => {
      await render('H180-OFF');
      assert.equal(await page.evaluate(() => __native), 2);
      await page.getByTestId('h180-send').dblclick();
      await page.waitForFunction(() => __native === 3);
      assert.equal(await page.evaluate(() => PrintManager.history().filter(j => j.ticketId === 'H180-OFF').length), 1);
      await end();
    });
    await test(`${name}: sin RawBT, mutaciones comerciales ni errores`, async () => {
      assert.equal(await page.evaluate(() => __intents.length), 0);
      assert.equal(await page.getByTestId('receipt-design-status').count()
        ? /RawBT|Bluetooth/.test(await page.getByTestId('receipt-design-status').textContent()) : false, false);
      assert.equal(await page.evaluate(() => __business === JSON.stringify([DATA.sales, DATA.products, DATA.payments, DATA.movements])), true);
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
} finally { await browser.close(); if (server) await new Promise(r => server.close(r)); }
fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ artifactSHA256: html && sha(html), results, hardware: 'NOT_TESTED' }, null, 2));
console.log(`${results.filter(r => r.ok).length}/${results.length}; evidence: ${evidence}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
