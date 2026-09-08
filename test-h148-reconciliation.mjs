import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const harness=readFileSync('test-store-queue.mjs','utf8');
const freshEnv=new Function(harness.slice(harness.indexOf('function freshEnv()'),harness.indexOf('\nconst SRC ='))+'\nreturn freshEnv;')();
const source=readFileSync('balam/core.jsx','utf8')+'\n'+readFileSync('balam/store.jsx','utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function setup({version=1,cursor,queue=[]}={}) {
 const e=freshEnv(); const timers=[];
 if(cursor!==undefined)e.localStorage.setItem('balam_sync_domain_cursors_v1',JSON.stringify({products:cursor}));
 e.localStorage.setItem('balam_sync_queue',JSON.stringify(queue));
 e.window.AUTH={current:()=>null,role:()=> 'admin',refreshPermissions:async()=>({ok:true})};
 e.cloud.rowsByTable.system_manifest=[{singleton:true,schema_version:20260830017500,sync_protocol_min:3,sync_protocol_current:3,data_epoch:1,domain_modes:{products:'active'}}];
 e.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version}];
 e.cloud.rowsByTable.products=[{id:'remote',nombre:'Remote',stock_quantity:10,sync_version:1}];
 e.window.DATA.products=[{id:'ghost',nombre:'Unjustified cache',stockQuantity:99}];
 e.window.DATA.applyRemote=(kind,rows)=>{if(kind==='products'){e.window.DATA.products.splice(0,Infinity,...rows);e.localStorage.setItem('projection',JSON.stringify(rows));}return true;};
 const S=new Function('window','localStorage','document','CustomEvent','setInterval','clearInterval','navigator',source+'\nreturn window.STORE;')(e.window,e.localStorage,{hidden:false},class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},(fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{},{onLine:true});
 return {e,S,timers};
}
let pass=0,fail=0;
async function test(name,fn){try{await fn();console.log('PASS '+name);pass++;}catch(e){console.log('FAIL '+name+': '+e.message);fail++;}}
await test('version zero must apply an uninitialized domain',async()=>{
 const {e,S}=setup({version:0});await S.init({});await wait(80);
 assert.equal(e.window.DATA.products[0]?.id,'remote');assert.equal(S.syncStatus().cursors.products,0);
});
await test('cursor ahead cannot certify stale cache',async()=>{
 const {e,S}=setup({version:1,cursor:99});await S.init({});await wait(80);await S.reconcileDomains({force:true});
 assert.equal(e.window.DATA.products[0]?.id,'remote');assert.equal(S.syncStatus().cursors.products,1);
});
await test('manual reconciliation repairs divergence without a new event',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 e.window.DATA.products[0].stockQuantity=99;
 await S.reconcileDomains({force:true});
 assert.equal(e.window.DATA.products[0].stockQuantity,10);
});
await test('failed durable checkpoint cannot report synchronized',async()=>{
 const {e,S}=setup();e.failStorage('balam_sync_domain_cursors_v1');
 await S.init({});await wait(80);
 assert.equal(S.syncStatus().synchronized,false);
 e.recoverStorage('balam_sync_domain_cursors_v1');await S.reconcileDomains({force:true});assert.equal(S.syncStatus().synchronized,true);
});
await test('apply failure retains domain for a retry at the same version',async()=>{
 const {e,S}=setup();e.window.DATA.applyRemote=()=>false;await S.init({});await wait(80);
 assert.equal(S.syncStatus().synchronized,false);assert.ok(S.syncStatus().invalidDomains.includes('products'));
 e.window.DATA.applyRemote=()=>true;await S.reconcileDomains({force:true});assert.equal(S.syncStatus().cursors.products,1);
});
await test('durable intent survives a missing or damaged projection',async()=>{
 const op={id:'14800000-0000-4000-8000-000000000001',type:'upsert',kind:'products',table:'products',conflict:'id',ownerId:null,protocolVersion:3,dataEpoch:1,rowIds:['offline-created'],rows:[{id:'offline-created',nombre:'Pending intent',precio:123,sync_base_version:0}],status:'pending'};
 const {e,S}=setup({queue:[op]});
 let sent=[];
 e.setRpc(async(name,args)=>{if(name==='save_products_checked_v2') {sent=args.p_rows;return {data:args.p_rows.map(r=>({...r,sync_version:1})),error:null};}return {data:null,error:null};});
 await S.init({});await wait(80);
 assert.equal(sent[0]?.nombre,'Pending intent');assert.equal(S.pending,0);
});
await test('rebootstrap sends valid pending intent instead of archiving it',async()=>{
 const op={id:'14800000-0000-4000-8000-000000000002',type:'upsert',kind:'products',table:'products',conflict:'id',ownerId:null,protocolVersion:3,dataEpoch:1,rowIds:['offline-created'],rows:[{id:'offline-created',nombre:'Pending intent',precio:123,sync_base_version:0}],status:'pending'};
 const {e,S}=setup({queue:[op]});let available=false,sent=0;
 e.setRpc(async(name,args)=>{if(name==='save_products_checked_v2'){
  if(!available)return {data:null,error:{message:'Failed to fetch'}};
  sent++;return {data:args.p_rows.map(r=>({...r,sync_version:1})),error:null};
 }return {data:null,error:null};});
 await S.init({});await wait(80);assert.equal(S.pending,1);
 available=true;await S.rebootstrapFromCloud();await wait(40);
 assert.equal(sent,1);assert.equal(S.pending,0);
 assert.equal(e.rpcCalls.filter(c=>/quarantine/.test(c.name)).length,0);
});
await test('a remote legacy reset mark cannot upload local cache',async()=>{
 const {e,S}=setup();let mode;
 e.cloud.rowsByTable.settings=[{key:'_resetMark',value:'2026-09-05T00:00:00Z'}];
 e.window.DATA.resetTestData=opts=>{mode=opts?.authority;return true;};
 await S.init({pull:true});await wait(80);
 assert.equal(mode,'remote');
});
await test('configuration intention is durable before debounce or reload',async()=>{
 const {e,S}=setup();await S.init({});
 S.pushConfig({catalogs:{},catalogMeta:{},settings:{qa:'pending'}});
 const q=JSON.parse(e.localStorage.getItem('balam_sync_queue')||'[]');
 assert.ok(q.some(op=>op.type==='config' && op.settings.some(row=>row.key==='qa'&&row.value==='pending')));
});
await test('empty acknowledgement cannot discard an unconfirmed intention',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 e.setRpc(async()=>({data:[],error:null}));
 await S.pushRows('products',[{id:'unconfirmed',nombre:'Keep this',precio:1}]);await S.flushQueue();
 assert.equal(S.pending,1);
});
await test('a rejected edit remains available for review after remote recovery',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 e.window.DATA.applySyncResult=()=>({conflicts:1});
 e.setRpc(async()=>({data:[{id:'remote',nombre:'Another terminal',stock_quantity:9,sync_version:2}],error:null}));
 await S.pushRows('products',[{id:'remote',nombre:'My pending edit',stockQuantity:10,_syncVersion:1}]);await S.flushQueue();
 assert.equal(S.pending,1);assert.equal(S.queueStatus().operations[0].status,'blocked_conflict');
});
await test('a rejected deletion remains pending after remote recovery',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 e.window.DATA.applySyncResult=()=>({conflicts:1});
 e.setRpc(async()=>({data:[{id:'remote',nombre:'Another terminal',stock_quantity:9,sync_version:2}],error:null}));
 await S.deleteRow('products','remote',1);await S.flushQueue();
 assert.equal(S.pending,1);assert.equal(S.queueStatus().operations[0].status,'blocked_conflict');
 assert.equal(JSON.parse(e.localStorage.getItem('balam_sync_queue'))[0].baseVersion,1,'rejected deletion cannot adopt the competing version');
});
await test('an empty deletion acknowledgement retains the intention',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 e.setRpc(async()=>({data:null,error:null}));
 await S.deleteRow('products','remote',1);await S.flushQueue();
 assert.equal(S.pending,1);
});
await test('rebootstrap cannot publish a cursor before its durable checkpoint',async()=>{
 const {e,S}=setup();await S.init({});await wait(80);
 const before=S.syncStatus().cursors.products;
 e.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:2}];
 e.failStorage('balam_sync_domain_cursors_v1');
 await assert.rejects(()=>S.rebootstrapFromCloud(),/CHECKPOINT_NOT_DURABLE/);
 assert.equal(S.syncStatus().cursors.products,before);
});
await test('a financial receipt cannot authorize a queued stale stock snapshot',async()=>{
 const sale={id:'14800000-0000-4000-8000-000000000031',operationId:'14800000-0000-4000-8000-000000000031',type:'sale',folio:'QA',header:{folio:'QA'},items:[],moves:[],payments:[],stockLines:[],sellerEffects:[],ownerId:null,protocolVersion:3,dataEpoch:1,status:'pending'};
 const {e,S}=setup({queue:[sale]});let release,entered;
 const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let sent;
 e.window.DATA.applySyncResult=()=>({conflicts:0});
 e.setRpc(async(name,args)=>{
  if(name==='commit_sale_checked'){entered();await gate;return {data:{ok:true,products:[{id:'remote',stock_quantity:9,sync_version:2}]},error:null};}
  if(name==='save_products_checked_v2'){sent=args.p_rows;return {data:args.p_rows.map(r=>({...r,sync_version:2})),error:null};}
  return {data:null,error:null};
 });
 const initializing=S.init({});await Promise.race([waiting,wait(2000).then(()=>{throw Error('sale never started');})]);
 const editing=S.pushRows('products',[{id:'remote',nombre:'Price edit',precio:120,stockQuantity:10,_syncVersion:1}]);
 release();await initializing;await editing;await S.flushQueue();
 assert.equal(sent?.[0]?.sync_base_version,1,'a financial receipt cannot rebase an unrelated replacement intention');
});
console.log(`${pass}/${pass+fail}`);process.exitCode=fail?1:0;
