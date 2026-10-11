// H-186: real ReturnDetail interactions; all external requests blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const html = await fs.readFile('index.html', 'utf8');
const sources = await Promise.all(['config', 'data', 'returns'].map(name => fs.readFile(`balam/${name}.jsx`, 'utf8')));
const browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
let passed = 0, failed = 0;
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url() === 'http://h186-return.test/'
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await context.addInitScript(() => {
    window.__roots = []; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); __roots.push(root); return root; };
      } });
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://h186-return.test/');
  await page.waitForFunction(() => window.ReturnsScreen && window.DATA && window.ReactDOM);
  await page.evaluate(() => {
    __roots.forEach(root => root.unmount()); document.body.innerHTML = '<div id="fixture"></div>';
    window.__calls = []; window.__toasts = [];
    UI.toast = message => __toasts.push(message);
    window.CORE = { registerCatalogProducts() {}, registerCatalogPromotions() {}, registerMonetaryDocuments() {},
      invokeSync: name => name === 'serverNow' ? new Date('2026-10-10T12:00:00-07:00') : null };
  });
  for (let i = 0; i < sources.length; i++) {
    // Expose the unchanged private component only inside this isolated test page.
    const content = i === 2 ? sources[i].replace('window.ReturnsScreen = ReturnsScreen;',
      'window.ReturnsScreen = ReturnsScreen; window.__ReturnDetail = ReturnDetail;') : sources[i];
    await page.addScriptTag({ content });
  }
  await page.evaluate(() => {
    CONFIG.load(CONFIG.prepareMutation('reset', []).state);
    window.__fixtureRoot = ReactDOM.createRoot(document.getElementById('fixture'));
    window.__mount = (version, price) => {
      __calls.length = 0; __toasts.length = 0;
      const talla = DATA.SIZES_LETRA[0];
      const product = DATA.hydrate({ id: '18600000-0000-4000-8000-000000000001', recordModel: 'v1',
        nombre: 'JOEL fixture', cat: '21', modelo: 'H186', tela: 'ALG', manga: 'ML', color: 'BL', cuello: 'NOR', orn: '—',
        precio: 1250, costo: 563, sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' },
        stock: [{ talla, escala: 'L', stock: 5 }] });
      const sale = { folio: 'H186-RETURN', financialVersion: version, estado: 'Pagado', metodo: 'Efectivo',
        fecha: '2026-10-10 12:00', total: price, subtotal: price, iva: 0, descuento: 1250 - price,
        vendedores: [], returnLimitDays: null, lineas: [{ lineId: 'test-line', productId: product.id,
          sku: product.sku, nombre: product.nombre, talla, qty: 1, precio: price }] };
      DATA.replaceFromOnline({ products: [product], sales: [sale], payments: price ? [{ id: 'payment', folio: sale.folio,
        metodo: 'Efectivo', monto: price, efectivo: price, components: [{ methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: price }] }] : [],
        clients: [], sellers: [], promotions: [], returns: [], exchanges: [], movements: [], loans: [], liquidations: [],
        commissionAdjustments: [], commissionContext: { periodStart: '', sellerBases: [] } });
      DATA.recordReturn = async request => { __calls.push(request); throw new Error('Isolated UI gateway'); };
      __fixtureRoot.render(React.createElement(__ReturnDetail, { key: `${version}-${price}`, sale, onBack() {}, onDone() {} }));
    };
  });
  for (const [name, version, price, expectedCalls] of [
    ['V2 zero refund keeps default method and confirms with no payment components', 2, 0, 1],
    ['Legacy zero refund keeps its historical evidence requirement', undefined, 0, 0],
    ['V2 paid refund keeps the confirmed original monetary components', 2, 10, 1],
  ]) {
    try {
      await page.evaluate(([version, price]) => __mount(version, price), [version, price]);
      await page.getByTestId('return-line-toggle-line:test-line').click();
      const reason = page.getByTestId('return-line-reason-line:test-line');
      const value = await reason.locator('option:not([disabled])').first().getAttribute('value');
      await reason.selectOption(value);
      await page.getByTestId('return-confirm').click();
      const result = await page.evaluate(() => ({ calls: __calls, toasts: __toasts }));
      assert.equal(result.calls.length, expectedCalls, JSON.stringify(result.toasts));
      if (expectedCalls) {
        assert.equal(result.calls[0].metodo, 'Efectivo');
        assert.equal(result.calls[0].lineas[0].sourceSaleLineId, 'test-line');
        assert.deepEqual(result.calls[0].refundComponents, price ? [{ methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: price }] : []);
      }
      passed++; console.log('PASS ' + name);
    } catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, failed, remoteBusinessWrites: 0, externalRequests: 'blocked' }));
  process.exitCode = failed ? 1 : 0;
} finally { await browser.close(); }
