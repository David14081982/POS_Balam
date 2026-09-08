import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {webcrypto,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const harness=readFileSync('test-store-queue.mjs','utf8');
const freshEnv=new Function(harness.slice(harness.indexOf('function freshEnv()'),harness.indexOf('\nconst SRC ='))+'\nreturn freshEnv;')();
const storeSource=process.argv.includes('--baseline')
 ?execFileSync('git',['show','HEAD:balam/store.jsx'],{encoding:'utf8'}) :readFileSync('balam/store.jsx','utf8');
const source=readFileSync('balam/core.jsx','utf8')+'\n'+storeSource;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setup(count,{backup=false,unknown=false,oldEpoch=false,archived=false}={}) {
 const e=freshEnv();e.window.crypto=webcrypto;
 e.cloud.directedRecoveryEnabled=true;
 e.client.auth.getSession=async()=>({data:{session:{user:{id:'qa-owner'}}},error:null});
 const device='qa-h149-'+randomUUID();e.localStorage.setItem('balam_device_id',device);
 e.localStorage.setItem('balam_auth','preserve-auth');e.localStorage.setItem('balam-sidebar','1');
 const queue=Array.from({length:count},()=>({id:randomUUID(),type:'upsert',kind:'products',table:'products',
  rows:[{id:randomUUID(),nombre:'Test pending',precio:1,sync_base_version:0,sync_device_id:device}],
  conflict:'id',ownerId:null,status:'pending',protocolVersion:3,dataEpoch:1}));
 e.localStorage.setItem('balam_sync_queue',JSON.stringify(queue));
 if(archived){
  e.localStorage.setItem('balam_sync_quarantine_1_qa',JSON.stringify({epoch:1,operations:queue,reportedAt:'qa'}));
  e.localStorage.setItem('balam_sync_queue','[]');
 }
 if(backup)e.idb.set('balam_sync_queue',structuredClone(queue));
 let plan={id:randomUUID(),device_id:device,state:'pending',expected_count:count,source_epoch:1,
  protocol_version:3,minimum_build:'2026-09-08-h149',candidate_ids:queue.map(o=>o.id)};
 if(oldEpoch)plan.source_epoch=2;
 if(unknown)plan.candidate_ids[0]=randomUUID();
 let captures=0,completions=0,sent=[],failCapture=false,failComplete=false,lookupError=null;
 e.setRpc(async(name,args)=>{
  if(name==='get_sync_device_recovery')return {data:lookupError?null:structuredClone(plan),error:lookupError?{message:lookupError}:null};
  if(name==='capture_sync_device_recovery'){
   if(failCapture)return {data:null,error:{message:'network lost'}};
   assert.equal(e.localStorage.getItem('balam_sync_queue'),JSON.stringify(archived?[]:queue),'capture precedes deletion');
   captures++;plan={...plan,state:'captured',discarded_ids:args.p_evidence.operations.map(x=>x.id),evidence:args.p_evidence};
   return {data:structuredClone(plan),error:null};
  }
  if(name==='complete_sync_device_recovery'){
   if(failComplete)return {data:null,error:{message:'ACK lost'}};
   assert.equal(args.p_pending,0);assert.equal(args.p_cursors.products,1);
   assert.equal(e.window.DATA.products[0]?.id,'remote','complete follows remote reconstruction');
   completions++;plan={...plan,state:'completed',write_token:randomUUID()};
   return {data:structuredClone(plan),error:null};
  }
  if(name==='save_products_checked_v2'||name==='save_products_checked'){
   sent.push(args.p_operation_id);return {data:args.p_rows.map(r=>({...r,sync_version:1})),error:null};
  }
  return {data:null,error:null};
 });
 e.window.AUTH={current:()=>null,role:()=> 'admin',refreshPermissions:async()=>({ok:true})};
 e.cloud.rowsByTable.system_manifest=[{singleton:true,schema_version:20260830017500,sync_protocol_min:3,sync_protocol_current:3,data_epoch:oldEpoch?2:1,domain_modes:{products:'active'}}];
 e.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:1}];
 e.cloud.rowsByTable.products=[{id:'remote',nombre:'Confirmed remote',stock_quantity:10,sync_version:1}];
 e.window.DATA.products=[{id:'ghost',stockQuantity:999}];
 e.window.DATA.applyRemote=(kind,rows)=>{if(kind==='products')e.window.DATA.products.splice(0,Infinity,...rows);return true;};
 function boot(){return new Function('window','localStorage','document','CustomEvent','setInterval','clearInterval','navigator',source+'\nreturn window.STORE;')(
  e.window,e.localStorage,{hidden:false},class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},()=>1,()=>{},{onLine:true});}
 const S=boot();
 return {e,S,queue,boot,get plan(){return plan;},get sent(){return sent;},get captures(){return captures;},get completions(){return completions;},
  captureFailure:v=>failCapture=v,completeFailure:v=>failComplete=v,
  lookupFailure:v=>lookupError=v,noDirective:()=>plan=null};
}
let pass=0,fail=0;
async function test(name,fn){try{await fn();console.log('PASS '+name);pass++;}catch(e){console.log('FAIL '+name+': '+e.stack);fail++;}}
for(const count of [10,17])await test(`boot ${count}, zero legacy uploads, durable zero, convergence, reload and fresh operation`,async()=>{
 const t=setup(count,{backup:true});await t.S.init({});await t.S.reconcileDomains({force:true});
 assert.equal(t.sent.length,0);assert.equal(t.S.pending,0);assert.equal(t.e.idb.has('balam_sync_queue'),false);
 assert.equal(t.e.window.DATA.products[0].id,'remote');assert.equal(t.plan.state,'completed',JSON.stringify(t.S.syncStatus()));
 assert.equal(t.S.syncStatus().synchronized,true);assert.equal(t.captures,1);assert.equal(t.completions,1);
 assert.equal(t.e.localStorage.getItem('balam_auth'),'preserve-auth');assert.equal(t.e.localStorage.getItem('balam-sidebar'),'1');
 const newer={...t.queue[0],id:randomUUID()};t.e.localStorage.setItem('balam_sync_queue',JSON.stringify([newer]));
 const reloaded=t.boot();await reloaded.init({});await sleep(60);
 assert.deepEqual(t.sent,[newer.id]);assert.equal(reloaded.pending,0);assert.equal(t.captures,1);assert.equal(t.completions,1);
});
await test('unknown operation preserves the entire queue and blocks business',async()=>{
 const t=setup(10,{unknown:true});await t.S.init({});assert.equal(t.S.pending,10);assert.equal(t.sent.length,0);
 assert.equal(t.S.syncStatus().synchronized,false);assert.throws(()=>t.S.assertBusinessReady(),/actualizando/);
});
await test('failed evidence upload preserves all pending operations',async()=>{
 const t=setup(10);t.captureFailure(true);await t.S.init({});assert.equal(t.S.pending,10);assert.equal(t.captures,0);assert.equal(t.sent.length,0);
 t.captureFailure(false);await t.S.init({});assert.equal(t.S.pending,0);assert.equal(t.plan.state,'completed',JSON.stringify(t.S.syncStatus()));
});
await test('lost completion ACK resumes from server capture without repeating deletion',async()=>{
 const t=setup(17);t.completeFailure(true);await t.S.init({});assert.equal(t.S.pending,0);assert.equal(t.plan.state,'captured');
 assert.equal(t.S.syncStatus().synchronized,false);t.completeFailure(false);
 const restarted=t.boot();await restarted.init({});assert.equal(t.plan.state,'completed');assert.equal(t.captures,1);assert.equal(t.sent.length,0);
});
await test('receipt storage failure cannot delete pending operations',async()=>{
 const t=setup(10);t.e.failStorage('balam_device_recovery_v1');await t.S.init({});assert.equal(t.S.pending,10);assert.equal(t.sent.length,0);
 t.e.recoverStorage('balam_device_recovery_v1');await t.S.init({});assert.equal(t.S.pending,0);assert.equal(t.captures,1);
});
await test('queue fallback to IndexedDB stays empty after reboot',async()=>{
 const t=setup(17);t.e.failStorage('balam_sync_queue');await t.S.init({});assert.equal(t.S.pending,0);
 assert.deepEqual(t.e.idb.get('balam_sync_queue'),[]);assert.equal(t.plan.state,'completed');
 const restarted=t.boot();await restarted.init({});assert.equal(restarted.pending,0);assert.equal(t.sent.length,0);
});
await test('older queued epoch is captured without replay',async()=>{
 const t=setup(10,{oldEpoch:true});await t.S.init({});assert.equal(t.plan.state,'completed');
 assert.equal(t.sent.length,0);assert.ok(t.plan.evidence.operations.every(op=>op.epoch===1));
});
await test('a tab without the writer lease cannot consume a directive',async()=>{
 const t=setup(10);t.e.window.DATA.assertLocalWriter=()=>{throw Error('LOCAL_WRITER_REQUIRED');};
 await t.S.flushQueue();assert.equal(t.S.pending,10);assert.equal(t.captures,0);assert.equal(t.sent.length,0);
});
await test('failure of both durable stores cannot certify deletion held only in memory',async()=>{
 const t=setup(10);t.e.failStorage('balam_sync_queue');t.e.cloud.failQueueBackupWrite=true;
 await t.S.init({});assert.equal(t.plan.state,'captured');assert.equal(t.completions,0);
 assert.equal(t.S.syncStatus().recoveryError,'RECOVERY_QUEUE_NOT_DURABLE');
 assert.equal(JSON.parse(t.e.localStorage.getItem('balam_sync_queue')).length,10);
 t.e.recoverStorage('balam_sync_queue');t.e.cloud.failQueueBackupWrite=false;
 const restarted=t.boot();await restarted.init({});assert.equal(t.plan.state,'completed');assert.equal(t.sent.length,0);
});
await test('authorized originals archived by an older bootstrap are consumed without replay',async()=>{
 const t=setup(10,{archived:true});await t.S.init({});assert.equal(t.plan.state,'completed');
 assert.equal(t.sent.length,0);assert.equal(t.captures,1);
 assert.deepEqual(JSON.parse(t.e.localStorage.getItem('balam_sync_quarantine_1_qa')).operations,[]);
});
await test('API outage preserves offline capture after a completed recovery but fences uploads',async()=>{
 const t=setup(10);await t.S.init({});t.lookupFailure('Failed to fetch');
 await t.S.pushRows('products',[{id:randomUUID(),nombre:'New offline intent'}]);
 assert.equal(t.S.pending,1);assert.equal(t.sent.length,0);assert.doesNotThrow(()=>t.S.assertBusinessReady());
 t.lookupFailure(null);await t.S.flushQueue();assert.equal(t.S.pending,0);assert.equal(t.sent.length,1);
});
await test('API outage preserves ordinary local-first capture on an unaffected checked device',async()=>{
 const t=setup(0);t.noDirective();await t.S.init({});t.lookupFailure('Failed to fetch');
 await t.S.pushRows('products',[{id:randomUUID(),nombre:'Ordinary offline intent'}]);
 assert.equal(t.S.pending,1);assert.equal(t.sent.length,0);assert.doesNotThrow(()=>t.S.assertBusinessReady());
 t.lookupFailure(null);await t.S.flushQueue();assert.equal(t.S.pending,0);
});
await test('a first boot cannot bypass the directive lookup when the API is unreachable',async()=>{
 const t=setup(10);t.lookupFailure('Failed to fetch');await t.S.init({});
 assert.equal(t.S.pending,10);assert.equal(t.captures,0);assert.throws(()=>t.S.assertBusinessReady());
});
await test('permission denial never degrades into offline authorization',async()=>{
 const t=setup(0);t.noDirective();await t.S.init({});t.lookupFailure('permission denied');
 await t.S.recoverDirectedDevice();assert.throws(()=>t.S.assertBusinessReady());
});
console.log(`${pass}/${pass+fail}`);process.exitCode=fail?1:0;
