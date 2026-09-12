// H-160: real H133 RESTRICT tables/immutable trigger and Punto Cero functions.
// In-memory PostgreSQL only. H159 supplies synthetic business rows and explicit
// auth/notification doubles; these checks do not certify remote RLS or A/B/C.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const baseline = process.argv.includes('--baseline');
const previousSetup = process.env.BALAM_H159_SETUP_ONLY;
const previousMax = process.env.BALAM_SQL_MIGRATION_MAX;
process.env.BALAM_H159_SETUP_ONLY = '1';
process.env.BALAM_SQL_MIGRATION_MAX = '20260911020500';
let fixture;
try { fixture = await import('./test-h159-point-zero-sql.mjs'); }
finally {
  if (previousSetup === undefined) delete process.env.BALAM_H159_SETUP_ONLY;
  else process.env.BALAM_H159_SETUP_ONLY = previousSetup;
  if (previousMax === undefined) delete process.env.BALAM_SQL_MIGRATION_MAX;
  else process.env.BALAM_SQL_MIGRATION_MAX = previousMax;
}
const { db, scalar, preview, backup, execute, preserved, denied, definitions } = fixture;
const checks = [];
const migrationFile = 'supabase/migrations/20260911020600_pos_h160_point_zero_inventory_links.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const payload = () => scalar('select pos.point_zero_payload()');
const links = () => scalar(`select jsonb_build_object(
  'aliases',(select jsonb_agg(to_jsonb(x) order by alias_code) from pos.barcode_aliases x),
  'map',(select jsonb_agg(to_jsonb(x) order by source_v1_product_id,size_scale,raw_size_value) from pos.inventory_v1_v2_map x))`);
async function counts() {
  return (await db.query(`select (select count(*)::int from pos.products) products,
    (select count(*)::int from pos.barcode_aliases) aliases,
    (select count(*)::int from pos.inventory_v1_v2_map) mappings`)).rows[0];
}
async function scenario(name, run) {
  await db.exec('begin');
  try {
    const evidence = await run(); checks.push({ name, passed: true, evidence }); console.log('PASS ' + name);
  } catch (error) {
    checks.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message);
  } finally { await db.exec('rollback'); }
}
async function removeAliasesForFixture() {
  await db.exec(`select set_config('pos.h133_internal','on',true);
    delete from pos.barcode_aliases; select set_config('pos.h133_internal','',true)`);
}
async function complete(operation) {
  const p = await preview(); const b = await backup(p); const result = await execute(p,b,operation);
  assert.equal(result.ok, true, JSON.stringify(result));
  return { p, b, result };
}

try {
  await scenario('pre-H160 real alias FK reproduces failure and full rollback', async () => {
    const before = await payload(), beforeLinks = await links(), hash = await preserved();
    const p = await preview(), b = await backup(p), result = await execute(p,b,'h160-baseline-alias');
    assert.equal(result.ok,false); assert.equal(result.rolled_back,true);
    assert.match(result.error,/barcode_aliases_product_id_fkey/);
    assert.deepEqual(await payload(),before); assert.deepEqual(await links(),beforeLinks);
    assert.equal(await preserved(),hash); assert.deepEqual(await counts(),{products:2,aliases:1,mappings:1});
    assert.equal(Number(await scalar('select count(*) from pos.test_data_purges')),0);
    return { error: result.error, rolledBack: true, beforeAndAfter: await counts() };
  });
  await scenario('pre-H160 map FK independently rejects deletion without aliases', async () => {
    await removeAliasesForFixture();
    const before = await payload(), beforeLinks = await links(), hash = await preserved();
    const p = await preview(), b = await backup(p), result = await execute(p,b,'h160-baseline-map');
    assert.equal(result.ok,false); assert.equal(result.rolled_back,true);
    assert.match(result.error,/inventory_v1_v2_map_target_v2_product_id_fkey/);
    assert.deepEqual(await payload(),before); assert.deepEqual(await links(),beforeLinks);
    assert.equal(await preserved(),hash); assert.deepEqual(await counts(),{products:2,aliases:0,mappings:1});
    return { error: result.error, rolledBack: true };
  });

  // Apply the delivered migration, including both drift guards, in the actual
  // interpreter. The baseline functions above come from H98/H154/H159 sources.
  if (!baseline) await db.exec(migration);

  await scenario('backup seals all 23 families including both inventory dependencies', async () => {
    const before = await payload(), hash = await preserved(), p = await preview(), b = await backup(p);
    assert.equal(Object.keys(b.document.payload).length,23);
    assert.equal(b.document.payload.barcode_aliases[0].alias_code,'H160-LEGACY');
    assert.equal(b.document.payload.inventory_v1_v2_map[0].target_v2_product_id,'v2');
    assert.deepEqual(b.document.payload,before); assert.equal(b.payload_hash,p.snapshot_hash);
    assert.equal(await preserved(),hash); assert.deepEqual(await payload(),before);
    return { families:23,aliases:1,mappings:1,businessUnchanged:true };
  });
  await scenario('successful execution deletes children before products and preserves protected state', async () => {
    const hash = await preserved(); const { p, b, result } = await complete('h160-success');
    assert.deepEqual(await counts(),{products:0,aliases:0,mappings:0});
    assert.equal(await preserved(),hash); assert.equal(result.preserved_hash,hash);
    assert.equal(await scalar("select status from pos.sync_devices where device_id='retired'"),'revoked');
    assert.ok(Object.entries(result.counts_after).filter(([key])=>!['cola','bloqueos'].includes(key)).every(([,value])=>Number(value)===0));
    assert.equal((await execute(p,b,'h160-success')).idempotent,true);
    return { childrenAndProductsZero:true,protectedHashUnchanged:true,retirementPreserved:true,idempotent:true };
  });
  await scenario('failure after child deletion rolls back children, operations and protected data', async () => {
    await db.exec(`set local pos.h133_internal='caller-marker';
      create function pos.h160_corrupt_protected() returns trigger language plpgsql as $$begin
        update pos.settings set value='"H160 CORRUPTION"' where key='logo'; return old; end$$;
      create trigger h160_corrupt_protected after delete on pos.products for each statement execute function pos.h160_corrupt_protected()`);
    const before = await payload(), beforeLinks = await links(), hash = await preserved();
    const p = await preview(), b = await backup(p), result = await execute(p,b,'h160-preservation-failure');
    assert.equal(result.ok,false); assert.equal(result.rolled_back,true);
    assert.equal(result.error,'point_zero_preserved_data_changed');
    assert.deepEqual(await payload(),before); assert.deepEqual(await links(),beforeLinks); assert.equal(await preserved(),hash);
    assert.equal(await scalar("select current_setting('pos.h133_internal',true)"),'caller-marker');
    assert.equal(Number(await scalar('select count(*) from pos.test_data_purges')),0);
    return { childrenRestored:true,protectedHashRestored:true,gucRestored:true };
  });
  await scenario('internal exception is scoped to aliases and restores the caller GUC', async () => {
    await db.exec(`set local pos.h133_internal='caller-marker';
      create function pos.h160_check_internal_scope() returns trigger language plpgsql as $$begin
        if current_setting('pos.h133_internal',true)<>'caller-marker' then raise exception 'H160_INTERNAL_SCOPE_LEAK'; end if;
        return old; end$$;
      create trigger h160_check_internal_scope before delete on pos.products for each row execute function pos.h160_check_internal_scope()`);
    await complete('h160-internal-scope');
    assert.equal(await scalar("select current_setting('pos.h133_internal',true)"),'caller-marker');
    assert.equal(await scalar('select pos.h133_internal_enabled()'),false);
    await db.exec(`insert into pos.products(id,sku,record_model,stock_quantity,stock)
      values('h160-after','H160-AFTER','v2',0,'[]');
      insert into pos.barcode_aliases(alias_code,product_id,contract_version,source,operation_id)
      values('H160-AFTER','h160-after',2,'h133-migration','16000000-0000-4000-8000-000000000002')`);
    await denied(()=>db.exec("delete from pos.barcode_aliases where alias_code='H160-AFTER'"),'BARCODE_ALIAS_IMMUTABLE');
    await denied(()=>db.exec("update pos.barcode_aliases set source='changed' where alias_code='H160-AFTER'"),'BARCODE_ALIAS_IMMUTABLE');
    return { restoredBeforeProducts:true,ordinaryDeleteBlocked:true,ordinaryUpdateBlocked:true };
  });
  await scenario('a caller already using the internal scope keeps its original value', async () => {
    await db.exec("set local pos.h133_internal='on'");
    await complete('h160-prior-internal');
    assert.equal(await scalar("select current_setting('pos.h133_internal',true)"),'on');
    return { callerValueRestored:'on' };
  });
  await scenario('failure while the alias exception is active rolls back data and GUC', async () => {
    await db.exec(`set local pos.h133_internal='off';
      create function pos.h160_fail_alias_delete() returns trigger language plpgsql as $$begin
        raise exception 'H160_INJECTED_ALIAS_FAILURE'; end$$;
      create trigger h160_fail_alias_delete after delete on pos.barcode_aliases for each statement execute function pos.h160_fail_alias_delete()`);
    const before = await payload(), beforeLinks = await links(), hash = await preserved();
    const p = await preview(), b = await backup(p), result = await execute(p,b,'h160-alias-failure');
    assert.equal(result.ok,false); assert.equal(result.rolled_back,true);
    assert.equal(result.error,'H160_INJECTED_ALIAS_FAILURE');
    assert.deepEqual(await payload(),before); assert.deepEqual(await links(),beforeLinks); assert.equal(await preserved(),hash);
    assert.equal(await scalar("select current_setting('pos.h133_internal',true)"),'off');
    assert.equal(await scalar('select pos.h133_internal_enabled()'),false);
    await denied(()=>db.exec("delete from pos.barcode_aliases where alias_code='H160-LEGACY'"),'BARCODE_ALIAS_IMMUTABLE');
    return { childrenRestored:true,gucRestored:'off',ordinaryGuardStillActive:true };
  });
  await scenario('ordinary aliases remain immutable outside Punto Cero', async () => {
    await db.exec("set local pos.h133_internal='off'");
    const before = await links();
    await denied(()=>db.exec("delete from pos.barcode_aliases where alias_code='H160-LEGACY'"),'BARCODE_ALIAS_IMMUTABLE');
    await denied(()=>db.exec("update pos.barcode_aliases set product_id='v1' where alias_code='H160-LEGACY'"),'BARCODE_ALIAS_IMMUTABLE');
    assert.deepEqual(await links(),before);
    return { updateBlocked:true,deleteBlocked:true };
  });
  await scenario('map-only inventory also completes without an alias row', async () => {
    await removeAliasesForFixture(); const hash = await preserved();
    const { b } = await complete('h160-map-only');
    assert.equal(b.document.payload.barcode_aliases.length,0);
    assert.equal(b.document.payload.inventory_v1_v2_map.length,1);
    assert.deepEqual(await counts(),{products:0,aliases:0,mappings:0}); assert.equal(await preserved(),hash);
    return { aliasesBefore:0,mappingsBefore:1,childrenAndProductsAfter:0 };
  });
  await scenario('changes to either dependency invalidate the previous backup token', async () => {
    const aliasPreview = await preview();
    await db.exec(`select set_config('pos.h133_internal','on',true);
      update pos.barcode_aliases set source='h133-restored'; select set_config('pos.h133_internal','',true)`);
    await denied(()=>backup(aliasPreview),'point_zero_preview_changed');
    const mapPreview = await preview();
    await db.exec('update pos.inventory_v1_v2_map set source_stock=source_stock+1');
    await denied(()=>backup(mapPreview),'point_zero_preview_changed');
    return { aliasChangeInvalidates:true,mapChangeInvalidates:true };
  });
} finally {
  await db.close();
  const report = { baseline, certification:'Isolated PostgreSQL behavior; no real Supabase/RLS/A/B/C certification',
    migration:migrationFile,migrationSHA256:createHash('sha256').update(migration).digest('hex'),
    baselineSources:definitions,passed:checks.filter(check=>check.passed).length,total:checks.length,checks };
  if (process.env.BALAM_H160_SQL_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.BALAM_H160_SQL_OUTPUT),{recursive:true});
    fs.writeFileSync(process.env.BALAM_H160_SQL_OUTPUT,JSON.stringify(report,null,2)+'\n');
  }
  console.log(`H160 SQL: ${report.passed}/${report.total}`);
  if (checks.some(check=>!check.passed)) process.exitCode=1;
}
