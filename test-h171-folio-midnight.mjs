// Narrow local midnight regression: real canonical PostgreSQL rows, durable
// journal and reconciler; no network, counter creation or writes outside PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createLiveCleanupPlanFixture} from './test-h171-live-cleanup-plan.mjs';
import {buildLiveCleanupPlan,proveNewFolioCounter} from './h171-live-cleanup-plan.mjs';
import {diffLiveSnapshots,SNAPSHOT_ACTOR} from './h171-live-snapshot.mjs';
import {journalHash} from './h171-live-journal.mjs';
import {postgresJsonbHash} from './h171-live-reconciliation.mjs';
const f=await createLiveCleanupPlanFixture({keepJournalOpen:true});
const q=v=>"'"+String(v).replaceAll("'","''")+"'",contexts=[],checks=[];
try{
  for(const sequence of [1,2]){
    const id=randomUUID(),c={type:'folio',prefix:'BG',businessDate:'260913',documentKind:'sale',floor:0,expectedActorId:f.actorId};
    const response={ok:true,prefix:'BG',business_date:'2026-09-13',from:sequence,to:sequence,folio:'BG-260913-'+String(sequence).padStart(4,'0')};
    const e=await f.journal.prepare({kind:'rpc:execute_online_command',checkpoint:'local midnight allocation',actorId:f.actorId,
      requestId:id,identities:{requestId:id},command:c});
    await f.insert('online_requests',{actor_id:q(f.actorId),request_id:q(id),device_id:q(f.fixtures.installations[0]),
      state:"'confirmed'",command_kind:"'folio'",command_hash:q(postgresJsonbHash(c)),response:q(JSON.stringify({ok:true,requestId:id,result:response}))+'::jsonb'});
    contexts.push({c,response,e,id});
  }
  await f.insert('folio_counters',{prefix:"'BG'",business_date:"DATE '2026-09-13'",last_seq:'2'});
  const input=f.input();input.currentSnapshot=await f.capture();input.journalSnapshot=f.journal.snapshot();await f.reconcile(input);
  const plan=buildLiveCleanupPlan(input),creation=plan.preservedCounterCreations[0];
  assert.equal(plan.readyForReview,true);assert.equal(plan.preservedCounterCreations.length,1);
  assert.equal(plan.targets.some(t=>t.table==='folio_counters'),false);
  assert.equal(creation.allocations.length,2);assert.deepEqual(creation.allocations.map(p=>p.sequence),[1,2]);
  checks.push('complete 1..last_seq proof retains one new day; counter never selected for DELETE');
  const find=(table,predicate)=>input.currentSnapshot.tables.find(t=>t.table===table).rows.find(r=>predicate(JSON.parse(r.row_json_text)));
  const counter={table:'folio_counters',...find('folio_counters',b=>b.business_date==='2026-09-13')};
  for(const x of contexts){const r=find('online_requests',b=>b.request_id===x.id);x.r={...r,body:JSON.parse(r.row_json_text)};}
  const foreign=structuredClone(contexts);foreign[0].r.body.actor_id=SNAPSHOT_ACTOR;
  assert.equal(proveNewFolioCounter({row:counter,contexts:foreign,actorId:f.actorId,run:f.run}),null);
  checks.push('foreign actor receipt cannot authorize a counter creation');
  assert.equal(proveNewFolioCounter({row:counter,contexts:contexts.slice(1),actorId:f.actorId,run:f.run}),null);
  checks.push('missing allocation leaves unexplained sequence held');
  const exactQaDeltas=plan.targets.map(t=>({table:t.table,pk_json_text:t.pk_json_text,before_full_md5:null,
    after_full_md5:t.full_row_md5,provenanceSha256:journalHash(t.provenance)}));
  const args={baseline:input.baselineSnapshot,final:input.currentSnapshot,catalog:f.catalog,sourceUrl:f.sourceUrl,
    exactQaDeltas,approvedMonotonicCreations:plan.preservedCounterCreations};
  assert.equal(diffLiveSnapshots(args).nonQaPreservedWithMonotonicAdvances,true);
  assert.equal(diffLiveSnapshots(args).new.find(r=>r.table==='folio_counters').classification,'MONOTONIC_CREATION_TO_PRESERVE');
  await f.db.exec("UPDATE pos.folio_counters SET last_seq=3 WHERE prefix='BG' AND business_date='2026-09-13';");
  assert.throws(()=>diffLiveSnapshots({...args,final:{}}));
  const changed=await f.capture();assert.throws(()=>diffLiveSnapshots({...args,final:changed}),/SNAPSHOT_RETAINED_COUNTER_DRIFT/);
  checks.push('subsequent full-row hash change blocks final preservation proof');
  await fs.writeFile('docs/fixes/evidence/h171/folio-midnight-local.json',JSON.stringify({scope:'LOCAL_PGLITE_ONLY',passed:checks.length,
    checks,remoteWrites:0,certified:false,preservedCounterCreation:creation},null,2)+'\n');
  console.log(checks.length+' PASS; new counter preserved; remote writes 0');
}finally{await f.close();}
