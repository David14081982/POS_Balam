// H171 concrete operator controller. No I/O on import. The runner remains gated
// until this lifecycle and its adapters have passed their integration checks.
import assert from 'node:assert/strict';
import { join, resolve, relative } from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { durableJson } from './h171-live-authority-io.mjs';
import { journalHash } from './h171-live-journal.mjs';
import { createLiveReconciler } from './h171-live-reconciliation.mjs';
import { buildLiveCleanupPlan } from './h171-live-cleanup-plan.mjs';
import { buildLiveCleanupSql } from './h171-live-cleanup-sql.mjs';
import { verifyCanonicalFixtureBackup, verifyLiveSqlPostcheck } from './h171-live-cleanup-validation.mjs';
import { buildLiveAuthIdentityEvidence, createLiveCleanupAuth } from './h171-live-cleanup-auth.mjs';
import { diffLiveSnapshots, validateLiveSnapshot, SNAPSHOT_PROJECT, SNAPSHOT_ACTOR } from './h171-live-snapshot.mjs';

const fileHash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Recovery must reuse the durable capture made BEFORE this run's Auth creation.
// A current capture can never stand in for that baseline.
export async function loadOriginalLiveBaseline({baselineFile,authBaselineFile,baselineSha256,authBaselineSha256},
  {catalog,sourceUrl,run,actorId,artifactSha256,journalSnapshot}) {
  const read=async(file,expected)=>{
    assert.match(expected||'',/^[a-f0-9]{64}$/,'ORIGINAL_BASELINE_EXPECTED_FILE_HASH_REQUIRED');
    const absolute=resolve(file),inside=relative(resolve('.evidence-h171-private'),absolute);
    assert.ok(inside&&!inside.startsWith('..')&&!inside.includes(':'),'ORIGINAL_BASELINE_PRIVATE_PATH_REQUIRED');
    const bytes=await fs.readFile(absolute);assert.equal(fileHash(bytes),expected,'ORIGINAL_BASELINE_FILE_HASH_MISMATCH');
    return {value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),evidence:{file:absolute,sha256:expected,bytes:bytes.length}};
  };
  const original=await read(baselineFile,baselineSha256),auth=await read(authBaselineFile,authBaselineSha256);
  // writePrivateLiveSnapshot adds only this local envelope after authBaseline's
  // hash input was captured. Verify it, then recover the original SQL object.
  if(Object.hasOwn(original.value,'local')){
    assert.deepEqual(original.value.local,{path:original.evidence.file,sourceUrl},'ORIGINAL_BASELINE_LOCAL_ENVELOPE_MISMATCH');
    delete original.value.local;
  }
  const snapshot=validateLiveSnapshot(original.value,{catalog,sourceUrl}).snapshot,value=auth.value;
  assert.equal(value.format,'balam-live-auth-baseline-v1');assert.equal(value.projectRef,SNAPSHOT_PROJECT);
  assert.equal(value.run,run);assert.equal(value.actorId,actorId);assert.equal(value.artifactSha256,artifactSha256);
  assert.equal(value.complete,true);assert.equal(value.snapshotSha256,journalHash(snapshot),'ORIGINAL_BASELINE_AUTH_BINDING_MISMATCH');
  assert.deepEqual(value.ids,snapshot.auth_user_ids);assert.ok(value.ids.includes(SNAPSHOT_ACTOR)&&!value.ids.includes(actorId));
  assert.equal(journalSnapshot.run,run);assert.equal(journalSnapshot.artifactSha256,artifactSha256);
  const create=journalSnapshot.entries.find(e=>e.kind==='auth-create'&&e.identities?.userId===actorId);
  assert.ok(create&&Number.isFinite(Date.parse(snapshot.at))&&Date.parse(snapshot.at)<=Date.parse(create.preparedAt),
    'ORIGINAL_BASELINE_MUST_PRECEDE_AUTH_INTENT');
  return {baseline:{snapshot,evidence:original.evidence},authBaseline:{...value,fileSha256:auth.evidence.sha256}};
}

export async function createLiveCleanupLifecycle({io,db,admin,journal,fixtures,artifactSha256,clientBuild,readAuthPreflight,originalBaseline}) {
  assert.equal(typeof readAuthPreflight,'function');
  assert.equal(journal.snapshot().projectRef,SNAPSHOT_PROJECT);
  const {catalog,sourceUrl}=io;
  assert.equal(sourceUrl,`https://${SNAPSHOT_PROJECT}.supabase.co/`,'LIVE_CLEANUP_CANONICAL_SOURCE_ORIGIN_REQUIRED');
  const plannedActorId=fixtures.plannedActorId;
  assert.notEqual(plannedActorId,SNAPSHOT_ACTOR);assert.ok(plannedActorId,'PLANNED_ACTOR_BEFORE_BASELINE_REQUIRED');
  const recovered=originalBaseline?await loadOriginalLiveBaseline(originalBaseline,{catalog,sourceUrl,run:fixtures.run,
    actorId:plannedActorId,artifactSha256,journalSnapshot:journal.snapshot()}):null;
  const baseline=recovered?.baseline||await io.capture('before-fixtures');
  const authBaseline=recovered?.authBaseline||await io.authBaseline({baseline,run:fixtures.run,actorId:plannedActorId,artifactSha256});
  const persist=(name,value)=>durableJson(join(io.directory,name+'.json'),value);
  let finalized=false;
  async function finalize({execute=true,approvedReviewSha256}={}) {
    assert.equal(finalized,false,'CLEANUP_LIFECYCLE_ALREADY_ATTEMPTED');finalized=true;
    await journal.flush();journal.assertHealthy();
    assert.equal(fixtures.userId,plannedActorId,'PROVISIONED_ACTOR_DIFFERS_FROM_PRECOMMITTED_ID');
    const snapshot=journal.snapshot();
    assert.equal(snapshot.entries.some(e=>e.kind==='live-cleanup-sql-attempt'),false,'PRIOR_SQL_ATTEMPT_REQUIRES_READ_ONLY_RECOVERY');
    const reconciler=createLiveReconciler({db,admin,expectedProjectRef:SNAPSHOT_PROJECT,
      expectedActorId:plannedActorId,protectedAuthIds:authBaseline.ids});
    const reconciliation=await reconciler.reconcile({snapshot,fixtures});
    await persist('reconciliation',reconciliation);
    assert.equal(reconciliation.reconciled,true,'READ_ONLY_RECONCILIATION_INCOMPLETE');
    const current=await io.capture('after-scenarios',{reusePointZeroFrom:baseline.snapshot});
    const plan=buildLiveCleanupPlan({journalSnapshot:snapshot,fixtures,reconciliation,baselineSnapshot:baseline.snapshot,
      currentSnapshot:current.snapshot,catalog,sourceUrl,authBaseline,clientBuild,
      backup:{baselineFileSha256:baseline.evidence.sha256,currentFileSha256:current.evidence.sha256}});
    const planEvidence=await persist('cleanup-plan',plan);
    assert.equal(plan.readyForReview,true,'EXACT_NEW_FIXTURE_PLAN_INCOMPLETE');
    const restoration=await verifyCanonicalFixtureBackup({plan,catalog});
    await persist('backup-restore-validation',restoration);
    const generated=buildLiveCleanupSql({plan,catalog,baselineSnapshot:baseline.snapshot,currentSnapshot:current.snapshot,sourceUrl});
    await persist('cleanup-manifest',generated.manifest);
    const users=[];
    for(const target of plan.authTargets) {
      const response=await admin.auth.admin.getUserById(target.id);
      assert.equal(response.error,null,'AUTH_IDENTITY_GET_REQUIRED_BEFORE_SQL');users.push(response.data.user);
    }
    const identityEvidence=buildLiveAuthIdentityEvidence({plan,users,observedAt:new Date().toISOString()});
    const identityFile=await persist('auth-identity-before-cleanup',identityEvidence);
    // The review binds all destructive identities, their full hashes, outside
    // rows, catalog, revision, Auth bodies and the unchanged journal prefix.
    // Observation timestamps/file names are intentionally not approval inputs.
    const binding={projectRef:SNAPSHOT_PROJECT,run:fixtures.run,actorId:plannedActorId,artifactSha256,clientBuild,
      baselineFileSha256:baseline.evidence.sha256,authBaselineSha256:authBaseline.fileSha256,journalSha256:plan.journalSha256,
      targets:plan.targets.map(t=>({table:t.table,pk_json_text:t.pk_json_text,full_row_md5:t.full_row_md5,provenance:t.provenance})),
      holds:plan.holds,authTargets:plan.authTargets,authIdentities:identityEvidence.identities,
      outside:generated.manifest.outside,catalogSha256:generated.manifest.catalogSha256,
      revisionFullRowMd5:current.snapshot.tables.find(t=>t.table==='online_snapshot_revision').rows[0].full_row_md5,
      expectedRevisionDelta:generated.expectedRevisionDelta};
    const reviewSha256=journalHash(binding),sqlFile=join(io.directory,'cleanup-reviewed.sql');
    const sqlHandle=await fs.open(sqlFile,'wx',0o600);
    try{await sqlHandle.writeFile(generated.sql,'utf8');await sqlHandle.sync();}finally{await sqlHandle.close();}
    assert.equal(fileHash(await fs.readFile(sqlFile)),journalHash(generated.sql));
    const review={format:'balam-live-cleanup-review-v1',reviewSha256,binding,sqlFile,sqlSha256:journalHash(generated.sql),
      exactRows:plan.targets.length,authTargets:plan.authTargets.map(t=>t.id),restorationVerified:true,
      originalBaselineReused:!!recovered,executed:false,cleanupVerified:false,certified:false};
    await persist('cleanup-review',review);
    if(execute===false)return review;
    assert.equal(execute,true,'CLEANUP_EXPLICIT_EXECUTION_REQUIRED');
    if(recovered){assert.match(approvedReviewSha256||'',/^[a-f0-9]{64}$/,'RECOVERY_REVIEW_APPROVAL_REQUIRED');
      assert.equal(approvedReviewSha256,reviewSha256,'RECOVERY_REVIEW_CHANGED');}
    // Exact scope and restoration evidence exist before the one destructive attempt.
    assert.equal(journalHash(journal.snapshot()),journalHash(snapshot),'MUTATION_EMITTER_NOT_QUIESCENT');
    const execution=await journal.beforeMutation({kind:'live-cleanup-sql-attempt',checkpoint:'Exact self-cleanup after emitters stopped',
      requestId:fixtures.run,actorId:plannedActorId,identities:{run:fixtures.run},command:{planSha256:journalHash(plan),
        planFileSha256:planEvidence.sha256,sqlSha256:journalHash(generated.sql),expectedRows:generated.expectedRows}},
    ()=>{
      const state=journal.snapshot();
      assert.equal(state.entries.length,snapshot.entries.length+1,'LATE_MUTATION_INTENT_DURING_CLEANUP');
      assert.equal(journalHash({...state,entries:state.entries.slice(0,-1)}),plan.journalSha256,'CLEANUP_JOURNAL_PREFIX_CHANGED');
      return io.query(generated.sql,'cleanup-execution');
    });
    const reports=execution.rows.filter(row=>row.report?.format==='balam-new-fixture-cleanup-result-v1');
    assert.equal(reports.length,1,'ONE_COMMITTED_CLEANUP_REPORT_REQUIRED');
    const result=reports[0].report;
    const post=await io.capture('after-sql-cleanup',{reusePointZeroFrom:baseline.snapshot});
    const postcheck=verifyLiveSqlPostcheck({plan,generated,result,baselineSnapshot:baseline.snapshot,currentSnapshot:current.snapshot,
      postSnapshot:post.snapshot,catalog,sourceUrl});
    const authState=await readAuthPreflight({plan,label:'auth-after-sql'});
    assert.deepEqual(authState.pos_catalog,post.snapshot.catalog,'AUTH_PREFLIGHT_POS_CATALOG_CHANGED');
    assert.deepEqual([...authState.pos_fingerprints].sort((a,b)=>a.table.localeCompare(b.table)),
      [...postcheck.posFingerprints].sort((a,b)=>a.table.localeCompare(b.table)),'AUTH_PREFLIGHT_POS_CHANGED_AFTER_SQL');
    const request=post.snapshot.tables.find(t=>t.table==='online_account_requests').rows.find(r=>
      JSON.parse(r.pk_json_text).request_id==='70549527-4867-4342-94d2-38e770b0f2a9');
    assert.ok(request,'REAL_REQUEST_MISSING_AFTER_SQL');
    assert.equal(authState.protected_request.fullRowMd5,request.full_row_md5,'REAL_REQUEST_HASH_CHANGED');
    Object.assign(postcheck,{protectedRequest:authState.protected_request,
      snapshotCatalogSha256:postcheck.posCatalogSha256,posCatalogSha256:authState.pos_catalog_sha256,
      authDependencyCatalogSha256:authState.auth_dependency_catalog_sha256,
      nonTargetAuthIds:authState.non_target_auth_ids,foreignAuthFingerprint:authState.foreign_auth_fingerprint,
      storageOwnerCatalog:authState.storage_owner_catalog,snapshotRevision:authState.snapshot_revision});
    const postFile=await persist('sql-postcheck',postcheck);
    const proof={format:'balam-live-auth-sql-proof-v1',projectRef:SNAPSHOT_PROJECT,run:fixtures.run,actorId:plannedActorId,
      artifactSha256,planSha256:journalHash(plan),journalSha256:plan.journalSha256,status:'COMMITTED_AND_VERIFIED',commitConfirmed:true,
      sqlSha256:execution.sqlSha256,sqlManifestSha256:generated.planSha256,resultFileSha256:execution.evidence.sha256,
      postcheckFileSha256:postFile.sha256,result,postcheck};
    await persist('sql-commit-outcome',proof);
    let inspections=0;
    const auth=createLiveCleanupAuth({admin:admin.auth.admin,journal,plan,identityEvidence,
      identityEvidenceFileSha256:identityFile.sha256,proof,
      preflight:()=>readAuthPreflight({plan,label:'auth-fresh-'+String(++inspections)})});
    const retired=await auth.retireAll();await persist('auth-cleanup-result',retired);
    assert.equal(retired.authAbsenceVerified,true,'NEW_AUTH_CLEANUP_NOT_VERIFIED');
    const final=await io.capture('after-all-cleanup',{reusePointZeroFrom:baseline.snapshot});
    const finalDiff=diffLiveSnapshots({baseline:baseline.snapshot,final:final.snapshot,catalog,sourceUrl,
      approvedMonotonicCreations:plan.preservedCounterCreations||[]});
    assert.equal(finalDiff.nonQaPreservedWithMonotonicAdvances,true,'FINAL_OUTSIDE_CHANGE_OR_NEW_RESIDUE');
    assert.deepEqual(final.snapshot.auth_user_ids,baseline.snapshot.auth_user_ids,'FINAL_AUTH_ID_RESIDUE_OR_OUTSIDE_CHANGE');
    const report={format:'balam-live-cleanup-completion-v1',at:new Date().toISOString(),run:fixtures.run,projectRef:SNAPSHOT_PROJECT,
      artifactSha256,cleanupVerified:true,exactRowsDeleted:plan.targets.length,authAbsent:plan.authTargets.map(t=>t.id),
      newPosResidue:0,newAuthResidue:0,protectedTables:64,nonQaPreserved:true,
      monotonicAdvances:[...finalDiff.changed,...finalDiff.new.filter(r=>r.classification==='MONOTONIC_CREATION_TO_PRESERVE')],
      preservedCounterCreations:plan.preservedCounterCreations||[],
      baselineFileSha256:baseline.evidence.sha256,finalFileSha256:final.evidence.sha256,
      separateTransactions:true,certified:false};
    await persist('cleanup-completion',report);return report;
  }
  return {baseline:baseline.snapshot,authBaseline,finalize};
}
