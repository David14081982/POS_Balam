import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const harness=readFileSync('test-h148-reconciliation.mjs','utf8');
const common=harness.slice(0,harness.indexOf('let pass=0,fail=0;')).replace("readFileSync('balam/store.jsx','utf8')","readFileSync(process.env.BALAM_STORE_SOURCE||'balam/store.jsx','utf8')");
const {setup:baseSetup,wait}=await import('data:text/javascript;base64,'+Buffer.from(common+'\nexport {setup,wait};').toString('base64'));
function setup(options){
 const value=baseSetup(options),{e}=value;
 e.client.auth.getSession=async()=>({data:{session:{user:{id:'h151-user',email:'h151@example.test'}}}});
 e.setRpc(async()=>({data:[],error:null}));
 const from=e.client.from;
 e.client.from=table=>{const q=from(table),select=q.select;q.select=(...args)=>{const p=select(...args);p.limit=n=>p.range(0,n-1);return p;};return q;};
 return value;
}
let pass=0,fail=0;
async function until(predicate){const end=Date.now()+5000;while(!predicate()&&Date.now()<end)await wait(25);assert.ok(predicate(),'terminal did not finish applying the cleanup');}
async function test(name,fn){try{await fn();console.log('PASS '+name);pass++;}catch(e){console.log('FAIL '+name+': '+e.message);fail++;}}
function cleaned(e,epoch=8){
 e.cloud.rowsByTable.system_manifest=[{...e.cloud.rowsByTable.system_manifest[0],data_epoch:epoch}];
 e.cloud.rowsByTable.selective_cleanup_events=[{cleanup_id:'h151-cleanup',data_epoch:epoch,protocol_version:5,minimum_client_protocol:5,identities:{sale_folios:['OLD']}}];
 e.cloud.rowsByTable.products=[{id:'remote',nombre:'Restored',stock_quantity:12,sync_version:2}];
 e.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:2}];
 e.window.DATA.applySelectiveCleanup=()=>({ok:true});
}
await test('closed empty terminal applies cleanup on next boot',async()=>{
 const {e,S}=setup({cursor:1});e.localStorage.setItem('balam_sync_data_epoch','7');cleaned(e);
 await S.init({});await wait(100);
 await until(()=>e.localStorage.getItem('balam_sync_data_epoch')==='8'&&S.syncStatus().synchronized);
 assert.equal(S.syncStatus().compatibility,'ok');
 assert.equal(e.window.DATA.products[0]?.stockQuantity,12);
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'8');
});
await test('open empty terminal recovers after epoch change',async()=>{
 const {e,S}=setup();await S.init({});await wait(100);cleaned(e,2);
 await S.reconcileDomains();await wait(150);
 await until(()=>e.localStorage.getItem('balam_sync_data_epoch')==='2'&&S.syncStatus().synchronized);
 assert.equal(S.syncStatus().compatibility,'ok');assert.equal(e.window.DATA.products[0]?.stockQuantity,12);
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'2');
});
await test('poll repairs a terminal already waiting for rebootstrap',async()=>{
 const {e,S,timers}=setup();await S.init({});await wait(100);cleaned(e,2);
 await S.flushQueue();await wait(50);
 for(const t of timers.filter(t=>t.ms===60000))await t.fn();await wait(150);
 await until(()=>e.localStorage.getItem('balam_sync_data_epoch')==='2'&&S.syncStatus().synchronized);
 assert.equal(S.syncStatus().compatibility,'ok');assert.equal(e.window.DATA.products[0]?.stockQuantity,12);
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'2');
});
for(const ownerId of [null,'other@example.test'])await test('pending intent stays intact: '+String(ownerId),async()=>{
 const op={id:'15100000-0000-4000-8000-000000000001',type:'upsert',kind:'products',table:'products',ownerId,dataEpoch:7,protocolVersion:3,rows:[{id:'pending'}],rowIds:['pending'],status:'pending'};
 const {e,S}=setup({queue:[op]});e.localStorage.setItem('balam_sync_data_epoch','7');cleaned(e);
 await S.init({});await S.applyRemoteSelectiveCleanup();await wait(100);
 assert.equal(S.syncStatus().compatibility,'must_rebootstrap');
 assert.deepEqual(JSON.parse(e.localStorage.getItem('balam_sync_queue')),[op]);
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'7');
 assert.equal(e.rpcCalls.some(c=>/save_products|report_sync_quarantine/.test(c.name)),false);
});
await test('active capture defers recovery until released',async()=>{
 const {e,S,timers}=setup();let active=true;e.window.CORE.activityStatus=()=>({active});
 e.localStorage.setItem('balam_sync_data_epoch','7');cleaned(e);await S.init({});await S.applyRemoteSelectiveCleanup();
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'7');assert.equal(e.window.DATA.products[0].id,'ghost');
 active=false;for(const t of timers.filter(t=>t.ms===60000))await t.fn();
 await until(()=>e.localStorage.getItem('balam_sync_data_epoch')==='8');
});
for(const variant of ['absent','other_epoch','new_protocol'])await test('unrecognized cleanup remains fenced: '+variant,async()=>{
 const {e,S}=setup();e.localStorage.setItem('balam_sync_data_epoch','7');cleaned(e);
 if(variant==='absent')e.cloud.rowsByTable.selective_cleanup_events=[];
 if(variant==='other_epoch')e.cloud.rowsByTable.selective_cleanup_events[0].data_epoch=6;
 if(variant==='new_protocol')e.cloud.rowsByTable.selective_cleanup_events[0].minimum_client_protocol=99;
 await S.init({});await S.applyRemoteSelectiveCleanup();await wait(100);
 assert.equal(S.syncStatus().compatibility,'must_rebootstrap');assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'7');
});
await test('failed snapshot retains fence and is retried',async()=>{
 const {e,S,timers}=setup();e.localStorage.setItem('balam_sync_data_epoch','7');cleaned(e);e.setError('products',{message:'Failed to fetch'});
 await S.init({});await wait(200);
 assert.equal(S.syncStatus().synchronized,false);assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'7');
 assert.equal(e.localStorage.getItem('balam_selective_cleanup_seen_v2'),null);
 e.clearError('products');for(const t of timers.filter(t=>t.ms===60000))await t.fn();
 await until(()=>e.localStorage.getItem('balam_sync_data_epoch')==='8');
});
await test('intent arriving during the recovery lookup is preserved',async()=>{
 const {e,S}=setup();await S.init({});await wait(100);
 const release=e.hold();const rebuilding=S.rebootstrapFromCloud({requireEmptyQueue:true,expectedEpoch:1});
 await wait(30);const op={id:'late-intent',ownerId:null,dataEpoch:1,type:'sale',status:'pending'};
 e.localStorage.setItem('balam_sync_queue',JSON.stringify([op]));release();
 await assert.rejects(rebuilding,/CLEANUP_RECOVERY_BUSY/);
 assert.deepEqual(JSON.parse(e.localStorage.getItem('balam_sync_queue')),[op]);
 assert.equal(e.rpcCalls.some(c=>c.name==='report_sync_quarantine'),false);
});
await test('a second epoch change cannot reuse the previous cleanup authority',async()=>{
 const {e,S}=setup();await S.init({});await wait(100);
 await assert.rejects(S.rebootstrapFromCloud({requireEmptyQueue:true,expectedEpoch:999}),/CLEANUP_RECOVERY_EPOCH_CHANGED/);
 assert.equal(e.localStorage.getItem('balam_sync_data_epoch'),'1');
});
console.log(`H151 ${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
