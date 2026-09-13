// H171: actual Settings UI, isolated CONFIG confirmation, external network blocked.
// --before records the obsolete controls; --source tests settings.jsx before rebuilding.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const before = process.argv.includes('--before'), sourceMode = process.argv.includes('--source');
const controls = [
  { key: 'currency', section: 'negocio', label: 'Moneda', value: 'USD' },
  { key: 'pos.askSize', section: 'ventas', label: 'Pedir talla al escanear', value: false },
  { key: 'pos.allowLayaway', section: 'ventas', label: 'Permitir apartados', value: false },
  { key: 'commission.auto', section: 'ventas', label: 'Cálculo automático de comisión', value: false },
  { key: 'pos.sound', section: 'ventas', label: 'Sonido al agregar al ticket', value: false },
  { key: 'print.lowStockAlert', section: 'impresion', label: 'Alerta de stock bajo', value: false },
];
const hash = value => createHash('sha256').update(value).digest('hex');
const html = await fs.readFile(process.env.BALAM_VERIFIED_HTML || 'index.html');
const settingsSource = await fs.readFile('balam/settings.jsx', 'utf8');
const evidence = { stage: before ? 'before' : 'after', date: new Date().toISOString(),
  baseArtifactSha256: hash(html), settingsSourceSha256: hash(settingsSource), sourceMode,
  scope: 'Chromium isolated UI; controlled CONFIG confirmation; all external requests blocked',
  realSupabaseWrites: 0, visibleObsoleteControls: 0, controls: [], errors: [] };
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  // Same bootstrap-root interception used by test-h164-online-ui.mjs.
  await context.addInitScript(() => {
    window.__h171Roots = []; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); window.__h171Roots.push(root); return root; };
      } });
    } });
  });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.AUTH?.isReady() && window.SettingsScreen && window.DATA && window.CONFIG);
  if (sourceMode) await page.addScriptTag({ content: settingsSource });
  const initial = await page.evaluate(({ controls, before }) => {
    window.__h171Roots.forEach(root => root.unmount());
    const C = window.CONFIG, D = window.DATA;
    const seed = C.prepareMutation('reset', []).state;
    if (!before) controls.forEach(({ key, value }) => { seed.settings[key] = value; });
    C.load(seed);
    window.AUTH.canAccess = () => true; window.AUTH.isAdmin = () => true;
    window.STORE.assertBusinessReady = () => true;
    window.STORE.serverNow = () => new Date('2026-09-12T19:00:00Z');
    window.STORE.syncStatus = () => ({ ready: true, connection: 'online' });
    window.STORE.syncFleetStatus = async () => ({ devices: [], history: [] });
    window.__h171Writes = [];
    window.STORE.execute = async command => {
      if (command.type !== 'config') throw new Error('Unexpected commercial command');
      window.__h171Writes.push(command);
      C.load(command.state);
      return { ok: true, result: { confirmed: true } };
    };
    // Fixture instrumentation uses the existing CONFIG key contract, never button copy.
    // The actual bundled component and its callback still execute unchanged.
    const settingKeys = new Set([...controls.map(row => row.key), 'print.auto']);
    const createElement = React.createElement;
    React.createElement = (type, props, ...children) => {
      const element = createElement(type, props, ...children);
      return typeof type === 'function' && settingKeys.has(props?.k)
        ? createElement('div', { key: props.key, 'data-h171-setting': props.k }, element) : element;
    };
    document.body.innerHTML = '<div id="h171-controls"></div>';
    window.__h171Root = ReactDOM.createRoot(document.getElementById('h171-controls'));
    window.__h171Root.render(React.createElement(window.SettingsScreen));
    return { formatted: window.UI.fmt(1234.5), data: JSON.stringify({ products: D.products, sales: D.sales, payments: D.payments }),
      legacy: Object.fromEntries(controls.map(({ key }) => [key, C.get(key)])) };
  }, { controls, before });
  for (const control of controls) {
    await page.getByTestId('settings-section-' + control.section).click();
    const label = control.key === 'currency'
      ? page.getByTestId('config-field-currency') : page.getByText(control.label, { exact: true });
    const count = await label.count();
    evidence.visibleObsoleteControls += count;
    evidence.controls.push({ ...control, visible: count === 1 });
    assert.equal(count, before ? 1 : 0, control.key + ' visibility');
    if (before) {
      if (control.key === 'currency') { await label.fill(control.value); await label.blur(); }
      else await page.locator('[data-h171-setting="' + control.key + '"] button').click();
      await page.waitForFunction(({ key, value }) => window.CONFIG.get(key) === value, control);
    }
  }
  const after = await page.evaluate(controls => ({
    formatted: window.UI.fmt(1234.5), layawayAvailable: window.CONFIG.list('payment_method').some(row => row.code === 'Apartado'),
    legacy: Object.fromEntries(controls.map(({ key }) => [key, window.CONFIG.get(key)])),
    data: JSON.stringify({ products: DATA.products, sales: DATA.sales, payments: DATA.payments }),
    writes: window.__h171Writes.length,
  }), controls);
  assert.equal(after.formatted, initial.formatted, 'The historical currency field never changes actual money formatting');
  assert.equal(after.layawayAvailable, true, 'Apartado is governed by the payment-method catalogue');
  assert.equal(after.data, initial.data, 'UI checks create no products, sales or payments');
  assert.deepEqual(after.legacy, Object.fromEntries(controls.map(({ key, value }) => [key, value])));
  assert.equal(after.writes, before ? 6 : 0);
  await page.getByTestId('settings-section-vendedores').click();
  assert.equal(await page.getByTestId('config-field-commission.bonus').count(), 1);
  assert.equal(await page.getByText('Informativo: la política vigente no paga bono automático. El importe queda guardado para cuando se defina esa regla.', { exact: true }).count(), 1);
  await page.getByTestId('settings-section-impresion').click();
  const auto = page.getByText('Imprimir ticket automáticamente', { exact: true });
  assert.equal(await auto.count(), 1, 'Working printing control remains available');
  const autoBefore = await page.evaluate(() => window.CONFIG.get('print.auto'));
  await page.locator('[data-h171-setting="print.auto"] button').click();
  await page.waitForFunction(value => window.CONFIG.get('print.auto') === !value, autoBefore);
  evidence.result = { ...after, data: undefined, historicalKeysPreserved: 6, informativeBonusPreserved: true,
    workingPrintControlConfirmed: true, removedControls: before ? 0 : 6 };
  assert.deepEqual(evidence.errors, []);
  evidence.ok = true;
  console.log('PASS H171 controls: ' + (before ? '6 ineffective controls reproduced' : '6 controls removed; historical values and working controls preserved'));
} catch (error) {
  evidence.ok = false; evidence.failure = error.message; throw error;
} finally {
  const output = process.env.BALAM_CONTROLS_OUTPUT || 'docs/fixes/evidence/h171-controls-' + (before ? 'before' : 'after') + '.json';
  await fs.mkdir('docs/fixes/evidence', { recursive: true });
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
