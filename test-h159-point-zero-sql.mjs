// H-159: actual Punto Cero SQL in isolated, in-memory PostgreSQL (PGlite).
// No network or business database. The four RPC/helper bodies, preservation
// hashes and H68 purge are extracted unchanged from committed migrations.
// Synthetic tables contain the columns used by those functions; this is not a
// full schema/RLS/trigger or real A/B/C certification. Auth/capability and domain
// notification dependencies are explicit doubles. SHA-256 uses PostgreSQL SHA.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const { PGlite } = await import(process.env.BALAM_PGLITE_MODULE
  ? pathToFileURL(process.env.BALAM_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const setupOnly = process.env.BALAM_H159_SETUP_ONLY === '1';
const baseline = !setupOnly && process.argv.includes('--baseline');
let setupComplete = false;
const migrationDir = path.resolve('supabase/migrations');
const sources = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql')
  && (!process.env.BALAM_SQL_MIGRATION_MAX || file.slice(0,14) <= process.env.BALAM_SQL_MIGRATION_MAX)
  && !/verification/.test(file) && (!baseline || !file.includes('_h159_')))
  .sort().map(file => ({ file, text: fs.readFileSync(path.join(migrationDir, file), 'utf8').replace(/\r\n/g, '\n') }));
const definitions = [];
function actualFunction(name) {
  const pattern = new RegExp('create (?:or replace )?function pos\\.' + name + '\\s*\\(', 'ig');
  let found;
  for (const source of sources) {
    let match;
    while ((match = pattern.exec(source.text))) {
      const tail = source.text.slice(match.index);
      const body = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
      if (!body) throw new Error('No SQL body for ' + name);
      const end = tail.indexOf(body[1], body.index + body[0].length);
      const sql = tail.slice(0, end + body[1].length) + ';';
      found = { name, file: source.file, sql, sha256: createHash('sha256').update(sql).digest('hex') };
    }
  }
  assert.ok(found, 'Missing real SQL ' + name);
  definitions.push({ name, file: found.file, sha256: found.sha256 });
  return found.sql;
}
const checks = [];
async function scenario(name, run) {
  await db.exec('begin');
  try { await run(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
  finally { await db.exec('rollback'); }
}
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const preview = () => scalar('select pos.point_zero_preview()');
const backup = p => scalar("select pos.create_point_zero_backup($1,'h159-synthetic','A')", [p.preview_token]);
const execute = (p, b, operation = 'h159-operation', phrase = 'PUNTO CERO') => scalar(
  "select pos.execute_point_zero($1,$2,$3,$4,'h159-synthetic','A')", [operation, p.preview_token, b.backup_id, phrase]);
const preserved = () => scalar('select pos.point_zero_preserved_hash()');
async function denied(run, message) {
  await db.exec('savepoint negative_guard');
  let error; try { await run(); } catch (caught) { error = caught; }
  await db.exec('rollback to savepoint negative_guard');
  assert.ok(error, 'Expected rejection: ' + message);
  assert.match(error.message, new RegExp(message));
}
async function cleanFleet() { await db.exec("delete from pos.sync_devices where device_id<>'A'"); }

try {
  await db.exec(`create schema pos; create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql as $$select '15900000-0000-4000-8000-000000000001'::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select '{"email":"synthetic@h159.invalid"}'::jsonb$$;
    create function pos.is_active_admin() returns boolean language sql as $$select coalesce(nullif(current_setting('h159.admin',true),''),'true')='true'$$;
    create function pos.current_has_capability(text) returns boolean language sql as $$select coalesce(nullif(current_setting('h159.capability',true),''),'true')='true'$$;
    create function pos.bump_sync_domain(text,text) returns void language sql as $$select null::void$$;
    create function extensions.digest(bytea,text) returns bytea language plpgsql immutable as $$begin
      if $2<>'sha256' then raise exception 'Only SHA256 supported in fixture'; end if; return sha256($1); end$$;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz);
    create table pos.system_manifest(singleton boolean primary key,system_mode text,schema_version bigint,data_epoch bigint,updated_at timestamptz);
    create table pos.sync_devices(device_id text primary key,data_epoch bigint,queue_pending integer,queue_blocked integer,status text,last_seen_at timestamptz,display_name text);
    create table pos.products(id text primary key,sku text,record_model text,stock_quantity integer,stock jsonb,deleted_at timestamptz,sync_base_version bigint,sync_device_id text);
    create table pos.clients(id text primary key,generic boolean,deleted_at timestamptz,compras integer,total numeric,ultima date,sync_base_version bigint,sync_device_id text);
    create table pos.sales(folio text primary key,operation_id text,estado text);
    create table pos.sale_items(id bigint primary key,folio text,product_id text,sku text,talla text,qty integer);
    create table pos.sale_payments(id text primary key,folio text,monto numeric);
    create table pos.returns(id text primary key,folio text);
    create table pos.return_items(id bigint primary key,return_id text,product_id text,sku text,talla text,qty integer);
    create table pos.exchanges(id text primary key,folio text);
    create table pos.exchange_items(id bigint primary key,exchange_id text,sku text,talla text,qty integer,lado text);
    create table pos.loan_documents(id text primary key);
    create table pos.movements(id bigint primary key,tipo text);
    create table pos.liquidations(id text primary key,tipo text);
    create table pos.commission_adjustments(operation_id uuid primary key);
    create table pos.reference_reclassifications(operation_id text primary key,reversed_by text,reversal_of text);
    create table pos.physical_card_redemptions(folio text primary key);
    create table pos.stock_reservations(operation_id text primary key,folio text,lines jsonb);
    create table pos.sale_commits(commit_id text primary key);
    create table pos.return_commits(commit_id text primary key);
    create table pos.exchange_commits(commit_id text primary key);
    create table pos.layaway_liquidation_commits(commit_id text primary key);
    create table pos.folio_counters(prefix text,business_date date,primary key(prefix,business_date));
    create table pos.settings(key text primary key,value jsonb,updated_at timestamptz);
    create table pos.lookup(kind text,code text,label text,primary key(kind,code));
    create table pos.sellers(id text primary key,nombre text,ventas_mes numeric,ventas_num integer,comision_acum numeric,updated_at timestamptz,sync_base_version bigint,sync_device_id text,deleted_at timestamptz);
    create table pos.promotions(id text primary key,deleted_at timestamptz);
    create table pos.permission_roles(code text primary key);
    create table pos.role_screen_permissions(role_code text,screen_key text);
    create table pos.user_screen_permission_overrides(user_id uuid,screen_key text);
    create table pos.role_capability_permissions(role_code text,capability_key text);
    create table pos.user_capability_overrides(user_id uuid,capability_key text);
    create table pos.operational_capabilities(capability_key text);
    create table pos.user_permission_role_assignments(user_id uuid,role_code text);
    create table pos.screen_permission_catalog(screen_key text);
    create table pos.sync_conflicts(id text);
    create table pos.test_data_purges(purge_id text primary key,epoch bigint,purged_at timestamptz,actor_email text,report jsonb);
    create table pos.purged_documents(kind text,identity text,purge_id text,primary key(kind,identity));
    create table pos.point_zero_backups(backup_id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),created_by uuid,actor_email text,device_id text,client_build text,schema_version bigint,preview_token text,payload_hash text,counts jsonb,payload jsonb);
    create table pos.point_zero_operations(operation_id text primary key,backup_id uuid,status text,started_at timestamptz default now(),completed_at timestamptz,actor_user_id uuid,actor_email text,device_id text,client_build text,schema_version bigint,preview_token text,counts_before jsonb,counts_after jsonb,result jsonb default '{}');`);
  // H133's real RESTRICT relationships and immutable alias trigger are part of
  // Punto Cero's deletion boundary, including in the shared H160 fixture.
  const h133 = fs.readFileSync(path.join(migrationDir, '20260830017200_pos_h133_inventory_v3_contract.sql'), 'utf8');
  for (const name of ['barcode_aliases', 'inventory_v1_v2_map']) {
    const start = h133.indexOf('create table if not exists pos.' + name + ' (');
    const end = h133.indexOf('\n);', start);
    assert.ok(start >= 0 && end > start, 'Missing real H133 table ' + name);
    await db.exec(h133.slice(start, end + 3));
  }
  for (const name of ['h133_internal_enabled','h133_alias_immutable']) await db.exec(actualFunction(name));
  await db.exec(`create trigger h133_alias_immutable before update or delete on pos.barcode_aliases
    for each row execute function pos.h133_alias_immutable()`);
  for (const name of ['config_fingerprint','total_stock_pieces','purge_test_data','point_zero_payload',
    'point_zero_sha256','point_zero_preserved_hash','point_zero_preview','create_point_zero_backup','execute_point_zero','point_zero_receipt']) {
    await db.exec(actualFunction(name));
  }
  await db.exec(`insert into pos.system_manifest values(true,'preproduction',20260911020200,8,now());
    insert into pos.sync_devices(device_id,data_epoch,queue_pending,queue_blocked,status,last_seen_at)
      values('A',8,0,0,'online',now()),('retired',7,0,0,'revoked',now()-interval '1 year');
    insert into auth.users values(auth.uid(),'synthetic@h159.invalid',null);
    insert into pos.settings values('skuRecipe','{"order":["category","color","size"]}',now()),
      ('paymentMethods','["cash","card","transfer"]',now()),('logo','"data:image/png;base64,SYNTHETIC"',now()),
      ('store','{"name":"Synthetic store","currency":"MXN"}',now()),('_catalogMeta','{"color":{"label":"Color"}}',now()),
      ('configuration','{"returnsDays":15}',now());
    insert into pos.lookup values('color','RED','Red'),('category','TOP','Top');
    insert into pos.sellers values('admin','Synthetic admin',100,1,10,now(),1,'A',null);
    insert into pos.promotions values('promotion-preserved',null);
    insert into pos.permission_roles values('admin');
    insert into pos.role_screen_permissions values('admin','config.demo');
    insert into pos.user_screen_permission_overrides values(auth.uid(),'inventory');
    insert into pos.role_capability_permissions values('admin','settings.manage');
    insert into pos.user_capability_overrides values(auth.uid(),'inventory.write');
    insert into pos.operational_capabilities values('settings.manage');
    insert into pos.user_permission_role_assignments values(auth.uid(),'admin');
    insert into pos.screen_permission_catalog values('config.demo');
    insert into pos.products values('v1','SYNTHETIC-1','v1',null,'[{"talla":"M","stock":10}]',null,1,'A'),
      ('v2','SYNTHETIC-2','v2',5,'[{"talla":"L","stock":5}]',null,1,'A');
    insert into pos.clients select 'historic-'||n,false,now()-interval '1 year',0,0,null,1,'old' from generate_series(1,13) n;
    insert into pos.clients values('generic',true,null,1,100,current_date,1,'A');
    insert into pos.sales values('SYNTHETIC-SALE','operation-sale','Pagado');
    insert into pos.sale_items values(1,'SYNTHETIC-SALE','v1','SYNTHETIC-1','M',2);
    insert into pos.sale_payments values('payment','SYNTHETIC-SALE',100);
    insert into pos.returns values('return','SYNTHETIC-SALE');
    insert into pos.return_items values(1,'return','v1','SYNTHETIC-1','M',1);
    insert into pos.exchanges values('exchange','SYNTHETIC-SALE');
    insert into pos.exchange_items values(1,'exchange','SYNTHETIC-1','M',1,'devuelto');
    insert into pos.loan_documents values('loan');
    insert into pos.movements values(1,'Venta'),(2,'Ajuste');
    insert into pos.liquidations values('liquidation','comision'),('closing','corte');
    insert into pos.commission_adjustments values('15900000-0000-4000-8000-000000000002');
    insert into pos.reference_reclassifications values('reclassification',null,null);
    insert into pos.physical_card_redemptions values('SYNTHETIC-SALE');
    insert into pos.stock_reservations values('reservation','SYNTHETIC-SALE','[{"product_id":"v1","talla":"M","qty":2}]');
    insert into pos.sale_commits values('sale-commit'); insert into pos.return_commits values('return-commit');
    insert into pos.exchange_commits values('exchange-commit'); insert into pos.layaway_liquidation_commits values('layaway-commit');
    insert into pos.folio_counters values('V',current_date);
    insert into pos.barcode_aliases(alias_code,product_id,contract_version,source,operation_id)
      values('H160-LEGACY','v2',2,'h133-migration','16000000-0000-4000-8000-000000000001');
    insert into pos.inventory_v1_v2_map(source_v1_product_id,size_scale,raw_size_value,target_v2_product_id,source_stock,operation_id)
      values('v1','alpha','M','v2',10,'16000000-0000-4000-8000-000000000001');`);
  setupComplete = true;

  if (!setupOnly) {
  await scenario('retired equipment with 0/0 does not block the active clean fleet', async () => {
    const p = await preview(); assert.equal(p.queue_pending, 0); assert.equal(p.active_locks, 0);
    assert.equal(p.sync_complete, true); assert.equal(p.unsynchronized_devices, 0);
  });
  await scenario('retired pending evidence remains intact without counting as active fleet', async () => {
    await db.exec("update pos.sync_devices set queue_pending=7,queue_blocked=2 where device_id='retired'");
    const p = await preview(); assert.equal(p.queue_pending, 0); assert.equal(p.active_locks, 0); assert.equal(p.sync_complete, true);
    assert.deepEqual((await db.query("select status,queue_pending,queue_blocked from pos.sync_devices where device_id='retired'")).rows[0],
      { status: 'revoked', queue_pending: 7, queue_blocked: 2 });
  });
  for (const [name, update] of [['offline',"status='offline'"],['requires reconstruction',"status='must_rebootstrap'"],
    ['old heartbeat',"last_seen_at=now()-interval '3 minutes'"],['old epoch','data_epoch=7'],['pending operations','queue_pending=1'],['blocked operations','queue_blocked=1']]) {
    await scenario('active equipment remains blocked with ' + name, async () => {
      await cleanFleet(); await db.exec("update pos.sync_devices set " + update + " where device_id='A'");
      const p = await preview(); assert.equal(p.sync_complete, false); await denied(() => backup(p), 'point_zero_not_synchronized');
    });
  }
  await scenario('thirteen historical client tombstones are not current clients', async () => {
    const p = await preview(); assert.equal(p.counts.clientes, 0);
    assert.equal(Number(await scalar('select count(*) from pos.clients where generic is not true')), 13);
    const payload = await scalar('select pos.point_zero_payload()'); assert.equal(payload.clients.length, 13, 'backup preserves historical evidence');
  });
  await scenario('backup contains all inventory and operation families and changes no business rows', async () => {
    await cleanFleet(); const p = await preview(); const before = await preserved();
    const payload = await scalar('select pos.point_zero_payload()'); const b = await backup(p);
    assert.equal(b.ok, true); assert.deepEqual(b.document.payload, payload); assert.equal(b.payload_hash, p.snapshot_hash);
    assert.equal(await preserved(), before); assert.deepEqual(await scalar('select pos.point_zero_payload()'), payload);
    assert.equal(Object.keys(payload).length, 23); assert.ok(Object.values(payload).every(rows => rows.length > 0));
  });
  await scenario('production, admin and capability guards remain enforced', async () => {
    await cleanFleet(); const p = await preview();
    await db.exec("update pos.system_manifest set system_mode='production' where singleton");
    await denied(() => backup(p), 'point_zero_production_locked');
    await db.exec("set local h159.admin='false'"); await denied(preview, 'point_zero_requires_admin');
    await db.exec("set local h159.admin='true'; set local h159.capability='false'"); await denied(preview, 'point_zero_requires_admin');
  });
  await scenario('exact confirmation and matching backup/preview are mandatory', async () => {
    await cleanFleet(); const p = await preview(); const b = await backup(p);
    await denied(() => execute(p,b,'bad-phrase','PUNTO CERO '), 'point_zero_confirmation_required');
    await denied(() => execute(p,{ backup_id: '15900000-0000-4000-8000-000000000099' }), 'point_zero_backup_mismatch');
    await db.exec("update pos.sale_payments set monto=101 where id='payment'");
    await denied(() => backup(p), 'point_zero_preview_changed'); await denied(() => execute(p,b), 'point_zero_preview_changed');
  });
  await scenario('real purge and execute succeed with tombstones, preserve protected data and are idempotent', async () => {
    await cleanFleet();
    await db.exec("insert into pos.clients values('active-test',false,null,1,100,current_date,1,'A')");
    const before = await preserved(); const p = await preview(); const b = await backup(p); const result = await execute(p,b);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.preserved_hash,before); assert.equal(await preserved(),before);
    assert.ok(Object.entries(result.counts_after).filter(([key]) => !['cola','bloqueos'].includes(key)).every(([,value]) => Number(value)===0));
    assert.equal(Number(await scalar('select count(*) from pos.products')),0);
    assert.equal(Number(await scalar('select count(*) from pos.clients where generic is not true and deleted_at is not null')),14);
    assert.equal(Number(await scalar('select count(*) from auth.users')),1);
    assert.equal(Number(await scalar('select count(*) from pos.settings where key<>\'_resetMark\'')),6);
    assert.equal((await execute(p,b)).idempotent,true);
    const receipt = await scalar("select pos.point_zero_receipt('h159-operation')"); assert.equal(receipt.status,'completed');
    assert.equal(receipt.backup_id,b.backup_id);
  });
  await scenario('preservation failure rolls back inventory, operations and configuration together', async () => {
    await cleanFleet(); const before = await preserved(); const payload = await scalar('select pos.point_zero_payload()');
    await db.exec(`create function pos.h159_injected_corruption() returns trigger language plpgsql as $$begin
      update pos.settings set value='"INJECTED CORRUPTION"' where key='logo'; return old; end$$;
      create trigger h159_injected_corruption after delete on pos.products for each statement execute function pos.h159_injected_corruption();`);
    const p = await preview(); const b = await backup(p); const result = await execute(p,b,'forced-failure');
    assert.equal(result.ok,false); assert.equal(result.rolled_back,true); assert.equal(result.error,'point_zero_preserved_data_changed');
    assert.equal(await preserved(),before); assert.deepEqual(await scalar('select pos.point_zero_payload()'),payload);
    assert.equal(Number(await scalar('select count(*) from pos.test_data_purges')),0);
  });
  await scenario('empty operation screens with orphan commits still back up and purge all residual authorities', async () => {
    // Current reported shape: no commercial operations; inventory, historical
    // client tombstones, orphan commits, redemption and folios still exist.
    for (const table of ['sales','sale_items','sale_payments','returns','return_items','exchanges',
      'exchange_items','loan_documents','movements','liquidations','commission_adjustments',
      'reference_reclassifications','stock_reservations','return_commits']) await db.exec('delete from pos.' + table);
    await db.exec("insert into pos.sale_commits values('orphan-2'),('orphan-3'); insert into pos.folio_counters select 'SYNTHETIC-'||n,current_date from generate_series(1,29) n");
    const before = await preserved(); const p = await preview();
    for (const count of ['ventas','apartados','sale_items','pagos','devoluciones','return_items','cambios','exchange_items','prestamos','movimientos']) assert.equal(p.counts[count],0);
    assert.equal(p.counts.sale_commits,3); assert.equal(p.counts.exchange_commits,1);
    assert.equal(p.counts.layaway_liquidation_commits,1); assert.equal(p.counts.folio_counters,30);
    const b = await backup(p); assert.equal(b.document.payload.sale_commits.length,3);
    assert.equal(b.document.payload.clients.length,13); assert.equal(b.document.payload.physical_card_redemptions.length,1);
    const result = await execute(p,b,'residual-only'); assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(await preserved(),before);
    assert.ok(Object.entries(result.counts_after).filter(([key]) => !['cola','bloqueos'].includes(key)).every(([,value]) => Number(value)===0));
    const after = await scalar('select pos.point_zero_payload()');
    assert.ok(Object.entries(after).every(([key,rows]) => key==='clients' ? rows.length===13 : rows.length===0));
    assert.equal(await scalar("select status from pos.sync_devices where device_id='retired'"),'revoked');
  });
  }
} finally {
  if (!setupOnly || !setupComplete) await db.close();
  if (!setupOnly) {
  const report = { baseline, certification: 'Isolated SQL behavior only; no real Supabase A/B/C or RLS certification',
    sources: definitions, passed: checks.filter(check => check.passed).length, total: checks.length, checks };
  if (process.env.BALAM_H159_SQL_OUTPUT) fs.writeFileSync(process.env.BALAM_H159_SQL_OUTPUT, JSON.stringify(report,null,2));
  console.log(`H159 SQL: ${report.passed}/${report.total}`);
  if (checks.some(check => !check.passed)) process.exitCode=1;
  }
}

export { db, scalar, preview, backup, execute, preserved, denied, cleanFleet, definitions };
