import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.cwd();
const evidence=process.env.BALAM_TEST_OUTPUT || join(tmpdir(),'balam-h142-sync');
mkdirSync(evidence,{recursive:true});
const read=p=>readFileSync(join(root,p),'utf8');
const harness=read('test-store-queue.mjs');
const freshEnv=new Function(harness.slice(harness.indexOf('function freshEnv()'),harness.indexOf('\nconst SRC ='))+'\nreturn freshEnv;')();
const source=read('balam/core.jsx')+'\n'+read('balam/store.jsx');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await wait(5);}throw Error('probe timed out');}
const results=[];
function result(id,description,_oldDefect,e){
 const checks={
 S01:()=>e.pendingBefore===2 && e.pendingAfter===0 && e.sent.includes('one') && e.sent.includes('two'),
 S02:()=>e.initial===1 && e.beforeManual.stock===9 && e.beforeManual.newVersionReads>0,
 S03:()=>e.stateBefore.pending===1 && e.stateAfter.pending===0 && e.rpcAttemptsDuringTimers>0,
 S04:()=>e.pull.applied===false && e.ids.includes('only-offline') && e.durableOperations.length===1 && e.advertised.devicePending===1,
 S05:()=>e.compatibility==='client_outdated' && e.pending===1 && e.timers>0 && e.heartbeatCalls>0,
 S06:()=>e.label.label!=='Sincronizado',
 S08:()=>e.stock===9 && e.status.cursors.products===2 && e.status.synchronized,
 S10:()=>!!e.lastClean && !!e.duringReconcile,
 };
 const ok=!!checks[id]?.();results.push({id,ok,evidence:e});console.log(`${ok?'PASS':'FAIL'} ${id} ${description}`);
}

function setup({live=false,protocol=3,owner=null}={}){
 const env=freshEnv();const timers=[];
 env.window.AUTH={current:()=>owner?{email:owner}:null,role:()=> 'admin'};
 env.window.DATA.products=[];
 const apply=env.window.DATA.applyRemote;
 env.window.DATA.applyRemote=function(kind,rows,opts){if(kind==='products')this.products.splice(0,this.products.length,...structuredClone(rows).filter(r=>!r._deletedAt));return apply.call(this,kind,rows,opts);};
 if(live){
  env.cloud.rowsByTable.system_manifest=[{singleton:true,schema_version:20260830017500,sync_protocol_min:protocol,sync_protocol_current:protocol,data_epoch:1,domain_modes:{products:'active'}}];
  env.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:1}];
  env.cloud.rowsByTable.products=[{id:'remote',nombre:'Remote',stock_quantity:1,sync_version:1}];
  env.client.channel=()=>({on(_event,_filter,fn){env.event=fn;return this;},subscribe(fn){fn('SUBSCRIBED');return this;}});
  env.client.removeChannel=()=>{};
 }
 const doc={hidden:false,createElement:()=>({}),head:{appendChild(){}}};
 const CustomEvent=class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}};
 const S=new Function('window','localStorage','document','CustomEvent','setInterval','clearInterval','navigator',source+'\nreturn window.STORE;')(env.window,env.localStorage,doc,CustomEvent,(fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{},{onLine:true});
 return {env,S,timers};
}
const product=id=>({id,nombre:id,modelo:'1',stock:[],precio:100,costo:40,_syncVersion:0});

// Real STORE + existing transport harness. A second edit arrives while the
// successful operation waits for its telemetry response, after cur=loadQ().
{
 const {env,S}=setup();await S.init({});
 env.client.auth.getSession=async()=>({data:{session:{user:{id:'14200000-0000-4000-8000-000000000001',email:'audit@example.test'}}}});
 const from=env.client.from;let entered=false,release;
 const gate=new Promise(r=>release=r);
 env.client.from=table=>table==='sync_activity'?{upsert:async row=>{if(row.status==='synced'&&!entered){entered=true;await gate;}return {data:null,error:null};}}:from(table);
 const p1=product('one');env.window.DATA.products.push(p1);S.pushRows('products',[p1]);
 await until(()=>entered);
 const p2=product('two');env.window.DATA.products.push(p2);await S.pushRows('products',[p2]);
 const pendingBefore=S.queueStatus().pending;release();await wait(150);
 const sent=env.rpcCalls.filter(x=>x.name==='save_products_checked').flatMap(x=>(x.args.p_rows||[]).map(r=>r.id));
 result('S01','Capture lost when telemetry awaits before queue removal',pendingBefore===2&&!sent.includes('two')&&S.pending===0,{pendingBefore,pendingAfter:S.pending,sent,localIds:env.window.DATA.products.map(p=>p.id)});
}

// No network timers really run. Exercise the two registered 60s callbacks.
{
 const {env,S,timers}=setup({live:true});await S.init({});await wait(100);
 const initial=env.window.DATA.products[0]?.stockQuantity;
 env.cloud.rowsByTable.products=[{id:'remote',nombre:'Remote',stock_quantity:9,sync_version:2}];
 env.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:2}];
 const readsBefore=env.calls.filter(x=>x.table==='sync_domain_versions').length;
 for(let minute=0;minute<3;minute++){for(const t of timers)t.fn();await wait(35);}
 const beforeManual={stock:env.window.DATA.products[0]?.stockQuantity,status:S.syncStatus(),newVersionReads:env.calls.filter(x=>x.table==='sync_domain_versions').length-readsBefore};
 await S.reconcileDomains();await wait(30);
 result('S02','Lost event remains stale while WebSocket says subscribed',initial===1&&beforeManual.stock===1&&beforeManual.newVersionReads===0&&beforeManual.status.synchronized&&env.window.DATA.products[0]?.stockQuantity===9,{initial,beforeManual,afterManualStock:env.window.DATA.products[0]?.stockQuantity});
}
{
 const {env,S,timers}=setup({live:true});await S.init({});await wait(80);
 let failing=true;env.setRpc(async(name,args)=>name==='save_products_checked_v2'?failing?{data:null,error:{message:'Failed to fetch'}}:{data:args.p_rows,error:null}:{data:null,error:null});
 const p=product('retry');env.window.DATA.products.push(p);
 S.pushRows('products',[p]);await wait(80);const stateBefore=S.queueStatus();const attemptsBefore=env.rpcCalls.length;
 failing=false;for(let i=0;i<3;i++){for(const t of timers)t.fn();await wait(30);}
 const stateAfter=S.queueStatus();const attemptsAfter=env.rpcCalls.length;
 await S.flushQueue();await wait(50);
 result('S03','Transient failure has no periodic automatic sending retry',stateBefore.pending===1&&stateAfter.pending===1&&stateAfter.operations[0]?.status==='retry_wait'&&attemptsAfter===attemptsBefore&&S.pending===0,{stateBefore,stateAfter,rpcAttemptsDuringTimers:attemptsAfter-attemptsBefore,afterManualFlush:S.pending});
}
{
 const {env,S}=setup({owner:'second@example.test'});
 env.window.DATA.products.push(product('only-offline'));
 env.localStorage.setItem('balam_sync_queue',JSON.stringify([{id:'14200000-0000-4000-8000-000000000002',ownerId:'first@example.test',type:'upsert',kind:'products',table:'products',rowIds:['only-offline'],rows:[{id:'only-offline'}],status:'pending'}]));
 env.cloud.rowsByTable.products=[{id:'remote',nombre:'Cloud',sync_version:1}];
 await S.init({});const advertised=S.queueStatus();const pull=await S.pullDomain('products');
 const ids=env.window.DATA.products.map(p=>p.id);const durable=JSON.parse(env.localStorage.getItem('balam_sync_queue'));
 result('S04','Other-account queue does not protect shared local inventory',advertised.pending===0&&pull.applied&&!ids.includes('only-offline')&&durable.length===1,{advertised,pull,ids,durableOperations:durable.map(o=>({id:o.id,rowIds:o.rowIds}))});
}
{
 const {env,S,timers}=setup({live:true,protocol:4});
 env.client.auth.getSession=async()=>({data:{session:{user:{id:'14200000-0000-4000-8000-000000000003'}}}});env.setRpc(async()=>({data:[],error:null}));await S.init({});await wait(60);const p=product('incompatible');env.window.DATA.products.push(p);await S.pushRows('products',[p]);await wait(50);
 const reported=env.rpcCalls.filter(c=>c.name==='report_sync_device').length;
 result('S05','Incompatible clients accumulate queue with no heartbeat timer',S.syncStatus().compatibility==='client_outdated'&&S.pending===1&&timers.length===0&&reported===0,{compatibility:S.syncStatus().compatibility,pending:S.pending,timers:timers.length,heartbeatCalls:reported});
}
{
 const s=read('balam/settings.jsx');const start=s.indexOf('const deviceState =');const end=s.indexOf('const beginEdit =',start);
 const fn=new Function(s.slice(start,end)+'return deviceState;')();
 const fixture={status:'online',staleEpoch:false,connection:'online',queue_pending:0,queue_blocked:0,last_synced_at:'2026-08-29T17:20:21.420Z',protocol_version:2,cursors:{products:594}};
 const label=fn(fixture);
 result('S06','Fleet labels incompatible/behind terminal synchronized',label.label==='Sincronizado',{fixture,label,serverProtocol:3,serverProductVersion:634});
}
{
 const {env,S}=setup({live:true});env.window.AUTH.refreshPermissions=async()=>{};
 await S.init({});await wait(80);
 const from=env.client.from;let armed=true;
 env.client.from=table=>{
  if(armed&&table==='movements'){
   armed=false;
   env.cloud.rowsByTable.products=[{id:'remote',nombre:'Remote updated during recovery',stock_quantity:9,sync_version:2}];
   env.cloud.rowsByTable.sync_domain_versions=[{domain:'products',version:2}];
  }
  return from(table);
 };
 try{
  const status=await S.rebootstrapFromCloud();
  result('S08','Recovery stamps newest cursor on older snapshot',env.window.DATA.products[0]?.stockQuantity===1&&status.cursors.products===2&&status.synchronized,{stock:env.window.DATA.products[0]?.stockQuantity,remoteStock:9,status});
 }catch(error){result('S08','Recovery probe incomplete',false,{message:error.message,result:error.result});}
}
{
 const {env,S,timers}=setup({live:true});
 env.client.auth.getSession=async()=>({data:{session:{user:{id:'14200000-0000-4000-8000-000000000003',email:'audit@example.test'}}}});
 env.setRpc(async()=>({data:[],error:null}));
 await S.init({});await wait(80);
 const reports=()=>env.rpcCalls.filter(x=>x.name==='report_sync_device');
 await S.reconcileDomains();
 const lastClean=reports().at(-1)?.args.p_last_synced_at;
 await S.reconcileDomains();
 const duringReconcile=reports().at(-1)?.args.p_last_synced_at;
 result('S10','Successful reconciliation reports null last-confirmed time',!!lastClean&&duringReconcile===null,{lastClean,duringReconcile,status:S.syncStatus(),timerCount:timers.length,remoteDefinition:'report_sync_device: last_synced_at=excluded.last_synced_at'});
}
writeFileSync(join(evidence,'regression-source.json'),JSON.stringify({suite:'H142',scope:'Isolated source execution, fake network; no business data writes',results},null,2));
console.log('Passed '+results.filter(x=>x.ok).length+'/'+results.length);
process.exitCode=results.some(x=>!x.ok)?1:0;
