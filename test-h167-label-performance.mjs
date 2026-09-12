// H-167: guardian de coste, garantías y completitud sobre el artefacto real.
// Fixtures V3 sintéticos, sesión aislada y toda red externa bloqueada.
// --record-before "motivo" conserva la reproducción previa.
// --fijar "motivo" refija el suelo después de pasar guardián/regresiones.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.env.BALAM_TEST_ROOT || '.');
const evidenceDir = resolve('docs/fixes/evidence');
mkdirSync(evidenceDir, { recursive: true });
const option = flag => { const at = process.argv.indexOf(flag); return at < 0 ? '' : process.argv[at + 1] || ''; };
const appendBefore = option('--append-before');
const beforeReason = option('--record-before') || appendBefore;
const fixReason = option('--fijar');
const beforeFile = resolve(evidenceDir, 'h167-before.json');
const baselineFile = resolve(evidenceDir, 'h167-baseline.json');
const outputFile = beforeReason ? beforeFile : resolve(evidenceDir, 'h167-after.json');
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8'))
  : existsSync(beforeFile) ? JSON.parse(readFileSync(beforeFile, 'utf8')) : null;
const counts = (process.env.H167_COUNTS || '10,100,300').split(',').map(Number);
const phases = (process.env.H167_PHASES || 'open,stock,price').split(',');
const timeoutMs = Number(process.env.H167_TIMEOUT_MS || 45000);
const pdfTimeoutMs = Number(process.env.H167_PDF_TIMEOUT_MS || 120000);
const checks = [];
const report = {
  story: 'H-167', at: new Date().toISOString(), reason: beforeReason || fixReason || 'Verificación del guardián',
  artifact: { path: resolve(root, 'index.html'), sha256: createHash('sha256').update(readFileSync(resolve(root, 'index.html'))).digest('hex') },
  environment: { browser: 'Chrome headless', viewport: '1280x850', network: 'All external requests aborted', fixture: 'V2, barcode contract 3, positive stock 2, size 40' },
  costPolicy: { strict: ['certifications', 'publicResolve', 'productArrayReads', 'pngImages', 'barcodeRenders', 'jpegBlobRasters for completed PDF'],
    bounded: 'modelChecks <= 10N and sizeResolutions <= 4N accommodate React commit counts; costly scans/renders remain strict',
    observations: 'Wall times, long tasks and JPEG work before cancellation at 300 are observations; productArrayReads includes one fixture-snapshot observation per measurement',
    pdfTimeoutMs },
  measurements: [], guarantees: [], checks,
};
if (appendBefore && baseline) {
  report.previousRuns = [...(baseline.previousRuns || []), { at: baseline.at, summary: baseline.summary,
    interrupted: baseline.measurements.filter(row => !row.completed) }];
  report.measurements = baseline.measurements.filter(row => !counts.includes(row.count));
} else if (beforeReason && baseline) {
  report.previousRuns = [...(baseline.previousRuns || []), { at: baseline.at, artifact: baseline.artifact,
    summary: baseline.summary, measurements: baseline.measurements, guarantees: baseline.guarantees }];
}
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
const bounded = async (promise, name, limit = timeoutMs) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name}: timeout ${limit}ms`)), limit); })]); }
  finally { clearTimeout(timer); }
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..' + sep) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const baseURL = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
report.environment.version = browser.version();

async function makePage(count, invalid = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(baseURL) || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    // H164 publica snapshots mediante getter no configurable. Contar la lectura
    // en su creación conserva descriptor/resultado y no sustituye esa autoridad.
    const define = Object.defineProperty;
    Object.defineProperty = function (target, name, descriptor) {
      if (target === window.DATA && name === 'products' && typeof descriptor.get === 'function') {
        const getter = descriptor.get;
        descriptor = { ...descriptor, get() {
          if (window.__h167) window.__h167.counts.productArrayReads = (window.__h167.counts.productArrayReads || 0) + 1;
          return getter.call(this);
        } };
      }
      return define.call(Object, target, name, descriptor);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.InventoryScreen && window.BARCODES.ready());
  await page.evaluate(({ count, invalid }) => {
    const D = window.DATA, B = window.BARCODES;
    if (window.CONFIG.prepareMutation && window.CONFIG.load && !window.CONFIG.ready) window.CONFIG.load(window.CONFIG.prepareMutation('reset', []).state);
    const rows = Array.from({ length: count }, (_, index) => {
      const id = `10000161-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return D.hydrate({ id, recordModel: 'v2', referenceFamilyId: id, barcodeContract: 3, barcodeCode: D.barcodeFromId(id),
        nombre: `PERF ${index + 1}`, modelo: `PERF${index + 1}`, sku: `PERF-${index + 1}-40`,
        cat: '1', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: '—', precio: 590,
        attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N', stockQuantity: 2 });
    });
    if (invalid === 'contract') rows[rows.length - 1].barcodeContract = 2;
    if (invalid === 'duplicate') rows[rows.length - 1].barcodeAliases = [rows[0].barcodeCode];
    if (invalid === 'legacy') Object.assign(rows[rows.length - 1], { recordModel: 'v1', stock: [{ talla: '40', escala: 'N', stock: 2 }] });
    window.__h167ReplaceRows = rows => {
      if (D.replaceFromOnline) {
        const kinds = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
        const snapshot = Object.fromEntries(kinds.map(kind => [kind, []]));
        D.replaceFromOnline({ ...snapshot, products: rows, commissionContext: { periodStart: '', sellerBases: [] } });
      } else D.products.splice(0, D.products.length, ...rows);
    };
    window.__h167ReplaceRows(rows);
    window.AUTH.canAccess = () => true;
    D.saveProducts = () => { throw new Error('Fixture must not persist products'); };
    window.__h167 = { counts: {}, certifications: {}, pngCodes: [], longTasks: [], pdfCompleted: 0, source: JSON.stringify(D.products) };
    const state = window.__h167;
    const NativeBlob = window.Blob;
    window.Blob = new Proxy(NativeBlob, { construct(target, args, constructor) {
      const blob = Reflect.construct(target, args, constructor);
      if (args[1]?.type === 'application/pdf') state.pdfCompleted++;
      return blob;
    } });
    const increment = name => { state.counts[name] = (state.counts[name] || 0) + 1; };
    for (const [object, key, name] of [[B, 'certifySellableReference', 'certifications'], [B, 'resolve', 'publicResolve'],
      [D, 'resolveProductSizes', 'sizeResolutions'], [D, 'isV2Reference', 'modelChecks'], [B, 'toPNGDataURL', 'pngImages']]) {
      const original = object[key];
      object[key] = function (...args) {
        increment(name);
        const result = original.apply(this, args);
        if (name === 'certifications') state.certifications[String(args[0].id) + ':' + String(args[1])] = { ok: result.ok, issues: result.issues,
          productId: result.productId, resolvedProductId: result.resolvedProductId, size: result.size, resolvedSize: result.resolvedSize, barcode: result.labelCode };
        if (name === 'pngImages') state.pngCodes.push(args[0]);
        return result;
      };
    }
    if (B.createLabelCertificationBatch) {
      const originalBatch = B.createLabelCertificationBatch;
      B.createLabelCertificationBatch = function (...args) {
        const batch = originalBatch.apply(this, args), original = batch.certify;
        return { ...batch, certify: function (...values) {
          increment('certifications');
          const result = original.apply(this, values);
          state.certifications[String(values[0].id) + ':' + String(values[1])] = { ok: result.ok, issues: result.issues,
            productId: result.productId, resolvedProductId: result.resolvedProductId, size: result.size, resolvedSize: result.resolvedSize, barcode: result.labelCode };
          return result;
        } };
      };
    }
    const products = D.products;
    if (Object.getOwnPropertyDescriptor(D, 'products').configurable) Object.defineProperty(D, 'products', { configurable: true, enumerable: true, get() { increment('productArrayReads'); return products; } });
    const originalBarcode = window.JsBarcode;
    window.JsBarcode = function (...args) { increment('barcodeRenders'); return originalBarcode.apply(this, args); };
    const originalURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) { increment(args[0] === 'image/jpeg' ? 'jpegRasters' : 'pngRasters'); return originalURL.apply(this, args); };
    const originalBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { increment(args[1] === 'image/jpeg' ? 'jpegBlobRasters' : 'pngBlobRasters'); return originalBlob.apply(this, args); };
    new PerformanceObserver(list => { state.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))); }).observe({ type: 'longtask', buffered: false });
    document.body.innerHTML = '<div id="h167-root"></div>';
    window.__h167Root = ReactDOM.createRoot(document.getElementById('h167-root'));
    window.__h167Root.render(React.createElement(window.InventoryScreen));
  }, { count, invalid });
  await page.getByTestId('inventory-labels').waitFor();
  return { page, context };
}

async function measure(page, count, phase, action, expectedCopies, withPrice) {
  await page.evaluate(() => { window.__h167.counts = {}; window.__h167.pngCodes = []; window.__h167.longTasks = []; window.__h167.start = performance.now(); window.__h167.pdfStart = window.__h167.pdfCompleted; });
  const start = Date.now();
  await bounded(action(), `${count}/${phase}/action`);
  await page.getByTestId('label-modal').waitFor();
  const modalMs = Date.now() - start;
  if (count < 300) {
    await bounded(page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="labels-download"]');
      return button && !button.disabled && window.__h167.pdfCompleted > window.__h167.pdfStart;
    }, undefined, { timeout: pdfTimeoutMs }), `${count}/${phase}/PDF`, pdfTimeoutMs);
  } else {
    await bounded(page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="labels-open-printable"]');
      return button && !button.disabled;
    }), `${count}/${phase}/prepared`);
  }
  const completeMs = Date.now() - start;
  const result = await page.evaluate(({ count, expectedCopies, withPrice }) => {
    const s = window.__h167, rows = window.DATA.products;
    const preview = [...document.querySelectorAll('[data-testid="label-preview-stage"]')];
    return { cost: { ...s.counts }, maxLongTaskMs: Math.round(Math.max(0, ...s.longTasks.map(t => t.duration))),
      identities: Object.values(s.certifications), pngUnique: new Set(s.pngCodes).size,
      guarantee: { productsUnchanged: s.source === JSON.stringify(rows),
        certifiedAll: Object.values(s.certifications).filter(r => r.ok && r.productId === r.resolvedProductId && r.size === r.resolvedSize).length === count,
        wholeBatch: document.querySelector('[data-testid="labels-open-printable"]')?.textContent.includes(`(${count * expectedCopies})`),
        previewCount: preview.length === Math.min(4, count),
        previewPrice: preview.every(node => withPrice ? node.textContent.includes('$590') : !node.textContent.includes('$590')),
        outputsEnabled: !document.querySelector('[data-testid="labels-open-printable"]')?.disabled,
      } };
  }, { count, expectedCopies, withPrice });
  delete result.identities;
  const measurement = { count, phase, completed: true, completionKind: count < 300 ? 'PDF-ready' : 'whole-batch-prepared', modalMs, completeMs, ...result };
  report.measurements.push(measurement);
  console.log(`MEASURE ${JSON.stringify(measurement)}`);
  for (const [name, ok] of Object.entries(result.guarantee)) check(`${count}/${phase}/${name}`, ok);
  check(`${count}/${phase}/bounded-work`, (result.cost.modelChecks || 0) <= count * 10 && (result.cost.sizeResolutions || 0) <= count * 4,
    `${result.cost.modelChecks || 0} revisiones de modelo (máximo ${count * 10}); ${result.cost.sizeResolutions || 0} resoluciones de talla (máximo ${count * 4})`);
  save();
}

try {
  for (const count of counts) {
    let context, activePhase = 'mount';
    try {
      const fixture = await bounded(makePage(count), `${count}/mount`);
      context = fixture.context;
      const { page } = fixture;
      activePhase = 'open';
      await measure(page, count, 'open', () => page.getByTestId('inventory-labels').click(), 1, true);
      if (count >= 300) {
        const closedAt = Date.now();
        await page.getByTestId('label-modal-close').click();
        await page.getByTestId('label-modal').waitFor({ state: 'detached' });
        check(`${count}/cancel`, true, `${Date.now() - closedAt} ms`);
        if (!beforeReason) {
          const rasters = await page.evaluate(() => window.__h167.counts.jpegBlobRasters || 0);
          await page.waitForTimeout(650);
          const later = await page.evaluate(() => window.__h167.counts.jpegBlobRasters || 0);
          check(`${count}/PDF-cancel-stops-work`, later <= rasters + 1, `${rasters} → ${later} raster(s), como máximo uno en vuelo`);
        }
        continue;
      }
      if (!phases.includes('stock')) continue;
      activePhase = 'stock';
      await measure(page, count, 'stock', () => page.getByTestId('labels-copies-stock').click(), 2, true);
      // Functional structure: only checkbox outside the reference-selection fieldset.
      if (!phases.includes('price')) continue;
      activePhase = 'price';
      await measure(page, count, 'price', () => page.getByTestId('label-modal').locator('input[type="checkbox"]:not([data-testid^="label-reference-select-"])').uncheck(), 2, false);
      if (!beforeReason) {
        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('labels-download').click();
        const pdf = readFileSync(await (await downloadPromise).path()).toString('latin1');
        const pdfBatch = { count, pages: (pdf.match(/\/Type \/Page\b/g) || []).length, header: pdf.startsWith('%PDF-1.4'),
          exactCopies: Array.from({ length: count }, (_, index) => `PERF ${index + 1} | PERF-${index + 1}-40`).every(value => pdf.split(`(${value})`).length - 1 === 2) };
        (report.pdfBatches ||= []).push(pdfBatch);
        if (count === 10) report.pdf = pdfBatch;
        check(`${count}/PDF/whole-batch-and-two-copies-each`, pdfBatch.header && pdfBatch.pages === count * 2 && pdfBatch.exactCopies);
      }
      if (!beforeReason && count === 10) {
        await page.evaluate(() => {
          const state = window.__h167;
          state.uploads = []; state.savedIds = []; state.savedRows = [];
          window.STORE.hasSession = async () => true;
          window.STORE.assertBusinessReady = () => true;
          window.STORE.uploadBarcode = async (name, blob) => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            state.uploads.push({ name, type: blob.type, png: bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 });
            return `https://fixture.invalid/${name}`;
          };
          window.DATA.saveProducts = ids => { state.savedIds.push(ids); return true; };
          window.DATA.saveProductRows = async rows => {
            state.savedRows = JSON.parse(JSON.stringify(rows));
            state.savedIds.push(rows.map(row => row.id));
            return { ok: true, rows };
          };
        });
        const start = Date.now();
        await page.getByTestId('labels-save-account').click();
        await page.waitForFunction(() => window.__h167.savedIds.length > 0);
        report.upload = await page.evaluate(() => {
          const state = window.__h167, current = window.DATA.products;
          const rows = state.savedRows.length ? state.savedRows : current;
          const expectedNames = rows.map(row => row.barcodeCode + '.png').sort();
          const expectedIds = rows.map(row => row.id).sort();
          const stable = rows.map(row => { const copy = { ...row }; delete copy.barcodeUrls; return copy; });
          const prior = JSON.parse(state.source).map(row => { const copy = { ...row }; delete copy.barcodeUrls; return copy; });
          return { files: state.uploads.length, pngValid: state.uploads.every(file => file.png && file.type === 'image/png'),
            exactNames: JSON.stringify(state.uploads.map(file => file.name).sort()) === JSON.stringify(expectedNames),
            exactIds: state.savedIds.length === 1 && JSON.stringify([...state.savedIds[0]].sort()) === JSON.stringify(expectedIds),
            exactUrls: rows.every(row => row.barcodeUrls['40'] === `https://fixture.invalid/${row.barcodeCode}.png`),
            businessUnchanged: JSON.stringify(prior) === JSON.stringify(stable),
            cacheNotMutatedBeforeDurability: state.savedRows.length ? JSON.stringify(current) === state.source : true,
            transport: 'STORE upload/save boundary stubbed; PNG real; external network aborted' };
        });
        report.upload.durationMs = Date.now() - start;
        check('upload/exact-PNG-codes-IDs-and-business', report.upload.files === count && report.upload.pngValid && report.upload.exactNames && report.upload.exactIds && report.upload.exactUrls && report.upload.businessUnchanged && report.upload.cacheNotMutatedBeforeDurability);
      }
    } catch (error) {
      report.measurements.push({ count, phase: activePhase, completed: false, error: String(error.message) });
      check(`${count}/completion`, false, String(error.message)); save();
    } finally { if (context) await bounded(context.close(), `${count}/close`).catch(() => {}); }
  }
  for (const invalid of ['contract', 'duplicate', 'legacy']) {
    const { page, context } = await makePage(2, invalid);
    try {
      await page.evaluate(() => { window.__h167.counts = {}; });
      await page.getByTestId('inventory-labels').click();
      await page.getByTestId('labels-certification-block').waitFor();
      const guard = await page.evaluate(() => ({
        pngImages: window.__h167.counts.pngImages || 0,
        previewAbsent: !document.querySelector('[data-testid="label-preview-stage"]'),
        downloadDisabled: document.querySelector('[data-testid="labels-download"]').disabled,
        printDisabled: document.querySelector('[data-testid="labels-open-printable"]').disabled,
        productsUnchanged: JSON.stringify(window.DATA.products) === window.__h167.source,
      }));
      report.guarantees.push({ invalid, ...guard });
      check(`blocked/${invalid}`, guard.pngImages === 0 && guard.previewAbsent && guard.downloadDisabled && guard.printDisabled && guard.productsUnchanged);
    } finally { await context.close(); }
  }
  if (!beforeReason) {
    const { page, context } = await makePage(300);
    try {
      await page.evaluate(() => {
        const original = window.BARCODES.createLabelCertificationBatch;
        window.BARCODES.createLabelCertificationBatch = function (...args) {
          const batch = original.apply(this, args);
          let scheduled = false;
          return { ...batch, certify(...values) {
            const result = batch.certify(...values);
            if (!scheduled) {
              scheduled = true;
              setTimeout(() => {
                window.__h167.cancelledWhilePreparing = !!document.querySelector('[data-testid="labels-preparing"]');
                document.querySelector('[data-testid="label-modal-close"]')?.click();
              }, 0);
            }
            return result;
          } };
        };
      });
      await page.getByTestId('inventory-labels').click();
      await page.waitForFunction(() => window.__h167.cancelledWhilePreparing !== undefined);
      await page.getByTestId('label-modal').waitFor({ state: 'detached' });
      const stopped = await page.evaluate(() => ({ preparing: window.__h167.cancelledWhilePreparing,
        certifications: window.__h167.counts.certifications || 0, png: window.__h167.counts.pngImages || 0 }));
      await page.waitForTimeout(200);
      const stable = await page.evaluate(() => ({ certifications: window.__h167.counts.certifications || 0, png: window.__h167.counts.pngImages || 0 }));
      report.cancelPreparation = { ...stopped, after: stable };
      check('cancel/preparation-stops-work', stopped.preparing && stopped.certifications === stable.certifications && stopped.png === stable.png);
    } finally { await context.close(); }
    const small = await makePage(2);
    try {
      const p = small.page;
      await p.getByTestId('inventory-labels').click();
      await p.waitForFunction(() => !document.querySelector('[data-testid="labels-download"]')?.disabled && !!document.querySelector('[data-testid="labels-download"]'));
      await p.evaluate(() => { window.__h167.counts = {}; window.dispatchEvent(new Event('datachange')); });
      await p.waitForTimeout(200);
      const unchanged = await p.evaluate(() => ({ certifications: window.__h167.counts.certifications || 0,
        png: window.__h167.counts.pngImages || 0, ready: !document.querySelector('[data-testid="labels-download"]')?.disabled }));
      check('invalidate/unrelated-data-does-not-restart', unchanged.certifications === 0 && unchanged.png === 0 && unchanged.ready);
      await p.evaluate(() => {
        const rows = window.DATA.products; rows[0].barcodeContract = 2;
        window.__h167.counts = {};
        window.__h167ReplaceRows(rows);
        if (!window.DATA.replaceFromOnline) window.dispatchEvent(new Event('datachange'));
      });
      await p.getByTestId('labels-certification-block').waitFor();
      const blocked = await p.evaluate(() => ({ png: window.__h167.counts.pngImages || 0,
        downloads: document.querySelector('[data-testid="labels-download"]').disabled,
        prints: document.querySelector('[data-testid="labels-open-printable"]').disabled,
        preview: !!document.querySelector('[data-testid="label-preview-stage"]') }));
      check('invalidate/datachange-blocks-stale-output', blocked.png === 0 && blocked.downloads && blocked.prints && !blocked.preview);
      await p.evaluate(() => {
        const rows = window.DATA.products; rows[0].barcodeContract = 3;
        window.__h167ReplaceRows(rows);
        if (!window.DATA.replaceFromOnline) window.dispatchEvent(new Event('datachange'));
      });
      await p.waitForFunction(() => !!document.querySelector('[data-testid="labels-download"]') && !document.querySelector('[data-testid="labels-download"]').disabled);
      await p.evaluate(() => {
        window.__h167.counts = {};
        const C = window.CONFIG;
        if (C.prepareMutation && C.load) C.load(C.prepareMutation('setSetting', ['store.name', 'H167 CONFIG REVALIDADA']).state);
        else window.dispatchEvent(new Event('configchange'));
      });
      await p.waitForFunction(() => !!document.querySelector('[data-testid="labels-download"]') && !document.querySelector('[data-testid="labels-download"]').disabled);
      const restored = await p.evaluate(() => ({ certifications: window.__h167.counts.certifications || 0,
        png: window.__h167.counts.pngImages || 0, blocks: !!document.querySelector('[data-testid="labels-certification-block"]') }));
      check('invalidate/configchange-recertifies-and-restores', restored.certifications === 2 && restored.png === 2 && !restored.blocks);
      report.invalidation = { unchanged, blocked, restored };
    } finally { await small.context.close(); }
  }
  if (!beforeReason) {
    check('baseline/exists', !!baseline);
    for (const previous of baseline?.measurements || []) {
      const current = report.measurements.find(row => row.count === previous.count && row.phase === previous.phase);
      check(`baseline/${previous.count}/${previous.phase}/completion`, current?.completed === true);
      if (!current || !previous.completed) continue;
      for (const [name, value] of Object.entries(previous.guarantee)) if (value) check(`baseline/${previous.count}/${previous.phase}/guarantee/${name}`, current.guarantee[name]);
      for (const name of ['certifications', 'publicResolve', 'productArrayReads', 'pngImages', 'barcodeRenders']) {
        check(`baseline/${previous.count}/${previous.phase}/cost/${name}`, (current.cost[name] || 0) <= (previous.cost[name] || 0));
      }
      if (previous.count < 300 && previous.cost.jpegBlobRasters !== undefined) check(`baseline/${previous.count}/${previous.phase}/cost/JPEG`, (current.cost.jpegBlobRasters || 0) <= previous.cost.jpegBlobRasters);
    }
    for (const previous of baseline?.guarantees || []) check(`baseline/block/${previous.invalid}`, report.guarantees.some(row => row.invalid === previous.invalid && row.pngImages === 0 && row.previewAbsent && row.downloadDisabled && row.printDisabled && row.productsUnchanged));
  }
} catch (error) { check('runner', false, error.message); }
finally {
  report.summary = { passed: checks.filter(row => row.ok).length, failed: checks.filter(row => !row.ok).length };
  save();
  if (fixReason && !report.summary.failed) writeFileSync(baselineFile, JSON.stringify(report, null, 2) + '\n');
  await bounded(browser.close(), 'browser.close').catch(() => {});
  server.closeAllConnections(); server.close();
}
console.log(`H-167 ${report.summary.passed}/${checks.length}; ${outputFile}`);
process.exit(report.summary.failed ? 1 : 0);
