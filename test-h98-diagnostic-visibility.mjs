// H-98 · Contrato visual del preview. Sólo usa fixtures sintéticos y jamás
// llama respaldo, ejecución ni purga.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const server = http.createServer((request, response) => {
  let name = decodeURIComponent(request.url.split('?')[0]);
  if (name === '/') name = '/index.html';
  const file = path.join(root, name);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    response.writeHead(404); response.end('not found'); return;
  }
  response.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(8899, '127.0.0.1', resolve));

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8899/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);
  await page.evaluate(() => {
    window.__h98Diagnostic = {
      calls: 0, backupCalls: 0, executeCalls: 0, fail: false,
      counts: { productos: 1378, piezas: 3334, ventas: 21, sale_items: 31,
        movimientos: 44, pagos: 20, apartados: 2, devoluciones: 3,
        return_items: 3, cambios: 4, exchange_items: 5, prestamos: 1,
        reclasificaciones: 6, liquidaciones: 7, commission_adjustments: 8,
        physical_card_redemptions: 9, stock_reservations: 10, sale_commits: 11,
        return_commits: 12, exchange_commits: 13,
        layaway_liquidation_commits: 14, folio_counters: 15, clientes: 16 },
    };
    window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
    window.AUTH.isAdmin = () => true;
    window.STORE.pointZeroPreview = async () => {
      window.__h98Diagnostic.calls++;
      await new Promise(resolve => setTimeout(resolve, 80));
      if (window.__h98Diagnostic.fail) throw new Error('RPC de diagnóstico no disponible');
      return { ok: true, system_mode: 'preproduction', schema_version: 20260812014100,
        data_epoch: 7, preview_token: `preview-${window.__h98Diagnostic.calls}`,
        generated_at: new Date().toISOString(), ready: true, sync_complete: true,
        client_ready: true, queue_pending: 0, active_locks: 0, active_operation: 0,
        counts: window.__h98Diagnostic.counts };
    };
    window.STORE.createPointZeroBackup = async () => { window.__h98Diagnostic.backupCalls++; throw new Error('NO DEBE LLAMARSE'); };
    window.STORE.executePointZero = async () => { window.__h98Diagnostic.executeCalls++; throw new Error('NO DEBE LLAMARSE'); };
    document.body.innerHTML = '<div id="h98-diagnostic-root"></div>';
    ReactDOM.createRoot(document.getElementById('h98-diagnostic-root')).render(React.createElement(window.SettingsScreen));
  });

  await page.getByTestId('settings-section-demo').click();
  await page.getByTestId('point-zero-card').waitFor();
  await page.waitForTimeout(200);
  const hasDiagnostic = await page.getByTestId('point-zero-diagnostic').count() === 1;
  const initial = hasDiagnostic ? await page.getByTestId('point-zero-diagnostic').innerText() : '';
  check('el preview se renderiza fuera del wizard', initial.includes('1,378') && initial.includes('3,334'));
  check('declara sale_items, return_items y exchange_items',
    initial.includes('31') && initial.includes('3') && initial.includes('5'));
  check('muestra fecha o estado de actualización', /Actualizado|Actualización/.test(initial));

  await page.getByRole('button', { name: 'Actualizar diagnóstico' }).click();
  check('bloquea limpiar mientras actualiza', await page.getByTestId('point-zero-open').isDisabled());
  await page.waitForFunction(() => window.__h98Diagnostic.calls >= 2 && !document.querySelector('[data-testid="point-zero-open"]').disabled);
  check('el click vuelve a consultar la autoridad', await page.evaluate(() => window.__h98Diagnostic.calls) === 2);

  await page.evaluate(() => { window.__h98Diagnostic.fail = true; });
  await page.getByRole('button', { name: 'Actualizar diagnóstico' }).click();
  await page.waitForTimeout(200);
  const hasError = await page.getByTestId('point-zero-error').count() === 1;
  check('el error del diagnóstico queda visible',
    hasError && (await page.getByTestId('point-zero-error').innerText()).includes('RPC de diagnóstico no disponible'));
  check('un fallo invalida el preview visible', await page.getByTestId('point-zero-diagnostic').count() === 0);
  check('un fallo mantiene bloqueada la continuación', await page.getByTestId('point-zero-open').isDisabled());
  check('la prueba no invoca respaldo ni ejecución', await page.evaluate(() =>
    window.__h98Diagnostic.backupCalls === 0 && window.__h98Diagnostic.executeCalls === 0));
} finally {
  await browser.close();
  server.close();
}

console.log(`\nH-98 diagnóstico visible: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
