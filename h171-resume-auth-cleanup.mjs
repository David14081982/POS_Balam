// H171 post-COMMIT continuation. Never executes cleanup SQL or creates fixtures.
// Default validates existing local evidence only. --execute enables exact GoTrue
// retirement after a fresh READ ONLY preflight; import has no side effects.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {openLiveJournal,journalHash} from './h171-live-journal.mjs';
import {SNAPSHOT_PROJECT,recordedSnapshotCatalog,validateLiveSnapshot,diffLiveSnapshots} from './h171-live-snapshot.mjs';
import {loadOriginalLiveBaseline} from './h171-live-cleanup-lifecycle.mjs';
import {verifyLiveSqlPostcheck} from './h171-live-cleanup-validation.mjs';
import {createLiveCleanupAuth} from './h171-live-cleanup-auth.mjs';
import {createLiveAuthorityIO,durableJson} from './h171-live-authority-io.mjs';
import {buildAuthCleanupPreflightSql,validateAuthCleanupPreflight} from './h171-live-cleanup-auth-preflight.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const privatePath=value=>{const path=resolve(value),inside=relative(resolve('.evidence-h171-private'),path);
  assert.ok(inside&&!inside.startsWith('..')&&!inside.includes(':'),'AUTH_RESUME_PRIVATE_PATH_REQUIRED');return path;};
const read=async file=>{const bytes=await fs.readFile(file);return {value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),sha256:hash(bytes)};};
export function authResumeArguments(argv){
  const options={execute:false},allowed=new Set(['execution-dir','output','linked-directory','approved-review-sha256']);
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--execute'){assert.equal(options.execute,false);options.execute=true;continue;}
    const key=argv[i].slice(2);assert.ok(argv[i].startsWith('--')&&allowed.has(key)&&argv[i+1]&&!argv[i+1].startsWith('--'));
    assert.equal(options[key],undefined);options[key]=argv[++i];
  }
  assert.ok(options['execution-dir'],'AUTH_RESUME_EXECUTION_DIRECTORY_REQUIRED');
  if(options.execute)assert.match(options['approved-review-sha256']||'',/^[a-f0-9]{64}$/,'AUTH_RESUME_REVIEW_REQUIRED');
  return options;
}

export async function resumeCommittedAuthCleanup(options){
  const directory=privatePath(options['execution-dir']),input=(await read(join(directory,'recovery-input.json'))).value;
  assert.equal(input.projectRef,SNAPSHOT_PROJECT);assert.equal(input.execute,true);
  const runDirectory=privatePath(input.runDirectory),baselineDirectory=privatePath(input.baselineDirectory);
  const planFile=await read(join(directory,'cleanup-plan.json')),plan=planFile.value;
  const review=(await read(join(directory,'cleanup-review.json'))).value;
  const manifest=(await read(join(directory,'cleanup-manifest.json'))).value;
  const identityFile=await read(join(directory,'auth-identity-before-cleanup.json'));
  const resultFile=await read(join(directory,'cleanup-execution-response.json'));
  const historicalAuthFile=await read(join(directory,'auth-after-sql-response.json'));
  const historicalAuth=historicalAuthFile.value.rows?.[0]?.report||historicalAuthFile.value;
  const restoration=(await read(join(directory,'backup-restore-validation.json'))).value;
  assert.equal(restoration.verified,true);assert.equal(restoration.planSha256,journalHash(plan));
  assert.equal(restoration.restoredRows,plan.targets.length);assert.equal(restoration.expectedRows,plan.targets.length);
  assert.equal(historicalAuth.run,plan.run);assert.equal(historicalAuth.project_ref,SNAPSHOT_PROJECT);
  assert.equal(historicalAuth.plan_sha256,journalHash(plan));assert.equal(historicalAuth.read_only,'on');
  const stored=(await read(join(runDirectory,'mutation-journal.json'))).value;
  const {checksum,...journalSnapshot}=stored;assert.equal(checksum,journalHash(journalSnapshot),'AUTH_RESUME_JOURNAL_CHECKSUM');
  assert.equal(plan.projectRef,SNAPSHOT_PROJECT);assert.equal(plan.run,input.run);assert.equal(plan.artifactSha256,input.artifactSha256);
  assert.equal(journalSnapshot.run,plan.run);assert.equal(journalSnapshot.artifactSha256,plan.artifactSha256);
  assert.equal(hash(await fs.readFile(join(runDirectory,'verified-artifact.html'))),plan.artifactSha256,'AUTH_RESUME_ARTIFACT_CHANGED');
  assert.equal(review.reviewSha256,journalHash(review.binding),'AUTH_RESUME_REVIEW_BINDING');
  assert.equal(review.binding.run,plan.run);assert.equal(review.binding.actorId,plan.actorId);
  assert.equal(review.binding.artifactSha256,plan.artifactSha256);assert.equal(review.binding.journalSha256,plan.journalSha256);
  assert.deepEqual(review.binding.outside,manifest.outside);
  if(options.execute)assert.equal(options['approved-review-sha256'],review.reviewSha256,'AUTH_RESUME_REVIEW_CHANGED');
  const attempts=journalSnapshot.entries.filter(e=>e.kind==='live-cleanup-sql-attempt');
  assert.equal(attempts.length,1,'AUTH_RESUME_ONE_COMMITTED_SQL_ATTEMPT_REQUIRED');
  const attempt=attempts[0],prefix={...journalSnapshot,entries:journalSnapshot.entries.slice(0,attempt.sequence-1)};
  assert.equal(journalHash(prefix),plan.journalSha256,'AUTH_RESUME_JOURNAL_PREFIX_CHANGED');
  assert.equal(attempt.sequence,journalSnapshot.entries.length,'AUTH_RESUME_PRIOR_AUTH_ATTEMPT_REQUIRES_SEPARATE_RECONCILIATION');
  assert.equal(attempt.command.planSha256,journalHash(plan));assert.equal(attempt.command.planFileSha256,planFile.sha256);
  assert.equal(attempt.command.expectedRows,plan.targets.length);
  const sqlSha256=hash(await fs.readFile(join(directory,'cleanup-execution.sql')));
  assert.equal(sqlSha256,review.sqlSha256);assert.equal(sqlSha256,attempt.command.sqlSha256);
  assert.equal(sqlSha256,hash(await fs.readFile(join(directory,'cleanup-reviewed.sql'))));
  const catalog=recordedSnapshotCatalog({authorityAudit:(await read('docs/fixes/evidence/h171/authority-audit-before.json')).value,
    cleanupCatalog:(await read('docs/fixes/evidence/h171/cleanup-catalog-before.json')).value});
  const sourceUrl=`https://${SNAPSHOT_PROJECT}.supabase.co/`;
  const {baseline}=await loadOriginalLiveBaseline({baselineFile:join(baselineDirectory,'before-fixtures.json'),
    authBaselineFile:join(baselineDirectory,'auth-baseline.json'),baselineSha256:input.baselineSha256,
    authBaselineSha256:input.authBaselineSha256},{catalog,sourceUrl,run:plan.run,actorId:plan.actorId,
    artifactSha256:plan.artifactSha256,journalSnapshot});
  const loadCapture=async name=>{const file=join(directory,name+'.json.gz'),bytes=await fs.readFile(file);
    const value=JSON.parse(gunzipSync(bytes).toString('utf8'));assert.deepEqual(value.local,{path:resolve(file),sourceUrl});delete value.local;
    return {snapshot:validateLiveSnapshot(value,{catalog,sourceUrl}).snapshot,evidence:{file,sha256:hash(bytes)}};};
  const current=await loadCapture('after-scenarios'),post=await loadCapture('after-sql-cleanup');
  assert.equal(current.evidence.sha256,plan.backup.currentFileSha256);
  assert.equal(journalHash(current.snapshot),plan.backup.currentSha256);
  assert.equal(baseline.evidence.sha256,plan.backup.baselineFileSha256);
  const rows=Array.isArray(resultFile.value)?resultFile.value:resultFile.value.rows;
  const reports=rows.filter(r=>r.report?.format==='balam-new-fixture-cleanup-result-v1');assert.equal(reports.length,1);
  const result=reports[0].report,generated={manifest,planSha256:journalHash(manifest),expectedRevisionDelta:manifest.expectedRevisionDelta};
  const postcheck=verifyLiveSqlPostcheck({plan,generated,result,baselineSnapshot:baseline.snapshot,currentSnapshot:current.snapshot,
    postSnapshot:post.snapshot,catalog,sourceUrl});
  const summary={projectRef:SNAPSHOT_PROJECT,run:plan.run,priorSqlCommitVerified:true,sqlRepeated:false,
    exactRowsPreviouslyDeleted:plan.targets.length,authTargets:plan.authTargets.map(t=>t.id),reviewSha256:review.reviewSha256,
    cleanupVerified:false,certified:false};
  if(options.execute!==true)return summary;
  const output=privatePath(options.output||join('.evidence-h171-private','live-recovery','auth-resume-'+randomUUID()));
  const io=await createLiveAuthorityIO({catalog,sourceUrl,cliPath:resolve('node_modules/supabase/dist/supabase.js'),
    linkedDirectory:resolve(options['linked-directory']||'.'),privateDirectory:output});
  const persist=(name,value)=>durableJson(join(output,name+'.json'),value);
  await persist('auth-resume-input',{...summary,executionDirectory:directory,journalSha256:journalHash(journalSnapshot),
    planFileSha256:planFile.sha256,resultFileSha256:resultFile.sha256,historicalAuthFileSha256:historicalAuthFile.sha256,baselineFileSha256:baseline.evidence.sha256,
    currentFileSha256:current.evidence.sha256,postSqlFileSha256:post.evidence.sha256});
  let journal;
  try{
    journal=await openLiveJournal({file:join(runDirectory,'mutation-journal.json'),run:plan.run,projectRef:SNAPSHOT_PROJECT,
      artifactSha256:plan.artifactSha256});
    assert.equal(journalHash(journal.snapshot()),journalHash(journalSnapshot),'AUTH_RESUME_JOURNAL_CHANGED');
    const readPreflight=async label=>{const response=await io.query(buildAuthCleanupPreflightSql({plan,catalog,sourceUrl}),label);
      // The saved read was incomplete only for Storage count coverage. Its
      // foreign Auth/POS/catalog hashes still fence intervening real activity.
      const checked=validateAuthCleanupPreflight({input:response.payload,plan,catalog,sourceUrl,baseline:historicalAuth});
      assert.equal(checked.ready,true,'AUTH_RESUME_FRESH_PREFLIGHT_INCOMPLETE');return checked.preflight;};
    const authState=await readPreflight('auth-after-sql');
    assert.deepEqual(authState.pos_catalog,post.snapshot.catalog,'AUTH_RESUME_POS_CATALOG_CHANGED');
    const sorted=values=>[...values].sort((a,b)=>a.table.localeCompare(b.table));
    assert.deepEqual(sorted(authState.pos_fingerprints),sorted(postcheck.posFingerprints),'AUTH_RESUME_POS_CHANGED_AFTER_SQL');
    const request=post.snapshot.tables.find(t=>t.table==='online_account_requests').rows.find(r=>JSON.parse(r.pk_json_text).request_id==='70549527-4867-4342-94d2-38e770b0f2a9');
    assert.ok(request);assert.equal(authState.protected_request.fullRowMd5,request.full_row_md5);
    Object.assign(postcheck,{protectedRequest:authState.protected_request,snapshotCatalogSha256:postcheck.posCatalogSha256,
      posCatalogSha256:authState.pos_catalog_sha256,authDependencyCatalogSha256:authState.auth_dependency_catalog_sha256,
      nonTargetAuthIds:authState.non_target_auth_ids,foreignAuthFingerprint:authState.foreign_auth_fingerprint,
      storageOwnerCatalog:authState.storage_owner_catalog,snapshotRevision:authState.snapshot_revision});
    const postFile=await persist('sql-postcheck',postcheck);
    const proof={format:'balam-live-auth-sql-proof-v1',projectRef:SNAPSHOT_PROJECT,run:plan.run,actorId:plan.actorId,
      artifactSha256:plan.artifactSha256,planSha256:journalHash(plan),journalSha256:plan.journalSha256,
      status:'COMMITTED_AND_VERIFIED',commitConfirmed:true,sqlSha256,sqlManifestSha256:generated.planSha256,
      resultFileSha256:resultFile.sha256,postcheckFileSha256:postFile.sha256,result,postcheck};
    await persist('sql-commit-outcome',proof);
    let key;
    try{const raw=execFileSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'projects','api-keys',
      '--project-ref',SNAPSHOT_PROJECT,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true});
      const parsed=JSON.parse(raw);key=(Array.isArray(parsed)?parsed:parsed.rows).find(r=>r.name==='service_role')?.api_key;assert.ok(key);
    }catch{throw Error('AUTH_RESUME_OWNER_CREDENTIAL_UNAVAILABLE');}
    const admin=createClient(sourceUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init={})=>fetch(input,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)})}});
    let inspections=0;
    const auth=createLiveCleanupAuth({admin:admin.auth.admin,journal,plan,identityEvidence:identityFile.value,
      identityEvidenceFileSha256:identityFile.sha256,proof,preflight:()=>readPreflight('auth-fresh-'+String(++inspections))});
    const retired=await auth.retireAll();await persist('auth-cleanup-result',retired);
    assert.equal(retired.authAbsenceVerified,true,'AUTH_RESUME_ABSENCE_UNCONFIRMED');
    const final=await io.capture('after-all-cleanup',{reusePointZeroFrom:baseline.snapshot});
    const diff=diffLiveSnapshots({baseline:baseline.snapshot,final:final.snapshot,catalog,sourceUrl,
      approvedMonotonicCreations:plan.preservedCounterCreations||[]});
    assert.equal(diff.nonQaPreservedWithMonotonicAdvances,true,'AUTH_RESUME_FINAL_OUTSIDE_CHANGE');
    assert.deepEqual(final.snapshot.auth_user_ids,baseline.snapshot.auth_user_ids,'AUTH_RESUME_FINAL_AUTH_RESIDUE');
    const report={...summary,format:'balam-live-cleanup-completion-v1',at:new Date().toISOString(),artifactSha256:plan.artifactSha256,
      output,cleanupVerified:true,exactRowsDeleted:plan.targets.length,authAbsent:summary.authTargets,newPosResidue:0,newAuthResidue:0,
      protectedTables:64,nonQaPreserved:true,monotonicAdvances:[...diff.changed,...diff.new.filter(r=>r.classification==='MONOTONIC_CREATION_TO_PRESERVE')],
      baselineFileSha256:baseline.evidence.sha256,finalFileSha256:final.evidence.sha256,separateTransactions:true};
    await persist('cleanup-completion',report);return report;
  }finally{await journal?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await resumeCommittedAuthCleanup(authResumeArguments(process.argv.slice(2)))));}
  catch(error){const reason=String(error?.message||'').match(/^AUTH_RESUME_[A-Z_]+/)?.[0]||null;
    console.error(JSON.stringify({code:'H171_AUTH_RESUME_STOPPED',reason,cleanupVerified:false,certified:false}));process.exitCode=1;}
}
