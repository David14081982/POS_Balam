// Synthetic PGlite only: no Supabase, no network, no live gate changes.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, recordedSnapshotCatalog, buildLiveSnapshotSql } from './h171-live-snapshot.mjs';
import { buildLiveCleanupSql, cleanupRowsFingerprint } from './h171-live-cleanup-sql.mjs';

const read = async path => JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const authorityAudit = await read('docs/fixes/evidence/h171/authority-audit-before.json');
const cleanupCatalog = await read('docs/fixes/evidence/h171/cleanup-catalog-before.json');
const audit = authorityAudit.rows?.[0]?.report || authorityAudit;
const catalog = recordedSnapshotCatalog({ authorityAudit, cleanupCatalog });
const sourceUrl = `https://api.supabase.com/v1/projects/${SNAPSHOT_PROJECT}/database/query`;
const run = '11111111-1111-4111-8111-111111111111', actorId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333', deviceId = 'local-H171-device';
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const rows = snapshot => snapshot.tables.flatMap(t => t.rows.map(row => ({ table: t.table, ...row })));
const checks = [];
const checked = (name, fn) => test(name, async () => { try { await fn(); checks.push({ name, status: 'PASS' }); }
  catch(error) { delete error.query; throw error; } });
function defaultValue(column) {
  if (!column.not_null) return 'NULL';
  if (column.type === 'text') return "'local fixture'";
  if (column.type === 'uuid') return q(requestId) + '::uuid';
  if (column.type === 'boolean') return 'true';
  if (column.type === 'jsonb') return "'[]'::jsonb";
  if (column.type === 'text[]') return "'{}'::text[]";
  if (column.type === 'date') return "DATE '2026-09-12'";
  if (column.type === 'timestamp with time zone') return "TIMESTAMPTZ '2026-09-12 13:14:15.123456+00'";
  return '0';
}
async function database(fn, { extraSetup = '', zeroScope = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA pos;CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
      INSERT INTO auth.users VALUES('${SNAPSHOT_ACTOR}','{}','{}')${zeroScope ? '' : `,('${actorId}','{"balam_online_test":"${run}"}','{}')`};
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
      CREATE FUNCTION pos.can_manage_screen_permissions(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${SNAPSHOT_ACTOR}'::uuid$$;
      CREATE FUNCTION pos.assert_permission_admin_survives() RETURNS void LANGUAGE plpgsql AS $$BEGIN
       IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${SNAPSHOT_ACTOR}') THEN RAISE EXCEPTION 'LAST_ADMIN'; END IF;
      END$$;`);
    await db.exec(catalog.map(t => `CREATE TABLE pos.${t.table}(${t.columns.map(c =>
      `"${c.name}" ${c.type}${c.not_null ? ' NOT NULL' : ''}`).join(',')},PRIMARY KEY(${t.pk.map(q => '"' + q + '"').join(',')}));`).join('\n'));
    await db.exec(audit.foreign_keys.filter(fk => fk.source.startsWith('pos.')).map(fk =>
      `ALTER TABLE ${fk.source} ADD CONSTRAINT ${fk.constraint} ${fk.definition};`).join('\n'));
    await db.exec(`CREATE FUNCTION pos.h166_advance_snapshot_revision() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      UPDATE pos.online_snapshot_revision SET revision=revision+1 WHERE singleton;RETURN NULL;END$$;
      ${['clients','products','sales','sale_items','sellers'].map(t => `CREATE TRIGGER h166_snapshot_changed AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON pos.${t} FOR EACH STATEMENT EXECUTE FUNCTION pos.h166_advance_snapshot_revision();`).join('\n')}
      ${extraSetup}`);
    const insert = async (table, overrides = {}) => {
      const t = catalog.find(t => t.table === table);
      await db.exec(`INSERT INTO pos.${table}(${t.columns.map(c => '"' + c.name + '"').join(',')}) VALUES(${t.columns.map(c => overrides[c.name] ?? defaultValue(c)).join(',')});`);
    };
    const capture = async () => (await db.exec(buildLiveSnapshotSql({ catalog, sourceUrl }))).find(r => r.rows[0]?.report)?.rows[0].report;
    await insert('online_snapshot_revision', { singleton:'true',revision:'10' });
    await insert('system_manifest', { system_mode:"'preproduction'" });
    await insert('online_runtime', { enabled:'true' });
    await insert('clients', { id:"'real-client'" });
    await insert('products', { id:"'real-product'",stock_quantity:'37' });
    await insert('sales', { folio:"'BG-260912-0001'",cliente_id:"'real-client'",items:'0',vendedores:"'[]'::jsonb" });
    await insert('folio_counters', { prefix:"'BG'",business_date:"DATE '2026-09-12'",last_seq:'1' });
    const baselineSnapshot = await capture();
    if (zeroScope) await db.exec(`INSERT INTO auth.users VALUES('${actorId}','{"balam_online_test":"${run}"}','{}');`);
    else {
    await insert('clients', { id:"'new-client'",total:'116.00' });
    await insert('products', { id:"'new-product'",stock_quantity:'1' });
    await insert('sales', { folio:"'BG-260912-0002'",cliente_id:"'new-client'",items:'1',vendedores:"'[]'::jsonb" });
    await insert('sale_items', { id:'2',folio:"'BG-260912-0002'",product_id:"'new-product'" });
    await insert('sync_devices', { device_id:q(deviceId),user_id:q(actorId),status:"'revoked'" });
    await insert('online_requests', { actor_id:q(actorId),request_id:q(requestId),device_id:q(deviceId),state:"'confirmed'",response:q(JSON.stringify({ ok:true,requestId,result:{} }))+'::jsonb' });
    await db.exec("UPDATE pos.folio_counters SET last_seq=2;");
    }
    const captureInput = async () => {
      const currentSnapshot = await capture();
      const initial = new Set(rows(baselineSnapshot).map(r => r.table + ':' + r.pk_json_text));
      const targets = rows(currentSnapshot).filter(r => !initial.has(r.table + ':' + r.pk_json_text)).map(r => ({
        table:r.table,pk_json_text:r.pk_json_text,full_row_md5:r.full_row_md5,
        provenance:{actorId,run,requestId,intentSha256:journalHash('synthetic durable intent'),receiptSha256:journalHash('synthetic terminal receipt')},
      }));
      const plan = { projectRef:SNAPSHOT_PROJECT,actorId,run,artifactSha256:journalHash('synthetic artifact'),clientBuild:'2026-09-12-h166-online',
        reconciled:true,cleanupManifestComplete:true,reconciliationSha256:journalHash('synthetic reconciliation'),
        backup:{baselineSha256:journalHash(baselineSnapshot),currentSha256:journalHash(currentSnapshot),
          baselineFileSha256:journalHash('synthetic private baseline bytes'),currentFileSha256:journalHash('synthetic private current bytes')},
        targets,holds:[],external:{auth:'HELD_SEPARATE_GOTRUE',storage:'HELD_SEPARATE_STORAGE'} };
      if (zeroScope) {
        plan.readyForReview = true; plan.authCleanupManifestComplete = true; plan.blockers = [];
        plan.authBaseline = {format:'balam-live-auth-baseline-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,
          artifactSha256:plan.artifactSha256,complete:true,ids:[...baselineSnapshot.auth_user_ids],
          snapshotSha256:plan.backup.baselineSha256,fileSha256:journalHash('synthetic durable Auth census')};
        plan.authBaselineSha256 = journalHash(plan.authBaseline);
        plan.authTargets = [{id:actorId,status:'PROVEN_NEW_SEPARATE_GOTRUE',emailSha256:journalHash('synthetic email'),
          marker:{namespace:'user_metadata',key:'balam_online_test',value:run},
          provenance:{actorId,run,requestId,sequence:1,intentSha256:journalHash('synthetic durable Auth intent'),
            receiptSha256:journalHash('synthetic observed Auth identity')}}];
      }
      return { plan,catalog,baselineSnapshot,currentSnapshot,sourceUrl };
    };
    const execute = async input => {
      const generated = buildLiveCleanupSql(input);
      return { generated,report:(await db.exec(generated.sql)).find(r => r.rows[0]?.report)?.rows[0].report };
    };
    const rejectSql = async (sql, pattern) => {
      await assert.rejects(db.exec(sql), pattern); await db.exec('ROLLBACK;');
      assert.equal((await db.query("SELECT count(*)::int n FROM pos.sales WHERE folio='BG-260912-0002'")).rows[0].n,1);
      assert.equal((await db.query("SELECT last_seq FROM pos.folio_counters")).rows[0].last_seq,2);
    };
    await fn({ db,insert,capture,captureInput,execute,rejectSql,baselineSnapshot });
  } finally { await db.close(); }
}

checked('real64 catalog and FK order clean six new fixtures; all63 outside tables and advanced folio survive', () => database(async ({ captureInput,execute,db }) => {
  const input = await captureInput(), { generated,report } = await execute(input);
  assert.equal(report.removed_rows,6); assert.equal(report.outside_tables_checked,63);
  assert.equal(report.snapshot_revision_delta,5); assert.equal(generated.expectedRevisionDelta,5);
  assert.equal(report.certified,false); assert.equal(report.cleanup_verified,false); assert.equal(generated.liveGateOpened,false);
  assert.equal((await db.query('SELECT last_seq FROM pos.folio_counters')).rows[0].last_seq,2);
  assert.equal(Number((await db.query("SELECT stock_quantity FROM pos.products WHERE id='real-product'")).rows[0].stock_quantity),37);
  assert.equal((generated.sql.match(/DELETE FROM pos\."sales"/g)||[]).length,1);
  assert.ok(!generated.sql.includes('116.00')); // Canonical private row bodies never enter generated SQL.
}));
checked('zero POS scope after one proven Auth creation executes real COMMIT with all64 guards and no revision advance', () => database(async ({ captureInput,execute,db,capture }) => {
  const input = await captureInput(), before = await capture();
  assert.equal(input.plan.targets.length,0);
  for (const mutate of [p=>p.readyForReview=false,p=>p.authCleanupManifestComplete=false,p=>p.authTargets=[],
    p=>p.authTargets[0].provenance.receiptSha256=null,p=>p.authTargets[0].id=SNAPSHOT_ACTOR,
    p=>p.authBaseline.ids.push(actorId)]) {
    const wrong = structuredClone(input); mutate(wrong.plan);
    assert.throws(()=>buildLiveCleanupSql(wrong),/CLEANUP_ZERO_SCOPE_/);
  }
  const {generated,report} = await execute(input);
  assert.equal(report.removed_rows,0); assert.deepEqual(report.removed_manifest,[]);
  assert.equal(report.outside_tables_checked,63); assert.equal(report.snapshot_revision_delta,0);
  assert.equal(report.auth_sql_unchanged,true); assert.equal(generated.expectedRows,0);
  assert.equal(generated.expectedRevisionDelta,0); assert.doesNotMatch(generated.sql,/DELETE FROM pos\./);
  assert.match(generated.sql,/BEGIN ISOLATION LEVEL SERIALIZABLE/); assert.match(generated.sql,/COMMIT;\s*$/);
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,2);
  assert.deepEqual((await capture()).tables,before.tables);
  const newTransaction = await db.query("SELECT current_setting('transaction_read_only') read_only,to_regclass('pg_temp.h171_new_scope') scope");
  assert.equal(newTransaction.rows[0].read_only,'off'); assert.equal(newTransaction.rows[0].scope,null);
  await fs.writeFile('docs/fixes/evidence/h171/live-cleanup-sql-zero-scope.json',JSON.stringify({
    at:new Date().toISOString(),mode:'LOCAL_SYNTHETIC_PGLITE',actualCommit:true,report,
    expectedRows:generated.expectedRows,expectedRevisionDelta:generated.expectedRevisionDelta,
    posTablesCompared:64,authBefore:2,authAfter:2,liveNetworkCalls:0,liveDeletes:0,certified:false},null,2)+'\n');
},{zeroScope:true}));
checked('wrong backup, unreconciled run, preexisting identity and fake prefix proof fail before SQL generation', () => database(async ({ captureInput }) => {
  const input = await captureInput();
  const changed = fn => { const value=structuredClone(input);fn(value);return value; };
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.backup.currentSha256='a'.repeat(64))),/BACKUP_DIGEST/);
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.reconciled=false)),/RECONCILIATION/);
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.cleanupManifestComplete=false)),/COMPLETE_MANIFEST/);
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.targets[0].provenance={qa:true,prefix:'qa-h171'})),/PROVENANCE/);
  const old=rows(input.baselineSnapshot).find(r=>r.table==='clients');
  assert.throws(()=>buildLiveCleanupSql(changed(v=>Object.assign(v.plan.targets[0],{table:old.table,pk_json_text:old.pk_json_text,full_row_md5:old.full_row_md5}))),/BASELINE_ROW/);
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.actorId=SNAPSHOT_ACTOR)),/QA_ACTOR/);
  assert.throws(()=>buildLiveCleanupSql(changed(v=>v.plan.targets[0].provenance.run=requestId)),/PROVENANCE/);
}));
checked('canonical target hash changed after capture aborts before DELETE', () => database(async ({ captureInput,db,rejectSql }) => {
  const { sql }=buildLiveCleanupSql(await captureInput());
  await db.exec("UPDATE pos.clients SET total=117 WHERE id='new-client';");
  await rejectSql(sql,/EXACT_PK_HASH_DRIFT/);
}));
checked('unselected real row changed after snapshot is detected under locks', () => database(async ({ captureInput,db,rejectSql }) => {
  const { sql }=buildLiveCleanupSql(await captureInput());
  await db.exec("UPDATE pos.folio_counters SET updated_at='2026-09-12 20:00:00+00';");
  await rejectSql(sql,/LOCKED_BASELINE_DRIFT:folio_counters/);
}));
checked('selected sale referencing a real commercial parent is rejected without deleting it', () => database(async ({ db,captureInput,rejectSql }) => {
  await db.exec("UPDATE pos.sales SET cliente_id='real-client' WHERE folio='BG-260912-0002';");
  const { sql }=buildLiveCleanupSql(await captureInput());
  await rejectSql(sql,/FOREIGN_PARENT:sales:clients/);
}));
checked('a surviving CASCADE child cannot be removed implicitly with its selected parent', () => database(async ({ captureInput,rejectSql }) => {
  const input=await captureInput();input.plan.targets=input.plan.targets.filter(t=>t.table!=='sale_items');
  await rejectSql(buildLiveCleanupSql(input).sql,/UNSELECTED_CHILD:sale_items:sales/);
}));
checked('logical product links without physical FK block a partial cleanup', () => database(async ({ captureInput,rejectSql }) => {
  const input=await captureInput();input.plan.targets=input.plan.targets.filter(t=>t.table!=='products');
  await rejectSql(buildLiveCleanupSql(input).sql,/FOREIGN_PARENT:sale_items:products/);
}));
checked('BALAM vendedores arrays of seller IDs reject an unselected commercial seller', () => database(async ({ insert,db,captureInput,rejectSql }) => {
  await insert('sellers',{id:"'other-seller'",password_hash:'NULL'});
  await db.exec(`UPDATE pos.sales SET vendedores='["other-seller"]'::jsonb WHERE folio='BG-260912-0002';`);
  const input=await captureInput();input.plan.targets=input.plan.targets.filter(t=>t.table!=='sellers');
  await rejectSql(buildLiveCleanupSql(input).sql,/FOREIGN_PARENT:sales:sellers/);
}));
checked('H152 exchange payment and movement links require the exact exchange and complete child scope', () => database(async ({ insert,captureInput,rejectSql,execute }) => {
  await insert('exchanges',{id:"'new-exchange'",folio:"'CA-LOCAL'",origen_folio:"'BG-260912-0002'"});
  await insert('sale_payments',{id:"'pay-H152'",folio:"'CA-LOCAL'"});
  // Isolate ref->exchange closure from the separately tested product_id closure.
  await insert('movements',{id:'3',ref:"'CA-LOCAL'",product_id:'NULL'});
  const input=await captureInput();
  const missingChild=structuredClone(input);missingChild.plan.targets=missingChild.plan.targets.filter(t=>t.table!=='sale_payments');
  await rejectSql(buildLiveCleanupSql(missingChild).sql,/UNSELECTED_CHILD:sale_payments:exchanges/);
  const missingParent=structuredClone(input);missingParent.plan.targets=missingParent.plan.targets.filter(t=>t.table!=='exchanges');
  await rejectSql(buildLiveCleanupSql(missingParent).sql,/FOREIGN_PARENT:sale_payments:exchanges/);
  const missingMove=structuredClone(input);missingMove.plan.targets=missingMove.plan.targets.filter(t=>t.table!=='movements');
  await rejectSql(buildLiveCleanupSql(missingMove).sql,/UNSELECTED_CHILD:movements:exchanges/);
  assert.equal((await execute(input)).report.removed_rows,9);
}));
checked('global executing command blocks cleanup, even when the other actor is outside scope', () => database(async ({ db,insert,captureInput,rejectSql }) => {
  await insert('online_requests',{actor_id:q(SNAPSHOT_ACTOR),request_id:q('44444444-4444-4444-8444-444444444444'),state:"'executing'"});
  const input=await captureInput();input.plan.targets=input.plan.targets.filter(t=>!t.pk_json_text.includes(SNAPSHOT_ACTOR));
  await rejectSql(buildLiveCleanupSql(input).sql,/NONTERMINAL_REQUEST/);
}));
checked('nonterminal account preparation blocks cleanup without replay or resolution', () => database(async ({ insert,captureInput,rejectSql }) => {
  await insert('online_account_requests',{actor_id:q(actorId),request_id:q('44444444-4444-4444-8444-444444444444'),state:"'prepared'"});
  await rejectSql(buildLiveCleanupSql(await captureInput()).sql,/NONTERMINAL_REQUEST/);
}));
checked('catalog or function drift aborts before any fixture deletion', () => database(async ({ db,captureInput,rejectSql }) => {
  const { sql }=buildLiveCleanupSql(await captureInput());
  await db.exec("CREATE FUNCTION pos.new_unreviewed_function() RETURNS int LANGUAGE sql AS $$SELECT 1$$;");
  await rejectSql(sql,/CATALOG_DRIFT/);
}));
checked('a reviewed trigger changing a foreign counter is detected after DELETE and rolls back everything', () => database(async ({ captureInput,rejectSql }) => {
  await rejectSql(buildLiveCleanupSql(await captureInput()).sql,/OUTSIDE_CHANGED:folio_counters/);
},{extraSetup:`CREATE FUNCTION pos.local_bad_counter() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE pos.folio_counters SET last_seq=0;RETURN OLD;END$$;
 CREATE TRIGGER local_bad_counter BEFORE DELETE ON pos.clients FOR EACH ROW EXECUTE FUNCTION pos.local_bad_counter();`}));
checked('deferred trigger effects are checked before commit and cannot hide behind final constraints', () => database(async ({ captureInput,rejectSql }) => {
  await rejectSql(buildLiveCleanupSql(await captureInput()).sql,/OUTSIDE_CHANGED:folio_counters/);
},{extraSetup:`CREATE FUNCTION pos.local_deferred_change() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE pos.folio_counters SET last_seq=0;RETURN OLD;END$$;
 CREATE CONSTRAINT TRIGGER local_deferred_change AFTER DELETE ON pos.clients DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos.local_deferred_change();`}));
checked('incorrect snapshot advance rolls back, and never rewinds the revision', () => database(async ({ captureInput,rejectSql }) => {
  await rejectSql(buildLiveCleanupSql(await captureInput()).sql,/SNAPSHOT_REVISION_DELTA/);
},{extraSetup:`CREATE FUNCTION pos.local_bad_revision() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE pos.online_snapshot_revision SET revision=revision+2;RETURN OLD;END$$;
 CREATE TRIGGER local_bad_revision BEFORE DELETE ON pos.clients FOR EACH ROW EXECUTE FUNCTION pos.local_bad_revision();`}));
checked('nonNULL omitted secrets require an explicit hold and can never become targets', () => database(async ({ insert,captureInput }) => {
  await insert('sellers',{id:"'secret-seller'",password_hash:"'synthetic-not-a-credential'"});
  const input=await captureInput(),target=input.plan.targets.find(t=>t.table==='sellers');
  assert.throws(()=>buildLiveCleanupSql(input),/SECRET_HOLD_REQUIRED/);
  input.plan.holds.push({table:'sellers',pk_json_text:target.pk_json_text,reason:'NONNULL_OMITTED_COLUMN'});
  assert.throws(()=>buildLiveCleanupSql(input),/NEW_HOLD_REQUIRES_RECONCILIATION/);
  input.plan.targets=input.plan.targets.filter(t=>t!==target);
  assert.throws(()=>buildLiveCleanupSql(input),/NEW_HOLD_REQUIRES_RECONCILIATION/);
  // Simulate an unchanged historical held row in both canonical snapshots.
  const old=input.baselineSnapshot.tables.find(t=>t.table==='sellers');
  old.rows=structuredClone(input.currentSnapshot.tables.find(t=>t.table==='sellers').rows);old.row_count=old.rows.length;
  input.plan.backup.baselineSha256=journalHash(input.baselineSnapshot);
  const result=buildLiveCleanupSql(input);assert.ok(!result.sql.includes('synthetic-not-a-credential'));
  assert.ok(result.sql.includes('NONNULL_OMITTED_COLUMN'));
}));
checked('full canonical hash aggregation matches PostgreSQL numeric scale and timestamp, independent of row order', () => database(async ({ captureInput,db }) => {
  const input=await captureInput(),clients=input.currentSnapshot.tables.find(t=>t.table==='clients').rows;
  const expected=cleanupRowsFingerprint(clients);
  assert.deepEqual(cleanupRowsFingerprint([...clients].reverse()),expected);
  await db.exec("BEGIN;SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO, MDY';");
  const actual=(await db.query("WITH row_hashes AS MATERIALIZED(SELECT md5(to_jsonb(t)::text) row_md5 FROM pos.clients t) SELECT count(*)::int row_count,md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),'')) full_rows_md5 FROM row_hashes")).rows[0];
  await db.exec('ROLLBACK;');
  assert.deepEqual(actual,expected);
}));
after(async () => {
  const fileHash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex');
  await fs.mkdir('docs/fixes/evidence/h171',{recursive:true});
  await fs.writeFile('docs/fixes/evidence/h171/live-cleanup-sql.json',JSON.stringify({at:new Date().toISOString(),
    mode:'LOCAL_SYNTHETIC_PGLITE',project:SNAPSHOT_PROJECT,passed:checks.length,checks,
    moduleSha256:await fileHash('h171-live-cleanup-sql.mjs'),testSha256:await fileHash('test-h171-live-cleanup-sql.mjs'),
    snapshotModuleSha256:await fileHash('h171-live-snapshot.mjs'),liveNetworkCalls:0,liveDeletes:0,
    certified:false,cleanupVerified:false,liveGateOpened:false},null,2)+'\n');
});
