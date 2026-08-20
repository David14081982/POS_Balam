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
  returnId: `H119-R-${RUN}`,
  returnLine: `H119-RL-${RUN}`,
};
const USER_ID = '00000000-0000-4000-8000-000000011900';
const EMAIL = 'h119-admin@fixture.invalid';
const q = value => `'${String(value).replaceAll("'", "''")}'`;

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
  '[{"talla":"M","escala":"L","stock":10}]','v1');
alter table pos.sales disable trigger sales_require_stock_reservation;
insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
values(${q(IDS.sale)},'Cliente H119','[]','Efectivo','Pagado',1,100,${q(IDS.saleOperation)},'[]');
alter table pos.sales enable trigger sales_require_stock_reservation;
insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id)
values(${q(IDS.sale)},${q(IDS.product)},'H119-SKU','Guayabera H119','M',1,100,${q(IDS.saleLine)});
insert into pos.sale_commits(commit_id,operation_id,folio,payload_hash)
values(${q(`H119-SC-${RUN}`)},${q(IDS.saleOperation)},${q(IDS.sale)},repeat('a',64));
insert into pos.returns(id,folio,cliente,vendedores,metodo,total,fecha,comisiones)
values(${q(IDS.returnId)},${q(IDS.sale)},'Cliente H119','[]','Efectivo',100,
  '2026-08-19 12:00:00-07','[]');
insert into pos.return_items(return_id,product_id,source_sale_line_id,sku,nombre,talla,qty,motivo,precio,line_id)
values(${q(IDS.returnId)},${q(IDS.product)},${q(IDS.saleLine)},'H119-SKU','Guayabera H119',
  'M',1,'CAMBIO',100,${q(IDS.returnLine)});
insert into pos.return_commits(commit_id,return_id,folio,payload_hash)
values(${q(`H119-RC-${RUN}`)},${q(IDS.returnId)},${q(IDS.sale)},repeat('b',64));
insert into pos.movements(fecha,tipo,producto,product_id,sku,talla,cant,ref)
values('2026-08-19 11:00:00-07','Venta','Guayabera H119',${q(IDS.product)},'H119-SKU','M',-1,${q(IDS.sale)});
insert into pos.movements(return_id,fecha,tipo,producto,product_id,sku,talla,cant,ref)
values(${q(IDS.returnId)},'2026-08-19 12:00:00-07','Devolucion','Guayabera H119',
  ${q(IDS.product)},'H119-SKU','M',1,${q(IDS.sale)});
insert into pos.movements(fecha,tipo,producto,product_id,sku,talla,cant,ref)
values('2026-08-19 12:00:01-07',convert_from(decode('4465766f6c756369c3b36e','hex'),'UTF8'),'Guayabera H119 legacy',
  ${q(IDS.product)},'H119-SKU','M',1,${q(IDS.sale)});
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
const rpcCalls = { preview: 0, backup: 0, execute: 0 };
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
    ReactDOM.createRoot(document.getElementById('h119-root')).render(React.createElement(window.SettingsScreen));
  }, { userId: USER_ID, email: EMAIL, product: IDS.product });
  await page.waitForFunction(() => window.STORE.syncStatus().synchronized === true);
  await page.getByTestId('settings-section-demo').click();
  await page.getByTestId('selective-cleanup-card').waitFor();
  return { context, page };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const first = await prepareContext();
const page = first.page;
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
check('preview real revierte 1 pieza: 10 → 9', selected.includes('1 piezas saldrán del inventario')
  && selected.includes('Cambio neto: -1 piezas')
  && /Piezas afectadas antes\s+10/.test(selected) && /Piezas afectadas después\s+9/.test(selected));
check('CTA válido queda habilitado', !(await page.getByTestId('selective-cleanup-open').isDisabled()));
const activityAfterSelection = await page.evaluate(() => window.CORE.activityStatus());
check('Administración / Datos no se bloquea con su propio foco', activityAfterSelection.active === 0
  && !activityAfterSelection.domains.config);

await page.getByTestId('selective-cleanup-open').click();
await page.getByTestId('selective-cleanup-backup').click();
await page.getByTestId('selective-cleanup-confirmation').waitFor();
const backedMovements = backupDocument && backupDocument.payload && backupDocument.payload.movements || [];
check('respaldo incluye movimientos de devolución moderno/legacy y excluye Venta',
  backedMovements.filter(row => row.tipo === 'Devolucion' || row.tipo === 'Devolución').length === 2
  && !backedMovements.some(row => row.tipo === 'Venta'));
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
  'sale_items',(select count(*) from pos.sale_items where folio=${q(IDS.sale)}),
  'sale_commits',(select count(*) from pos.sale_commits where folio=${q(IDS.sale)}),
  'returns',(select count(*) from pos.returns where id=${q(IDS.returnId)}),
  'return_items',(select count(*) from pos.return_items where return_id=${q(IDS.returnId)}),
  'return_commits',(select count(*) from pos.return_commits where return_id=${q(IDS.returnId)}),
  'sale_movements',(select count(*) from pos.movements where ref=${q(IDS.sale)} and tipo='Venta' and return_id is null),
  'return_movements',(select count(*) from pos.movements where return_id=${q(IDS.returnId)}),
  'legacy_return_movements',(select count(*) from pos.movements where ref=${q(IDS.sale)}
    and tipo=convert_from(decode('4465766f6c756369c3b36e','hex'),'UTF8') and return_id is null)
)`);
check('RPC ejecutó una sola vez', rpcCalls.backup === 1 && rpcCalls.execute === 1);
check('stock queda exactamente antes de la devolución', after.stock === 9);
check('devolución, renglón, commit y movimiento desaparecen', after.returns === 0 && after.return_items === 0
  && after.return_commits === 0 && after.return_movements === 0 && after.legacy_return_movements === 0);
check('venta, renglón, commit y movimiento sobreviven', after.sale === 1 && after.sale_items === 1
  && after.sale_commits === 1 && after.sale_movements === 1);
const localAfter = await page.evaluate(ids => {
  const product = window.DATA.products.find(row => String(row.id) === ids.product);
  return {
    stock: product ? window.DATA.stockOf(product, 'M') : null,
    sale: window.DATA.sales.filter(row => String(row.folio) === ids.sale).length,
    returns: window.DATA.returns.filter(row => String(row.id) === ids.returnId).length,
    saleMovements: window.DATA.movements.filter(row => String(row.ref) === ids.sale
      && row.tipo === 'Venta' && !String(row.returnId || row.return_id || '')).length,
    returnMovements: window.DATA.movements.filter(row => String(row.returnId || row.return_id || '') === ids.returnId).length,
    legacyReturnMovements: window.DATA.movements.filter(row => String(row.ref) === ids.sale
      && row.tipo === 'Devolución' && !String(row.returnId || row.return_id || '')).length,
  };
}, IDS);
check('estado local conserva venta/movimiento y revierte sólo la devolución', localAfter.stock === 9
  && localAfter.sale === 1 && localAfter.returns === 0
  && localAfter.saleMovements === 1 && localAfter.returnMovements === 0
  && localAfter.legacyReturnMovements === 0,
JSON.stringify(localAfter));

await first.context.close();
const second = await prepareContext();
await second.page.getByTestId('cleanup-group-returns').check();
await second.page.getByText('No hay operaciones de la selección para limpiar.', { exact: true }).waitFor();
check('segunda terminal ve cero devoluciones y no permite no-op',
  /Devoluciones\s+0(?:\s|$)/.test(await second.page.getByTestId('selective-cleanup-card').innerText())
  && await second.page.getByTestId('selective-cleanup-open').isDisabled());
check('segunda terminal no reejecuta la limpieza', rpcCalls.execute === 1);
check('sin errores de navegador', browserErrors.length === 0, browserErrors.join(' | '));

await second.context.close();
await browser.close();
server.close();
console.log(`\nH-119 E2E PostgreSQL aislado: ${pass} pasaron, ${fail} fallaron`);
if (fail) process.exit(1);
