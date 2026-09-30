import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { installPrintTransport } from './test-print-transport.mjs';
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync('index.html')); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
const results = [];
const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
try {
  for (const android of [false, true]) {
  console.log(android ? 'Android system transport' : 'Desktop system transport');
  const context = await browser.newContext(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0' } : {});
  await context.route(/supabase\.co/, r => r.abort());
  await context.addInitScript(installPrintTransport, { counter: '__native', hold: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.PrintManager);
  await page.evaluate(() => {
    window.__element = document.createElement('main'); __element.style.cssText = 'width:80mm;font:14px Arial';
    __element.textContent = 'FOLIO ORIGINAL - TOTAL 100 - PIE'; document.body.append(__element);
    const host = document.createElement('div'); document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(PrintManager.PrintStatus));
  });
  // Force unavailable native transport, then retry the same document after the
  // source has changed. Stub only the device boundary, never the renderer.
  await page.evaluate(() => {
    window.__throwNative = true;
    new MutationObserver(() => document.querySelectorAll('iframe[data-print-job-id]').forEach(f => {
      if (!f.__failureTest) { f.__failureTest = true; const print = f.contentWindow.print;
        f.contentWindow.print = () => { if (__throwNative) throw new Error('TEST_UNAVAILABLE'); print(); }; }
    })).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-print-job-id'] });
    UI.printReceipt({ element: __element });
  });
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'FAILED');
  const original = await page.evaluate(() => PrintManager.history().at(-1));
  check('native failure has no false completion', !original.completedAt && original.result === 'NOT_HANDED_OFF');
  await page.evaluate(() => { __throwNative = false; __element.textContent = 'OTHER DOCUMENT TOTAL 999'; });
  await page.getByTestId('print-retry').last().click();
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'SEND_STARTED');
  check('retry retains same job, payload, folio and total', await page.evaluate(original => {
    const j = PrintManager.history().at(-1);
    return j.printJobId === original.printJobId && j.payloadHash === original.payloadHash && __printArtifacts.at(-1).text.includes('FOLIO ORIGINAL - TOTAL 100 - PIE') && !__printArtifacts.at(-1).text.includes('999');
  }, original));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  check('focus alone is not dialog completion', await page.evaluate(() => PrintManager.history().at(-1).stage === 'SEND_STARTED'));
  await page.evaluate(() => document.querySelector('iframe[data-print-job-id]').contentWindow.dispatchEvent(new Event('afterprint')));
  // Empty and oversized documents fail as whole jobs with diagnostic evidence.
  await page.evaluate(() => { __element.textContent = ''; UI.printReceipt({ element: __element }); });
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'FAILED');
  check('empty document is rejected before transport', await page.evaluate(() => !PrintManager.history().at(-1).sendStartedAt));
  await page.evaluate(() => { __element.textContent = 'VERY LONG'; __element.style.height = '30000px'; UI.printReceipt({ element: __element }); });
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'FAILED');
  check('very long native document is rejected, never cut silently', await page.evaluate(() => !PrintManager.history().at(-1).sendStartedAt));
  // An image which never becomes ready cannot authorize a send; cancellation
  // must release the renderer without waiting for a guessed timeout.
  await page.evaluate(() => {
    __element.style.height = ''; __element.innerHTML = '<p>WAITING FOR LOGO</p><img src="data:image/png;base64,invalid">';
    const append = document.body.appendChild;
    document.body.appendChild = function (node) {
      const result = append.call(this, node);
      if (node.tagName === 'IFRAME') {
        const proto = node.contentWindow.HTMLImageElement.prototype, decode = proto.decode;
        proto.decode = function () { return this.src.includes('invalid') ? new Promise(() => {}) : decode.call(this); };
      }
      return result;
    };
    UI.printReceipt({ element: __element });
  });
  await page.waitForFunction(() => PrintManager.history().at(-1)?.events.some(e => e.stage === 'ASSETS_WAITING'));
  check('unready assets never reach transport', await page.evaluate(() => !PrintManager.history().at(-1).sendStartedAt));
  await page.evaluate(() => PrintManager.cancel(PrintManager.history().at(-1).printJobId));
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  check('cancel releases an unfinished renderer without a timer', await page.evaluate(() => PrintManager.history().at(-1).stage === 'CANCELLED'));
  await page.evaluate(() => {
    __element.textContent = 'MANUAL DIALOG RETURN'; UI.printReceipt({ element: __element });
  });
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'SEND_STARTED');
  await page.getByTestId('print-returned').last().click();
  check('manual dialog return never confirms physical printing', await page.evaluate(() => {
    const job = PrintManager.history().at(-1);
    return job.stage === 'COMPLETED' && job.result === 'USER_CONFIRMED_RETURN' && !job.physicalPrintConfirmed;
  }));
  const childCreated = context.waitForEvent('page');
  await page.evaluate(() => {
    const child = window.open('', '_blank');
    child.document.write('<main>CHILD ORIGINAL TOTAL 100 FOOTER</main><button data-testid="child-print">Print</button>'); child.document.close();
    child.document.querySelector('button').onclick = () => UI.printReceipt({ element: child.document.querySelector('main'), host: child });
  });
  const child = await childCreated;
  await child.getByTestId('child-print').click();
  await child.close();
  await page.waitForFunction(() => PrintManager.history().at(-1)?.stage === 'SEND_STARTED');
  check('closed child window retains its complete system document', await page.evaluate(() => __printArtifacts.at(-1).text.includes('CHILD ORIGINAL TOTAL 100 FOOTER')));
  await page.evaluate(() => document.querySelector('iframe[data-print-job-id]').contentWindow.dispatchEvent(new Event('afterprint')));
  await context.close();

  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exitCode = results.every(Boolean) ? 0 : 1;
