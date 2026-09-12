// H-167: generated browser artifact, real Code128/PNG/PDF, isolated online snapshots.
// The only artificial cost is a configurable delay before the real certificate.
// No remote transports are allowed; this does not certify a physical printer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const html = await fs.readFile(process.env.BALAM_VERIFIED_HTML || 'index.html');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = 'docs/fixes/evidence';
await fs.mkdir(output, { recursive: true });
const evidence = {
  history: 'H-167', startedAt: new Date().toISOString(), artifactSha256: hash(html),
  scope: 'Generated HTML; real certification, Code128, PNG and PDF; valid explicit online snapshots; external network aborted.',
  sourceSha256: {}, cases: [], errors: [], externalRequestsAborted: 0, remoteBusinessWrites: 0,
};
for (const file of ['test-h167-label-lifecycle.mjs', 'balam/inventory.jsx', 'balam/barcodes.jsx']) {
  evidence.sourceSha256[file] = hash(await fs.readFile(file));
}
const save = () => fs.writeFile(output + '/h167-lifecycle.json', JSON.stringify(evidence, null, 2) + '\n');
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser, context, page;

async function fixture(count = 3, delayMs = 0) {
  await page?.close();
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.AUTH?.isReady() && window.DATA && window.InventoryScreen && window.BARCODES?.ready());
  const result = await page.evaluate(({ count, delayMs }) => {
    const D = window.DATA, C = window.CONFIG, B = window.BARCODES;
    C.load(C.prepareMutation('reset', []).state);
    const makeProduct = (number, extra = {}) => D.createReference({
      id: '16700000-0000-4000-8000-' + String(number).padStart(12, '0'),
      referenceFamilyId: '16700000-0000-4000-9000-' + String(number).padStart(12, '0'),
      nombre: 'Etiqueta H167 ' + number, modelo: 'H167-' + number,
      cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR',
      orn: '—', ornamentColorCodes: [], precio: 116, costo: 40,
      stockQuantity: 1, sizeCode: '40', sizeScale: 'N',
      sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' }, ...extra,
    }, []);
    const snapshot = Object.fromEntries(['products', 'sellers', 'clients', 'sales', 'movements', 'promotions',
      'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'].map(key => [key, []]));
    snapshot.products = Array.from({ length: count }, (_, index) => makeProduct(index + 1));
    snapshot.commissionContext = { periodStart: '', sellerBases: [] };
    D.replaceFromOnline(snapshot);
    window.__h167 = {
      snapshot, makeProduct, delayMs, batch: 0, certified: 0, png: 0, jpegStarted: 0, jpegCompleted: 0,
      arm: null, triggered: false, trace: [], closed: null,
    };
    const state = window.__h167;
    const counters = () => ({ batch: state.batch, certified: state.certified, png: state.png,
      jpegStarted: state.jpegStarted, jpegCompleted: state.jpegCompleted });
    state.counters = counters;
    state.trigger = where => {
      if (!state.arm || state.triggered || state.arm.trigger !== where) return;
      state.triggered = true;
      setTimeout(() => {
        if (state.arm.mode === 'close') {
          document.querySelector('[data-testid="label-modal-close"]').click();
          state.trace.push({ event: 'close', ...counters() });
          return;
        }
        const previousRevision = D.commercialProjectionRevision;
        if (state.arm.mode === 'collision') {
          state.snapshot.products.push(makeProduct(9999, {
            stockQuantity: 0, barcodeAliases: [state.snapshot.products[0].barcodeCode],
          }));
        } else if (state.arm.mode === 'clients') {
          state.snapshot.clients.push({ id: 'h167-client', nombre: 'Cliente aislado H167', tel: '—',
            compras: 0, total: 0, ultima: '', generic: false });
        }
        D.replaceFromOnline(state.snapshot);
        state.trace.push({ event: state.arm.mode, previousRevision, revision: D.commercialProjectionRevision, ...counters() });
      }, 0);
    };
    const originalBatch = B.createLabelCertificationBatch;
    if (typeof originalBatch !== 'function') throw new Error('H167_BATCH_MISSING_FROM_ARTIFACT');
    B.createLabelCertificationBatch = () => {
      const batch = originalBatch(); state.batch++;
      return { certify: (...args) => {
        const start = performance.now();
        while (performance.now() - start < state.delayMs) { /* controlled cost; real result below */ }
        const result = batch.certify(...args); state.certified++;
        state.trigger('certify'); return result;
      } };
    };
    const originalPNG = B.toPNGDataURL;
    B.toPNGDataURL = (...args) => { state.png++; return originalPNG(...args); };
    const originalBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, ...args) {
      if (type !== 'image/jpeg') return originalBlob.call(this, callback, type, ...args);
      state.jpegStarted++; state.trigger('jpeg');
      return originalBlob.call(this, blob => { state.jpegCompleted++; callback(blob); }, type, ...args);
    };
    document.addEventListener('click', event => {
      if (event.target.closest('[data-testid="label-modal-close"]')) state.closed = counters();
    }, true);
    window.AUTH.canAccess = () => true; window.AUTH.isAdmin = () => true;
    window.__h167ReactRoots.forEach(root => root.unmount());
    document.body.innerHTML = '<div id="h167-ui"></div>';
    window.__h167Root = ReactDOM.createRoot(document.getElementById('h167-ui'));
    window.__h167Root.render(React.createElement(window.InventoryScreen));
    return { count, firstId: snapshot.products[0].id, firstBarcode: snapshot.products[0].barcodeCode,
      revision: D.commercialProjectionRevision };
  }, { count, delayMs });
  await page.getByTestId('inventory-labels').waitFor();
  return result;
}
const counters = () => page.evaluate(() => window.__h167.counters());
const open = () => page.getByTestId('inventory-labels').click();
const ready = () => page.waitForFunction(() => {
  const button = document.querySelector('[data-testid="labels-download"]'); return button && !button.disabled;
}, null, { timeout: 30000 });
async function pdf() {
  await ready();
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const bytes = await fs.readFile(await (await downloaded).path());
  assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
  const text = bytes.toString('latin1');
  const pages = (text.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages > 0); assert.match(text, /\/DCTDecode/);
  return { text, pages, sha256: hash(bytes), bytes: bytes.length };
}
async function noEnabledOutputs() {
  for (const id of ['labels-download', 'labels-open-printable', 'labels-save-account', 'labels-share']) {
    const control = page.getByTestId(id);
    assert.ok(await control.count() === 0 || !await control.isEnabled(), id + ' retained an enabled stale output');
  }
}
async function scenario(name, run) {
  const started = Date.now();
  try {
    const details = await run();
    evidence.cases.push({ name, ok: true, elapsedMs: Date.now() - started, details });
    console.log('PASS ' + name);
  } catch (error) {
    const details = await counters().catch(() => null);
    evidence.cases.push({ name, ok: false, elapsedMs: Date.now() - started, error: error.message, details });
    await page?.screenshot({ path: output + '/h167-lifecycle-failure.png', fullPage: true }).catch(() => {});
    console.error('FAIL ' + name + ': ' + error.message);
  } finally { await save(); }
}

try {
  browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true }
    : { channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__h167ReactRoots = []; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); window.__h167ReactRoots.push(root); return root; };
      } });
    } });
  });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    evidence.externalRequestsAborted++; return route.abort();
  });

  await scenario('Cerrar durante preparación aborta certificación pendiente y todos los PNG', async () => {
    const initial = await fixture(240, 6); await open();
    await page.waitForFunction(() => window.__h167.certified > 0);
    await page.getByTestId('labels-preparing').waitFor();
    await page.screenshot({ path: output + '/h167-loading.png' });
    await page.getByTestId('label-modal-close').click();
    await page.getByTestId('label-modal').waitFor({ state: 'detached' });
    const closed = await counters();
    await page.waitForTimeout(200);
    const settled = await counters();
    assert.ok(closed.certified > 0 && closed.certified < initial.count);
    assert.deepEqual(settled, closed); assert.equal(settled.png, 0); assert.equal(settled.jpegStarted, 0);
    return { selected: initial.count, closed, settled };
  });

  await scenario('Cerrar durante PDF detiene nuevos rasterizados JPEG', async () => {
    const initial = await fixture(24);
    // Schedule the stable close control from the first real JPEG operation so
    // host load cannot make Playwright arrive after the final page was encoded.
    await page.evaluate(() => { window.__h167.arm = { trigger: 'jpeg', mode: 'close' }; });
    await open();
    await page.waitForFunction(() => window.__h167.trace.some(row => row.event === 'close'), null, { timeout: 30000 });
    await page.getByTestId('label-modal').waitFor({ state: 'detached' });
    const closed = await counters();
    await page.waitForTimeout(250);
    const settled = await counters();
    assert.ok(closed.jpegStarted > 0 && closed.jpegStarted < initial.count);
    assert.equal(settled.jpegStarted, closed.jpegStarted); assert.equal(settled.png, initial.count);
    await noEnabledOutputs();
    return { selected: initial.count, closed, settled };
  });

  await scenario('Colisión fuera de selección durante batch invalida todo antes del primer PNG', async () => {
    const initial = await fixture(40, 6);
    await page.evaluate(() => { window.__h167.arm = { trigger: 'certify', mode: 'collision' }; });
    await open(); await page.getByTestId('labels-certification-block').waitFor();
    const state = await page.evaluate(() => ({ ...window.__h167.counters(), trace: window.__h167.trace,
      authority: DATA.products.length, selected: document.querySelectorAll('[data-testid^="label-reference-select-"]').length }));
    assert.equal(state.trace.length, 1); assert.equal(state.batch, 2);
    assert.equal(state.authority, initial.count + 1); assert.equal(state.selected, initial.count);
    assert.equal(state.png, 0); assert.equal(state.jpegStarted, 0);
    await noEnabledOutputs(); return state;
  });

  await scenario('Cambiar existencias con PDF listo retira el archivo viejo y genera las copias actuales', async () => {
    await fixture(2); await open(); await ready();
    await page.getByTestId('labels-copies-stock').click();
    const before = await pdf(); assert.equal(before.pages, 2);
    const invalidated = await page.evaluate(() => {
      const state = window.__h167;
      state.snapshot.products[0].stockQuantity = 4;
      state.snapshot.products[0].nombre = 'Nombre actualizado H167';
      ReactDOM.flushSync(() => DATA.replaceFromOnline(state.snapshot));
      const button = document.querySelector('[data-testid="labels-download"]');
      return !button || button.disabled;
    });
    assert.equal(invalidated, true);
    const after = await pdf(); assert.equal(after.pages, 5); assert.notEqual(after.sha256, before.sha256);
    assert.match(after.text, /Nombre actualizado H167/); assert.doesNotMatch(after.text, /Etiqueta H167 1 \|/);
    await page.screenshot({ path: output + '/h167-ready.png' });
    return { previousPdf: { pages: before.pages, sha256: before.sha256 }, currentPdf: { pages: after.pages, sha256: after.sha256 }, invalidated, counters: await counters() };
  });

  await scenario('Cambiar barcode cuando el PDF está listo bloquea salidas sin reutilizar la certificación anterior', async () => {
    await fixture(2); await open(); await ready(); const before = await counters();
    await page.evaluate(() => {
      window.__h167.snapshot.products[0].barcodeCode = window.__h167.snapshot.products[1].barcodeCode;
      ReactDOM.flushSync(() => DATA.replaceFromOnline(window.__h167.snapshot));
    });
    await page.getByTestId('labels-certification-block').waitFor();
    await noEnabledOutputs(); const after = await counters();
    assert.equal(after.batch, before.batch + 1); assert.equal(after.png, before.png);
    assert.equal(after.jpegStarted, before.jpegStarted);
    return { before, after };
  });

  await scenario('Referencia desaparecida retira el PDF anterior y todas las salidas', async () => {
    await fixture(1); await open(); await ready(); const before = await counters();
    await page.evaluate(() => {
      window.__h167.snapshot.products = [];
      ReactDOM.flushSync(() => DATA.replaceFromOnline(window.__h167.snapshot));
    });
    await page.waitForFunction(() => window.__h167.batch === 2 && !document.querySelector('[data-testid="labels-preparing"]'));
    await noEnabledOutputs(); const after = await counters();
    assert.equal(after.png, before.png); assert.equal(after.jpegStarted, before.jpegStarted);
    assert.equal(await page.getByTestId('label-preview-stage').count(), 0);
    return { before, after };
  });

  await scenario('CONFIG confirmada distinta vuelve a certificar y preparar etiquetas', async () => {
    await fixture(2); await open(); await ready(); const before = await counters();
    const revision = await page.evaluate(() => {
      const before = DATA.commercialProjectionRevision;
      ReactDOM.flushSync(() => CONFIG.load(CONFIG.prepareMutation('setSetting', ['stock.lowThreshold', 9]).state));
      const button = document.querySelector('[data-testid="labels-download"]');
      return { before, after: DATA.commercialProjectionRevision, invalidated: !button || button.disabled };
    });
    assert.notEqual(revision.after, revision.before); assert.equal(revision.invalidated, true);
    await ready(); const after = await counters();
    assert.equal(after.batch, before.batch + 1); assert.equal(after.certified, before.certified + 2);
    assert.equal(after.png, before.png + 2); assert.equal(after.jpegStarted, before.jpegStarted + 2);
    return { revision, before, after };
  });

  await scenario('Cambio de clientes durante PDF conserva el lote y no repite trabajo de etiquetas', async () => {
    const initial = await fixture(24);
    await page.evaluate(() => { window.__h167.arm = { trigger: 'jpeg', mode: 'clients' }; });
    await open(); const file = await pdf();
    const state = await page.evaluate(() => ({ ...window.__h167.counters(), trace: window.__h167.trace, clients: DATA.clients.length }));
    assert.equal(state.trace.length, 1); assert.equal(state.trace[0].previousRevision, state.trace[0].revision);
    assert.equal(state.clients, 1); assert.equal(state.batch, 1); assert.equal(state.certified, initial.count);
    assert.equal(state.png, initial.count); assert.equal(state.jpegStarted, initial.count);
    assert.equal(file.pages, initial.count);
    return { ...state, pdf: { pages: file.pages, sha256: file.sha256 } };
  });

  assert.deepEqual(evidence.errors, []);
  evidence.completedAt = new Date().toISOString();
  evidence.passed = evidence.cases.filter(item => item.ok).length;
  evidence.failed = evidence.cases.filter(item => !item.ok).length;
  process.exitCode = evidence.failed ? 1 : 0;
  console.log(`H-167 lifecycle: ${evidence.passed} PASS / ${evidence.failed} FAIL`);
} catch (error) {
  evidence.failure = error.message; process.exitCode = 1; console.error(error);
} finally {
  await save(); await browser?.close(); await new Promise(resolve => server.close(resolve));
}
