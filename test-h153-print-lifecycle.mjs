import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { installPrintTransport } from './test-print-transport.mjs';
const remote = process.argv.find(a => /^https?:/.test(a));
const evidence = process.env.BALAM_PRINT_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h153-'));
fs.mkdirSync(evidence, { recursive: true });
const server = remote ? null : createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync('index.html')); });
if (server) await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], artifacts = [];
const pdfHashes = new Map();
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const hash = value => createHash('sha256').update(value).digest('hex');
const artifactSHA256 = hash(remote ? Buffer.from(await (await fetch(remote)).arrayBuffer()) : fs.readFileSync('index.html'));
try {
  for (const android of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0', hasTouch: true } : {}) });
    await context.route(/supabase\.co/, r => r.abort());
    await context.addInitScript(installPrintTransport, { counter: '__native', hold: true });
    await context.addInitScript(() => {
      window.__intents = [];
      document.addEventListener('click', event => {
        if (event.target.matches('a[href^="intent:"]')) {
          event.preventDefault();
          __intents.push({ href: event.target.href, active: navigator.userActivation.isActive });
        }
      }, true);
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(remote || `http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.PrintManager && window.BalamTicket && window.DATA);
    await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      window.__root = ReactDOM.createRoot(host);
      window.__baseline = JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns, DATA.loans]);
      window.__render = (id, count, kind = 'sale') => {
        const lineas = Array.from({ length: count }, (_, i) => ({ productId: `ref-${id}-${i}`, line_id: `line-${i}`, nombre: `ARTICULO ${id} ${i + 1}`, sku: `SKU-${id}-${i}`, talla: 'M', qty: 1, precio: 500 }));
        const sale = { folio: id, fecha: '2026-09-09 12:00', estado: kind === 'payment' || kind === 'layaway' ? 'Apartado' : 'Pagado', metodo: 'Efectivo', total: count * 500, subtotal: count * 500 / 1.16, iva: count * 500 * .16 / 1.16, lineas };
        const props = { sale };
        if (kind === 'payment') props.payment = { id: 'pay-' + id, folio: id, monto: 100, metodo: 'Efectivo', tipo: 'abono', fecha: sale.fecha };
        if (kind === 'exchange') props.exchange = { folio: 'CMB-' + id, origenFolio: id, diferencia: 0, lineas: [{ ...lineas[0], lado: 'devuelto' }, { ...lineas[0], lado: 'entregado' }] };
        if (kind === 'return') props.returnDoc = { id: 'DEV-' + id, folio: id, fecha: sale.fecha, metodo: 'Efectivo', total: sale.total, lineas };
        __root.render(React.createElement(React.Fragment, null,
          React.createElement(kind === 'return' ? BalamReturnReceipt : BalamTicket, props),
          React.createElement('button', { 'data-testid': 'test-send', onClick: () => UI.printReceipt({ source: 'lifecycle-test' }) }, 'Imprimir'),
          React.createElement(PrintManager.PrintStatus)));
      };
    });
    const prefix = android ? 'RawBT' : 'Browser';
    async function render(id, count, kind = 'sale') {
      await page.evaluate(args => __render(...args), [id, count, kind]);
      await page.waitForFunction(id => document.querySelector('#balam-ticket, #balam-return-receipt')?.textContent.includes(id), id);
      if (android) await page.evaluate(async () => { const s = UI.prepareReceipt(); await s.promise; if (s.error) throw s.error; });
    }
    async function complete() {
      await page.evaluate(android => {
        if (android) {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
        } else document.querySelector('iframe[data-print-job-id]').contentWindow.dispatchEvent(new Event('afterprint'));
      }, android);
    }
    async function capture(name) {
      const item = await page.evaluate(android => {
        const job = PrintManager.history().find(j => j.stage === 'SEND_STARTED');
        return { job, payload: android ? __intents.at(-1).href.slice(7).split('#Intent;')[0] : __printArtifacts.at(-1).html,
          active: android ? __intents.at(-1).active : true };
      }, android);
      check(`${prefix} ${name}: payload at transport equals prepared SHA-256`, hash(item.payload) === item.job.payloadHash && item.active);
      const file = path.join(evidence, `${android ? 'android' : 'desktop'}-${name}`);
      if (android) fs.writeFileSync(file + '.png', Buffer.from(item.payload.split(',')[1], 'base64'));
      else {
        if (pdfHashes.has(item.job.payloadHash)) return item;
        const proof = await context.newPage(); await proof.setContent(item.payload);
        await proof.evaluate(async () => { document.body.getBoundingClientRect(); await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
        await proof.pdf({ path: file + '.pdf', preferCSSPageSize: true, printBackground: true });
        artifacts.push({ name, file: file + '.pdf', ticketId: item.job.ticketId });
        pdfHashes.set(item.job.payloadHash, file + '.pdf');
        await proof.close();
      }
      return item;
    }
    for (const count of [3, 5]) {
      await render(`COPIAS-${count}`, 3);
      const before = await page.evaluate(() => PrintManager.history().length);
      await page.evaluate(count => PrintManager.enqueue({ copies: count, source: 'copy-test' }), count);
      for (let i = 1; i <= count; i++) {
        await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'WAITING_TURN' || j.stage === 'SEND_STARTED'));
        if (android && !await page.evaluate(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'))) await page.getByTestId('print-next').last().click();
        await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'));
        const active = await capture(`${count}-copies-${i}`);
        check(`${prefix} copy ${i}/${count}: one active, correct copy metadata`, active.job.copyNumber === i && active.job.totalCopies === count && await page.evaluate(() => PrintManager.history().filter(j => j.stage === 'SEND_STARTED').length === 1));
        await complete();
      }
      const group = await page.evaluate(n => PrintManager.history().slice(n), before);
      check(`${prefix} ${count} copies: identical content, all handoffs ended`, new Set(group.map(j => j.payloadHash)).size === 1 && group.every(j => j.stage === 'COMPLETED' && !j.physicalPrintConfirmed));
    }
    // Long -> short -> long created while A is sending; subsequent React renders
    // and complete unmount must not change A/B/C or destroy their resources.
    for (const [id, count] of [['LARGO-A', 24], ['CORTO-B', 1], ['LARGO-C', 24]]) {
      await render(id, count); await page.getByTestId('test-send').click();
    }
    await page.evaluate(() => { __root.render(React.createElement(PrintManager.PrintStatus)); });
    for (const id of ['LARGO-A', 'CORTO-B', 'LARGO-C']) {
      if (android && id !== 'LARGO-A') { await page.waitForFunction(() => PrintManager.history().find(j => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.stage))?.stage === 'WAITING_TURN'); await page.getByTestId('print-next').last().click(); }
      await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'));
      const item = await capture(id);
      check(`${prefix} ${id}: retained after modal and screen removal`, item.job.ticketId === id && (android || item.payload.includes(`ARTICULO ${id}`)));
      await complete();
    }
    for (const kind of ['layaway', 'payment', 'exchange', 'return']) {
      await render('DOC-' + kind, 3, kind); await page.getByTestId('test-send').click();
      await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'));
      const item = await capture(kind);
      check(`${prefix} ${kind}: original document type preserved`, item.job.documentType === kind);
      await complete();
    }
    await render('DOUBLE', 1);
    const beforeDouble = await page.evaluate(() => PrintManager.history().length);
    await page.getByTestId('test-send').dblclick();
    await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'));
    check(`${prefix}: double click creates one job`, await page.evaluate(n => PrintManager.history().length === n + 1, beforeDouble));
    await render('CANCEL', 1); await page.getByTestId('test-send').click();
    const cancelled = await page.evaluate(() => PrintManager.cancel(PrintManager.history().at(-1).printJobId));
    check(`${prefix}: waiting job can be cancelled`, cancelled);
    await complete();
    check(`${prefix}: cancelled job never sent`, await page.evaluate(() => PrintManager.history().at(-1).events.every(e => e.stage !== 'SEND_STARTED')));
    await context.setOffline(true);
    await render('OFFLINE', 1); await page.getByTestId('test-send').click();
    await page.waitForFunction(() => PrintManager.history().some(j => j.stage === 'SEND_STARTED'));
    await capture('offline'); await complete();
    check(`${prefix}: business unchanged`, await page.evaluate(() => __baseline === JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns, DATA.loans])));
    check(`${prefix}: resources released`, await page.locator('iframe').count() === 0);
    const history = await page.evaluate(() => PrintManager.history());
    fs.writeFileSync(path.join(evidence, `${prefix}-history.json`), JSON.stringify(history, null, 2));
    check(`${prefix}: no exceptions`, errors.length === 0, errors);
    await context.setOffline(false); await page.reload(); await page.waitForFunction(() => window.PrintManager);
    check(`${prefix}: reload never replays handed off jobs`, await page.evaluate(() => PrintManager.history().length === 0 && __native === 0 && __intents.length === 0));
    await context.close();
  }
} finally { await browser.close(); if (server) await new Promise(r => server.close(r)); }
if (!remote && hash(fs.readFileSync('index.html')) !== artifactSHA256) throw new Error('The tested bundle changed during certification');
fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ artifactSHA256, results, artifacts }, null, 2));
console.log(`${results.filter(r => r.ok).length}/${results.length}; evidence: ${evidence}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
