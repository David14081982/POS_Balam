// Real PostgreSQL execution in an isolated, in-memory PGlite instance.
// No network, production data, Supabase CLI, disk database, or role changes remotely.
// Auth/recovery entry guards below are explicit test doubles; RPCs, inventory
// triggers, optimistic versions, SQL idempotency and STORE ACK are production code.
// BALAM_PGLITE_MODULE may point to an existing @electric-sql/pglite/dist/index.js.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.BALAM_PGLITE_MODULE
  ? pathToFileURL(process.env.BALAM_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const baseline = process.argv.includes('--baseline');
const versionProbe = process.argv.includes('--version-probe');
const versionFixed = process.argv.includes('--version-fixed');
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`);
};
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = file => read('supabase/migrations/' + file);
function functionSql(text, name) {
  const re = new RegExp('create (?:or replace )?function pos\\.' + name + '\\(', 'i');
  const start = text.search(re);
  if (start < 0) throw new Error('Missing actual function: ' + name);
  const tail = text.slice(start);
  const body = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
  if (!body) throw new Error('Missing function body: ' + name);
  const end = tail.indexOf(body[1], body.index + body[0].length);
  if (end < 0) throw new Error('Unclosed function: ' + name);
  return tail.slice(0, end + body[1].length) + ';';
}
const store = read('balam/store.jsx');
const mapExpression = '({' + store.slice(store.indexOf("table: 'products', conflict"),
  store.indexOf('\n    },\n    clients:', store.indexOf('const MAP ='))) + '})';
const map = new Function('window', 'return ' + mapExpression)({ CORE: { getDeviceId: () => 'h155-local-only' } });
const ackSource = store.slice(store.indexOf('  function confirmedWriteRows('),
  store.indexOf('  function protectQueuedWritesAfterConflict('));
const acknowledge = new Function(ackSource + '\nreturn confirmedWriteRows;')();
let sequence = 100;
const nextId = () => '15500000-0000-4000-8000-' + String(++sequence).padStart(12, '0');
const sql = route => route === 'family'
  ? 'select pos.commit_reference_family_batch($1,$2,$3,3,8) result'
  : 'select pos.save_products_checked_v2($1,$2,3,8) result';
const args = (route, op, family, rows) => route === 'family'
  ? [op, family, JSON.stringify(rows)] : [op, JSON.stringify(rows)];
const call = async (route, op, family, rows) =>
  (await db.query(sql(route), args(route, op, family, rows))).rows[0].result;
const resultRows = (route, result) => route === 'family' ? result.rows : result;
const current = async id => (await db.query('select * from pos.products where id=$1', [id])).rows[0];
const fingerprint = async () => JSON.stringify((await db.query(`select
  (select jsonb_agg(to_jsonb(p) order by id) from pos.products p) products,
  (select jsonb_agg(to_jsonb(a) order by operation_id) from pos.capability_operation_audit a) audit`)).rows[0]);
const denies = async (name, fn, expected) => {
  const before = await fingerprint(); let error;
  try { await fn(); } catch (e) { error = e; }
  const matched = typeof expected === 'string' ? error?.message === expected : error?.code === expected.code;
  check(name, matched && await fingerprint() === before,
    !matched ? { actual: error?.message || 'accepted', expected } : undefined);
};
async function fixture(route, options = {}) {
  const id = nextId(), family = options.family || nextId();
  const size = options.size || '38';
  const stock = options.stock ?? 2;
  const code = (await db.query('select pos.h133_barcode_v3_from_id($1) code', [id])).rows[0].code;
  const row = { id, cat: '1', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: 'H155',
    nombre: 'SYNTHETIC H155', orn: 'BEL', orn_colors: ['VNO', 'DRO'], precio: 100, costo: 50,
    pop: false, stock: [{ talla: size, escala: 'N', stock }], imagen: null, sku: 'H155-' + id,
    barcode_urls: {}, attrs: { __sizeCategoryId: 'size_number', corte: 'REG' }, precios_talla: {},
    sync_base_version: 0, sync_device_id: 'h155-local-only', record_model: 'v2',
    size_category_id: 'size_number', size_code: size, size_scale: 'N', stock_quantity: stock,
    barcode_code: code, barcode_contract: 3, barcode_aliases: [], ornament_color_codes: ['VNO', 'DRO'],
    physical_signature: JSON.stringify([['color', 'BL'], ['ornament_color', ['DRO', 'VNO']], ['size', size]]),
    reference_family_id: family };
  await call(route, nextId(), family, [row]);
  return { id, family, row: await current(id) };
}

try {
  await db.exec(`create schema pos; create schema auth; create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql as $$select '15500000-0000-4000-8000-000000000099'::uuid$$;
    create function pos.require_current_capability(text) returns void language plpgsql as $$begin
      if current_setting('h155.denied',true)='true' then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
    end$$;
    create function pos.assert_sync_write_context(integer,bigint) returns void language plpgsql as $$begin
      if $1<>3 or $2<>8 then raise exception 'SYNC_CONTEXT_INVALID'; end if;
    end$$;
    create function pos.assert_device_recovery_write(text,text[]) returns void language plpgsql as $$begin
      if current_setting('h155.recovery_denied',true)='true' then raise exception 'DEVICE_RECOVERY_REQUIRED'; end if;
    end$$;
    create table pos.inventory_contract_state(singleton boolean,enforced boolean);
    insert into pos.inventory_contract_state values(true,true);
    create table pos.products(id text primary key,cat text not null,manga text not null,tela text not null,
      color text not null,cuello text,modelo text not null,nombre text not null,orn text,orn_colors jsonb,
      precio numeric(12,2),costo numeric(12,2),pop boolean,stock jsonb,imagen text,sku text,barcode_urls jsonb,
      attrs jsonb,precios_talla jsonb,sync_base_version bigint,sync_device_id text,sync_version bigint default 1,
      updated_at timestamptz,record_model text,size_category_id text,size_code text,size_scale text,
      stock_quantity integer,barcode_code text,ornament_color_codes jsonb,physical_signature text,
      physical_identity_locked boolean default false,reference_family_id uuid,barcode_contract smallint,
      barcode_aliases jsonb not null default '[]',deleted_at timestamptz);
    create table pos.capability_operation_audit(operation_id uuid primary key,capability_key text,
      actor_user_id uuid,subject_key text,payload_hash text,result jsonb);
    create table pos.sync_conflicts(entity text,entity_id text,operation text,expected_version bigint,
      actual_version bigint,attempted jsonb,current_row jsonb,device_id text);
    create table pos.sale_items(product_id text); create table pos.return_items(product_id text);
    create table pos.exchange_items(product_id text); create table pos.movements(product_id text);
    create table pos.reference_reclassifications(source_product_id text,target_product_id text);`);
  const h94 = migration('20260810013400_pos_h94_reference_model_v2.sql');
  const h101 = migration('20260814014300_pos_h101_reference_families.sql');
  const h133 = migration('20260830017200_pos_h133_inventory_v3_contract.sql');
  const h149 = migration('20260908018400_pos_h149_directed_recovery.sql');
  for (const [source, name] of [[h94, 'save_products_checked'], [h101, 'h101_ensure_reference_family'],
    [h133, 'h133_internal_enabled'], [h133, 'guard_entity_version'], [h133, 'h94_guard_used_reference_identity'],
    [h94, 'h94_sync_v2_stock_shape'], [h133, 'h133_guard_operational_inventory'],
    [migration('20260830017250_pos_h133_barcode_entropy_fix.sql'), 'h133_barcode_v3_from_id']]) {
    await db.exec(functionSql(source, name));
  }
  await db.exec(functionSql(h101, 'commit_reference_family_batch')
    .replace('pos.commit_reference_family_batch(', 'pos.commit_reference_family_batch_h101_internal('));
  await db.exec(functionSql(h149, 'commit_reference_family_batch'));
  await db.exec(functionSql(h149, 'save_products_checked_v2'));
  await db.exec(migration('20260905017600_pos_h138_registration_v3.sql'));
  await db.exec(`create trigger h101_ensure_reference_family before insert or update of record_model,reference_family_id
      on pos.products for each row execute function pos.h101_ensure_reference_family();
    create trigger h133_guard_operational_inventory before insert or update of id,record_model,barcode_code,barcode_contract,barcode_aliases,deleted_at
      on pos.products for each row execute function pos.h133_guard_operational_inventory();
    create trigger h94_guard_used_reference_identity before update on pos.products
      for each row execute function pos.h94_guard_used_reference_identity();
    create trigger h94_sync_v2_stock_shape before insert or update on pos.products
      for each row execute function pos.h94_sync_v2_stock_shape();
    create trigger products_guard_entity_version before insert or update on pos.products
      for each row execute function pos.guard_entity_version();`);
  if (versionProbe) {
    // Isolate a pre-existing INSERT/ON CONFLICT version failure, with NO H155 migration.
    if (versionFixed) await db.exec(migration('20260911020200_pos_h155_inventory_base_version.sql'));
    for (const route of ['single', 'family']) {
      const f = await fixture(route, { stock: 5 });
      const oldSnapshot = map.toRow(map.fromRow(f.row));
      const a = { ...oldSnapshot, stock_quantity: 4,
        stock: [{ talla: oldSnapshot.size_code, escala: oldSnapshot.size_scale, stock: 4 }] };
      await call(route, nextId(), f.family, [a]);
      const beforeB = await current(f.id);
      await db.query('update pos.products set precio=105,sync_base_version=$1 where id=$2',
        [oldSnapshot.sync_base_version, f.id]);
      const direct = await current(f.id);
      check(route + ': direct UPDATE preserves A against obsolete version',
        Number(direct.stock_quantity) === 4 && Number(direct.precio) === 100
          && Number(direct.sync_version) === Number(beforeB.sync_version));
      const b = { ...oldSnapshot, precio: 105 };
      const result = await call(route, nextId(), f.family, [b]);
      const afterB = await current(f.id);
      check(route + ': obsolete commercial UPSERT cannot restore A stock',
        Number(afterB.stock_quantity) === 4 && Number(afterB.precio) === 100, {
          ornamentOrderFixApplied: false, baseVersionFixApplied: versionFixed,
          originalStock: 5, stockAfterA: Number(beforeB.stock_quantity),
          aVersion: Number(beforeB.sync_version), bBaseVersion: b.sync_base_version,
          stockAfterObsoleteB: Number(afterB.stock_quantity), priceAfterObsoleteB: Number(afterB.precio),
          finalVersion: Number(afterB.sync_version),
          ackContentMatches: acknowledge(map, resultRows(route, result), [b])[0]._syncAccepted,
          ackVersionMatches: Number(afterB.sync_version) === b.sync_base_version + 1,
        });
    }
  } else {
  if (!baseline) {
    await db.exec(migration('20260911020000_pos_h155_ornament_order.sql'));
    await db.exec(migration('20260911020200_pos_h155_inventory_base_version.sql'));
  }

  for (const route of ['single', 'family']) {
    const f = await fixture(route);
    const sent = map.toRow(map.fromRow(f.row));
    sent.precio = 101;
    // Same normalization made by DATA.hydrate; the physical signature is unchanged.
    sent.ornament_color_codes = ['DRO', 'VNO']; sent.orn_colors = ['DRO', 'VNO'];
    const editId = nextId(); let result, error;
    try { result = await call(route, editId, f.family, [sent]); } catch (e) { error = e; }
    check(route + ': price-only edit with reordered colors commits', !error,
      error ? { code: error.code, message: error.message } : undefined);
    if (error) continue;
    const saved = await current(f.id), returned = resultRows(route, result);
    check(route + ': returned NEW matches exact submitted color order',
      JSON.stringify(saved.ornament_color_codes) === JSON.stringify(sent.ornament_color_codes));
    check(route + ': actual STORE ACK accepts the confirmed write',
      acknowledge(map, returned, [sent])[0]._syncAccepted === true && Number(saved.sync_version) === 2);
    const immutable = ['id', 'barcode_code', 'reference_family_id', 'physical_signature', 'attrs', 'stock',
      'stock_quantity', 'barcode_aliases', 'physical_identity_locked', 'size_code', 'size_category_id'];
    check(route + ': identity, history attributes and stock preserved',
      immutable.every(k => JSON.stringify(saved[k]) === JSON.stringify(f.row[k])) && Number(saved.precio) === 101);
    const beforeRetry = await fingerprint();
    const repeated = await call(route, editId, f.family, [sent]);
    check(route + ': lost ACK retries immutable payload once',
      JSON.stringify(repeated) === JSON.stringify(result) && await fingerprint() === beforeRetry
        && acknowledge(map, resultRows(route, repeated), [sent])[0]._syncAccepted === true);
    await denies(route + ': operation ID cannot adopt a different payload',
      () => call(route, editId, f.family, [{ ...sent, precio: 102 }]), 'INVENTORY_OPERATION_CONFLICT');
    const latest = map.toRow(map.fromRow(saved));
    await denies(route + ': changing colors still requires reclassification',
      () => call(route, nextId(), f.family, [{ ...latest, ornament_color_codes: ['DRO', 'AZ'] }]),
      'REFERENCE_RECLASSIFICATION_REQUIRED');
    await denies(route + ': valid permutation cannot hide another physical change',
      () => call(route, nextId(), f.family, [{ ...latest, color: 'NEG', ornament_color_codes: ['VNO', 'DRO'] }]),
      'REFERENCE_RECLASSIFICATION_REQUIRED');
    const beforeStale = await current(f.id);
    const stale = { ...latest, precio: 999, sync_base_version: 0 };
    const staleResult = await call(route, nextId(), f.family, [stale]);
    check(route + ': actual optimistic version guard keeps stale write unaccepted',
      JSON.stringify(await current(f.id)) === JSON.stringify(beforeStale)
        && acknowledge(map, resultRows(route, staleResult), [stale])[0]._syncAccepted === false);
    const sibling = await fixture(route, { family: f.family, size: '40' });
    const good = { ...map.toRow(map.fromRow(await current(f.id))), precio: 777 };
    const bad = { ...map.toRow(map.fromRow(sibling.row)), color: 'NEG' };
    await denies(route + ': one invalid reference rolls back the complete batch',
      () => call(route, nextId(), f.family, [good, bad]), 'REFERENCE_RECLASSIFICATION_REQUIRED');
    await denies(route + ': duplicate IDs cannot choose an arbitrary original base',
      () => call(route, nextId(), f.family, [good, good]),
      route === 'family' ? 'PRODUCT_SCOPE_INVALID' : { code: '21000' });
    await denies(route + ': malformed base remains a typed SQL error without effects',
      () => call(route, nextId(), f.family, [{ ...good, sync_base_version: 'not-a-bigint' }]),
      { code: '22P02' });
    const mixedBases = [
      { ...map.toRow(map.fromRow(sibling.row)), precio: 222 },
      { ...map.toRow(map.fromRow(await current(f.id))), precio: 111 },
    ];
    const mixedResult = resultRows(route, await call(route, nextId(), f.family, mixedBases));
    check(route + ': multirow payload resolves each base by exact ID',
      mixedBases.every(sentRow => {
        const remote = mixedResult.find(row => row.id === sentRow.id);
        return Number(remote.sync_version) === sentRow.sync_base_version + 1
          && Number(remote.precio) === sentRow.precio && Number(remote.stock_quantity) === sentRow.stock_quantity;
      }) && acknowledge(map, mixedResult, mixedBases).every(row => row._syncAccepted));
    const legacy = map.toRow(map.fromRow(await current(f.id)));
    const beforeLegacyVersion = legacy.sync_base_version;
    delete legacy.sync_base_version;
    await call(route, nextId(), f.family, [{ ...legacy, precio: 112 }]);
    await call(route, nextId(), f.family, [{ ...legacy, sync_base_version: null, precio: 113 }]);
    const afterLegacy = await current(f.id);
    check(route + ': absent and explicit NULL retain existing legacy behavior',
      Number(afterLegacy.sync_version) === beforeLegacyVersion + 2 && Number(afterLegacy.precio) === 113
        && Number(afterLegacy.stock_quantity) === legacy.stock_quantity);
    await db.exec("set h155.denied='true'");
    await denies(route + ': existing capability entry guard remains invoked',
      () => call(route, nextId(), f.family, [latest]), 'PERMISSION_DENIED');
    await db.exec("set h155.denied='false'; set h155.recovery_denied='true'");
    await denies(route + ': directed recovery entry guard remains invoked',
      () => call(route, nextId(), f.family, [latest]), 'DEVICE_RECOVERY_REQUIRED');
    await db.exec("set h155.recovery_denied='false'");
  }
  if (!baseline) {
    for (const table of ['sale_items', 'return_items', 'exchange_items', 'movements', 'reference_reclassifications']) {
      const f = await fixture('single', { stock: 0 });
      const column = table === 'reference_reclassifications' ? 'source_product_id' : 'product_id';
      await db.query(`insert into pos.${table}(${column}) values($1)`, [f.id]);
      await denies('history alone protects identity: ' + table,
        () => call('single', nextId(), f.family, [{ ...map.toRow(map.fromRow(f.row)), color: 'NEG' }]),
        'REFERENCE_RECLASSIFICATION_REQUIRED');
    }
    await db.exec(migration('20260911020100_pos_h155_verify_ornament_order.sql'));
    check('behavioral verification runs against actual trigger and removes temporary rows',
      (await db.query("select to_regclass('pg_temp.h155_ornament_probe') probe")).rows[0].probe === null);
    await db.exec(migration('20260911020300_pos_h155_verify_inventory_base_version.sql'));
    check('version verification exercises installed assignments with no persistent fixtures',
      (await db.query("select to_regclass('pg_temp.h155_version_probe') probe,to_regclass('pg_temp.h155_version_conflicts') conflicts,to_regprocedure('pg_temp.h155_version_probe_guard()') guard")).rows
        .every(row => row.probe === null && row.conflicts === null && row.guard === null));
    const beforeDrift = (await db.query("select prosrc from pg_proc where oid='pos.h94_guard_used_reference_identity()'::regprocedure")).rows[0].prosrc;
    let drift;
    try { await db.exec(migration('20260911020000_pos_h155_ornament_order.sql')); } catch (e) { drift = e; await db.exec('rollback'); }
    check('source drift fails closed without replacing any guard', drift?.message === 'H155_IDENTITY_GUARD_SOURCE_DRIFT'
      && (await db.query("select prosrc from pg_proc where oid='pos.h94_guard_used_reference_identity()'::regprocedure")).rows[0].prosrc === beforeDrift);
    let versionDrift;
    try { await db.exec(migration('20260911020200_pos_h155_inventory_base_version.sql')); }
    catch (e) { versionDrift = e; await db.exec('rollback'); }
    check('both inventory RPCs fail closed against unexpected source drift',
      versionDrift?.message.startsWith('H155_INVENTORY_VERSION_SOURCE_DRIFT:'));
  }
  }
} catch (error) {
  check('SQL execution completes', false, { message: error.message, detail: error.detail });
} finally {
  await db.close();
}
console.log(`H155 ornament SQL ${versionProbe ? 'EXISTING VERSION PROBE' : baseline ? 'BASELINE' : 'CURRENT'}: ${checks.filter(c => c.ok).length}/${checks.length}`);
process.exitCode = checks.some(c => !c.ok) ? 1 : 0;
