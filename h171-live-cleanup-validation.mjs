import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { journalHash } from './h171-live-journal.mjs';
import { cleanupRowsFingerprint } from './h171-live-cleanup-sql.mjs';
import { validateLiveSnapshot, diffLiveSnapshots } from './h171-live-snapshot.mjs';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const qi=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};

// Restore only this run's fully backed rows into an isolated typed PostgreSQL engine.
// No remote connection; FK/trigger behavior is verified separately by guarded SQL.
export async function verifyCanonicalFixtureBackup({plan,catalog}) {
  assert.equal(plan.readyForReview,true,'COMPLETE_PROVEN_PLAN_REQUIRED');
  const db=new PGlite(),checks=[];
  try {
    await db.exec("SET TimeZone='UTC';SET DateStyle='ISO, MDY';CREATE SCHEMA pos;");
    for(const name of new Set(plan.targets.map(t=>t.table))) {
      const table=catalog.find(t=>t.table===name);assert.ok(table,'BACKUP_TABLE_NOT_IN_CATALOG');
      await db.exec(`CREATE TABLE pos.${qi(name)}(${table.columns.map(c=>qi(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')).join(',')},PRIMARY KEY(${table.pk.map(qi).join(',')}));`);
    }
    for(const target of plan.targets) {
      const table=qi(target.table);
      await db.exec(`INSERT INTO pos.${table} SELECT * FROM jsonb_populate_record(NULL::pos.${table},${q(target.row_json_text)}::jsonb);`);
      const result=await db.query(`SELECT md5(to_jsonb(t)::text) hash FROM pos.${table} t WHERE to_jsonb(t) @> ${q(target.pk_json_text)}::jsonb`);
      assert.equal(result.rows.length,1,'BACKUP_EXACT_PK_COUNT');assert.equal(result.rows[0].hash,target.full_row_md5,'BACKUP_TYPED_RESTORE_HASH_MISMATCH');
      checks.push({table:target.table,pk_json_text:target.pk_json_text,full_row_md5:target.full_row_md5});
    }
    return {format:'balam-live-fixture-backup-validation-v1',localOnly:true,at:new Date().toISOString(),planSha256:journalHash(plan),
      restoredRows:checks.length,expectedRows:plan.targets.length,verified:true,checks,
      scope:'Exact canonical PK/body/type/hash reconstruction; remote FK and triggers remain enforced in the cleanup transaction.'};
  } finally {await db.close();}
}

export function verifyLiveSqlPostcheck({plan,generated,result,baselineSnapshot,currentSnapshot,postSnapshot,catalog,sourceUrl}) {
  for(const snapshot of [baselineSnapshot,currentSnapshot,postSnapshot])validateLiveSnapshot(snapshot,{catalog,sourceUrl});
  assert.equal(result.format,'balam-new-fixture-cleanup-result-v1');assert.equal(result.run,plan.run);
  assert.equal(result.project_ref,plan.projectRef);assert.equal(result.plan_sha256,generated.planSha256);
  assert.equal(result.removed_rows,plan.targets.length);assert.equal(result.outside_tables_checked,63);assert.equal(result.auth_sql_unchanged,true);
  const expected=plan.targets.map(t=>journalHash({table_name:t.table,pk:JSON.parse(t.pk_json_text),row_md5:t.full_row_md5})).sort();
  assert.deepEqual(result.removed_manifest.map(journalHash).sort(),expected,'EXACT_REMOVAL_RECEIPT_REQUIRED');
  for(const target of plan.targets)assert.equal(postSnapshot.tables.find(t=>t.table===target.table).rows.some(r=>r.pk_json_text===target.pk_json_text),false,'CLEANUP_TARGET_STILL_PRESENT');
  const actual=postSnapshot.tables.filter(t=>t.table!=='online_snapshot_revision').map(t=>({table_name:t.table,...cleanupRowsFingerprint(t.rows)}));
  const sort=rows=>[...rows].sort((a,b)=>a.table_name.localeCompare(b.table_name));
  assert.deepEqual(sort(actual),sort(generated.manifest.outside),'POSTCHECK_OUTSIDE_FULL_HASH_CHANGED');
  const revision=s=>s.tables.find(t=>t.table==='online_snapshot_revision').rows[0];
  assert.equal(BigInt(revision(postSnapshot).monotonic.counter),BigInt(revision(currentSnapshot).monotonic.counter)+BigInt(generated.expectedRevisionDelta),'POSTCHECK_REVISION_DELTA');
  assert.equal(revision(postSnapshot).monotonic.other_fields_md5,revision(currentSnapshot).monotonic.other_fields_md5);
  assert.deepEqual(postSnapshot.auth_user_ids,currentSnapshot.auth_user_ids,'SQL_CHANGED_AUTH_IDENTITIES');
  const diff=diffLiveSnapshots({baseline:baselineSnapshot,final:postSnapshot,catalog,sourceUrl,
    approvedMonotonicCreations:plan.preservedCounterCreations||[]});
  assert.equal(diff.nonQaPreservedWithMonotonicAdvances,true,'POSTCHECK_BASELINE_CHANGED_OR_NEW_RESIDUE');
  return {format:'balam-live-sql-postcheck-v1',at:postSnapshot.at,readOnly:true,sourceUrl,
    exactRowsChecked:plan.targets.length,remainingExactRows:0,protectedTables:63,baselinePreserved:true,
    revision:revision(postSnapshot).monotonic.counter,preservedAdvances:[...diff.changed,...diff.new.filter(r=>r.classification==='MONOTONIC_CREATION_TO_PRESERVE')],
    posCatalogSha256:journalHash(postSnapshot.catalog),
    posFingerprints:postSnapshot.tables.map(t=>({table:t.table,...cleanupRowsFingerprint(t.rows)})),
    certified:false,cleanupVerified:false};
}
