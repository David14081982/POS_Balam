// H-122 · Los grupos de limpieza nombran documentos, no pantallas candidatas
// ni saldos derivados. Este arnés nunca crea respaldo ni ejecuta limpieza.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, '.evidence-h122');
fs.mkdirSync(EVIDENCE, { recursive: true });
const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.join(ROOT, requestPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': requestPath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(8902, '127.0.0.1', resolve));

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.route(/supabase\.co|googleapis\.com|gstatic\.com/, route => route.abort());
await page.goto('http://127.0.0.1:8902/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);

await page.evaluate(() => {
  window.__h122 = { backup: 0, execute: 0 };
  const pointZeroCounts = Object.fromEntries([
    'productos','piezas','ventas','sale_items','movimientos','apartados','pagos',
    'devoluciones','return_items','cambios','exchange_items','prestamos',
    'reclasificaciones','liquidaciones','commission_adjustments',
    'physical_card_redemptions','stock_reservations','sale_commits','return_commits',
    'exchange_commits','layaway_liquidation_commits','folio_counters','clientes',
  ].map(key => [key, 0]));
  window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
  window.AUTH.isAdmin = () => true;
  window.STORE.pointZeroPreview = async () => ({
    ok: true, system_mode: 'preproduction', schema_version: 20260820016100,
    data_epoch: 2, preview_token: 'point-zero', counts: pointZeroCounts, queue_pending: 0,
    active_locks: 0, sync_complete: true, client_ready: true, ready: true,
  });
  window.STORE.previewTestDataCleanup = async (_preset, selection = {}) => {
    const sales = !!selection.sales;
    const names = ['sales','returns','exchanges','loans','commissions','reclassifications','customers'];
    return {
      ok: true, system_mode: 'preproduction', protocol_version: 4,
      minimum_client_protocol: 4, data_epoch: 2, preset_requested: 'custom',
      selection_requested: { ...selection }, selection_normalized: { ...selection },
      forced_dependencies: [],
      counts: {
        ventas: sales ? 1 : 0, devoluciones: 0, cambios: 0, prestamos: 0,
        comisiones: 0, reclasificaciones: 0, clientes: 0,
      },
      documents: {
        sale_folios: sales ? ['BG-260810-0011'] : [], sale_operation_ids: sales ? ['OP-1'] : [],
        return_ids: [], exchange_ids: [], loan_ids: [], liquidation_ids: [],
        commission_adjustment_ids: [], reclassification_ids: [], customer_ids: [],
        customer_referenced: [], orphan_return_commits: [], sale_state_restorations: [],
      },
      stock: sales ? [{ product_id: 'P-1', talla: '36', current_stock: 1, delta: 1, target_stock: 2 }] : [],
      blocked_reasons: sales ? [] : ['cleanup_no_matching_data'],
      plan_hash: 'a'.repeat(64), executable: sales, client_ready: true, ready: sales,
      fleet: { devices: [], summary: {} },
      _fixtureKeys: names,
    };
  };
  window.STORE.createTestDataCleanupBackup = async () => { window.__h122.backup++; throw new Error('must not run'); };
  window.STORE.executeTestDataCleanup = async () => { window.__h122.execute++; throw new Error('must not run'); };
  document.body.innerHTML = '<div id="h122-root"></div>';
  ReactDOM.createRoot(document.getElementById('h122-root')).render(React.createElement(window.SettingsScreen));
});

await page.getByTestId('settings-section-demo').click();
await page.getByTestId('selective-cleanup-card').waitFor();

for (const domain of ['returns','exchanges','loans','commissions','reclassifications','customers']) {
  await page.getByTestId(`cleanup-group-${domain}`).check();
  await page.getByTestId(`cleanup-zero-explanation-${domain}`).waitFor();
  check(`${domain}: cero explica qué documento cuenta`, await page.getByTestId(`cleanup-zero-explanation-${domain}`).isVisible());
  await page.getByTestId(`cleanup-group-${domain}`).uncheck();
}

await page.getByTestId('cleanup-group-exchanges').check();
check('Cambios distingue venta candidata de cambio realizado',
  (await page.getByTestId('cleanup-zero-explanation-exchanges').innerText()).includes('ventas que aparecen como opciones'));
await page.getByTestId('cleanup-group-exchanges').uncheck();

await page.getByTestId('cleanup-group-commissions').check();
check('Comisiones distingue saldo derivado de liquidación/ajuste',
  (await page.getByTestId('cleanup-zero-explanation-commissions').innerText()).includes('Comisiones por liquidar'));
await page.getByTestId('cleanup-group-commissions').uncheck();

await page.getByTestId('cleanup-group-sales').check();
await page.getByTestId('cleanup-group-commissions').check();
await page.getByTestId('cleanup-sales-derived-impact').waitFor();
check('Ventas declara recálculo de comisión derivada',
  (await page.getByTestId('cleanup-sales-derived-impact').innerText()).includes('Comisiones por liquidar'));
check('preview autoritativo muestra folio comercial exacto',
  (await page.getByTestId('cleanup-sale-folios').innerText()).includes('BG-260810-0011'));
for (const width of [320,360,375,390,430,768,1024,1280,1440]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(30);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`responsive ${width}px sin overflow`, !overflow);
  if (width === 390 || width === 1440) {
    await page.screenshot({ path: path.join(EVIDENCE, `cleanup-domain-clarity-${width}.png`), fullPage: true });
  }
}
check('ninguna acción destructiva fue invocada',
  await page.evaluate(() => window.__h122.backup === 0 && window.__h122.execute === 0));
check('sin errores de navegador', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
console.log(`\nH-122 UI: ${passed} pasaron, ${failed} fallaron`);
if (failed) process.exit(1);
