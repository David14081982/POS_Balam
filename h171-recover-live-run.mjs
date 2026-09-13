// H171 exact stopped-run recovery. Default is READ-ONLY remote planning.
// No browser, fixture creation, replay, baseline replacement or I/O on import.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {openLiveJournal} from './h171-live-journal.mjs';
import {recordedSnapshotCatalog,validateLiveSnapshot,SNAPSHOT_PROJECT} from './h171-live-snapshot.mjs';
import {createLiveAuthorityIO,durableJson} from './h171-live-authority-io.mjs';
import {createLiveCleanupLifecycle} from './h171-live-cleanup-lifecycle.mjs';
import {buildAuthCleanupPreflightSql,validateAuthCleanupPreflight} from './h171-live-cleanup-auth-preflight.mjs';

export function recoveryArguments(argv) {
  const options={execute:false};
  const permitted=new Set(['run-dir','baseline-dir','baseline-sha256','auth-baseline-sha256','client-build',
    'output','linked-directory','approved-review-sha256','planning-capture-dir']);
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(key==='--execute'){assert.equal(options.execute,false);options.execute=true;continue;}
    assert.ok(key.startsWith('--')&&permitted.has(key.slice(2))&&argv[i+1]&&!argv[i+1].startsWith('--'),'RECOVERY_ARGUMENT_INVALID');
    assert.equal(options[key.slice(2)],undefined);options[key.slice(2)]=argv[++i];
  }
  for(const key of ['run-dir','baseline-dir','baseline-sha256','auth-baseline-sha256','client-build'])assert.ok(options[key],'RECOVERY_ARGUMENT_REQUIRED');
  for(const key of ['baseline-sha256','auth-baseline-sha256'])assert.match(options[key],/^[a-f0-9]{64}$/);
  assert.match(options['client-build'],/^20\d\d-\d\d-\d\d-h\d+-online$/);
  if(options.execute){assert.equal(options['planning-capture-dir'],undefined,'RECOVERY_EXECUTION_REQUIRES_FRESH_CAPTURE');
    assert.match(options['approved-review-sha256']||'',/^[a-f0-9]{64}$/,'RECOVERY_REVIEW_APPROVAL_REQUIRED');}
  else assert.equal(options['approved-review-sha256'],undefined);
  return options;
}

export async function recoverLiveRun(options) {
  const privatePath=value=>{const absolute=resolve(value),inside=relative(resolve('.evidence-h171-private'),absolute);
    assert.ok(inside&&!inside.startsWith('..')&&!inside.includes(':'),'RECOVERY_PRIVATE_PATH_REQUIRED');return absolute;};
  const runDirectory=privatePath(options['run-dir']),baselineDirectory=privatePath(options['baseline-dir']);
  const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
  const fixtures=await read(join(runDirectory,'fixtures.json')),storedJournal=await read(join(runDirectory,'mutation-journal.json'));
  assert.equal(fixtures.run,storedJournal.run);assert.equal(storedJournal.projectRef,SNAPSHOT_PROJECT);
  assert.equal(fixtures.userId,fixtures.plannedActorId);
  const artifact=await fs.readFile(join(runDirectory,'verified-artifact.html'));
  assert.equal(createHash('sha256').update(artifact).digest('hex'),storedJournal.artifactSha256,'RECOVERY_ARTIFACT_MISMATCH');
  assert.ok(!storedJournal.entries.some(e=>e.kind==='live-cleanup-sql-attempt'),'PRIOR_SQL_ATTEMPT_REQUIRES_READ_ONLY_RECOVERY');
  const catalog=recordedSnapshotCatalog({authorityAudit:await read('docs/fixes/evidence/h171/authority-audit-before.json'),
    cleanupCatalog:await read('docs/fixes/evidence/h171/cleanup-catalog-before.json')});
  const sourceUrl=`https://${SNAPSHOT_PROJECT}.supabase.co/`,cliPath=resolve('node_modules/supabase/dist/supabase.js');
  const output=privatePath(options.output||join('.evidence-h171-private','live-recovery',fixtures.run,randomUUID()));
  const io=await createLiveAuthorityIO({catalog,sourceUrl,cliPath,linkedDirectory:resolve(options['linked-directory']||'.'),privateDirectory:output});
  if(options['planning-capture-dir']){
    assert.equal(options.execute,false,'RECOVERY_EXECUTION_REQUIRES_FRESH_CAPTURE');
    const previous=privatePath(options['planning-capture-dir']),input=await read(join(previous,'recovery-input.json'));
    assert.equal(input.run,fixtures.run);assert.equal(input.projectRef,SNAPSHOT_PROJECT);
    assert.equal(input.artifactSha256,storedJournal.artifactSha256);
    assert.equal(input.baselineSha256,options['baseline-sha256']);assert.equal(input.authBaselineSha256,options['auth-baseline-sha256']);
    const file=join(previous,'after-scenarios.json'),bytes=await fs.readFile(file);
    const snapshot=validateLiveSnapshot(JSON.parse(bytes.toString('utf8')),{catalog,sourceUrl}).snapshot;
    io.capture=async label=>{assert.equal(label,'after-scenarios','RECOVERY_PLANNING_CACHE_ONLY');
      return {snapshot,evidence:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}};};
  }
  const input={format:'balam-live-recovery-input-v1',run:fixtures.run,projectRef:SNAPSHOT_PROJECT,
    artifactSha256:storedJournal.artifactSha256,runDirectory,baselineDirectory,execute:options.execute,
    baselineSha256:options['baseline-sha256'],authBaselineSha256:options['auth-baseline-sha256']};
  await durableJson(join(output,'recovery-input.json'),input);
  let journal;
  try{
    journal=await openLiveJournal({file:join(runDirectory,'mutation-journal.json'),run:fixtures.run,projectRef:SNAPSHOT_PROJECT,
      artifactSha256:storedJournal.artifactSha256});
    // Standard owner CLI session. Raw child output/key never leaves this scope.
    let key;
    try{const raw=execFileSync(process.execPath,[cliPath,'projects','api-keys','--project-ref',SNAPSHOT_PROJECT,'--output','json'],
      {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true});
      const rows=JSON.parse(raw);key=(Array.isArray(rows)?rows:rows.rows).find(r=>r.name==='service_role')?.api_key;assert.ok(key);
    }catch{throw Error('RECOVERY_OWNER_CREDENTIAL_UNAVAILABLE');}
    const admin=createClient(sourceUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init={})=>fetch(input,{...init,signal:init.signal?
        AbortSignal.any([init.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)})}});
    const readAuthPreflight=async({plan,label})=>{
      const result=await io.query(buildAuthCleanupPreflightSql({plan,catalog,sourceUrl}),label);
      const checked=validateAuthCleanupPreflight({input:result.payload,plan,catalog,sourceUrl});
      assert.equal(checked.ready,true,'AUTH_PREFLIGHT_INCOMPLETE');return checked.preflight;
    };
    const lifecycle=await createLiveCleanupLifecycle({io,db:admin.schema('pos'),admin,journal,fixtures,
      artifactSha256:storedJournal.artifactSha256,clientBuild:options['client-build'],readAuthPreflight,
      originalBaseline:{baselineFile:join(baselineDirectory,'before-fixtures.json'),authBaselineFile:join(baselineDirectory,'auth-baseline.json'),
        baselineSha256:options['baseline-sha256'],authBaselineSha256:options['auth-baseline-sha256']}});
    const result=await lifecycle.finalize({execute:options.execute,approvedReviewSha256:options['approved-review-sha256']});
    return {projectRef:SNAPSHOT_PROJECT,run:fixtures.run,output,execute:options.execute,reviewSha256:result.reviewSha256||null,
      exactRows:result.exactRows??result.exactRowsDeleted,authTargets:result.authTargets||result.authAbsent,
      cleanupVerified:result.cleanupVerified===true,certified:false};
  }finally{await journal?.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  // Includes parsing, CLI credential retrieval and all child process failures.
  try{console.log(JSON.stringify(await recoverLiveRun(recoveryArguments(process.argv.slice(2)))));}
  catch(error){const known=String(error?.message||'').match(/^(ORIGINAL_BASELINE_[A-Z_]+|RECOVERY_[A-Z_]+|READ_ONLY_RECONCILIATION_INCOMPLETE|EXACT_NEW_FIXTURE_PLAN_INCOMPLETE|PRIOR_SQL_ATTEMPT_REQUIRES_READ_ONLY_RECOVERY)/)?.[0];
    console.error(JSON.stringify({code:'H171_RECOVERY_STOPPED',reason:known||null,cleanupVerified:false,certified:false}));process.exitCode=1;}
}
