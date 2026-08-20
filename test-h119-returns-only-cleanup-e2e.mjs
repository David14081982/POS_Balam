// H-119 · UI real -> STORE real -> RPC interceptada -> PostgreSQL 18 aislado.
// Requiere que BALAM_H119_DB apunte a una base local con H-119 aplicado.
// Nunca permite tráfico hacia Supabase ni usa datos compartidos.
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PG_BIN = process.env.BALAM_H119_PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const PG_HOST = process.env.BALAM_H119_PGHOST || '127.0.0.1';
const PG_PORT = process.env.BALAM_H119_PGPORT || '55416';
const PG_DB = process.env.BALAM_H119_DB || 'h119_cleanup';
const PG_USER = process.env.BALAM_H119_PGUSER || 'postgres';
const RUN = String(Date.now());
const IDS = {
  product: `H119-P-${RUN}`,
  sale: `H119-S-${RUN}`,
  saleOperation: `H119-SOP-${RUN}`,
  saleLine: `H119-SL-${RUN}`,
  returnId: null,
};
const USER_ID = '00000000-0000-4000-8000-000000011900';
const EMAIL = 'h119-admin@fixture.invalid';
const q = value => `'${String(value).replaceAll("'", "''")}'`;
// psql en Windows recibe la línea de comandos en la página ANSI; el guion largo
// de snapshots visuales no tiene semántica comercial y se normaliza en la fixture.
const wire = value => JSON.stringify(value).normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/[^\x20-\x7E]/g, '-');

function psql(sql) {
  return execFileSync(PG_BIN, [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-h', PG_HOST, '-p', PG_PORT, '-U', PG_USER, '-d', PG_DB, '-c', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function jsonFromOutput(output) {
  for (const line of String(output).split(/\r?\n/).reverse()) {
    const value = line.trim();
    if (!value || (!value.startsWith('{') && !value.startsWith('[') && value !== 'null')) continue;
    try { return JSON.parse(value); } catch { /* sigue buscando */ }
  }
  throw new Error(`PostgreSQL no devolvió JSON: ${output}`);
}
function authSql(statement, commit = false) {
  const end = commit ? 'commit' : 'rollback';
  return jsonFromOutput(psql(`begin;
select set_config('request.jwt.claim.sub',${q(USER_ID)},true);
select set_config('request.jwt.claim.email',${q(EMAIL)},true);
select (${statement})::text;
${end};`));
}
function readJson(statement) {
  return jsonFromOutput(psql(`select (${statement})::text;`));
}

psql(`begin;
delete from pos.movements where ref like 'H119-S-%' or return_id like 'H119-R-%';
delete from pos.return_commits where return_id like 'H119-R-%';
delete from pos.return_items where return_id like 'H119-R-%';
delete from pos.returns where id like 'H119-R-%';
delete from pos.sale_payments where folio like 'H119-S-%';
delete from pos.sale_commits where folio like 'H119-S-%';
delete from pos.sale_items where folio like 'H119-S-%';
delete from pos.sales where folio like 'H119-S-%';
delete from pos.products where id like 'H119-P-%';
insert into auth.users(id,email) values(${q(USER_ID)}::uuid,${q(EMAIL)})
on conflict(id) do update set email=excluded.email;
update pos.sellers set email=${q(EMAIL)},role='admin',active=true where id='h119-admin';
insert into pos.user_permission_role_assignments(user_id,role_code)
values(${q(USER_ID)}::uuid,'admin') on conflict(user_id) do update set role_code=excluded.role_code;
delete from pos.sync_devices;
update pos.system_manifest set system_mode='preproduction' where singleton;
insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,stock,record_model)
values(${q(IDS.product)},'GUA','MC','ALG','BLA','H119','Guayabera H119','H119-SKU',
  '[{"talla":"M","escala":"L","stock":8}]','v1');
alter table pos.sales disable trigger sales_require_stock_reservation;
insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
values(${q(IDS.sale)},'Cliente H119','[]','Efectivo','Pagado',2,200,${q(IDS.saleOperation)},'[]');
alter table pos.sales enable trigger sales_require_stock_reservation;
insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id)
values(${q(IDS.sale)},${q(IDS.product)},'H119-SKU','Guayabera H119','M',2,100,${q(IDS.saleLine)});
insert into pos.sale_commits(commit_id,operation_id,folio,payload_hash)
values(${q(`H119-SC-${RUN}`)},${q(IDS.saleOperation)},${q(IDS.sale)},repeat('a',64));
insert into pos.stock_reservations(operation_id,folio,lines)
values(${q(IDS.saleOperation)},${q(IDS.sale)},
  jsonb_build_array(jsonb_build_object('product_id',${q(IDS.product)},'talla','M','qty',2)));
insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro)
values(${q(`H119-PAY-${RUN}`)},${q(IDS.sale)},'2026-08-19 11:00:00-07','venta','Efectivo',200,200,0,0,0);
insert into pos.movements(fecha,tipo,producto,product_id,sku,talla,cant,ref)
values('2026-08-19 11:00:00-07','Venta','Guayabera H119',${q(IDS.product)},'H119-SKU','M',-2,${q(IDS.sale)});
commit;`);

const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const file = path.join(ROOT, requestPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': requestPath.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8897, '127.0.0.1', resolve));

let pass = 0, fail = 0;
const browserErrors = [];
const rpcCalls = { returnCommit: 0, preview: 0, backup: 0, execute: 0 };
let backupDocument = null;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

function rpcResult(name, body) {
  if (name === 'point_zero_preview') return authSql('pos.point_zero_preview()');
  if (name === 'preview_test_data_cleanup') {
    rpcCalls.preview++;
    return authSql(`pos.preview_test_data_cleanup(${q(body.p_preset)},${q(JSON.stringify(body.p_selection || {}))}::jsonb,${Number(body.p_client_protocol)})`);
  }
  if (name === 'commit_return_checked') {
    rpcCalls.returnCommit++;
    return authSql(`pos.commit_return_checked(${q(body.p_commit_id)},
      ${q(wire(body.p_return || {}))}::jsonb,
      ${q(wire(body.p_items || []))}::jsonb,
      ${q(wire(body.p_moves || []))}::jsonb,
      ${q(wire(body.p_stock_lines || []))}::jsonb,
      ${body.p_client_effect == null ? 'null' : `${q(wire(body.p_client_effect))}::jsonb`},
      ${q(wire(body.p_seller_effects || []))}::jsonb,
      false)`, true);
  }
  if (name === 'create_test_data_cleanup_backup') {
    rpcCalls.backup++;
    const result = authSql(`pos.create_test_data_cleanup_backup(${q(body.p_preset)},${q(JSON.stringify(body.p_selection || {}))}::jsonb,${q(body.p_plan_hash)},${Number(body.p_client_protocol)},${q(body.p_client_build)},${q(body.p_device_id)})`, true);
    backupDocument = result.document;
    return result;
  }
  if (name === 'execute_test_data_cleanup') {
    rpcCalls.execute++;
    return authSql(`pos.execute_test_data_cleanup(${q(body.p_cleanup_id)},${q(body.p_preset)},${q(JSON.stringify(body.p_selection || {}))}::jsonb,${q(body.p_plan_hash)},${q(body.p_backup_id)}::uuid,${q(body.p_confirmation)},${Number(body.p_client_protocol)},${q(body.p_client_build)},${q(body.p_device_id)})`, true);
  }
  if (['consume_sync_commands', 'consume_sync_quarantine_decisions'].includes(name)) return [];
  if (name === 'report_sync_device') return { ok: true };
  return null;
}

async function prepareContext() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\.co/, socket => socket.close());
  await context.addInitScript(({ userId, email }) => {
    const enc = value => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
    const access = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: userId, email, role: 'authenticated', exp: 4102444800 })}.AA`;
    localStorage.setItem('balam_auth', JSON.stringify({
      access_token: access, refresh_token: 'h119-refresh', token_type: 'bearer',
      expires_in: 2147483647, expires_at: 4102444800,
      user: { id: userId, email, role: 'authenticated', aud: 'authenticated' },
    }));
  }, { userId: USER_ID, email: EMAIL });
  await context.route(/https:\/\/telohdbvbvsfmwyriflz\.supabase\.co\/.*/, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/rest/v1/system_manifest') {
      const manifest = readJson(`(select to_jsonb(m) from pos.system_manifest m where singleton)`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([manifest]) }); return;
    }
    if (url.pathname === '/rest/v1/sync_domain_versions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); return;
    }
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
    const pullTables = new Set(['products', 'clients', 'sellers', 'sales', 'sale_items',
      'sale_payments', 'returns', 'return_items', 'exchanges', 'exchange_items',
      'loan_documents', 'liquidations', 'movements']);
    if (table && pullTables.has(table[1])) {
      const rows = readJson(`coalesce((select jsonb_agg(to_jsonb(t)) from pos.${table[1]} t),'[]'::jsonb)`);
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
        body: JSON.stringify(rows) }); return;
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpc) {
      try {
        const body = route.request().postDataJSON() || {};
        const result = rpcResult(rpc[1], body);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      } catch (error) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: error.message }) });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(String(error)));
  await page.goto('http://127.0.0.1:8897/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH && window.DATA);
  await page.evaluate(async fixture => {
    window.AUTH.canAccess = id => id === 'config' || id === 'config.demo';
    window.AUTH.isAdmin = () => true;
    window.AUTH.role = () => 'admin';
    window.AUTH.current = () => ({ id: fixture.userId, email: fixture.email, role: 'admin', active: true });
    await window.STORE.init({ pull: true });
    document.body.innerHTML = '<div id="h119-root"></div>';
    window.__h119Root = ReactDOM.createRoot(document.getElementById('h119-root'));
    window.__h119Root.render(React.createElement(window.SettingsScreen));
  }, { userId: USER_ID, email: EMAIL, product: IDS.product });
  await page.waitForFunction(() => window.STORE.syncStatus().synchronized === true);
  await page.getByTestId('settings-section-demo').click();
  await page.getByTestId('selective-cleanup-card').waitFor();
  return { context, page };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const first = await prepareContext();
const page = first.page;
await page.evaluate(() => window.__h119Root.render(React.createElement(window.ReturnsScreen)));
await page.waitForTimeout(300);
if (await page.getByTestId(`return-sale-${IDS.sale}`).count() === 0) {
  console.error('H120_RETURN_PICKER=', await page.locator('body').innerText());
  console.error('H120_RETURN_DATA=', await page.evaluate(() => ({
    sales: window.DATA.sales.map(s => ({ folio: s.folio, estado: s.estado,
      lineas: (s.lineas || []).length, lifecycle: window.DATA.returnLifecycle(s) })),
    returns: window.DATA.returns,
    writer: window.DATA.localWriterState,
  })));
}
await page.getByTestId(`return-sale-${IDS.sale}`).click();
await page.locator('[data-testid^="return-line-toggle-"]').click();
const reason = page.locator('[data-testid^="return-line-reason-"]');
await reason.selectOption(await reason.locator('option:not([disabled])').first().getAttribute('value'));
await page.getByTestId('return-confirm').click();
await page.waitForTimeout(500);
if (await page.getByText('Devolucion registrada', { exact: true }).count() === 0) {
  console.error('H120_RETURN_CONFIRM=', await page.locator('body').innerText());
  console.error('H120_RETURN_QUEUE=', await page.evaluate(() => ({
    queue: window.STORE.queueStatus(), returns: window.DATA.returns,
    sales: window.DATA.sales.map(s => ({ folio: s.folio, estado: s.estado })),
  })));
}
await page.getByText('Devolucion registrada', { exact: true }).waitFor();
await page.waitForTimeout(1000);
const returnSyncProbe = await page.evaluate(() => ({
  queue: window.STORE.queueStatus(), returns: window.DATA.returns,
  sales: window.DATA.sales.map(s => ({ folio: s.folio, estado: s.estado })),
}));
if (returnSyncProbe.queue.pending !== 0 || returnSyncProbe.returns.length !== 1) {
  console.error('H120_RETURN_SYNC_PROBE=', JSON.stringify({ returnSyncProbe, rpcCalls }, null, 2));
}
await page.waitForFunction(() => window.STORE.queueStatus().pending === 0
  && window.DATA.returns.length === 1 && window.DATA.sales[0].estado === 'Devolución parcial');
const lifecycle = await page.evaluate(() => ({
  returnId: window.DATA.returns[0] && window.DATA.returns[0].id,
  priorSaleState: window.DATA.returns[0] && window.DATA.returns[0].priorSaleState,
  stock: window.DATA.stockOf(window.DATA.products[0], 'M'),
  saleState: window.DATA.sales[0] && window.DATA.sales[0].estado,
}));
IDS.returnId = lifecycle.returnId;
const remoteLifecycle = readJson(`jsonb_build_object(
  'returns',(select count(*) from pos.returns where id=${q(IDS.returnId)}),
  'prior_state',(select prior_sale_state from pos.returns where id=${q(IDS.returnId)}),
  'sale_state',(select estado from pos.sales where folio=${q(IDS.sale)}),
  'stock',(select (stock->0->>'stock')::integer from pos.products where id=${q(IDS.product)})
)`);
check('ciclo real registra 1 de 2 piezas y conserva estado previo exacto', rpcCalls.returnCommit === 1
  && lifecycle.priorSaleState === 'Pagado' && lifecycle.saleState === 'Devolución parcial'
  && lifecycle.stock === 9 && remoteLifecycle.returns === 1
  && remoteLifecycle.prior_state === 'Pagado' && remoteLifecycle.sale_state === 'Devolución parcial'
  && remoteLifecycle.stock === 9, JSON.stringify({ lifecycle, remoteLifecycle }));
await page.getByRole('button', { name: 'Listo', exact: true }).click();
await page.evaluate(() => window.__h119Root.render(React.createElement(window.SettingsScreen)));
await page.getByTestId('settings-section-demo').click();
await page.getByTestId('selective-cleanup-card').waitFor();
await page.getByTestId('cleanup-group-returns').check();
try {
  await page.getByText('Todo está listo para limpiar.', { exact: true }).waitFor();
} catch (error) {
  console.error('H119_PREVIEW_UI=', await page.getByTestId('selective-cleanup-card').innerText());
  console.error('H119_SYNC_STATUS=', await page.evaluate(() => window.STORE.syncStatus()));
  console.error('H119_ACTIVITY_STATUS=', await page.evaluate(() => window.CORE.activityStatus()));
  throw error;
}
const selected = await page.getByTestId('selective-cleanup-card').innerText();
check('selecciona exclusivamente Devoluciones', await page.getByTestId('cleanup-group-returns').isChecked()
  && await page.locator('[data-testid^="cleanup-group-"]:checked').count() === 1);
check('preview real cuenta una devolución', /Devoluciones\s+1(?:\s|$)/.test(selected));
check('preview real revierte 1 pieza: 9 → 8', selected.includes('1 piezas saldrán del inventario')
  && selected.includes('Cambio neto: -1 piezas')
  && /Piezas afectadas antes\s+9/.test(selected) && /Piezas afectadas después\s+8/.test(selected));
check('CTA válido queda habilitado', !(await page.getByTestId('selective-cleanup-open').isDisabled()));
const activityAfterSelection = await page.evaluate(() => window.CORE.activityStatus());
check('Administración / Datos no se bloquea con su propio foco', activityAfterSelection.active === 0
  && !activityAfterSelection.domains.config);

await page.getByTestId('selective-cleanup-open').click();
await page.getByTestId('selective-cleanup-backup').click();
await page.getByTestId('selective-cleanup-confirmation').waitFor();
const backedMovements = backupDocument && backupDocument.payload && backupDocument.payload.movements || [];
const backedSales = backupDocument && backupDocument.payload && backupDocument.payload.sales || [];
check('respaldo incluye movimientos de devolución moderno/legacy y excluye Venta',
  backedMovements.filter(row => row.tipo === 'Devolucion' || row.tipo === 'Devolución').length === 1
  && !backedMovements.some(row => row.tipo === 'Venta'));
check('respaldo incluye la venta cuyo estado restaurará',
  backedSales.length === 1 && backedSales[0].folio === IDS.sale
  && backedSales[0].estado === 'Devolución parcial');
await page.getByTestId('selective-cleanup-confirmation').fill('LIMPIAR OPERACIONES');
await page.getByRole('button', { name: 'Continuar', exact: true }).click();
await page.getByTestId('selective-cleanup-execute').click();
try {
  await page.getByText('LIMPIEZA COMPLETADA', { exact: true }).waitFor();
} catch (error) {
  console.error('H119_EXECUTION_UI=', await page.locator('body').innerText());
  console.error('H119_RPC_CALLS=', rpcCalls);
  throw error;
}

const after = readJson(`jsonb_build_object(
  'stock',(select (stock->0->>'stock')::integer from pos.products where id=${q(IDS.product)}),
  'sale',(select count(*) from pos.sales where folio=${q(IDS.sale)}),
  'sale_state',(select estado from pos.sales where folio=${q(IDS.sale)}),
  'sale_items',(select count(*) from pos.sale_items where folio=${q(IDS.sale)}),
  'sale_payments',(select count(*) from pos.sale_payments where folio=${q(IDS.sale)}),
  'sale_commits',(select count(*) from pos.sale_commits where folio=${q(IDS.sale)}),
  'stock_reservations',(select count(*) from pos.stock_reservations where folio=${q(IDS.sale)}),
  'products',(select count(*) from pos.products where id=${q(IDS.product)}),
  'returns',(select count(*) from pos.returns where id=${q(IDS.returnId)}),
  'return_items',(select count(*) from pos.return_items where return_id=${q(IDS.returnId)}),
  'return_commits',(select count(*) from pos.return_commits where return_id=${q(IDS.returnId)}),
  'sale_movements',(select count(*) from pos.movements where ref=${q(IDS.sale)} and tipo='Venta' and return_id is null),
  'return_movements',(select count(*) from pos.movements where return_id=${q(IDS.returnId)}),
  'legacy_return_movements',(select count(*) from pos.movements where ref=${q(IDS.sale)}
    and tipo=convert_from(decode('4465766f6c756369c3b36e','hex'),'UTF8') and return_id is null)
)`);
check('RPC ejecutó cada mutación una sola vez', rpcCalls.returnCommit === 1 && rpcCalls.backup === 1 && rpcCalls.execute === 1);
check('stock queda exactamente antes de la devolución', after.stock === 8);
check('devolución, renglón, commit y movimiento desaparecen', after.returns === 0 && after.return_items === 0
  && after.return_commits === 0 && after.return_movements === 0 && after.legacy_return_movements === 0);
check('venta, renglón, pago, commit, reserva, producto y movimiento sobreviven',
  after.sale === 1 && after.sale_items === 1 && after.sale_payments === 1
  && after.sale_state === 'Pagado' && after.sale_commits === 1
  && after.stock_reservations === 1 && after.products === 1 && after.sale_movements === 1);
const localAfter = await page.evaluate(ids => {
  const product = window.DATA.products.find(row => String(row.id) === ids.product);
  return {
    stock: product ? window.DATA.stockOf(product, 'M') : null,
    sale: window.DATA.sales.filter(row => String(row.folio) === ids.sale).length,
    saleState: (window.DATA.sales.find(row => String(row.folio) === ids.sale) || {}).estado,
    returns: window.DATA.returns.filter(row => String(row.id) === ids.returnId).length,
    payments: window.DATA.payments.filter(row => String(row.folio) === ids.sale).length,
    saleMovements: window.DATA.movements.filter(row => String(row.ref) === ids.sale
      && row.tipo === 'Venta' && !String(row.returnId || row.return_id || '')).length,
    returnMovements: window.DATA.movements.filter(row => String(row.returnId || row.return_id || '') === ids.returnId).length,
    legacyReturnMovements: window.DATA.movements.filter(row => String(row.ref) === ids.sale
      && row.tipo === 'Devolución' && !String(row.returnId || row.return_id || '')).length,
  };
}, IDS);
check('estado local conserva venta/movimiento y revierte sólo la devolución', localAfter.stock === 8
  && localAfter.sale === 1 && localAfter.saleState === 'Pagado' && localAfter.returns === 0
  && localAfter.payments === 1
  && localAfter.saleMovements === 1 && localAfter.returnMovements === 0
  && localAfter.legacyReturnMovements === 0,
JSON.stringify(localAfter));

await first.context.close();
const second = await prepareContext();
await second.page.evaluate(() => window.__h119Root.render(React.createElement(window.ReturnsScreen)));
check('segunda terminal no muestra estado parcial ni una venta inconsistente',
  !(await second.page.locator('body').innerText()).includes('DEVOLUCIÓN PARCIAL')
  && await second.page.getByTestId(`return-sale-${IDS.sale}`).isVisible()
  && await second.page.getByTestId('return-lifecycle-inconsistent').count() === 0);
await second.page.evaluate(() => window.__h119Root.render(React.createElement(window.SettingsScreen)));
await second.page.getByTestId('settings-section-demo').click();
await second.page.getByTestId('selective-cleanup-card').waitFor();
await second.page.getByTestId('cleanup-group-returns').check();
await second.page.getByText('No hay operaciones de la selección para limpiar.', { exact: true }).waitFor();
check('segunda terminal ve cero devoluciones y no permite no-op',
  /Devoluciones\s+0(?:\s|$)/.test(await second.page.getByTestId('selective-cleanup-card').innerText())
  && await second.page.getByTestId('selective-cleanup-open').isDisabled());
check('segunda terminal no reejecuta la limpieza', rpcCalls.execute === 1);

psql(`insert into pos.return_commits(commit_id,return_id,folio,payload_hash,created_at)
values(${q(`H120-ORPHAN-C-${RUN}`)},${q(`H120-ORPHAN-R-${RUN}`)},'BG-H120-ORPHAN',repeat('c',64),
  '2026-08-19 10:15:00-07');`);
await second.page.getByTestId('cleanup-group-returns').uncheck();
await second.page.getByTestId('cleanup-group-returns').check();
await second.page.getByTestId('cleanup-orphan-return-evidence').waitFor();
const orphanUi = await second.page.getByTestId('selective-cleanup-card').innerText();
check('UI separa comprobante huérfano de devolución borrable',
  /Devoluciones\s+0(?:\s|$)/.test(orphanUi)
  && orphanUi.includes('BG-H120-ORPHAN')
  && orphanUi.includes('pero faltan las devoluciones comerciales correspondientes')
  && orphanUi.includes('Selecciona “Evidencias huérfanas de devoluciones”')
  && await second.page.getByTestId('selective-cleanup-open').isDisabled());
for (const width of [320,360,375,390,430,768,1024,1280,1440]) {
  await second.page.setViewportSize({ width, height: 900 });
  check(`evidencia huérfana responsive ${width}px sin overflow`,
    await second.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}
fs.mkdirSync(path.join(ROOT, '.evidence-h120'), { recursive: true });
await second.page.screenshot({ path: path.join(ROOT, '.evidence-h120', 'h120-orphan-1440.png'), fullPage: true });
await second.page.setViewportSize({ width: 390, height: 844 });
await second.page.screenshot({ path: path.join(ROOT, '.evidence-h120', 'h120-orphan-390.png'), fullPage: true });

await second.page.evaluate(folio => {
  const sale = window.DATA.sales.find(row => row.folio === folio);
  sale.estado = 'Devolución parcial';
  window.__h119Root.render(React.createElement(window.ReturnsScreen));
}, IDS.sale);
await second.page.getByTestId('return-lifecycle-inconsistent').waitFor();
const inconsistentUi = await second.page.getByTestId('return-lifecycle-inconsistent').innerText();
check('Devoluciones pone en revisión una proyección parcial sin documento',
  inconsistentUi.includes(IDS.sale) && inconsistentUi.includes('Devolución parcial')
  && inconsistentUi.includes('No pueden reprocesarse')
  && await second.page.getByTestId(`return-sale-${IDS.sale}`).count() === 0);
for (const width of [320,360,375,390,430,768,1024,1280,1440]) {
  await second.page.setViewportSize({ width, height: 900 });
  check(`venta inconsistente responsive ${width}px sin overflow`,
    await second.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}
await second.page.screenshot({ path: path.join(ROOT, '.evidence-h120', 'h120-inconsistent-1440.png'), fullPage: true });
await second.page.setViewportSize({ width: 390, height: 844 });
await second.page.screenshot({ path: path.join(ROOT, '.evidence-h120', 'h120-inconsistent-390.png'), fullPage: true });

psql(`delete from pos.return_commits where commit_id=${q(`H120-ORPHAN-C-${RUN}`)};`);
check('sin errores de navegador', browserErrors.length === 0, browserErrors.join(' | '));

await second.context.close();
await browser.close();
server.close();
console.log(`\nH-119 E2E PostgreSQL aislado: ${pass} pasaron, ${fail} fallaron`);
if (fail) process.exit(1);
