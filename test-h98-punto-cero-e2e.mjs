// H-98 · Recorrido del wizard con fixtures exclusivamente sintéticos.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = process.cwd();
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8898, '127.0.0.1', resolve));

let pass = 0, fail = 0; const errors = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => errors.push(String(e)));
await page.route(/supabase\.co/, route => route.abort());
await page.goto('http://127.0.0.1:8898/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);

await page.evaluate(() => {
  window.__h98 = { mode: 'preproduction', backupCalls: 0, executeCalls: 0, receiptCalls: 0, downloads: [] };
  const syntheticPreview = () => ({
    ok: true, system_mode: window.__h98.mode, schema_version: 20260812013900,
    data_epoch: 7, preview_token: 'preview-sintetico-98', snapshot_hash: 'a'.repeat(64),
    queue_pending: 0, active_locks: 0, active_operation: 0, sync_complete: true,
    client_ready: true, ready: window.__h98.mode === 'preproduction',
    counts: { productos: 57, piezas: 243, ventas: 18, movimientos: 61,
      apartados: 3, pagos: 22, devoluciones: 2, cambios: 4, prestamos: 1,
      reclasificaciones: 2, comisiones: 5, clientes: 7 },
  });
  window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
  window.AUTH.isAdmin = () => true;
  window.STORE.pointZeroPreview = async () => syntheticPreview();
  window.STORE.createPointZeroBackup = async preview => {
    window.__h98.backupCalls++;
    if (preview.preview_token !== 'preview-sintetico-98') throw new Error('preview inesperado');
    return { ok: true, backup_id: '00000000-0000-0000-0000-000000000098',
      payload_hash: 'a'.repeat(64), document: { format: 'balam-point-zero-backup-v1', synthetic: true } };
  };
  window.STORE.downloadPointZeroDocument = (doc, kind, id) => {
    window.__h98.downloads.push({ doc, kind, id }); return { bytes: 10 };
  };
  window.STORE.executePointZero = async opts => {
    window.__h98.executeCalls++;
    if (opts.confirmation !== 'PUNTO CERO') throw new Error('confirmación inválida');
    return { ok: true, operation_id: 'h98-synthetic-operation',
      counts_before: syntheticPreview().counts,
      counts_after: { productos: 0, piezas: 0, ventas: 0, movimientos: 0,
        apartados: 0, pagos: 0, devoluciones: 0, cambios: 0, prestamos: 0,
        reclasificaciones: 0, comisiones: 0, clientes: 0 } };
  };
  window.STORE.pointZeroReceipt = async id => {
    window.__h98.receiptCalls++; return { format: 'balam-point-zero-receipt-v1', operation_id: id };
  };
  document.body.innerHTML = '<div id="h98-root"></div>';
  ReactDOM.createRoot(document.getElementById('h98-root')).render(React.createElement(window.SettingsScreen));
});

await page.getByTestId('settings-section-demo').click();
await page.getByTestId('point-zero-card').waitFor();
check('sección administrativa visible para admin', await page.getByTestId('point-zero-card').isVisible());
check('modo preproducción discreto', (await page.getByTestId('point-zero-mode').innerText()).includes('PREPRODUCCIÓN'));
await page.getByTestId('point-zero-open').click();
check('diagnóstico usa conteos sintéticos remotos', (await page.locator('body').innerText()).includes('243'));
check('diagnóstico declara conservados', (await page.locator('body').innerText()).includes('Roles y permisos'));
await page.getByTestId('point-zero-backup').click();
await page.getByTestId('point-zero-confirmation').waitFor();
check('respaldo obligatorio fue creado primero', (await page.evaluate(() => window.__h98.backupCalls)) === 1);
check('respaldo se descargó', (await page.evaluate(() => window.__h98.downloads[0]?.kind)) === 'respaldo');
const continueButton = page.getByRole('button', { name: 'Continuar', exact: true });
check('frase parcial no habilita continuar', await continueButton.isDisabled());
await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO ');
check('coincidencia no exacta sigue bloqueada', await continueButton.isDisabled());
await page.getByTestId('point-zero-confirmation').fill('PUNTO CERO');
check('frase exacta habilita continuar', !(await continueButton.isDisabled()));
await continueButton.click();
check('segunda confirmación muestra advertencia permanente', (await page.locator('body').innerText()).includes('eliminará permanentemente'));
await page.getByTestId('point-zero-execute').click();
await page.getByText('PUNTO CERO COMPLETADO', { exact: true }).waitFor();
check('ejecución única completada', (await page.evaluate(() => window.__h98.executeCalls)) === 1);
check('resultado muestra operation_id', (await page.locator('body').innerText()).includes('h98-synthetic-operation'));
await page.getByRole('button', { name: 'Descargar comprobante de Punto Cero' }).click();
check('comprobante se obtiene de su autoridad', (await page.evaluate(() => window.__h98.receiptCalls)) === 1);
check('comprobante se descarga separado del respaldo', (await page.evaluate(() => window.__h98.downloads[1]?.kind)) === 'comprobante');
await page.getByText('Cerrar', { exact: true }).click();

await page.evaluate(() => { window.__h98.mode = 'production'; });
await page.getByRole('button', { name: 'Actualizar diagnóstico' }).click();
await page.waitForFunction(() => document.body.innerText.includes('PRODUCCIÓN'));
check('producción muestra bloqueo inequívoco', (await page.locator('body').innerText()).includes('está bloqueado'));
check('producción deshabilita el botón', await page.getByTestId('point-zero-open').isDisabled());

await page.evaluate(() => {
  window.AUTH.canAccess = () => false; window.AUTH.isAdmin = () => false;
  document.body.innerHTML = '<div id="h98-seller"></div>';
  ReactDOM.createRoot(document.getElementById('h98-seller')).render(React.createElement(window.SettingsScreen));
});
await page.waitForTimeout(100);
check('vendedor no ve Administración / Datos', await page.getByTestId('settings-section-demo').count() === 0);
check('sin errores de navegador', errors.length === 0, errors.join(' | '));

await browser.close(); server.close();
console.log(`\nH-98 E2E: ${pass} pasaron, ${fail} fallaron`);
if (fail) process.exit(1);
