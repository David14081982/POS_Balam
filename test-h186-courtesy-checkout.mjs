// Real CheckoutModal -> POS seller confirmation -> DATA -> captured CORE gateway.
// Localhost fixtures only; the original application artifacts are never modified.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const out = path.resolve(process.env.BALAM_TEST_OUTPUT || '.evidence-h186-deploy/courtesy-checkout-red');
const sourceMode = process.argv.includes('--source');
// Historical comparison is opt-in so normal CI needs no ancestor Git objects.
const legacyCommit = process.argv.find(value => value.startsWith('--legacy-commit='))?.slice('--legacy-commit='.length) || null;
if (legacyCommit) assert.match(legacyCommit, /^[a-f0-9]{40}$/);
await fs.mkdir(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = path.join(out, 'tmp'); process.env.TMP = process.env.TEMP;
const html = await fs.readFile(process.env.BALAM_VERIFIED_HTML || 'index.html');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['balam/data.jsx', 'balam/discounts.jsx', 'balam/pos-ticket.jsx', 'balam/pos.jsx'];
const legacy = legacyCommit ? Object.fromEntries(sources.map(file => [file, execFileSync('git', ['show', legacyCommit + ':' + file], { encoding: 'utf8', windowsHide: true })])) : {};
const modes = ['current', ...(legacyCommit ? ['before-h186'] : []), 'current-layaway-zero',
  ...(legacyCommit ? ['before-h186-layaway-zero'] : []), 'current-layaway-restored'];
const evidence = { schema: 'h186-courtesy-checkout-v1', startedAt: new Date().toISOString(), artifactSha256: hash(html), sourceMode,
  legacyCommit,
  sourceHashes: Object.fromEntries(await Promise.all(sources.map(async file => [file, hash(await fs.readFile(file))]))),
  legacySourceHashes: Object.fromEntries(Object.entries(legacy).map(([file, body]) => [file, hash(body)])),
  scope: 'Actual rendered checkout and POS seller confirmation with real DATA; captures CORE pushSale before persistence.',
  remoteBusinessWrites: 0, hardware: 'NOT_TESTED', results: [] };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  evidence.browserVersion = browser.version();
  for (const mode of modes) {
    const isLegacy = mode.startsWith('before-h186'), isLayaway = mode.includes('layaway'), restored = mode.endsWith('restored');
    const row = { mode, ok: false }, context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await context.addInitScript(() => {
        window.__courtesyRoots = []; let reactDom;
        Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
          reactDom = value; let createRoot;
          Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
            createRoot = (...args) => { const root = implementation(...args); window.__courtesyRoots.push(root); return root; };
          } });
        } });
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      await page.goto(origin); await page.waitForFunction(() => window.POSScreen && window.CheckoutModal && window.DATA && window.PROMOS);
      await page.evaluate(() => { __courtesyRoots.forEach(root => root.unmount()); document.body.innerHTML = '<div id="courtesy-root"></div>'; });
      if (isLegacy) for (const file of sources) await page.addScriptTag({ content: legacy[file] });
      else if (sourceMode) await page.addScriptTag({ content: await fs.readFile('balam/pos-ticket.jsx', 'utf8') });
      await page.evaluate(() => {
        CONFIG.load(CONFIG.prepareMutation('reset', []).state);
        for (const [key, value] of [['discount.minMarginPct', 0], ['store.logo', ''], ['print.auto', false], ['print.twoCopies', false]])
          CONFIG.load(CONFIG.prepareMutation('setSetting', [key, value]).state);
        const state = window.__courtesy = { inputs: [], commands: [], errors: [] };
        const previousInvoke = CORE.invokeSync;
        CORE.invokeSync = (name, ...args) => {
          if (name === 'serverNow') return new Date('2026-10-11T02:00:00Z');
          if (name === 'getQuoteContext') return { fixture: 'courtesy-local-quote' };
          if (name === 'assertBusinessReady') return true;
          if (name === 'allocateFolio') return Promise.resolve({ ok: true, folio: 'QACOUR-261010-0001' });
          if (name === 'pushSale') { state.commands.push(JSON.parse(JSON.stringify(args))); return Promise.reject(Object.assign(new Error('LOCAL_GATEWAY_CAPTURE'), { code: 'H186_CAPTURE' })); }
          return previousInvoke(name, ...args);
        };
        const product = DATA.createReference({ id: '18600000-0000-4000-8000-000000000001', referenceFamilyId: '18600000-0000-4000-8000-000000000099',
          nombre: 'JOEL COURTESY', modelo: 'H186COURTESY', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn: '—', ornamentColorCodes: [],
          precio: 1250, costo: 563, stockQuantity: 9, sizeCode: '40', sizeScale: 'N', sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' } }, []);
        const snapshot = Object.fromEntries(['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'].map(key => [key, []]));
        Object.assign(snapshot, { products: [product], clients: [{ id: 'generic-fixture', nombre: 'Público en general', generic: true },
          { id: '18600000-0000-4000-8000-000000000002', nombre: 'CLIENTE CORTESIA', generic: false, compras: 0, total: 0 }],
          sellers: [{ id: '18600000-0000-4000-8000-000000000003', nombre: 'VENDEDOR PRUEBA', iniciales: 'VP', active: true, role: 'vendedor', color: '#333', ventasMes: 0, ventasNum: 0, comisionAcum: 0 }],
          promotions: [{ id: 'promo-courtesy', nombre: 'JOEL 30', tipo: 'pct', valor: 30, pausado: false, scope: { modelos: ['H186COURTESY'] } }],
          commissionContext: { periodStart: '', sellerBases: [] } });
        DATA.replaceFromOnline(snapshot); AUTH.canAccess = () => true; AUTH.isAdmin = () => true;
        const actualRecordSale = DATA.recordSale;
        DATA.recordSale = async args => {
          state.inputs.push(JSON.parse(JSON.stringify(args)));
          try { return await actualRecordSale(args); }
          catch (error) { state.errors.push({ message: error.message, code: error.code || null }); throw error; }
        };
        ReactDOM.createRoot(document.getElementById('courtesy-root')).render(React.createElement(POSScreen, { layout: 'right', catalogView: 'cards', onNav() {} }));
      });
      await page.getByPlaceholder('Nombre del cliente', { exact: true }).fill('CLIENTE CORTESIA');
      await page.getByRole('button', { name: /^CC CLIENTE CORTESIA/ }).click();
      await page.locator('[data-testid^="pos-product-add-"]').first().click();
      await page.locator('[data-testid^="family-size-pick-"]').first().click();
      await page.getByTestId('pos-checkout-open').click();
      await page.getByTestId(isLayaway ? 'checkout-method-Apartado' : 'checkout-method-Cortesía').click();
      if (isLayaway) {
        const dialog = page.getByRole('dialog'), advance = dialog.getByPlaceholder('0.00', { exact: true });
        await advance.fill('100'); await dialog.getByRole('combobox').selectOption('Mixto');
        await page.getByTestId('money-component-method-0').selectOption('Efectivo');
        await page.getByTestId('money-component-method-1').selectOption('Tarjeta');
        await page.getByTestId('money-component-amount-0').fill('50');
        await page.getByTestId('money-component-amount-1').fill('50');
        await advance.fill('0');
        assert.equal(await page.getByTestId('advance-money-components').count(), 0);
        if (restored) {
          await advance.fill('100');
          assert.equal(await page.getByTestId('money-component-amount-0').inputValue(), '50');
          assert.equal(await page.getByTestId('money-component-amount-1').inputValue(), '50');
        }
      }
      assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(), true);
      await page.getByTestId('checkout-confirmar').click();
      await page.getByTestId('seller-pick-18600000-0000-4000-8000-000000000003').click();
      await page.getByTestId('seller-pick-confirm').click();
      await page.waitForFunction(() => __courtesy.errors.length > 0 || __courtesy.commands.length > 0);
      const observed = await page.evaluate(() => ({ inputs: __courtesy.inputs, commands: __courtesy.commands, errors: __courtesy.errors }));
      row.observed = observed;
      await page.screenshot({ path: path.join(out, mode + '.png'), fullPage: true });
      assert.equal(observed.inputs.length, 1); assert.equal(observed.inputs[0].metodo, isLayaway ? 'Apartado' : 'Cortesía');
      assert.equal(observed.inputs[0].quote.finalTotal, 875);
      if (isLegacy && isLayaway) {
        // Preserve executable evidence that this second boundary predated H186.
        assert.equal(observed.inputs[0].anticipo, 0); assert.equal(observed.inputs[0].pagoEfectivo, 50);
        assert.equal(observed.inputs[0].pagoOtro, -50); assert.equal(observed.commands.length, 0);
        assert.match(observed.errors[0].message, /desglose de pago es inválido/);
        row.preexistingFailureProven = true;
      } else {
        assert.equal(observed.commands.length, 1, 'The actual checkout and POS flow must reach the gateway with consistent zero-payment fields');
        const [sale, effects] = observed.commands[0];
        if (isLayaway) {
          const amount = restored ? 100 : 0, part = restored ? 50 : 0;
          assert.equal(observed.inputs[0].anticipo, amount); assert.equal(observed.inputs[0].pagoEfectivo, part);
          assert.equal(observed.inputs[0].pagoOtro, part); assert.equal(observed.inputs[0].pagoDetalle.length, restored ? 2 : 0);
          assert.equal(sale.total, 875); assert.equal(sale.anticipo, amount); assert.equal(sale.saldo, 875 - amount);
          assert.equal(sale.pagoEfectivo, part); assert.equal(sale.pagoOtro, part); assert.equal(sale.valorRegalado, 0);
          assert.equal(sale.subtotal, 754.31); assert.equal(sale.iva, 120.69); assert.equal(effects.payments.length, restored ? 1 : 0);
          if (restored) { assert.equal(effects.payments[0].monto, 100); assert.equal(effects.payments[0].components.length, 2); }
        } else {
          assert.equal(sale.total, 0); assert.equal(sale.anticipo, 0); assert.equal(sale.saldo, 0);
          assert.equal(sale.pagoEfectivo, 0); assert.equal(sale.pagoOtro, 0); assert.equal(sale.valorRegalado, 875);
          assert.deepEqual(effects.payments, []);
          if (!isLegacy) {
            assert.equal(observed.inputs[0].anticipo, 0); assert.equal(sale.financialVersion, 2);
            assert.equal(sale.subtotal, 0); assert.equal(sale.iva, 0); assert.equal(sale.originalTotal, 1250);
            row.invalidDirectInput = await page.evaluate(async () => {
              const previous = __courtesy.commands.length;
              try { await DATA.recordSale({ ...__courtesy.inputs[0], anticipo: 875 }); return { rejected: false }; }
              catch (error) { return { rejected: true, message: error.message, gatewayUnchanged: __courtesy.commands.length === previous }; }
            });
            assert.equal(row.invalidDirectInput.rejected, true); assert.equal(row.invalidDirectInput.gatewayUnchanged, true);
            assert.match(row.invalidDirectInput.message, /anticipo debe estar entre cero y el total/);
          }
        }
      }
      row.ok = true;
    } catch (error) { row.error = error.message; process.exitCode = 1; }
    finally { await context.setOffline(true).catch(() => {}); await context.close(); }
    evidence.results.push(row); console.log((row.ok ? 'PASS ' : 'FAIL ') + mode + ': ' + (row.error || (row.preexistingFailureProven ? 'historical failure independently reproduced' : 'actual checkout contract reaches captured gateway')));
  }
} finally {
  for (const context of browser?.contexts() || []) { await context.setOffline(true).catch(() => {}); await context.close(); }
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  evidence.completedAt = new Date().toISOString(); evidence.ok = evidence.results.length === modes.length && evidence.results.every(row => row.ok);
  evidence.sourceUnchanged = (await Promise.all(sources.map(async file => hash(await fs.readFile(file)) === evidence.sourceHashes[file]))).every(Boolean);
  evidence.artifactUnchanged = hash(await fs.readFile(process.env.BALAM_VERIFIED_HTML || 'index.html')) === evidence.artifactSha256;
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (!evidence.ok || !evidence.sourceUnchanged || !evidence.artifactUnchanged) process.exitCode = 1;
}
