// H-186: financial projections and complete print artifacts from the real UI.
// Explicit isolated fixtures, no commercial requests or physical printer.
// --source overlays only pos-ticket.jsx on the existing bundle during development.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { installPrintTransport } from './test-print-transport.mjs';

const sourceMode = process.argv.includes('--source');
const html = await fs.readFile(process.env.BALAM_VERIFIED_HTML || 'index.html');
const output = process.env.BALAM_TEST_OUTPUT || '.evidence-h186-financial-ui';
await fs.mkdir(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { date: new Date().toISOString(), artifactSHA256: sha(html), sourceMode,
  ticketSourceSHA256: sha(await fs.readFile('balam/pos-ticket.jsx')), results: [], errors: [],
  remoteBusinessWrites: 0, hardware: 'NOT_TESTED', scope: 'Real browser components, explicit financial fixtures, external network blocked.' };
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
let browser, page;
async function test(name, run) {
  try { const detail = await run(); evidence.results.push({ name, ok: true, detail }); console.log('PASS ' + name); }
  catch (error) { evidence.results.push({ name, ok: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function mount(kind, name) {
  const token = await page.evaluate(([kind, name]) => window.__h186.mount(kind, name), [kind, name]);
  await page.waitForFunction(token => document.querySelector('[data-h186-render]')?.dataset.h186Render === token, token);
}
async function fields(selector) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector);
    const read = label => {
      const node = [...root.querySelectorAll('span')].find(node => node.textContent === label || (label === 'Precio original' && node.textContent.startsWith('Precio original (')));
      if (!node && label === 'Total a pagar') {
        const checkout = [...root.querySelectorAll('div')].find(node => node.textContent === 'Total a cobrar');
        return checkout?.parentElement?.nextElementSibling?.textContent || null;
      }
      return node?.nextElementSibling?.textContent || null;
    };
    return { original: read('Precio original'), subtotal: read('Importe'), iva: read('IVA (16%)'), total: read('Total a pagar'), text: root.innerText };
  }, selector);
}
const expected = {
  pct30: [1250, 754.31, 120.69, 875], pct50: [1250, 538.79, 86.21, 625],
  pct60: [1250, 431.03, 68.97, 500], pct100: [1250, 0, 0, 0],
  additional: [1250, 668.10, 106.90, 775], additionalOnly: [1250, 991.38, 158.62, 1150],
  fixed: [1250, 1034.48, 165.52, 1200], split: [3750, 2262.07, 361.93, 2624],
};
function assertFields(actual, values) {
  for (const [i, key] of ['original', 'subtotal', 'iva', 'total'].entries()) {
    assert.ok(actual[key] != null, 'missing ' + key);
    assert.equal(Number(actual[key].replace(/[^\d.-]/g, '')), values[i], key + ': ' + actual[key]);
  }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await context.addInitScript(installPrintTransport, { counter: '__h186Printed', hold: false });
  await context.addInitScript(() => {
    window.__h186Roots = []; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); window.__h186Roots.push(root); return root; };
      } });
    } });
  });
  page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => window.BalamTicket && window.TicketPanel && window.CheckoutModal && window.ReportsScreen && window.DATA && window.PrintManager);
  if (sourceMode) await page.addScriptTag({ content: await fs.readFile('balam/pos-ticket.jsx', 'utf8') });
  await page.evaluate(() => {
    __h186Roots.forEach(root => root.unmount()); document.body.innerHTML = '<div id="h186-root"></div>';
    const root = ReactDOM.createRoot(document.getElementById('h186-root'));
    CONFIG.load(CONFIG.prepareMutation('reset', []).state);
    for (const [key, value] of [['store.logo', ''], ['print.auto', false], ['print.twoCopies', false], ['print.thermer', false]])
      CONFIG.load(CONFIG.prepareMutation('setSetting', [key, value]).state);
    const product = DATA.createReference({ id: '18600000-0000-4000-8000-000000000001',
      referenceFamilyId: '18600000-0000-4000-8000-000000000099', nombre: 'JOEL H186', modelo: 'H186',
      cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn: '—', ornamentColorCodes: [],
      precio: 1250, costo: 563, stockQuantity: 9, sizeCode: '40', sizeScale: 'N',
      sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' } }, []);
    const client = { id: '18600000-0000-4000-8000-000000000002', nombre: 'Público en general', generic: true };
    const make = (name, pct, additional = 0, qty = 1, fixed = false) => {
      const originalTotal = 1250 * qty, unit = fixed ? 1250 - pct : 1250 * (1 - pct / 100);
      const discount = Math.round((1250 - unit) * qty * 100) / 100;
      const total = Math.round((unit * qty - additional) * 100) / 100;
      const subtotal = Math.round(total / 1.16 * 100) / 100, iva = Math.round((total - subtotal) * 100) / 100;
      const promos = pct ? [{ id: 'h186-promo', nombre: 'PROMO HISTÓRICA', tipo: fixed ? 'monto' : 'pct', valor: pct }] : [];
      const applications = additional ? [{ id: 'h186-benefit', origin: 'Otro', benefitName: 'Beneficio H186', reason: 'Motivo congelado', discountAmount: additional }] : [];
      const quote = { financialVersion: 2, originalTotal, configuredDiscountTotal: discount, beforeAdditionalTotal: unit * qty,
        additionalDiscountTotal: additional, subtotal, iva, ivaPct: 16, ivaIncluded: true, finalTotal: total, applications };
      const ticket = [{ key: name, productId: product.id, p: product, talla: '40', qty, res: { orig: 1250, unit, promos } }];
      const high = Math.ceil(total * 100 / qty), highQty = total * 100 % qty;
      const parts = highQty ? [{ qty: highQty, unit: high / 100 }, { qty: qty - highQty, unit: (high - 1) / 100 }] : [{ qty, unit: total / qty }];
      const lineas = parts.map((part, i) => ({ lineId: '18600000-0000-4000-8000-' + String(10 + i).padStart(12, '0'),
        productId: product.id, sku: product.sku, nombre: 'JOEL H186', talla: '40', qty: part.qty, precio: part.unit,
        precioOrig: 1250, precioBase: unit, effectivePrice: part.unit, promos }));
      const now = new Date();
      const fecha = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-') + ' 12:00';
      const sale = { financialVersion: 2, originalTotal, folio: 'H186-' + name, fecha, cliente: client.nombre,
        vendedor: 'VENDEDOR HISTÓRICO', vendedores: [], metodo: 'Efectivo', estado: 'Pagado', items: qty, total,
        subtotal, iva, ivaPct: 16, ivaIncluded: true, descuento: discount, descuentoAdicional: additional,
        descuentosAdicionales: applications, anticipo: total, saldo: 0, pagoEfectivo: total, pagoOtro: 0, comisiones: [], lineas,
        receiptSnapshot: { version: 1, store: { name: 'TIENDA HISTÓRICA', footer: 'FIN ÍNTEGRO H186' }, sellerName: 'VENDEDOR HISTÓRICO',
          lines: lineas.map(line => ({ lineId: line.lineId, productId: product.id, name: 'JOEL H186', sku: product.sku, sizeCode: '40', sizeLabel: '40 HISTÓRICA', colorLabel: 'BLANCO HISTÓRICO', ornamentColors: [], attributes: [] })) } };
      return { quote, sale, panel: { ticket, client, subtotal: total, subtotalOrig: originalTotal, discount, itemCount: qty, grandTotal: total, quote,
        onPickClient() {}, onResetClient() {}, onQty() {}, onRemove() {}, onCobrar() {}, onClear() {}, onAdditionalDiscount() {}, onRemoveAdditionalDiscount() {} } };
    };
    const cases = { pct30: make('pct30', 30), pct50: make('pct50', 50), pct60: make('pct60', 60), pct100: make('pct100', 100),
      additional: make('additional', 30, 100), additionalOnly: make('additionalOnly', 0, 100),
      fixed: make('fixed', 50, 0, 1, true), split: make('split', 30, 1, 3), legacy: make('legacy', 30), courtesy: make('courtesy', 30) };
    delete cases.legacy.sale.financialVersion; delete cases.legacy.sale.originalTotal;
    Object.assign(cases.legacy.sale, { total: 1126, subtotal: 970.69, iva: 155.31, descuento: 124, anticipo: 1126, pagoEfectivo: 1126 });
    Object.assign(cases.courtesy.sale, { metodo: 'Cortesía', total: 0, subtotal: 0, iva: 0, anticipo: 0, pagoEfectivo: 0, valorRegalado: 875 });
    const snapshot = Object.fromEntries(['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'].map(key => [key, []]));
    Object.assign(snapshot, { products: [product], clients: [client], commissionContext: { periodStart: '', sellerBases: [] } });
    DATA.replaceFromOnline(snapshot); AUTH.canAccess = () => true; AUTH.isAdmin = () => true;
    const state = window.__h186 = { root, cases, snapshot, client, confirmations: [], token: 0 };
    state.mount = (kind, name) => {
      const entry = cases[name], token = String(++state.token); let node;
      if (kind === 'panel') node = React.createElement(TicketPanel, entry.panel);
      if (kind === 'ticket') node = React.createElement(BalamTicket, { sale: entry.sale });
      if (kind === 'checkout') node = React.createElement(CheckoutModal, { total: entry.quote.finalTotal, itemCount: entry.sale.items, client,
        quote: entry.quote, onClose() {}, onConfirm: value => state.confirmations.push(value) });
      if (kind === 'reports') node = React.createElement(ReportsScreen);
      root.render(React.createElement('div', { key: token, 'data-h186-render': token }, node)); return token;
    };
    state.business = () => JSON.stringify({ snapshot: { sales: DATA.sales, products: DATA.products, payments: DATA.payments, returns: DATA.returns }, cases });
  });
  for (const [name, values] of Object.entries(expected)) {
    await test(name + ': resumen preserva original y usa IVA del importe cobrado', async () => { await mount('panel', name); assertFields(await fields('#h186-root'), values); });
    await test(name + ': ticket proyecta snapshot financiero íntegro', async () => { await mount('ticket', name); assertFields(await fields('#balam-ticket'), values); });
  }
  await test('histórico: H-32 conserva importes impresos previos', async () => {
    await mount('ticket', 'legacy'); assertFields(await fields('#balam-ticket'), [1250, 1077.59, 172.41, 1126]);
  });
  await test('cortesía explícita nueva: snapshot fiscal cero, original y valor regalado conservados', async () => {
    await mount('ticket', 'courtesy'); assertFields(await fields('#balam-ticket'), [1250, 0, 0, 0]);
    assert.match((await fields('#balam-ticket')).text, /Cortesía/);
  });
  await test('caja: importes fiscales y total iguales a la cotización', async () => {
    await mount('checkout', 'additional'); const actual = await fields('[role="dialog"]');
    assertFields(actual, expected.additional);
  });
  await test('pago positivo: bloqueado sin efectivo y permitido con el importe exacto', async () => {
    await mount('checkout', 'pct30'); assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(), true);
    await page.getByTestId('checkout-recibido').fill('874.99'); assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(), true);
    await page.getByTestId('checkout-recibido').fill('875'); assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(), true);
    await page.getByTestId('checkout-confirmar').click();
    const payload = await page.evaluate(() => __h186.confirmations.at(-1));
    assert.equal(payload.pagoEfectivo, 875); assert.equal(payload.pagoOtro, 0); assert.equal(payload.pagoDetalle[0].amount, 875);
  });
  await test('100%: caja confirma sin captura, efectivo ni componente de pago inventado', async () => {
    await mount('checkout', 'pct100'); assert.equal(await page.getByTestId('checkout-recibido').count(), 0);
    assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(), true);
    await page.getByTestId('checkout-confirmar').click();
    const payload = await page.evaluate(() => __h186.confirmations.at(-1));
    assert.equal(payload.metodo, 'Efectivo'); assert.equal(payload.anticipo, 0); assert.equal(payload.pagoEfectivo, 0);
    assert.equal(payload.pagoOtro, 0); assert.deepEqual(payload.pagoDetalle, []);
    await mount('ticket', 'pct100'); assert.match((await fields('#balam-ticket')).text, /Sin cobro/);
  });
  await test('reimpresión: promociones y productos actuales no reinterpretan evidencia', async () => {
    await mount('ticket', 'additional'); const before = await fields('#balam-ticket');
    await page.evaluate(() => { const snapshot = structuredClone(__h186.snapshot); snapshot.products[0].precio = 9999;
      snapshot.products[0].nombre = 'NO DEBE IMPRIMIRSE'; snapshot.promotions = []; DATA.replaceFromOnline(snapshot); });
    await mount('ticket', 'additional'); assert.deepEqual(await fields('#balam-ticket'), before);
  });
  await test('dos tickets consecutivos: HTML completo, copia, identidad, hash y recursos en frontera nativa', async () => {
    const result = [];
    for (const name of ['split', 'additional']) {
      await mount('ticket', name);
      const before = await page.evaluate(() => __h186.business());
      const reference = await page.evaluate(async () => {
        const snap = UI.captureReceipt(document.getElementById('balam-ticket'));
        const frame = await UI.receiptFrame(snap); const text = frame.contentDocument.body.innerText;
        frame.remove(); return text;
      });
      const index = await page.evaluate(() => __printArtifacts.length);
      await page.evaluate(() => UI.printReceipt());
      await page.waitForFunction(index => __printArtifacts.length > index && !document.querySelector('iframe[data-print-job-id]'), index);
      const sent = await page.evaluate(() => ({ artifact: __printArtifacts.at(-1), job: PrintManager.history().at(-1), after: __h186.business() }));
      assert.equal(sent.artifact.text, reference); assert.equal(sha(sent.artifact.html), sent.job.payloadHash);
      assert.match(sent.artifact.text, /FIN ÍNTEGRO H186/); assert.match(sent.artifact.text, new RegExp('H186-' + name));
      assert.equal(sent.after, before); assert.equal(sent.job.stage, 'COMPLETED');
      assert.equal(sent.job.physicalPrintConfirmed, false);
      await fs.writeFile(output + '/' + name + '-delivered.html', sent.artifact.html);
      result.push({ name, hash: sha(sent.artifact.html), transport: sent.job.transport, stage: sent.job.stage });
    }
    assert.notEqual(result[0].hash, result[1].hash); return result;
  });
  await test('Reportes: mismo total confirmado y reimpresión con IVA congelado', async () => {
    await page.evaluate(() => { const snapshot = structuredClone(__h186.snapshot), sale = structuredClone(__h186.cases.additional.sale);
      snapshot.sales = [sale]; snapshot.payments = [{ id: 'h186-payment', folio: sale.folio, fecha: sale.fecha, tipo: 'venta', metodo: 'Efectivo',
        monto: sale.total, efectivo: sale.total, tarjeta: 0, transferencia: 0, otro: 0, components: [{ methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: sale.total }] }];
      DATA.replaceFromOnline(snapshot); });
    const before = await page.evaluate(() => __h186.business());
    await mount('reports', 'additional'); await page.getByTestId('reports-tab-sales').click();
    const reprint = page.getByTestId('sales-reprint-H186-additional'); await reprint.waitFor();
    assert.match(await reprint.locator('xpath=ancestor::tr').innerText(), /\$775(?:\.00)?\b/);
    const index = await page.evaluate(() => __printArtifacts.length); await reprint.click();
    await page.waitForFunction(index => __printArtifacts.length > index && !document.querySelector('iframe[data-print-job-id]'), index);
    assertFields(await fields('#balam-ticket'), expected.additional);
    assert.equal(await page.evaluate(() => __h186.business()), before);
    await page.getByTestId('sales-reprint-close').click();
  });
  await test('móvil: resumen y caja mantienen importes, sin desbordamiento', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await mount('panel', 'additional');
    assertFields(await fields('#h186-root'), expected.additional);
    await page.screenshot({ path: output + '/mobile-summary.png', fullPage: true });
    await mount('checkout', 'pct100');
    assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: output + '/mobile-zero-checkout.png', fullPage: true });
  });
  await test('sin errores de ejecución del navegador', async () => assert.deepEqual(evidence.errors, []));
} finally {
  if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  evidence.passed = evidence.results.filter(result => result.ok).length; evidence.failed = evidence.results.filter(result => !result.ok).length;
  await fs.writeFile(output + '/result.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.passed, failed: evidence.failed, sourceMode, output }));
}
if (evidence.failed) process.exitCode = 1;
