// Deterministic lifecycle reproduction; no printer or business network.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { installPrintTransport } from './test-print-transport.mjs';
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync('index.html')); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`); };
try {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0' });
  await page.route(/supabase\.co/, r => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.UI && window.DATA);
  // Mutation before the preparation microtask must never substitute B for A.
  const snapshot = await page.evaluate(async () => {
    const element = document.createElement('main'); element.style.cssText = 'width:80mm;background:white;color:black;font:20px Arial';
    element.textContent = 'DOCUMENTO A · TOTAL 100 · PIE A'; document.body.append(element);
    const a = UI.prepareReceipt(element);
    element.textContent = 'DOCUMENTO B · TOTAL 999 · PIE B';
    await a.promise;
    const b = UI.prepareReceipt(element); await b.promise;
    return { different: a.png !== b.png, aReady: !!a.png, bReady: !!b.png };
  });
  check('A is frozen before any asynchronous preparation', snapshot.different && snapshot.aReady && snapshot.bReady, snapshot);
  const overlap = await page.evaluate(async () => {
    window.__sends = [];
    document.addEventListener('click', e => { if (e.target.matches('a[href^="intent:"]')) { e.preventDefault(); __sends.push(e.target.href); } }, true);
    const element = document.querySelector('main');
    const state = UI.prepareReceipt(element); await state.promise;
    UI.printReceipt({ element }); UI.printReceipt({ element }); UI.printReceipt({ element });
    return __sends.length;
  });
  check('Repeated activation does not overlap RawBT handoffs', overlap <= 1, { sendsWithoutReturn: overlap });
  await page.close();
  const desktop = await browser.newPage();
  await desktop.addInitScript(installPrintTransport, { counter: '__nativeCount', hold: true });
  await desktop.route(/supabase\.co/, r => r.abort());
  await desktop.goto(`http://127.0.0.1:${server.address().port}/`);
  await desktop.waitForFunction(() => window.UI);
  await desktop.evaluate(async () => {
    const element = document.createElement('main'); element.textContent = 'DOCUMENTO COMPLETO'; document.body.append(element);
    UI.printReceipt({ element }); UI.printReceipt({ element }); UI.printReceipt({ element });
  });
  await desktop.waitForFunction(() => __nativeCount > 0);
  const native = await desktop.evaluate(() => ({ count: __nativeCount, text: __printArtifacts[0].text, retained: !!document.querySelector('iframe[data-print-job-id]') }));
  check('Native transport waits for dialog lifecycle', native.count === 1 && native.retained && native.text.includes('DOCUMENTO COMPLETO'), native);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
fs.writeFileSync('h153-races.json', JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.ok).length}/${results.length}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
