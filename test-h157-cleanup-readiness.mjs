// Four scenarios, one per group requested by the owner. No remote business writes.
// Browser: real final HTML + unchanged STORE preview with controlled dependencies.
// Propagation: unchanged STORE in three independent local harnesses, not live certification.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const html = fs.readFileSync('index.html');
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const previewSource = store.slice(store.indexOf('  async function previewTestDataCleanup('),
  store.indexOf('  function requireSelectiveCleanupReady('));
const output = 'docs/fixes/evidence/h157-correction.json';
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
async function scenario(name, run) {
  if (process.env.BALAM_H157_CASE && !name.startsWith(process.env.BALAM_H157_CASE + '.')) return;
  try { const evidence = await run(); results.push({ name, passed: true, evidence }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function mount(synchronized, group = 'sales') {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.DATA);
  await page.evaluate(({ synchronized, previewSource }) => {
    window.__h157 = { synchronized, reconciling: false, calls: 0, backups: 0, executions: 0, reasons: [], failNext: false };
    const state = window.__h157;
    window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
    window.AUTH.isAdmin = () => true;
    const counts = Object.fromEntries(['productos','piezas','ventas','sale_items','movimientos','apartados','pagos','devoluciones','return_items','cambios','exchange_items','prestamos','reclasificaciones','liquidaciones','commission_adjustments','physical_card_redemptions','stock_reservations','sale_commits','return_commits','exchange_commits','layaway_liquidation_commits','folio_counters','clientes'].map(key => [key, 0]));
    window.STORE.pointZeroPreview = async () => ({ ok: true, system_mode: 'preproduction', preview_token: 'h157', counts, ready: true });
    const initialStatus = window.STORE.syncStatus();
    window.STORE.syncStatus = () => ({ ...initialStatus, synchronized: state.synchronized && !state.reconciling,
      connection: 'online', compatibility: 'ok', recoveryPhase: 'ready', pending: 0, blocked: 0,
      errors: [], cursors: { sales: 1 }, dataEpoch: 8 });
    const syncStatus = window.STORE.syncStatus;
    const hasSession = async () => true;
    const SELECTIVE_CLEANUP_PROTOCOL = 6;
    const reconcileDomains = async () => {
      state.reconciling = true; window.dispatchEvent(new Event('syncstatuschange'));
      await Promise.resolve();
      state.reconciling = false; window.dispatchEvent(new Event('syncstatuschange'));
    };
    const ensureClient = async () => ({ rpc: async (_name, args) => {
      state.calls++;
      if (state.failNext) { state.failNext = false; throw new Error('Failed to fetch'); }
      return { data: { ok: true, system_mode: 'preproduction', preset_requested: 'custom',
        selection_requested: args.p_selection, selection_normalized: args.p_selection,
        counts: { ventas: args.p_selection.sales ? 1 : 0, prestamos: args.p_selection.loans ? 1 : 0 },
        documents: {}, stock: [], fleet: { summary: {}, devices: [] }, plan_hash: 'h157-fixture',
        blocked_reasons: state.reasons, executable: !state.reasons.length }, error: null };
    } });
    window.STORE.previewTestDataCleanup = eval('(' + previewSource.trim() + ')');
    window.STORE.createTestDataCleanupBackup = async preview => {
      state.backups++; return { backup_id: 'h157-backup', document: { preview } };
    };
    window.STORE.downloadTestDataCleanupDocument = () => {};
    window.STORE.executeTestDataCleanup = async () => { state.executions++; throw new Error('Unexpected execution'); };
    document.body.innerHTML = '<div id="h157-root"></div>';
    ReactDOM.createRoot(document.getElementById('h157-root')).render(React.createElement(window.SettingsScreen));
  }, { synchronized, previewSource });
  try { await page.getByTestId('settings-section-demo').click(); }
  catch (error) {
    error.message += '\nBrowser errors: ' + JSON.stringify(errors) + '\nDOM: ' + (await page.locator('body').innerText()).slice(0, 1000);
    await context.close(); throw error;
  }
  await page.getByTestId('cleanup-group-' + group).check();
  await page.waitForFunction(() => window.__h157.calls > 0);
  return { page, context, errors };
}
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="selective-cleanup-open"]').disabled);
}
try {
  await scenario('1. Botón: recuperación con selección conservada y reintento directo', async () => {
    const { page, context, errors } = await mount(false);
    try {
      await page.getByTestId('cleanup-local-sync-block').waitFor();
      assert.equal(await page.getByTestId('selective-cleanup-open').isDisabled(), true);
      await page.evaluate(() => { window.__h157.synchronized = true; window.dispatchEvent(new Event('syncstatuschange')); });
      await ready(page);
      const afterRecovery = await page.evaluate(() => window.__h157.calls);
      assert.ok(afterRecovery >= 2);
      assert.equal(await page.getByTestId('cleanup-group-sales').isChecked(), true);
      assert.match(await page.getByTestId('selective-cleanup-card').innerText(), /Eliminar datos por categoría/);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.__h157.calls), afterRecovery, 'preview must not refresh itself');
      await page.evaluate(() => { window.__h157.failNext = true; });
      await page.getByTestId('selective-cleanup-refresh').click();
      await page.getByTestId('selective-cleanup-error').waitFor();
      await page.getByTestId('selective-cleanup-refresh').click(); await ready(page);
      assert.equal(await page.getByTestId('cleanup-group-sales').isChecked(), true);
      assert.deepEqual(errors, []);
      return { autoRecoveredWithoutReselection: true, retryRecovered: true, requestsAfterRecovery: afterRecovery };
    } finally { await context.close(); }
  });
  await scenario('2. Categoría: eliminar un préstamo y conservar venta, pago e inventario', async () => {
    const { page, context, errors } = await mount(true, 'loans');
    try {
      await ready(page);
      await page.evaluate(() => {
        const d = window.DATA;
        for (const key of ['products','sales','payments','loans','returns','exchanges','sellers','clients','liquidations','movements']) d[key].splice(0);
        d.products.push({ id: 'h157-product', recordModel: 'v2', nombre: 'Camisa', precio: 100, stockQuantity: 4, stock: [{ talla: 'M', stock: 4 }] });
        d.sales.push({ folio: 'H157-KEEP', estado: 'Pagado', total: 100, vendedores: [], lineas: [] });
        d.payments.push({ id: 'h157-payment', folio: 'H157-KEEP', monto: 100, tipo: 'venta' });
        d.loans.push({ id: 'h157-loan', folio: 'PR-H157', estado: 'pendiente', items: [{ productId: 'h157-product', talla: 'M', qty: 1 }] });
        window.STORE.executeTestDataCleanup = async options => {
          if (!options.preview.selection_requested.loans || options.preview.selection_requested.sales
            || options.backupId !== 'h157-backup' || options.confirmation !== 'LIMPIAR OPERACIONES') throw new Error('Wrong cleanup scope or confirmation');
          window.__h157.executions++;
          const result = { ok: true, cleanup_id: 'h157-cleanup', identities: { loan_ids: ['h157-loan'] }, stock: [] };
          const applied = d.applySelectiveCleanup(result);
          if (!applied.ok) throw new Error(applied.error);
          return result;
        };
      });
      await page.getByTestId('selective-cleanup-open').click();
      await page.getByTestId('selective-cleanup-backup').click();
      const input = page.getByTestId('selective-cleanup-confirmation');
      await input.fill('LIMPIAR OPERACIONES');
      await page.getByTestId('selective-cleanup-next').click();
      await page.getByTestId('selective-cleanup-execute').click();
      await page.getByText('LIMPIEZA COMPLETADA', { exact: true }).waitFor();
      const state = await page.evaluate(() => ({ loans: window.DATA.loans.length,
        sale: window.DATA.sales[0]?.folio, payment: window.DATA.payments[0]?.id,
        stock: window.DATA.products[0]?.stockQuantity, products: window.DATA.products.length,
        persistedLoans: JSON.parse(localStorage.getItem('balam_pos_loans_v1') || '[]').length,
        backups: window.__h157.backups, executions: window.__h157.executions }));
      assert.deepEqual(state, { loans: 0, sale: 'H157-KEEP', payment: 'h157-payment', stock: 4, products: 1, persistedLoans: 0, backups: 1, executions: 1 });
      assert.deepEqual(errors, []);
      return { ...state, scope: 'Real local DATA application; controlled execution response, no SQL deletion' };
    } finally { await context.close(); }
  });
  await scenario('3. Protección: un plan que se bloquea al continuar no abre confirmación', async () => {
    const { page, context, errors } = await mount(true);
    try {
      await ready(page);
      await page.evaluate(() => { window.__h157.reasons = [{ code: 'negative_stock' }, { code: 'client_cannot_be_fenced', device_name: 'Caja antigua' }]; });
      await page.getByTestId('selective-cleanup-open').click();
      await page.getByTestId('cleanup-readiness').getByText(/Caja antigua/).waitFor();
      assert.equal(await page.getByTestId('selective-cleanup-open').isDisabled(), true);
      assert.equal(await page.getByTestId('selective-cleanup-dialog').count(), 0);
      assert.match(await page.getByTestId('cleanup-readiness').innerText(), /existencias negativas/);
      assert.deepEqual(await page.evaluate(() => [window.__h157.backups, window.__h157.executions]), [0, 0]);
      assert.deepEqual(errors, []);
      return { bothBlockersVisible: true, backupCalls: 0, executionCalls: 0 };
    } finally { await context.close(); }
  });
  await scenario('4. Propagación: tres terminales locales adoptan un evento confirmado', async () => {
    const harness = fs.readFileSync('test-h151-cleanup-propagation.mjs', 'utf8');
    const common = harness.slice(0, harness.indexOf('\nlet pass=0,fail=0;'));
    const { setup } = await import('data:text/javascript;base64,' + Buffer.from(common + '\nexport {setup};').toString('base64'));
    const terminals = ['A','B','C'].map(name => ({ name, ...setup() }));
    for (const { e, S } of terminals) {
      await S.init({});
      e.cloud.rowsByTable.system_manifest = [{ ...e.cloud.rowsByTable.system_manifest[0], data_epoch: 2 }];
      e.cloud.rowsByTable.selective_cleanup_events = [{ cleanup_id: 'h157-confirmed', data_epoch: 2, protocol_version: 5,
        minimum_client_protocol: 5, identities: { sale_folios: ['H157-REMOVED'] } }];
      e.cloud.rowsByTable.products = [{ id: 'remote', nombre: 'Restored', stock_quantity: 12, sync_version: 2 }];
      e.cloud.rowsByTable.sync_domain_versions = [{ domain: 'products', version: 2 }];
      e.window.DATA.applySelectiveCleanup = () => ({ ok: true });
      await S.reconcileDomains();
    }
    const deadline = Date.now() + 5000;
    while (!terminals.every(({ S }) => S.syncStatus().synchronized && S.syncStatus().dataEpoch === 2) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    const state = terminals.map(({ name, e, S }) => ({ name, synchronized: S.syncStatus().synchronized,
      epoch: S.syncStatus().dataEpoch, stock: e.window.DATA.products[0]?.stockQuantity, pending: S.pending }));
    assert.ok(state.every(t => t.synchronized && t.epoch === 2 && t.stock === 12 && t.pending === 0), JSON.stringify(state));
    return { terminals: state, scope: 'Local independent STORE harnesses. NO CERTIFICADO against real Supabase A/B/C.' };
  });
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), artifactSHA256: createHash('sha256').update(html).digest('hex'),
    testLimit: 'One scenario per group, four total, requested by user', remoteBusinessWrites: 0, distributedCertification: 'NO CERTIFICADO', results }, null, 2));
}
console.log(`${results.filter(result => result.passed).length}/4 scenarios passed`);
if (results.some(result => !result.passed)) process.exitCode = 1;
