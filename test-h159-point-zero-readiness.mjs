// H-159: actual delivered UI and unchanged STORE preview/backup functions.
// Transport, session and synchronization are controlled; no Supabase requests.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const artifact = process.env.BALAM_H159_ARTIFACT || 'index.html';
const html = fs.readFileSync(artifact);
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const start = store.indexOf('  async function pointZeroPreview()');
const end = store.indexOf('  function downloadPointZeroDocument(', start);
assert.ok(start >= 0 && end > start, 'Point Zero STORE functions must exist');
const previewAndBackupSource = store.slice(start, end);
const browser = await chromium.launch({ headless: true,
  ...(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
const results = [];
let currentPage;
const width = Number(process.env.BALAM_H159_WIDTH || 390);
const selectedCases = new Set((process.env.BALAM_H159_CASE || '').split(',').map(value => value.trim()).filter(Boolean));

async function mount(options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url() === 'https://balam.test/index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.abort();
  });
  await page.goto('https://balam.test/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);
  await page.evaluate(({ options, previewAndBackupSource }) => {
    const state = window.__h159 = { synchronized: true, remoteSync: true,
      activeLocks: 0, queuePending: 0, reconciling: false, active: false,
      token: 'h159-preview-1', productCount: 2386, failures: 0,
      previews: 0, backups: 0, executions: 0, attempts: 0,
      backupRpcCalls: 0, pauseNextPreview: false, pauseNextBackup: false,
      waitingPreviews: [], waitingBackup: false, advanceBeforeBackup: false,
      blockedDevices: [],
      approvedTokens: [], backupTokens: [], downloads: [], ...options };
    const previewWaiters = new Map();
    window.__h159ReleasePreview = id => previewWaiters.get(id)?.();
    window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
    window.AUTH.isAdmin = () => true;
    const initialStatus = window.STORE.syncStatus();
    const syncStatus = () => ({ ...initialStatus, recoveryPhase: 'ready',
      reviewPending: 0, synchronized: state.synchronized && !state.reconciling,
      connection: 'online', compatibility: 'ok', pending: 0, blocked: 0,
      errors: [], checkpointError: null, cursors: { products: 1 }, dataEpoch: 8 });
    window.STORE.syncStatus = syncStatus;
    window.CORE.activityStatus = () => ({ active: state.active ? 1 : 0, domains: {} });
    window.DATA.hasLayawayLiquidationLock = () => false;
    const hasSession = async () => true;
    const reconcileDomains = async () => {
      state.reconciling = true;
      window.dispatchEvent(new Event('syncstatuschange'));
      await Promise.resolve();
      state.reconciling = false;
      window.dispatchEvent(new Event('syncstatuschange'));
    };
    const keys = ['productos','piezas','ventas','sale_items','movimientos','apartados',
      'pagos','devoluciones','return_items','cambios','exchange_items','prestamos',
      'reclasificaciones','liquidaciones','commission_adjustments','physical_card_redemptions',
      'stock_reservations','sale_commits','return_commits','exchange_commits',
      'layaway_liquidation_commits','folio_counters','clientes'];
    const counts = () => ({ ...Object.fromEntries(keys.map(key => [key, 0])),
      productos: state.productCount, piezas: 3502, clientes: 13 });
    const ensureClient = async () => ({ rpc: async (name, args) => {
      if (name === 'point_zero_preview') {
        const request = ++state.previews;
        const data = { ok: true, system_mode: 'preproduction',
          preview_token: state.token, generated_at: new Date().toISOString(),
          sync_complete: state.remoteSync, queue_pending: state.queuePending,
          active_locks: state.activeLocks, active_operation: 0, counts: counts(),
          blocked_devices: JSON.parse(JSON.stringify(state.blockedDevices)) };
        if (state.pauseNextPreview) {
          state.pauseNextPreview = false;
          state.waitingPreviews.push(request);
          await new Promise(resolve => previewWaiters.set(request, resolve));
          previewWaiters.delete(request);
          state.waitingPreviews = state.waitingPreviews.filter(id => id !== request);
        }
        await new Promise(resolve => setTimeout(resolve, 40));
        if (state.failures > 0) { state.failures--; throw new Error('Failed to fetch'); }
        return { error: null, data };
      }
      if (name === 'create_point_zero_backup') {
        state.backupRpcCalls++;
        if (state.advanceBeforeBackup) {
          state.advanceBeforeBackup = false;
          state.token = 'h159-preview-2'; state.productCount = 2400;
          return { data: null, error: { message: 'point_zero_preview_changed' } };
        }
        assertBackupToken(args.p_preview_token);
        state.backups++;
        const backupId = `h159-backup-${state.backups}`;
        state.backupTokens.push({ id: backupId, token: state.token });
        if (state.pauseNextBackup) {
          state.pauseNextBackup = false; state.waitingBackup = true;
          await new Promise(resolve => { window.__h159ReleaseBackup = resolve; });
          state.waitingBackup = false;
        }
        return { error: null, data: { ok: true, backup_id: backupId,
          payload_hash: 'a'.repeat(64), document: { synthetic: true, counts: counts() } } };
      }
      throw new Error('Unexpected mock RPC: ' + name);
    } });
    function assertBackupToken(token) {
      if (token !== state.token) throw new Error('POINT_ZERO_PREVIEW_CHANGED');
    }
    const SYNC_SCHEMA_VERSION = 20260812013900;
    const functions = eval(`(() => { ${previewAndBackupSource}; return { pointZeroPreview, createPointZeroBackup }; })()`);
    window.STORE.pointZeroPreview = functions.pointZeroPreview;
    window.STORE.createPointZeroBackup = async preview => {
      state.approvedTokens.push(preview.preview_token);
      return functions.createPointZeroBackup(preview);
    };
    window.STORE.synchronizeNow = async () => ({ ok: state.synchronized, status: syncStatus() });
    window.STORE.downloadPointZeroDocument = (document, kind, id) => {
      state.downloads.push({ document, kind, id });
    };
    window.STORE.executePointZero = async opts => {
      state.attempts++;
      assertBackupToken(opts.previewToken);
      if (opts.confirmation !== 'PUNTO CERO') throw new Error('POINT_ZERO_CONFIRMATION_REQUIRED');
      if (!state.backupTokens.some(backup => backup.id === opts.backupId && backup.token === state.token)) {
        throw new Error('POINT_ZERO_BACKUP_REQUIRED');
      }
      state.executions++;
      return { ok: true, operation_id: 'h159-synthetic-operation', counts_before: counts(),
        counts_after: Object.fromEntries(keys.map(key => [key, 0])) };
    };
    window.STORE.pointZeroReceipt = async operationId => ({ synthetic: true, operation_id: operationId });
    document.body.innerHTML = '<div id="h159-root"></div>';
    ReactDOM.createRoot(document.getElementById('h159-root')).render(React.createElement(window.SettingsScreen));
  }, { options, previewAndBackupSource });
  await page.getByTestId('settings-section-demo').click();
  await page.getByTestId('point-zero-open').click();
  await page.getByTestId('point-zero-backup').waitFor();
  return { page, context, errors };
}

async function waitForBackup(page, enabled) {
  await page.waitForFunction(expected => {
    const button = document.querySelector('[data-testid="point-zero-backup"]');
    return !!button && button.disabled === !expected;
  }, enabled);
}
async function noWrites(page) {
  assert.deepEqual(await page.evaluate(() => [window.__h159.backups, window.__h159.executions]), [0, 0]);
}
async function visualEvidence(page, state) {
  if (!process.env.BALAM_H159_SCREENSHOT_DIR) return null;
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="point-zero-dialog"]');
    const footer = document.querySelector('[data-testid="point-zero-dialog-footer"]');
    const backup = document.querySelector('[data-testid="point-zero-backup"]');
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    return { viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      dialogWidth: dialog.clientWidth, dialogScrollWidth: dialog.scrollWidth,
      footer: rect(footer), backup: rect(backup), backupDisabled: backup.disabled };
  });
  assert.ok(layout.documentWidth <= layout.viewport.width, 'document must not overflow horizontally');
  assert.ok(layout.dialogScrollWidth <= layout.dialogWidth, 'dialog must not overflow horizontally');
  for (const name of ['footer', 'backup']) {
    const box = layout[name];
    assert.ok(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0
      && box.right <= layout.viewport.width && box.bottom <= layout.viewport.height,
    `${name} must remain visible inside the viewport: ${JSON.stringify(box)}`);
  }
  const screenshot = path.join(process.env.BALAM_H159_SCREENSHOT_DIR, `h159-${state}-${width}.png`);
  fs.mkdirSync(process.env.BALAM_H159_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  return { screenshot, layout };
}
async function scenario(name, run) {
  if (selectedCases.size && !selectedCases.has(name.split('.')[0])) return;
  currentPage = null;
  try {
    const evidence = await run();
    results.push({ name, passed: true, evidence });
    console.log('PASS ' + name);
  } catch (error) {
    const observed = currentPage && !currentPage.isClosed()
      ? await currentPage.evaluate(() => ({ state: window.__h159,
        disabled: document.querySelector('[data-testid="point-zero-backup"]')?.disabled,
        dialog: document.querySelector('[role="dialog"]')?.innerText })).catch(() => null) : null;
    results.push({ name, passed: false, error: error.message, observed });
    console.log('FAIL ' + name + ': ' + error.message);
  } finally {
    if (currentPage && !currentPage.isClosed()) await currentPage.context().close();
  }
}

try {
  await scenario('1. Modal abierto se recupera con cero pendientes y bloqueos', async () => {
    const { page, errors } = await mount({ synchronized: false });
    assert.equal(await page.getByTestId('point-zero-backup').isDisabled(), true);
    const before = await page.evaluate(() => window.__h159.previews);
    await page.evaluate(() => {
      window.__h159.synchronized = true;
      window.dispatchEvent(new Event('syncstatuschange'));
    });
    await waitForBackup(page, true);
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.__h159.previews);
    assert.ok(after > before, 'readiness must come from a new preview');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__h159.previews), after, 'preview must not trigger a request loop');
    await noWrites(page);
    assert.deepEqual(errors, []);
    return { before, after, recoveredWithoutClosing: true, noAutomaticWrites: true,
      visual: await visualEvidence(page, 'ready') };
  });

  await scenario('2. Sincronía remota pendiente conserva el bloqueo real', async () => {
    const { page, errors } = await mount({ remoteSync: false });
    await page.evaluate(() => window.dispatchEvent(new Event('syncstatuschange')));
    await page.waitForTimeout(350);
    assert.equal(await page.getByTestId('point-zero-backup').isDisabled(), true);
    const text = await page.getByRole('dialog').innerText();
    for (const kept of ['Configuración', 'Catálogos', 'Usuarios', 'Roles y permisos',
      'Constructor de SKU', 'Métodos de pago', 'Logotipo', 'Configuración de tienda']) assert.ok(text.includes(kept), kept);
    await noWrites(page);
    assert.deepEqual(errors, []);
    return { remoteSync: false, pending: 0, locks: 0, blocked: true, kept: 8 };
  });

  await scenario('3. Fallo de red invalida diagnóstico y permite reintento directo', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => { window.__h159.failures = 1; });
    await page.getByTestId('point-zero-dialog-refresh').click();
    await page.waitForFunction(() => window.__h159.failures === 0);
    await waitForBackup(page, false);
    await page.getByTestId('point-zero-dialog-refresh').click();
    await waitForBackup(page, true);
    await noWrites(page);
    assert.deepEqual(errors, []);
    return { recoveredInOpenDialog: true, noAutomaticWrites: true };
  });

  await scenario('4. Preview cambiado antes del respaldo vuelve a diagnóstico vigente', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => { window.__h159.token = 'h159-preview-2'; window.__h159.productCount = 2400; });
    await page.getByTestId('point-zero-backup').click();
    await page.waitForFunction(() => window.__h159.approvedTokens.length === 1);
    await page.getByTestId('point-zero-backup').waitFor();
    await noWrites(page);
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.innerText.includes('2,400'));
    await waitForBackup(page, true);
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__h159.approvedTokens), ['h159-preview-1', 'h159-preview-2']);
    assert.equal(await page.evaluate(() => window.__h159.backups), 1);
    assert.deepEqual(errors, []);
    return { staleRejectedBeforeBackup: true, retryUsesNewToken: true };
  });

  await scenario('5. Cambio después del respaldo exige respaldo nuevo y otra confirmación', async () => {
    const { page, errors } = await mount();
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO');
    await page.getByTestId('point-zero-next').click();
    await page.evaluate(() => { window.__h159.token = 'h159-preview-2'; window.__h159.productCount = 2400; });
    await page.getByTestId('point-zero-execute').click();
    await waitForBackup(page, true);
    assert.equal(await page.getByTestId('point-zero-confirmation').count(), 0);
    assert.equal(await page.getByTestId('point-zero-execute').count(), 0);
    assert.equal(await page.evaluate(() => window.__h159.executions), 0);
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').waitFor();
    assert.equal(await page.getByTestId('point-zero-confirmation').inputValue(), '');
    assert.equal(await page.getByTestId('point-zero-next').isDisabled(), true);
    await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO');
    await page.getByTestId('point-zero-next').click();
    await page.getByTestId('point-zero-execute').click();
    await page.waitForFunction(() => window.__h159.executions === 1);
    assert.deepEqual(await page.evaluate(() => window.__h159.backupTokens.map(backup => backup.token)), ['h159-preview-1', 'h159-preview-2']);
    assert.deepEqual(errors, []);
    return { backups: 2, attempts: 2, executions: 1, confirmationReset: true };
  });

  await scenario('6. Respaldo, frase exacta y doble confirmación conservan el flujo', async () => {
    const { page, errors } = await mount();
    assert.equal(await page.getByTestId('point-zero-execute').count(), 0);
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO ');
    assert.equal(await page.getByTestId('point-zero-next').isDisabled(), true);
    await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO');
    await page.evaluate(() => window.dispatchEvent(new Event('syncstatuschange')));
    await page.waitForTimeout(350);
    assert.equal(await page.getByTestId('point-zero-confirmation').inputValue(), 'PUNTO CERO');
    assert.equal(await page.getByTestId('point-zero-execute').count(), 0);
    assert.equal(await page.evaluate(() => window.__h159.executions), 0);
    await page.getByTestId('point-zero-next').click();
    assert.equal(await page.evaluate(() => window.__h159.executions), 0);
    await page.getByTestId('point-zero-execute').click();
    await page.waitForFunction(() => window.__h159.executions === 1);
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.innerText.includes('PUNTO CERO COMPLETADO'));
    assert.ok((await page.getByRole('dialog').innerText()).includes('PUNTO CERO COMPLETADO'));
    assert.deepEqual(await page.evaluate(() => window.__h159.downloads.map(item => item.kind)), ['respaldo']);
    assert.deepEqual(errors, []);
    return { backups: 1, executions: 1, exactPhrase: true, twoConfirmationSteps: true };
  });

  await scenario('7. Carrera del RPC con error SQL minúsculo exige diagnóstico nuevo', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => { window.__h159.advanceBeforeBackup = true; });
    await page.getByTestId('point-zero-backup').click();
    await page.waitForFunction(() => window.__h159.backupRpcCalls === 1);
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.innerText.includes('2,400'));
    await waitForBackup(page, true);
    await noWrites(page);
    assert.equal(await page.getByTestId('point-zero-confirmation').count(), 0);
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').waitFor();
    assert.deepEqual(await page.evaluate(() => [window.__h159.backupRpcCalls, window.__h159.backups]), [2, 1]);
    assert.deepEqual(await page.evaluate(() => window.__h159.approvedTokens), ['h159-preview-1', 'h159-preview-2']);
    assert.deepEqual(errors, []);
    return { error: 'point_zero_preview_changed', rpcAttempts: 2, backups: 1, staleTokenRejected: true };
  });

  await scenario('8. Cerrar durante revisión no vuelve a abrir el modal', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => { window.__h159.pauseNextPreview = true; });
    await page.getByTestId('point-zero-dialog-refresh').click();
    await page.waitForFunction(() => window.__h159.waitingPreviews.length === 1);
    await page.getByTestId('point-zero-dialog-close').click();
    assert.equal(await page.getByTestId('point-zero-dialog').count(), 0);
    await page.evaluate(() => window.__h159ReleasePreview(window.__h159.waitingPreviews[0]));
    await page.waitForFunction(() => window.__h159.waitingPreviews.length === 0);
    await page.waitForTimeout(350);
    assert.equal(await page.getByTestId('point-zero-dialog').count(), 0);
    assert.equal(await page.evaluate(() => window.__h159.downloads.length), 0);
    await noWrites(page);
    assert.deepEqual(errors, []);
    return { closedWhilePending: true, remainsClosed: true, downloads: 0 };
  });

  await scenario('9. Cerrar durante respaldo no descarga ni revive confirmación', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => { window.__h159.pauseNextBackup = true; });
    await page.getByTestId('point-zero-backup').click();
    await page.waitForFunction(() => window.__h159.waitingBackup);
    await page.getByTestId('point-zero-dialog-close').click();
    assert.equal(await page.getByTestId('point-zero-dialog').count(), 0);
    await page.evaluate(() => window.__h159ReleaseBackup());
    await page.waitForFunction(() => !window.__h159.waitingBackup);
    await page.waitForTimeout(350);
    assert.equal(await page.getByTestId('point-zero-dialog').count(), 0);
    assert.equal(await page.getByTestId('point-zero-confirmation').count(), 0);
    assert.deepEqual(await page.evaluate(() => [window.__h159.backups,
      window.__h159.downloads.length, window.__h159.executions]), [1, 0, 0]);
    assert.deepEqual(errors, []);
    return { backupRequestedByUser: 1, remainsClosed: true, downloads: 0, executions: 0 };
  });

  await scenario('10. Respuesta anterior no sobrescribe una revisión nueva', async () => {
    const { page, errors } = await mount();
    await page.evaluate(() => {
      window.__h159.token = 'h159-preview-2'; window.__h159.productCount = 2400;
      window.__h159.pauseNextPreview = true;
    });
    await page.getByTestId('point-zero-dialog-refresh').click();
    await page.waitForFunction(() => window.__h159.waitingPreviews.length === 1);
    const oldRequest = await page.evaluate(() => window.__h159.waitingPreviews[0]);
    await page.getByTestId('point-zero-dialog-close').click();
    await page.evaluate(() => { window.__h159.token = 'h159-preview-3'; window.__h159.productCount = 2600; });
    await page.getByTestId('point-zero-open').click();
    await waitForBackup(page, true);
    assert.ok((await page.getByTestId('point-zero-dialog').innerText()).includes('2,600'));
    await page.evaluate(request => window.__h159ReleasePreview(request), oldRequest);
    await page.waitForFunction(() => window.__h159.waitingPreviews.length === 0);
    await page.waitForTimeout(350);
    const text = await page.getByTestId('point-zero-dialog').innerText();
    assert.ok(text.includes('2,600'));
    assert.ok(!text.includes('2,400'));
    await page.getByTestId('point-zero-backup').click();
    await page.getByTestId('point-zero-confirmation').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__h159.approvedTokens), ['h159-preview-3']);
    assert.deepEqual(errors, []);
    return { completedOutOfOrder: true, approvedToken: 'h159-preview-3', stalePreviewIgnored: true };
  });

  await scenario('11. Equipos bloqueantes muestran nombre y todos sus motivos', async () => {
    const { page, errors } = await mount({ remoteSync: false, blockedDevices: [
      { device_id: 'h159-device-a', display_name: 'Caja principal', status: 'active', reasons: ['pending', 'offline'] },
      { device_id: 'h159-device-b', display_name: 'Bodega', status: 'active', reasons: ['epoch', 'stale'] },
      { device_id: 'h159-device-retired', display_name: 'Equipo retirado', status: 'revoked', reasons: ['offline'] },
    ] });
    const text = await page.getByTestId('point-zero-dialog').innerText();
    for (const copy of ['Caja principal', 'cambios pendientes', 'debe conectarse',
      'Bodega', 'resincronizarse', 'señal reciente']) assert.ok(text.includes(copy), copy);
    assert.ok(!text.includes('Equipo retirado'));
    assert.equal(await page.getByTestId('point-zero-backup').isDisabled(), true);
    await noWrites(page);
    assert.deepEqual(errors, []);
    return { activeDevices: 2, actionableReasons: 4, revokedExcluded: true, blocked: true,
      visual: await visualEvidence(page, 'blocked') };
  });
} finally {
  await browser.close();
}

const evidence = { date: new Date().toISOString(), artifact,
  artifactSHA256: createHash('sha256').update(html).digest('hex'), width,
  scope: 'Actual bundled UI and STORE preview/backup with local controlled transport; no SQL or live A/B/C certification.',
  partial: selectedCases.size > 0, selectedCases: [...selectedCases],
  remoteBusinessWrites: 0, passed: results.filter(result => result.passed).length,
  total: results.length, results };
if (process.env.BALAM_H159_OUTPUT) {
  fs.mkdirSync(path.dirname(process.env.BALAM_H159_OUTPUT), { recursive: true });
  fs.writeFileSync(process.env.BALAM_H159_OUTPUT, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(`H-159: ${evidence.passed}/${evidence.total} scenarios passed`);
if (results.some(result => !result.passed)) process.exitCode = 1;
