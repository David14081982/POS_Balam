// H-123 · Dominio explícito de evidencia huérfana. El fixture no usa red y
// demuestra el flujo UI completo hasta la autoridad de ejecución simulada.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.join(ROOT, requestPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': requestPath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(8903, '127.0.0.1', resolve));

let passed = 0, failed = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? passed++ : failed++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
await page.route(/supabase\.co|googleapis\.com|gstatic\.com/, route => route.abort());
await page.goto('http://127.0.0.1:8903/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);

await page.evaluate(() => {
  const orphanDocuments = [
    { commit_id: 'C-15', return_id: 'R-15', folio: 'BG-260811-0015', created_at: '2026-08-12T06:28:03Z' },
    { commit_id: 'C-01', return_id: 'R-01', folio: 'BG-260812-0001', created_at: '2026-08-12T07:26:32Z' },
  ];
  window.__h123 = { backup: 0, execute: 0, selection: null };
  window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
  window.AUTH.isAdmin = () => true;
  const pointZeroCounts = Object.fromEntries([
    'productos','piezas','ventas','sale_items','movimientos','apartados','pagos',
    'devoluciones','return_items','cambios','exchange_items','prestamos',
    'reclasificaciones','liquidaciones','commission_adjustments',
    'physical_card_redemptions','stock_reservations','sale_commits','return_commits',
    'exchange_commits','layaway_liquidation_commits','folio_counters','clientes',
  ].map(key => [key, 0]));
  window.STORE.pointZeroPreview = async () => ({
    ok: true, system_mode: 'preproduction', schema_version: 20260820016300,
    data_epoch: 2, preview_token: 'point-zero', counts: pointZeroCounts,
    queue_pending: 0, active_locks: 0, sync_complete: true,
    client_ready: true, ready: true,
  });
  window.STORE.previewTestDataCleanup = async (_preset, selection = {}) => {
    const selected = !!selection.orphan_return_evidence;
    const returns = !!selection.returns;
    return {
      ok: true, system_mode: 'preproduction', protocol_version: 5,
      minimum_client_protocol: 5, data_epoch: 2, preset_requested: 'custom',
      selection_requested: { ...selection }, selection_normalized: { ...selection },
      forced_dependencies: [],
      counts: { ventas: 0, devoluciones: 0, evidencias_huerfanas_devolucion: selected ? 2 : 0,
        cambios: 0, prestamos: 0, comisiones: 0, reclasificaciones: 0, clientes: 0 },
      documents: { sale_folios: [], return_ids: [], exchange_ids: [], loan_ids: [],
        liquidation_ids: [], commission_adjustment_ids: [], reclassification_ids: [], customer_ids: [],
        customer_referenced: [], sale_state_restorations: [],
        orphan_return_commits: (selected || returns) ? orphanDocuments : [],
        orphan_return_commit_ids: selected ? orphanDocuments.map(x => x.commit_id) : [],
        orphan_return_ids: selected ? orphanDocuments.map(x => x.return_id) : [] },
      stock: [], plan_hash: 'a'.repeat(64),
      blocked_reasons: returns && !selected ? [{ code: 'orphan_return_evidence', documents: orphanDocuments }] : [],
      executable: selected, client_ready: true, ready: selected, fleet: { devices: [], summary: {} },
    };
  };
  window.STORE.createTestDataCleanupBackup = async preview => {
    window.__h123.backup++;
    return { ok: true, backup_id: 'B-H123', document: { plan: preview } };
  };
  window.STORE.downloadTestDataCleanupDocument = () => {};
  window.STORE.executeTestDataCleanup = async options => {
    window.__h123.execute++;
    window.__h123.selection = options.preview.selection_normalized;
    return { ok: true, cleanup_id: 'H123-UI', counts: options.preview.counts };
  };
  window.STORE.testDataCleanupReceipt = async () => ({});
  document.body.innerHTML = '<div id="h123-root"></div>';
  ReactDOM.createRoot(document.getElementById('h123-root')).render(React.createElement(window.SettingsScreen));
});

await page.getByTestId('settings-section-demo').click();
await page.getByTestId('selective-cleanup-card').waitFor();
const orphanGroup = page.getByTestId('cleanup-group-orphan-return-evidence');
const orphanGroupExists = await orphanGroup.count() === 1;
check('existe grupo explícito de evidencia huérfana', orphanGroupExists);
if (!orphanGroupExists) {
  await browser.close(); server.close();
  console.log(`\nH-123 UI: ${passed} pasaron, ${failed} fallaron`);
  process.exit(1);
}

await page.getByTestId('cleanup-group-returns').check();
await page.getByTestId('cleanup-orphan-return-evidence').waitFor();
check('Devoluciones sin seleccionar evidencia conserva la guarda', await page.getByTestId('selective-cleanup-open').isDisabled());
await page.getByTestId('cleanup-group-returns').uncheck();
await orphanGroup.check();
await page.getByTestId('cleanup-orphan-return-evidence').waitFor();
const cardText = await page.getByTestId('selective-cleanup-card').innerText();
check('preview muestra exactamente ambos folios', cardText.includes('BG-260811-0015') && cardText.includes('BG-260812-0001'));
check('preview cuenta dos evidencias seleccionadas', /Evidencias huérfanas de devoluciones\s+2/.test(cardText));
check('evidencia técnica no cambia inventario', cardText.includes('Esta selección no cambia el inventario.'));
check('selección explícita libera el CTA', !(await page.getByTestId('selective-cleanup-open').isDisabled()));

const evidenceDir = path.join(ROOT, '.evidence-h123');
fs.mkdirSync(evidenceDir, { recursive: true });
await page.screenshot({ path: path.join(evidenceDir, 'orphan-return-cleanup-390.png'), fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.screenshot({ path: path.join(evidenceDir, 'orphan-return-cleanup-1440.png'), fullPage: true });
await page.setViewportSize({ width: 390, height: 900 });

await page.getByTestId('selective-cleanup-open').click();
await page.getByTestId('selective-cleanup-backup').click();
await page.getByTestId('selective-cleanup-confirmation').fill('LIMPIAR OPERACIONES');
await page.getByRole('button', { name: 'Continuar', exact: true }).click();
await page.getByTestId('selective-cleanup-execute').click();
await page.getByText('LIMPIEZA COMPLETADA', { exact: true }).waitFor();
const calls = await page.evaluate(() => window.__h123);
check('flujo UI creó respaldo y ejecutó una sola vez', calls.backup === 1 && calls.execute === 1);
check('ejecución conservó el dominio exacto seleccionado', calls.selection.orphan_return_evidence === true && !calls.selection.returns);

for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  check(`responsive ${width}px sin overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
}

await browser.close();
server.close();
console.log(`\nH-123 UI: ${passed} pasaron, ${failed} fallaron`);
if (failed) process.exit(1);
