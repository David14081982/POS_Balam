// One local PGlite database, BALAM's recorded schema/FKs and H166 function.
// No Supabase clients, remote network or live Auth writes.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT,SNAPSHOT_ACTOR,recordedSnapshotCatalog } from './h171-live-snapshot.mjs';
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';
import { installAuthPreflightTestSchema } from './h171-auth-preflight-test-schema.mjs';
import { buildAuthCleanupPreflightSql,validateAuthCleanupPreflight } from './h171-live-cleanup-auth-preflight.mjs';

const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const authorityAudit=await read('docs/fixes/evidence/h171/authority-audit-before.json');
const cleanupCatalog=await read('docs/fixes/evidence/h171/cleanup-catalog-before.json');
const audit=authorityAudit.rows?.[0]?.report||authorityAudit,known=cleanupCatalog.rows?.[0]?.report||cleanupCatalog;
const catalog=recordedSnapshotCatalog({authorityAudit,cleanupCatalog});
const sourceUrl=`https://api.supabase.com/v1/projects/${SNAPSHOT_PROJECT}/database/query`;
const actorId='11111111-1111-4111-8111-111111111111',accountId='22222222-2222-4222-8222-222222222222';
const run='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const protectedId='70549527-4867-4342-94d2-38e770b0f2a9',artifactSha256=journalHash('local artifact');
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const results=[];const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}};
const backup={baselineSha256:journalHash('canonical baseline')};
const authBaseline={format:'balam-live-auth-baseline-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,artifactSha256,complete:true,
 snapshotSha256:backup.baselineSha256,fileSha256:journalHash('private baseline bytes'),ids:[SNAPSHOT_ACTOR]};
const targets=[{id:actorId,email:'principal@example.test',marker:{namespace:'user_metadata',key:'balam_online_test',value:run}},
 {id:accountId,email:'account@example.test',marker:{namespace:'app_metadata',key:'balam_account_request_id',value:requestId}}];
const plan={format:'balam-live-cleanup-plan-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,artifactSha256,clientBuild:'2026-09-12-h166-online',
 backup,authBaseline,authBaselineSha256:journalHash(authBaseline),
 authTargets:targets.map(t=>({id:t.id,emailSha256:journalHash(t.email),marker:t.marker,status:'PROVEN_NEW_SEPARATE_GOTRUE',
 provenance:{actorId,run,requestId,intentSha256:journalHash('intent '+t.id),receiptSha256:journalHash('receipt '+t.id)}})),
 targets:[{table:'products',pk_json_text:'{"id":"new-local-product"}'}]};
const options={plan,catalog,sourceUrl};
const pg=new PGlite();
const defaultValue=c=>!c.not_null?'NULL':c.type==='text'?"'local'":c.type==='uuid'?q(requestId):c.type==='boolean'?'true':
 c.type==='jsonb'?"'[]'::jsonb":c.type==='text[]'?"'{}'::text[]":c.type==='date'?"DATE '2026-09-12'":
 c.type==='timestamp with time zone'?"TIMESTAMPTZ '2026-09-12 12:00:00.123456+00'":'0';
const insert=async(table,override={})=>{const t=catalog.find(t=>t.table===table);await pg.exec(`INSERT INTO pos.${table}(${t.columns.map(c=>'"'+c.name+'"').join(',')}) VALUES(${t.columns.map(c=>override[c.name]??defaultValue(c)).join(',')});`);};
const addAuth=async t=>pg.exec(`INSERT INTO auth.users VALUES(${q(t.id)},${q(t.email)},${q(JSON.stringify(t.marker.namespace==='user_metadata'?{[t.marker.key]:t.marker.value}:{}))}::jsonb,${q(JSON.stringify(t.marker.namespace==='app_metadata'?{[t.marker.key]:t.marker.value}:{}))}::jsonb,'2026-09-12 12:00:00+00','SYNTHETIC_CREDENTIAL_NEVER_EXPORT');`);
const readPreflight=async(config=options)=>{const sql=buildAuthCleanupPreflightSql(config),rows=await pg.exec(sql);return rows.find(r=>r.rows[0]?.report).rows[0].report;};
const validate=(input,extra={})=>validateAuthCleanupPreflight({...options,input,...extra});
try {
 await pg.exec(`CREATE SCHEMA pos;CREATE SCHEMA auth;CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz,encrypted_password text);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY,owner uuid,owner_id text);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,owner uuid,owner_id text);
 CREATE TABLE storage.s3_multipart_uploads(id text PRIMARY KEY,owner_id text);
 CREATE TABLE storage.s3_multipart_uploads_parts(id text PRIMARY KEY,owner_id text);
 CREATE FUNCTION pos.can_manage_screen_permissions(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1 AND id='${SNAPSHOT_ACTOR}')$$;`);
 await pg.exec(catalog.map(t=>`CREATE TABLE pos.${t.table}(${t.columns.map(c=>'"'+c.name+'" '+c.type+(c.not_null?' NOT NULL':'')).join(',')},PRIMARY KEY(${t.pk.map(k=>'"'+k+'"').join(',')}));`).join('\n'));
 await installAuthPreflightTestSchema({pg,cleanupCatalog});
 await pg.exec(audit.foreign_keys.filter(f=>f.source.startsWith('pos.')&&f.target!=='auth.users').map(f=>`ALTER TABLE ${f.source} ADD CONSTRAINT ${f.constraint} ${f.definition};`).join('\n'));
 await pg.exec(`INSERT INTO auth.users VALUES('${SNAPSHOT_ACTOR}','real@example.test','{}','{}','2026-09-12 00:00:00+00','FOREIGN_CREDENTIAL_NEVER_EXPORT');`);
 for(const t of targets)await addAuth(t);
 await insert('online_snapshot_revision',{revision:'100'});
 await insert('online_runtime',{enabled:'true'});await insert('system_manifest',{system_mode:"'preproduction'"});
 await insert('online_account_requests',{actor_id:q(SNAPSHOT_ACTOR),request_id:q(protectedId),state:"'completed'"});
 let initial;
 await check('READ ONLY preflight emits all64 full fingerprints,18FKx2,6Storagecolsx2 and the actual seven-trigger revision contract',async()=>{
  initial=await readPreflight();const checked=validate(initial);assert.equal(checked.ready,true,checked.blockers.join(','));
  assert.equal(initial.pos_fingerprints.length,64);assert.equal(initial.fk_catalog.length,18);assert.equal(initial.fk_counts.length,36);
  assert.equal(initial.storage_owner_catalog.length,6);assert.equal(initial.storage_owner_counts.length,12);
  assert.equal(checked.preflight.snapshot_revision.delta_per_delete,7);assert.equal(checked.preflight.snapshot_revision.trigger_sources.length,7);
  assert.equal(checked.preflight.snapshot_revision.trigger_sources.filter(s=>s.effect==='n').length,5);
  assert.equal(checked.preflight.snapshot_revision.trigger_sources.filter(s=>s.effect==='c').length,2);
  assert.deepEqual(initial.non_target_auth_ids,[SNAPSHOT_ACTOR]);assert.equal(initial.exact_rows_checked,1);assert.equal(initial.remaining_exact_rows,0);
  assert.ok(!JSON.stringify(initial).includes('CREDENTIAL_NEVER_EXPORT'));assert.ok(!JSON.stringify(initial).includes('real@example.test'));
 });
 await check('SQL remains READ ONLY even if a caller appends DML inside its transaction',async()=>{
  const bad=buildAuthCleanupPreflightSql(options).replace(/COMMIT;\s*$/,`DELETE FROM auth.users WHERE id='${actorId}';COMMIT;`);
  await assert.rejects(pg.exec(bad),/read-only transaction/);await pg.exec('ROLLBACK;');
  assert.equal((await pg.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,3);
 });
 await check('Foreign project,run binding,real Auth target and tampered SHA reject before dispatch or readiness',async()=>{
  assert.throws(()=>buildAuthCleanupPreflightSql({...options,sourceUrl:'https://example.com/'}),/FOREIGN_PROJECT/);
  const altered=structuredClone(plan);altered.authTargets[0].id=SNAPSHOT_ACTOR;
  assert.throws(()=>buildAuthCleanupPreflightSql({...options,plan:altered}),/EXACT_AUTH_TARGETS|TARGET_PROVENANCE/);
  assert.throws(()=>validate({...initial,run:requestId}),/RESPONSE_BINDING/);
  assert.throws(()=>validate({...initial,pos_catalog_sha256:'a'.repeat(64)}),/CATALOG_HASH/);
 });
 await check('Missing FK/count/Storage coverage is never interpreted as zero',async()=>{
  const changed=structuredClone(initial);changed.fk_counts.pop();assert.throws(()=>validate(changed),/FK_COUNT_COVERAGE/);
  changed.fk_counts=initial.fk_counts;changed.storage_owner_counts.pop();assert.throws(()=>validate(changed),/STORAGE_COUNT_COVERAGE/);
  const fewer=structuredClone(initial);fewer.fk_catalog.pop();assert.ok(validate(fewer).blockers.includes('AUTH_FK_CATALOG_DRIFT'));
 });
 await check('A real Storage ownership in buckets or objects blocks Auth cleanup',async()=>{
  await pg.exec(`INSERT INTO storage.buckets VALUES('local-bucket',NULL,'${actorId}');`);
  assert.ok(validate(await readPreflight()).blockers.includes('STORAGE_OWNERSHIP_REMAINS'));
  await pg.exec("DELETE FROM storage.buckets WHERE id='local-bucket';");
  await pg.exec(`INSERT INTO storage.objects VALUES('${requestId}','${accountId}',NULL);`);
  assert.ok(validate(await readPreflight()).blockers.includes('STORAGE_OWNERSHIP_REMAINS'));
  await pg.exec(`DELETE FROM storage.objects WHERE id='${requestId}';`);
 });
 await check('An added Storage owner column/table is reported and blocks the incomplete known-count contract',async()=>{
  await pg.exec('CREATE TABLE storage.local_future(id uuid,owner_id text);');
  const response=await readPreflight();assert.equal(response.storage_owner_catalog.length,7);
  assert.ok(validate(response).blockers.includes('STORAGE_CATALOG_DRIFT'));
  await pg.exec('DROP TABLE storage.local_future;');
 });
 await check('Logical POS actor references without Auth FKs block cleanup and exact remaining scope is counted',async()=>{
  await insert('online_requests',{actor_id:q(actorId),request_id:q(requestId),state:"'confirmed'"});
  assert.ok(validate(await readPreflight()).blockers.includes('LOGICAL_POS_DEPENDENCIES_REMAIN'));
  await pg.exec(`DELETE FROM pos.online_requests WHERE actor_id='${actorId}';`);
  await insert('products',{id:"'new-local-product'"});const response=await readPreflight();
  assert.equal(response.remaining_exact_rows,1);assert.ok(validate(response).blockers.includes('SQL_SCOPE_REMAINS'));
  await pg.exec("DELETE FROM pos.products WHERE id='new-local-product';");
 });
 await check('Foreign Auth content,POS content and protected7054 changes are detected against the post-SQL baseline',async()=>{
  await pg.exec(`UPDATE auth.users SET encrypted_password='FOREIGN_CHANGE' WHERE id='${SNAPSHOT_ACTOR}';`);
  assert.ok(validate(await readPreflight(),{baseline:initial}).blockers.includes('BASELINE_PROTECTION_CHANGED'));
  await pg.exec(`UPDATE auth.users SET encrypted_password='FOREIGN_CREDENTIAL_NEVER_EXPORT' WHERE id='${SNAPSHOT_ACTOR}';`);
  await insert('clients',{id:"'foreign-change'"});
  assert.ok(validate(await readPreflight(),{baseline:initial}).blockers.includes('BASELINE_POS_CHANGED'));
  await pg.exec("DELETE FROM pos.clients WHERE id='foreign-change';");
  await pg.exec(`UPDATE pos.online_account_requests SET state='prepared' WHERE request_id='${protectedId}';`);
  const report=validate(await readPreflight(),{baseline:initial});assert.ok(report.blockers.includes('PROTECTED_REQUEST_CHANGED'));assert.ok(report.blockers.includes('NONTERMINAL_REQUEST'));
  await pg.exec(`UPDATE pos.online_account_requests SET state='completed' WHERE request_id='${protectedId}';`);
 });
 await check('Native Auth children are counted; local deletion produces exact+7 while63POS hashes andforeignAuth remain stable',async()=>{
  await pg.exec(`INSERT INTO auth.identities VALUES('${requestId}','${accountId}');`);
  const before=await readPreflight();assert.equal(before.fk_counts.find(c=>c.id===accountId&&c.relation==='auth.identities').rows,1);
  assert.equal(validate(before).ready,true);
  // Local reproduction only. Production deletion belongs exclusively to injected GoTrue.
  await pg.exec(`DELETE FROM auth.users WHERE id='${accountId}';`);
  const after=await readPreflight(),checked=validate(after,{baseline:before});assert.equal(checked.ready,true,checked.blockers.join(','));
  assert.equal(BigInt(after.snapshot_revision.value)-BigInt(before.snapshot_revision.value),7n);
  assert.equal(after.targets.find(t=>t.id===accountId).exists,false);
  assert.deepEqual(after.pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision'),before.pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision'));
  assert.deepEqual(after.foreign_auth_fingerprint,before.foreign_auth_fingerprint);
 });
 await check('Early failed run can preflight only its one proven principal; no second identity is invented',async()=>{
  const single=structuredClone(plan);single.authTargets=single.authTargets.filter(t=>t.id===actorId);
  const config={...options,plan:single},response=await readPreflight(config);
  const checked=validateAuthCleanupPreflight({...config,input:response});assert.equal(checked.ready,true,checked.blockers.join(','));
  assert.equal(response.targets.length,1);assert.equal(response.fk_counts.length,18);assert.equal(response.storage_owner_counts.length,6);
 });
} finally {await pg.close();}
const hashFile=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const report={scope:'LOCAL_PGLITE_READ_ONLY_PREFLIGHT',tests:results.length,passed:results.filter(r=>r.pass).length,
 failed:results.filter(r=>!r.pass).length,results,moduleSha256:await hashFile('h171-live-cleanup-auth-preflight.mjs'),
 testSha256:await hashFile('test-h171-live-cleanup-auth-preflight.mjs'),remoteCalls:0,remoteWrites:0,certified:false};
await fs.mkdir('docs/fixes/evidence/h171',{recursive:true});
await fs.writeFile('docs/fixes/evidence/h171/live-cleanup-auth-preflight.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
