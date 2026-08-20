import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.join(ROOT, requestPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': requestPath.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(8904, '127.0.0.1', resolve));

let passed = 0;
let failed = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  condition ? passed++ : failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route(/supabase\.co|googleapis\.com|gstatic\.com/, route => route.abort());
await page.goto('http://127.0.0.1:8904/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);
await page.evaluate(() => {
  window.__h124 = { changed: false, previews: 0, backups: 0, executions: 0 };
  const makePreview = () => ({
    ok: true, system_mode: 'preproduction', protocol_version: 5,
    minimum_client_protocol: 5, data_epoch: 3, preset_requested: 'custom',
    selection_requested: { sales: true },
    selection_normalized: { sales: true, returns: false, orphan_return_evidence: false,
      exchanges: false, loans: false, commissions: false, reclassifications: false,
      customers: false, inventory_products: false },
    forced_dependencies: [], counts: { ventas: 1, devoluciones: 0, cambios: 0,
      prestamos: 0, comisiones: 0, reclasificaciones: 0, clientes: 0 },
    documents: { sale_folios: [window.__h124.changed ? 'BG-NUEVA' : 'BG-ANTERIOR'] },
    stock: [], blocked_reasons: [], fleet: { summary: {}, devices: [] },
    plan_hash: window.__h124.changed ? 'nuevo-plan' : 'plan-anterior',
    executable: true, client_ready: true, ready: true,
  });
  window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
  window.AUTH.isAdmin = () => true;
  window.STORE.pointZeroPreview = async () => ({
    ok: true, system_mode: 'preproduction', schema_version: 20260820016500,
    data_epoch: 3, preview_token: 'h124', snapshot_hash: 'a'.repeat(64),
    queue_pending: 0, active_locks: 0, active_operation: 0,
    sync_complete: true, client_ready: true, ready: true,
    counts: { productos: 1, piezas: 1, ventas: 1, sale_items: 1,
      movimientos: 1, apartados: 0, pagos: 1, devoluciones: 0,
      return_items: 0, cambios: 0, exchange_items: 0, prestamos: 0,
      reclasificaciones: 0, liquidaciones: 0, commission_adjustments: 0,
      physical_card_redemptions: 0, stock_reservations: 0, sale_commits: 1,
      return_commits: 0, exchange_commits: 0, layaway_liquidation_commits: 0,
      folio_counters: 1, clientes: 1 },
  });
  window.STORE.previewTestDataCleanup = async () => {
    window.__h124.previews++; return makePreview();
  };
  window.STORE.createTestDataCleanupBackup = async () => {
    window.__h124.backups++; window.__h124.changed = true;
    throw new Error('CLEANUP_PREVIEW_CHANGED');
  };
  window.STORE.executeTestDataCleanup = async () => {
    window.__h124.executions++; throw new Error('must not execute');
  };
  document.body.innerHTML = '<div id="h124-root"></div>';
  ReactDOM.createRoot(document.getElementById('h124-root'))
    .render(React.createElement(window.SettingsScreen));
});

await page.getByTestId('settings-section-demo').click();
await page.getByTestId('cleanup-group-sales').check();
await page.waitForFunction(() => {
  const button = document.querySelector('[data-testid="selective-cleanup-open"]');
  return button && !button.disabled;
});
await page.getByTestId('selective-cleanup-open').click();
await page.getByTestId('selective-cleanup-backup').click();
await page.getByText(/La información cambió/).waitFor();

const body = await page.locator('body').innerText();
const state = await page.evaluate(() => window.__h124);
check('refresca el folio mostrado', body.includes('BG-NUEVA'));
check('retira el resumen obsoleto', !body.includes('BG-ANTERIOR'));
check('no expone el código técnico', !body.includes('CLEANUP_PREVIEW_CHANGED'));
check('exige revisar de nuevo', body.includes('Revisa el resumen actualizado'));
check('no crea respaldo con plan obsoleto', state.backups === 1);
check('no ejecuta la limpieza', state.executions === 0);
check('cierra el diálogo obsoleto', await page.getByRole('dialog').count() === 0);
for (const width of [320, 390, 768, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`resumen recuperado sin overflow a ${width}px`, !overflow);
}

await browser.close();
server.close();
console.log(`\nH-124 UI: ${passed} aprobadas, ${failed} fallidas`);
if (failed) process.exit(1);
