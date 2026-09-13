// H171: same synthetic opening before/after; no remote writes.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const before = process.argv.includes('--before');
const output = 'docs/fixes/evidence/h171/label-demand';
mkdirSync(output, { recursive: true });
const html = readFileSync('index.html');
const report = { at: new Date().toISOString(), artifact: createHash('sha256').update(html).digest('hex'), cases: [] };
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
function check(name, ok, details) { report.cases.push({ name, ok: !!ok, details }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, details || ''); }
async function fixture(count, saved = true, broken = false, invalid = false) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  let requests = 0, png;
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/public/barcodes/')) {
      requests++;
      return route.fulfill({ status: broken ? 404 : 200, contentType: 'image/png', body: broken ? '' : png });
    }
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(120000);
  await page.goto(base);
  await page.waitForFunction(() => window.InventoryScreen && window.BARCODES?.ready());
  const image = await page.evaluate(({ count, saved, invalid }) => {
    const D = DATA, B = BARCODES;
    if (!CONFIG.ready) CONFIG.load(CONFIG.prepareMutation('reset', []).state);
    const rows = Array.from({ length: count }, (_, i) => {
      const id = `10000171-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, code = D.barcodeFromId(id);
      return D.hydrate({ id, recordModel: 'v2', referenceFamilyId: id, barcodeContract: 3, barcodeCode: code,
        nombre: `DEMAND ${i + 1}`, modelo: `DEMAND${i + 1}`, sku: `DEMAND-${i + 1}-40`, cat: '1', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: '—', precio: 590,
        attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N', stockQuantity: 2,
        barcodeUrls: saved ? { '40': `https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/public/barcodes/${saved === 'wrong-code' ? '000' : code}.png` } : {} });
    });
    if (invalid) rows.at(-1).barcodeContract = 2;
    const kinds = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
    D.replaceFromOnline({ ...Object.fromEntries(kinds.map(k => [k, []])), products: rows, commissionContext: { periodStart: '', sellerBases: [] } });
    const image = B.toPNGDataURL(rows[0].barcodeCode);
    const state = window.__demand = { png: 0, jpeg: 0, certified: 0, correct: 0, source: JSON.stringify(D.products) };
    const batch = B.createLabelCertificationBatch, generate = B.toPNGDataURL;
    B.createLabelCertificationBatch = (...args) => {
      const b = batch(...args);
      return { ...b, certify(...values) { const c = b.certify(...values); state.certified++; if (c.ok && c.productId === c.resolvedProductId && c.size === c.resolvedSize) state.correct++; return c; } };
    };
    B.toPNGDataURL = (...args) => { state.png++; return generate(...args); };
    const blob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, ...rest) { if (type === 'image/jpeg') state.jpeg++; return blob.call(this, callback, type, ...rest); };
    AUTH.canAccess = () => true;
    document.body.innerHTML = '<div id="demand-root"></div>';
    window.__demandRoot = ReactDOM.createRoot(document.getElementById('demand-root'));
    window.__demandRoot.render(React.createElement(InventoryScreen));
    return image;
  }, { count, saved, invalid });
  png = Buffer.from(image.split(',')[1], 'base64');
  return { page, context, requests: () => requests };
}
try {
  for (const test of [{ count: 973, saved: true }, ...(!before ? [{ count: 3, saved: true }, { count: 3, saved: false }, { count: 3, saved: 'wrong-code' }, { count: 3, saved: true, broken: true }, { count: 3, saved: true, invalid: true }] : [])]) {
    const { page, context, requests } = await fixture(test.count, test.saved, test.broken, test.invalid);
    try {
      const start = Date.now();
      await page.getByTestId('inventory-labels').click();
      await page.getByTestId(test.invalid ? 'labels-certification-block' : 'labels-open-printable').waitFor();
      const ms = Date.now() - start;
      const state = await page.evaluate(() => ({ ...__demand, unchanged: __demand.source === JSON.stringify(DATA.products), previews: document.querySelectorAll('[data-testid="label-preview-stage"]').length }));
      delete state.source;
      report.opening ||= { ms, requests: requests(), ...state };
      check(`opening/${JSON.stringify(test)}`, test.invalid ? state.png === 0 && state.jpeg === 0 && requests() === 0 : state.png <= (test.saved === true && !test.broken ? 0 : Math.min(4, test.count)) && state.jpeg === 0 && state.previews === Math.min(4, test.count) && (test.saved !== 'wrong-code' || requests() === 0), { ms, requests: requests(), ...state });
      check(`authority/${JSON.stringify(test)}`, state.unchanged && state.certified === test.count && state.correct === test.count - (test.invalid ? 1 : 0));
      if (!before && !test.invalid && test.count < 10) {
        await page.getByTestId('labels-copies-stock').click();
        const download = page.waitForEvent('download');
        await page.getByTestId('labels-download').click();
        const bytes = readFileSync(await (await download).path());
        check(`pdf/${JSON.stringify(test)}`, bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length === test.count * 2);
        if (test.saved === true && !test.broken) {
          const popup = page.waitForEvent('popup');
          await page.getByTestId('labels-open-printable').click();
          const print = await popup;
          await print.waitForFunction(() => document.querySelectorAll('[data-testid="label-master"]').length === 6);
          const images = await print.locator('[data-label-part="barcode"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
          check('print/complete-embedded-images', images.length === 6 && images.every(src => src.startsWith('data:image/png;base64,')));
          await print.close();
        }
      }
      if (!before && test.count === 973) {
        await page.getByTestId('label-modal-close').click();
        const pngBefore = state.png;
        await page.getByTestId('inventory-labels').click();
        await page.getByTestId('labels-open-printable').waitFor();
        const again = await page.evaluate(() => ({ png: __demand.png, jpeg: __demand.jpeg, certified: __demand.certified }));
        check('reopen/reuses-saved-and-recertifies', again.png === pngBefore && again.jpeg === 0 && again.certified === 1946, again);
      }
    } finally { await context.close(); }
  }
  if (!before && existsSync(output + '/baseline.json')) {
    const baseline = JSON.parse(readFileSync(output + '/baseline.json', 'utf8'));
    check('baseline/cost-and-guarantees', report.opening.png <= baseline.opening.png && report.opening.jpeg <= baseline.opening.jpeg && report.opening.requests <= baseline.opening.requests && report.opening.correct === baseline.opening.correct && report.opening.unchanged);
  }
} catch (error) { check('runner', false, error.message); }
finally {
  report.passed = report.cases.filter(c => c.ok).length; report.failed = report.cases.length - report.passed;
  writeFileSync(`${output}/${before ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--fijar') && !report.failed) writeFileSync(output + '/baseline.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close(); server.closeAllConnections(); server.close();
}
process.exitCode = report.failed ? 1 : 0;
