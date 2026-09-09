// Real Supabase + three independent Chrome profiles. No network substitutes.
// Explicit gate: BALAM_SYNC_LIVE=1. Uses the already authenticated CLI only
// on the Node side to provision an isolated, temporary test identity.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright-core';

if(process.env.BALAM_SYNC_LIVE!=='1') {
 console.error('NOT CERTIFIED: run with BALAM_SYNC_LIVE=1 and an authenticated Supabase CLI.');
 process.exit(2);
}
const source=readFileSync('balam/store.jsx','utf8');
const url=source.match(/const SUPABASE_URL = '([^']+)'/)[1];
const publishable=source.match(/const SUPABASE_KEY = '([^']+)'/)[1];
const project=new URL(url).hostname.split('.')[0];
const run=randomUUID(), prefix=`qa-h148-${run}`;
const out=process.env.BALAM_TEST_OUTPUT || join(tmpdir(),prefix);
mkdirSync(out,{recursive:true});
const html=readFileSync(process.env.BALAM_VERIFIED_HTML || 'index.html');
const result={run,project,sourceSha256:createHash('sha256').update(html).digest('hex'),certifierSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),transport:'Real HTTPS Supabase; transport failures injected only for offline/lost ACK; no invented responses or service role in browser',cases:[],cleanup:null};
result.partial=!!process.env.BALAM_CASE_FILTER;
result.profiles=3;
const keys=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'projects','api-keys','--project-ref',project,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const key=(Array.isArray(keys)?keys:keys.rows).find(k=>k.name==='service_role')?.api_key;
if(!key)throw Error('Server provisioning key unavailable through authenticated CLI');
const serverClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).schema('pos');
const authAdmin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`${prefix}@example.test`, password=randomBytes(32).toString('base64url');
const sellerId=`${prefix}-seller`, adminId=`${prefix}-admin`;
const reportSellerId=`${prefix}-report-seller`;
let userId,browser,server,watchdog;
const terminals=[];
const productIds=[randomUUID(),randomUUID(),randomUUID()];
const createdSales=[],createdReturns=[],createdExchanges=[],createdLoans=[],createdClients=[],createdPromos=[],createdAdjustments=[];
const operations=new Set(), productPayloads=new Map();
const check=(response)=>{if(response.error)throw Error(response.error.message);return response.data;};
let baseline;
const safetyTables=['products','clients','sellers','promotions','sales','sale_items','returns','return_items','exchanges','exchange_items','sale_payments','loan_documents','liquidations','commission_adjustments','movements','lookup','settings'];
const rawRows=async table=>{const rows=[];for(let start=0;;start+=1000){const page=check(await serverClient.from(table).select('*').order(table==='settings'?'key':table==='sales'?'folio':table==='commission_adjustments'?'operation_id':'id').range(start,start+999));rows.push(...page);if(page.length<1000)return rows;}};
const semanticHash=rows=>createHash('sha256').update(JSON.stringify(rows,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).filter(k=>k!=='updated_at').sort().map(k=>[k,value[k]])):value)).digest('hex');
async function verify(name,fn) {
 if(process.env.BALAM_CASE_FILTER && !new RegExp(process.env.BALAM_CASE_FILTER).test(name)){console.log('NOT CERTIFIED / SKIP '+name);return;}
 console.log('START '+name);
 try {const evidence=await fn();result.cases.push({name,ok:true,evidence});console.log('PASS '+name);}
 catch(error){result.cases.push({name,ok:false,error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}
 finally{writeFileSync(join(out,'matrix.json'),JSON.stringify(result,null,2));}
}
try {
  const manifest=check(await serverClient.from('system_manifest').select('*').eq('singleton',true))[0];
 result.manifest=manifest;
 assert.ok(manifest,'Manifest missing');
 // The live certifier never assumes permission to seed another operational environment.
 assert.equal(manifest.system_mode,'preproduction','Live fixtures require the existing preproduction environment');
 baseline=Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,semanticHash(await rawRows(table))])));
 const created=check(await authAdmin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{balam_sync_test:run}}));userId=created.user.id;
 check(await serverClient.from('sellers').insert([
  {id:adminId,nombre:prefix+' Admin',email,role:'admin',active:true,comision_pct:0,sync_base_version:0},
  {id:sellerId,nombre:prefix+' Seller',email:null,role:'vendedor',active:true,comision_pct:5,sync_base_version:0},
 ]));
 check(await serverClient.from('user_permission_role_assignments').upsert({user_id:userId,role_code:'admin',active:true}));
 server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const address=`http://127.0.0.1:${server.address().port}/`;
 browser=await chromium.launch({channel:'chrome',headless:true});
 watchdog=setInterval(async()=>{
  for(const t of terminals){try{const s=await t.page.evaluate(()=>({status:window.STORE?.syncStatus(),queue:JSON.parse(localStorage.getItem('balam_sync_queue')||'[]').map(o=>({id:o.id,type:o.type,status:o.status}))}));writeFileSync(join(out,`state-${t.name}.json`),JSON.stringify(s,null,2));}catch{}}
 },10000);
 setTimeout(()=>browser?.close(),1200000).unref();
 for(const name of ['A','B','C']) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{
   if(!request.url().startsWith(url+'/rest/v1/rpc/'))return;
   try{const body=request.postDataJSON();for(const field of ['p_operation_id','p_commit_id'])if(body?.[field])operations.add(body[field]);for(const row of body?.p_rows||[])if(productIds.includes(row.id))productPayloads.set(row.id,row);}catch{}
  });
  terminals.push({name,context,page,errors});
  await page.addInitScript(({device})=>{if(location.hostname==='127.0.0.1')localStorage.setItem('balam_device_id',device);},{device:`${prefix}-${name}`});
  await page.goto(address);
  await page.waitForFunction(()=>window.AUTH?.isReady() && window.STORE?.enabled);
  const login=await page.evaluate(async({email,password})=>window.AUTH.login(email,password),{email,password});
  assert.ok(login.ok,`Login ${name}: ${JSON.stringify(login)}`);
  await page.waitForFunction(()=>window.AUTH?.hasSession() && window.DATA?.isLocalWriter);
  await page.evaluate(()=>window.STORE.init({pull:true}));
 }
 const converge=async(active=terminals)=>{
  const remote=(await rawRows('products')).filter(row=>!row.deleted_at);
  const normalize=r=>({id:r.id,nombre:r.nombre,precio:Number(r.precio),stock:Number(r.stock_quantity),size:r.size_code,barcode:r.barcode_code,family:r.reference_family_id,aliases:r.barcode_aliases||[]});
  const expected=remote.map(normalize).sort((a,b)=>a.id.localeCompare(b.id));
  const states=await Promise.all(active.map(async t=>{
   const state=await t.page.evaluate(async()=>{
    for(let pass=0;pass<3;pass++){await window.STORE.reconcileDomains();if(window.STORE.syncStatus().synchronized)break;}
    return {status:window.STORE.syncStatus(),products:window.DATA.products.map(p=>({id:p.id,nombre:p.nombre,precio:p.precio,stock:p.stockQuantity,size:p.sizeCode,barcode:p.barcodeCode,family:p.referenceFamilyId,aliases:p.barcodeAliases||[]})).sort((a,b)=>a.id.localeCompare(b.id))};
   });
   assert.equal(state.status.synchronized,true,`${t.name}: ${JSON.stringify(state.status)}`);
   assert.deepEqual(state.products,expected,`${t.name} differs from Supabase`);
   return {terminal:t.name,rows:state.products.length,pending:state.status.pending,hash:createHash('sha256').update(JSON.stringify(state.products)).digest('hex')};
  }));
  return {clients:states,remote:expected.length};
 };
 await verify('Bootstrap A/B/C from real authority',async()=>{
  const remote=(await rawRows('products')).filter(row=>!row.deleted_at);
  const states=[];
  for(const t of terminals){
   const state=await t.page.evaluate(async()=>{await window.STORE.synchronizeNow();return {status:window.STORE.syncStatus(),products:window.DATA.products.map(p=>({id:p.id,stock_quantity:p.stockQuantity})).sort((a,b)=>a.id.localeCompare(b.id))};});
   assert.equal(state.status.synchronized,true,`${t.name}: ${JSON.stringify(state.status)}`);
   assert.deepEqual(state.products,remote.map(({id,stock_quantity})=>({id,stock_quantity})).sort((a,b)=>a.id.localeCompare(b.id)));
   states.push({terminal:t.name,count:state.products.length,status:state.status});
  }
  return states;
 });
 const [A,B,C]=terminals;
 await verify('H151 idle A/B/C automatically apply the confirmed cleanup epoch',async()=>{
  const event=check(await serverClient.from('selective_cleanup_events').select('*').order('data_epoch',{ascending:false}).limit(1))[0];
  assert.equal(Number(event?.data_epoch),Number(manifest.data_epoch),'Requires an existing confirmed cleanup; never creates a destructive fixture');
  const before=Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,semanticHash(await rawRows(table))])));
  const cleanupCacheId=randomUUID();
  const writes=[];
  const observer=request=>{if(/\/rest\/v1\/rpc\/(commit_|save_products|delete_product)/.test(request.url()))writes.push(request.url());};
  for(const t of terminals)t.page.on('request',observer);
  try {
   await Promise.all(terminals.map(async t=>{
    await t.page.evaluate(({epoch,ghost})=>{
     if(window.STORE.pending)throw Error('Test requires an empty terminal');
     const template=window.DATA.products.find(p=>p.recordModel==='v2');
     if(!template)throw Error('Missing valid V2 reference for the obsolete cache fixture');
     window.DATA.products.push({...structuredClone(template),id:ghost,referenceFamilyId:ghost,
      nombre:'Cache-only deleted reference',barcodeCode:window.DATA.barcodeFromId(ghost),barcodeAliases:[],stockQuantity:999});
     window.DATA.saveProducts();
     localStorage.setItem('balam_sync_data_epoch',String(epoch-1));
     localStorage.removeItem('balam_selective_cleanup_seen_v2');
    },{epoch:Number(manifest.data_epoch),ghost:cleanupCacheId});
    await t.page.reload();
    await t.page.waitForFunction(({epoch,id,ghost})=>window.STORE?.syncStatus().synchronized
     && localStorage.getItem('balam_sync_data_epoch')===String(epoch)
     && localStorage.getItem('balam_selective_cleanup_seen_v2')===id
     && !window.DATA.products.some(p=>p.id===ghost),
     {epoch:Number(manifest.data_epoch),id:event.cleanup_id,ghost:cleanupCacheId},{timeout:120000});
   }));
   const states=await Promise.all(terminals.map(async t=>({terminal:t.name,...await t.page.evaluate(()=>({
    pending:window.STORE.pending,epoch:Number(localStorage.getItem('balam_sync_data_epoch')),synchronized:window.STORE.syncStatus().synchronized,
   }))})));
   assert.deepEqual(writes,[],'Automatic cleanup recovery uploaded a business operation');
   const after=Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,semanticHash(await rawRows(table))])));
   assert.deepEqual(after,before,'Automatic recovery changed confirmed business data');
   return {automatic:true,cleanupId:event.cleanup_id,epoch:Number(manifest.data_epoch),states,businessWrites:0,businessChanges:0};
  } catch(error) {
   for(const t of terminals)writeFileSync(join(out,`h151-failure-${t.name}.json`),JSON.stringify({errors:t.errors,...await t.page.evaluate(()=>({
    authReady:window.AUTH?.isReady(),hasSession:window.AUTH?.hasSession(),writer:window.DATA?.isLocalWriter,
    status:window.STORE?.syncStatus(),text:document.body.innerText.slice(-2500),
   }))},null,2));
   throw error;
  } finally {for(const t of terminals)t.page.off('request',observer);}
 });
 for(const [terminal,count] of [[B,10],[C,17]])await verify(`H149 directed boot ${count}: discard, remote convergence, replay fence and new operation`,async()=>{
  const device=`${prefix}-${terminal.name}`;
  const queue=Array.from({length:count},(_,i)=>{
   const id=randomUUID();operations.add(id);
   const type=count===17||i<5?'sale':i===9?'config':'upsert';
   return {id,operationId:id,type,kind:type==='upsert'?'products':undefined,table:type==='upsert'?'products':undefined,
    rows:type==='upsert'?[{id:productIds[0],nombre:'Must never upload',sync_device_id:device}]:undefined,
    header:type==='sale'?{folio:`${prefix}-discard-${i}`,operation_id:id}:undefined,
    folio:type==='sale'?`${prefix}-discard-${i}`:undefined,items:[],moves:[],payments:[],stockLines:[],
    ownerId:email,protocolVersion:3,dataEpoch:Number(manifest.data_epoch)-1,status:'pending'};
  });
  check(await serverClient.from('sync_devices').update({queue_pending:count}).eq('device_id',device));
  check(await serverClient.from('sync_activity').insert(queue.map(op=>({device_id:device,operation_id:op.id,user_id:userId,
   user_email:email,operation_type:op.type,domain:op.type==='sale'?'sales':op.type==='config'?'config':'products',
   status:'pending',summary:'H149 authorized isolated test queue'}))));
  check(await serverClient.rpc('prepare_sync_device_recovery',{p_device_id:device,p_expected_count:count,
   p_epoch:Number(manifest.data_epoch),p_protocol:3,p_minimum_build:'2026-09-08-h149',
   p_authorization:'H149 explicitly authorized isolated boot certification; discard exact test candidates'}));
  const pendingDevice=await A.page.evaluate(async device=>(await window.STORE.syncFleetStatus()).devices.find(d=>d.device_id===device),device);
  assert.equal(pendingDevice.recoveryPending,true);assert.equal(pendingDevice.synchronized,false);
  const recoveryHash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const beforeRecovery=Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,recoveryHash(await rawRows(table))])));
  const ids=new Set(queue.map(o=>o.id)),attempts=[];
  const observer=request=>{try{const b=request.postDataJSON();if(ids.has(b?.p_operation_id)||ids.has(b?.p_commit_id))attempts.push(request.url());}catch{}};
  terminal.page.on('request',observer);
  let releaseCapture,enteredCapture;
  const captureHeld=new Promise(r=>releaseCapture=r),captureEntered=new Promise(r=>enteredCapture=r);
  const capturePattern=url+'/rest/v1/rpc/capture_sync_device_recovery';
  await terminal.context.route(capturePattern,async route=>{enteredCapture();await captureHeld;await route.continue();});
  await terminal.page.evaluate(queue=>{
   const localReference=window.DATA.products.find(p=>p.recordModel==='v2');
   if(!localReference)throw Error('Missing local projection to corrupt for recovery certification');
   localReference.stockQuantity+=12345;
   window.DATA.saveProducts(); // persistence only: never emits inventory intent without IDs
   localStorage.setItem('balam_sync_queue',JSON.stringify(queue));
   localStorage.setItem('balam-sidebar','1');
  },queue);
  await terminal.page.reload();
  await Promise.race([captureEntered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Recovery never reached capture')),60000))]);
  try {
   await terminal.page.getByTestId('device-recovery-gate').waitFor({timeout:20000});
   for(const width of [320,360,390,430,768,1024,1280,1440]){
    await terminal.page.setViewportSize({width,height:900});
    const gate=terminal.page.getByTestId('device-recovery-gate');
    assert.equal(await gate.innerText(),'Estamos actualizando la información de este equipo.');
    assert.ok(await terminal.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width===320||width===1280)await terminal.page.screenshot({path:join(out,`h149-${count}-${width}.png`)});
   }
   assert.equal(await terminal.page.evaluate(()=>{try{window.DATA.addClient({nombre:'Forbidden during recovery'});return false;}catch(e){return e.code==='DEVICE_RECOVERY_REQUIRED';}}),true);
  } finally {releaseCapture();}
  await terminal.page.waitForFunction(()=>window.STORE?.syncStatus().recoveryPhase==='ready',null,{timeout:120000});
  await terminal.context.unroute(capturePattern);
  await terminal.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  assert.deepEqual(attempts,[],'Legacy queue reached a write RPC');
  assert.equal(await terminal.page.evaluate(()=>window.STORE.pending),0);
  const row=check(await serverClient.from('sync_device_recoveries').select('state,discarded_ids,evidence,completed_at').eq('device_id',device))[0];
  assert.equal(row.state,'completed');assert.equal(row.discarded_ids.length,count);
  assert.ok(row.evidence.operations.every(op=>op.epoch===Number(manifest.data_epoch)-1));
  assert.deepEqual(Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,recoveryHash(await rawRows(table))]))),beforeRecovery,'Recovery changed remote business, including timestamps');
  const legacy=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false},db:{schema:'pos'}});
  check(await legacy.auth.signInWithPassword({email,password}));
  for(const op of queue.filter(o=>o.type==='sale')){
   const rejected=await legacy.rpc('commit_sale_checked',{p_commit_id:op.id,p_operation_id:op.id,p_sale:{},p_items:[],p_moves:[],
    p_payments:[],p_stock_lines:[],p_reserve_stock:true,p_client_effect:null,p_seller_effects:[]});
   assert.equal(rejected.error?.details,'TEST_PENDING_DISCARDED');
  }
  const directId=randomUUID();createdClients.push(directId);
  const direct=await legacy.from('clients').insert({id:directId,nombre:'Forbidden legacy direct write',sync_device_id:device});
  assert.equal(direct.error?.details,'DEVICE_RECOVERY_REQUIRED');
  assert.equal(check(await serverClient.from('sale_commits').select('commit_id').in('commit_id',[...ids])).length,0);
  const receiptTime=row.completed_at;
  await terminal.page.reload();await terminal.page.waitForFunction(()=>window.AUTH?.hasSession()&&window.STORE?.syncStatus().recoveryPhase==='ready',null,{timeout:120000});
  assert.equal(await terminal.page.evaluate(()=>localStorage.getItem('balam-sidebar')),'1');
  const fresh=await terminal.page.evaluate(prefix=>window.DATA.addClient({nombre:prefix+' recovered',tel:prefix+' recovered'}),prefix);createdClients.push(fresh.id);
  await terminal.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  assert.equal(check(await serverClient.from('clients').select('id').eq('id',fresh.id)).length,1);
  assert.equal(check(await serverClient.from('sync_device_recoveries').select('completed_at').eq('device_id',device))[0].completed_at,receiptTime);
  assert.equal(await A.page.evaluate(async device=>(await window.STORE.syncFleetStatus()).devices.find(d=>d.device_id===device).recoveryPending,device),false);
  terminal.page.off('request',observer);
  return {pendingBefore:count,pendingAfter:0,legacyUploads:0,commercialRecoveryChanges:0,
   evidenceEpoch:Number(manifest.data_epoch)-1,serverReplayRejected:true,repeatedDirectiveDeletes:0,newOperation:true,viewports:8,deviceCenterTruthful:true,damagedProjectionRebuilt:true};
 });

 await verify('Create references A -> B/C/Supabase',async()=>{
  await A.page.evaluate(({ids,prefix})=>{
   const D=window.DATA,C=window.CONFIG;
   const template=D.products.find(p=>p.recordModel==='v2');
   if(!template)throw Error('No V2 contract template');
   const prepared=[];
   for(const id of ids){
    let candidate;
    for(const color of C.list('color')){
     try{
      candidate=D.createReference({...template,id,referenceFamilyId:id,nombre:prefix,imagen:null,
       color:color.code,stockQuantity:prepared.length===2?0:10,precio:100,costo:25,
       barcodeCode:undefined,barcodeAliases:[],physicalIdentityLocked:false,_syncVersion:0,_deletedAt:null},D.products.concat(prepared));
      break;
     }catch(error){if(error.code!=='REFERENCE_SIGNATURE_DUPLICATE')throw error;}
    }
    if(!candidate)throw Error('No unused valid physical combination for test fixture');
    prepared.push(candidate);
   }
   D.products.push(...prepared);D.saveProducts(ids);
  },{ids:productIds,prefix});
  await A.page.evaluate(()=>window.STORE.synchronizeNow());
  return converge();
 });
 await verify('Edit reference with immutable identity',async()=>{
  await A.page.evaluate(id=>{const D=window.DATA;D.updateReference({id,precio:120});D.saveProducts([id]);},productIds[0]);
  await A.page.evaluate(()=>window.STORE.synchronizeNow());return converge();
 });
 await verify('Delete reference A -> B/C/Supabase tombstone',async()=>{
  const removed=await A.page.evaluate(id=>window.DATA.removeProductScope({scope:'reference',productIds:[id]}),productIds[2]);
  assert.ok(removed.ok,JSON.stringify(removed));
  await A.page.evaluate(()=>window.STORE.synchronizeNow());
  const rows=check(await serverClient.from('products').select('deleted_at').eq('id',productIds[2]));assert.ok(rows[0]?.deleted_at);
  return converge();
 });
 await verify('Reload cannot resurrect a deleted reference',async()=>{
  await Promise.all(terminals.map(async t=>{await t.page.reload();await t.page.waitForFunction(()=>window.AUTH?.isReady() && window.AUTH.hasSession() && window.DATA?.isLocalWriter);}));
  return converge();
 });
 await verify('Old protocol and stale payload cannot resurrect a tombstone',async()=>{
  const row={...productPayloads.get(productIds[2]),sync_base_version:1};assert.equal(row.id,productIds[2]);
  const outdated=await B.page.evaluate(async({row,id})=>{const S=window.STORE,c=await S.getClient();return c.rpc('save_products_checked_v2',{p_operation_id:id,p_rows:[row],p_protocol_version:2,p_data_epoch:S.syncStatus().dataEpoch});},{row,id:randomUUID()});
  assert.ok(outdated.error&&/protocol/i.test(outdated.error.message));
  await B.page.evaluate(async({row,id})=>{const S=window.STORE,c=await S.getClient();return c.rpc('save_products_checked_v2',{p_operation_id:id,p_rows:[row],p_protocol_version:3,p_data_epoch:S.syncStatus().dataEpoch});},{row,id:randomUUID()});
  assert.ok(check(await serverClient.from('products').select('deleted_at').eq('id',productIds[2]))[0].deleted_at);return converge();
 });
 await verify('Realtime disconnected: periodic reconciliation converges',async()=>{
  for(const t of [B,C])await t.page.evaluate(async()=>{const client=await window.STORE.getClient();await client.removeAllChannels();client.realtime.disconnect();});
  await A.page.evaluate(id=>{window.DATA.updateReference({id,precio:130});window.DATA.saveProducts([id]);},productIds[0]);
  await A.page.evaluate(()=>window.STORE.synchronizeNow());
  await Promise.all([B,C].map(t=>t.page.waitForFunction(id=>window.DATA.products.find(p=>p.id===id)?.precio===130,productIds[0],{timeout:100000})));
  return converge();
 });
 await verify('Offline intent survives reload and uploads once',async()=>{
  await B.context.setOffline(true);
  await B.page.evaluate(id=>{window.DATA.updateReference({id,precio:140});window.DATA.saveProducts([id]);},productIds[0]);
  await B.page.waitForFunction(()=>window.STORE.pending>0);
  const pending=await B.page.evaluate(()=>JSON.parse(localStorage.getItem('balam_sync_queue')));
  await A.page.evaluate(id=>{window.DATA.updateReference({id,precio:102});window.DATA.saveProducts([id]);},productIds[1]);
  await A.page.evaluate(()=>window.STORE.synchronizeNow());
  await B.context.route(url+'/**',route=>route.abort());
  await B.context.setOffline(false);await B.page.reload();
  await B.page.waitForFunction(()=>window.DATA?.isLocalWriter && window.STORE?.enabled);
  const restored=await B.page.evaluate(()=>JSON.parse(localStorage.getItem('balam_sync_queue')));
  assert.ok(pending.every(op=>restored.some(r=>r.id===op.id)),'Pending intent lost on reload');
  await B.context.unroute(url+'/**');
  await B.page.evaluate(()=>window.STORE.synchronizeNow());
  const state=await converge();
  assert.equal(check(await serverClient.from('products').select('precio').eq('id',productIds[0]))[0].precio,140);
  return {...state,pendingBefore:pending.length,pendingLost:0};
 });
 const stock=async id=>Number(check(await serverClient.from('products').select('stock_quantity').eq('id',id))[0].stock_quantity);
 const sell=async(t,id,qty=1,layaway=false)=>{
  const sale=await t.page.evaluate(({id,qty,sellerId,layaway})=>{
   const D=window.DATA,p=D.products.find(p=>p.id===id);
   return D.recordSale({ticket:[{p,talla:p.sizeCode,qty}],sellerIds:[sellerId],client:null,
    metodo:layaway?'Apartado':'Efectivo',estado:layaway?'Apartado':'Pagado',
    ...(layaway?{anticipo:10,pagoEfectivo:10,pagoOtro:0}:{}),itemCount:qty});
  },{id,qty,sellerId,layaway});
  createdSales.push(sale.folio);return sale;
 };
 const documents=async()=>{
  const specs=[['clients','clients','id',['nombre','total','compras']],['sellers','sellers','id',['nombre',['comisionAcum','comision_acum'],['ventasMes','ventas_mes'],['ventasNum','ventas_num']]],
   ['promos','promotions','id',['nombre','valor','pausado']],['sales','sales','folio',['total','estado','saldo','receiptSnapshot:receipt_snapshot']],
   ['payments','sale_payments','id',['folio','monto','efectivo','tarjeta','transferencia','otro']],
   ['returns','returns','id',['folio','total']],['exchanges','exchanges','id',['folio','diferencia',['origenFolio','origen_folio']]],
   ['liquidations','liquidations','id',['monto',['sellerId','seller_id'],'tipo']],['movements','movements','id',['tipo','cant','sku','ref',['productId','product_id']]]];
  const evidence=[];
  for(const [local,table,key,fields] of specs){
   const remote=(await rawRows(table)).filter(r=>!r.deleted_at);
   const pick=(r,side)=>Object.fromEntries([key,...fields].map(f=>{
    const [a,b]=Array.isArray(f)?f:typeof f==='string'&&f.includes(':')?f.split(':'):[f,f];const value=r[side==='local'?a:b];return [a,value==null||value===''?null:value];
   }));
   const expected=remote.map(r=>pick(r,'remote')).sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
   for(const t of terminals){const actual=await t.page.evaluate(local=>window.DATA[local],local);assert.deepEqual(actual.map(r=>pick(r,'local')).sort((a,b)=>String(a[key]).localeCompare(String(b[key]))),expected,`${t.name} ${table}`);}
   evidence.push({domain:local,rows:expected.length,hash:createHash('sha256').update(JSON.stringify(expected)).digest('hex')});
  }
  for(const [table,parent,ids,local] of [['sale_items','folio',createdSales,'sales'],['return_items','return_id',createdReturns,'returns'],['exchange_items','exchange_id',createdExchanges,'exchanges']]){
   if(!ids.length)continue;
   const rows=check(await serverClient.from(table).select('*').in(parent,ids));
   for(const t of terminals){const docs=await t.page.evaluate(({local,ids})=>window.DATA[local].filter(d=>ids.includes(d.folio)||ids.includes(d.id)),{local,ids});
    for(const doc of docs){const children=rows.filter(r=>r[parent]===(local==='sales'?doc.folio:doc.id));assert.equal(doc.lineas.length,children.length);
     for(const line of doc.lineas){const row=children.find(r=>r.line_id===line.lineId);assert.ok(row,`${table} line identity`);assert.equal(line.productId,row.product_id);assert.equal(line.barcodeCode??null,row.barcode_code??null);assert.equal(line.qty,Number(row.qty));}
    }
   }
  }
  const loans=check(await serverClient.from('loan_documents').select('*').in('id',createdLoans));
  for(const t of terminals){const local=await t.page.evaluate(ids=>window.DATA.loans.filter(d=>ids.includes(d.id)),createdLoans);for(const row of loans){const loan=local.find(l=>l.id===row.id);assert.ok(loan);assert.equal(loan._loanVersion,Number(row.version));for(const field of Object.keys(row.document).filter(k=>!k.startsWith('_')))assert.deepEqual(loan[field],row.document[field],`${t.name} loan ${field}`);}}
  const adjustments=await rawRows('commission_adjustments');
  for(const t of terminals){const local=await t.page.evaluate(()=>window.DATA.commissionAdjustments.map(r=>({id:r.operationId,total:r.totales.comision})).sort((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(local,adjustments.map(r=>({id:r.operation_id,total:Number(r.total)})).sort((a,b)=>a.id.localeCompare(b.id)));}
  return evidence;
 };
 let sold;
 await verify('Sale decrements authoritative stock exactly once',async()=>{
  const before=await stock(productIds[0]);sold=await sell(A,productIds[0]);await A.page.evaluate(()=>window.STORE.synchronizeNow());
  assert.equal(await stock(productIds[0]),before-1);await converge();return documents();
 });
 await verify('Concurrent sales A/B preserve both stock deltas',async()=>{
  const before=await stock(productIds[0]);await Promise.all([sell(A,productIds[0]),sell(B,productIds[0])]);
  await Promise.all([A,B].map(t=>t.page.evaluate(()=>window.STORE.synchronizeNow())));assert.equal(await stock(productIds[0]),before-2);
  await converge();return documents();
 });
 await verify('Return restores the exact reference and financial document',async()=>{
  const before=await stock(productIds[0]);
  const ret=await B.page.evaluate(folio=>{const s=window.DATA.sales.find(s=>s.folio===folio),l=s.lineas[0];return window.DATA.recordReturn({folio,lineas:[{...l,sourceSaleLineId:l.lineId,qty:1,motivo:'QA'}],metodo:'Efectivo'});},sold.folio);
  assert.ok(ret.ok,JSON.stringify(ret));createdReturns.push(ret.ret.id);await B.page.evaluate(()=>window.STORE.synchronizeNow());
  assert.equal(await stock(productIds[0]),before+1);await converge();return documents();
 });
 await verify('Exchange preserves original sale and both reference identities',async()=>{
  const before=[await stock(productIds[0]),await stock(productIds[1])],folio=createdSales[1];
  const original=check(await serverClient.from('sales').select('total,receipt_snapshot').eq('folio',folio))[0];
  const exchange=await C.page.evaluate(({folio,id,sellerId})=>{const D=window.DATA,s=D.sales.find(s=>s.folio===folio),l=s.lineas[0],p=D.products.find(p=>p.id===id);return D.recordExchange({origenFolio:folio,lineas:[{...l,sourceSaleLineId:l.lineId,lado:'devuelto',qty:1},{productId:p.id,sku:p.sku,talla:p.sizeCode,nombre:p.nombre,lado:'entregado',qty:1}],usuario:'QA',vendedorId:sellerId,notas:'Prueba aislada'});},{folio,id:productIds[1],sellerId});
  assert.ok(exchange.ok,JSON.stringify(exchange));createdExchanges.push(exchange.exchange.id);await C.page.evaluate(()=>window.STORE.synchronizeNow());
  assert.equal(await stock(productIds[0]),before[0]+1);assert.equal(await stock(productIds[1]),before[1]-1);
  assert.deepEqual(check(await serverClient.from('sales').select('total,receipt_snapshot').eq('folio',folio))[0],original);await converge();return documents();
 });
 await verify('Loan and return retain their frozen document',async()=>{
  const loan=await A.page.evaluate(({id,prefix})=>{const p=window.DATA.products.find(p=>p.id===id),day=new Date().toISOString().slice(0,10);return window.DATA.registrarPrestamo({fecha:day,fechaEsperada:day,persona:{nombre:prefix,tipo:'cliente'},lineas:[{productId:id,talla:p.sizeCode,qty:1}],usuario:'QA'});},{id:productIds[1],prefix});
  assert.ok(loan.ok,JSON.stringify(loan));createdLoans.push(loan.loan.id);await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();await documents();
  const returned=await B.page.evaluate(id=>{const l=window.DATA.loans.find(l=>l.id===id);return window.DATA.registrarDevolucionPrestamo(id,{fecha:new Date().toISOString().slice(0,10),lineas:[{key:l.lineas[0].key,qty:1}]});},loan.loan.id);
  assert.ok(returned.ok,JSON.stringify(returned));await B.page.evaluate(()=>window.STORE.synchronizeNow());await converge();return documents();
 });
 await verify('Layaway partial payment and liquidation converge',async()=>{
  const before=await stock(productIds[1]),sale=await sell(A,productIds[1],1,true);await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  const identities={created:check(await serverClient.from('sale_items').select('*').eq('folio',sale.folio))};
  writeFileSync(join(out,'layaway-identities.json'),JSON.stringify(identities,null,2));
  assert.equal(await stock(productIds[1]),before);
  const paid=await B.page.evaluate(folio=>window.DATA.registrarPagoApartado(folio,{monto:10,metodo:'Efectivo',detalle:{efectivo:10}}),sale.folio);
  assert.ok(paid.ok,JSON.stringify(paid));await B.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  identities.partial=check(await serverClient.from('sale_items').select('*').eq('folio',sale.folio));writeFileSync(join(out,'layaway-identities.json'),JSON.stringify(identities,null,2));
  const liquidated=await C.page.evaluate(folio=>window.DATA.completarApartado(folio),sale.folio);assert.ok(liquidated);await C.page.evaluate(()=>window.STORE.synchronizeNow());
  identities.liquidated=check(await serverClient.from('sale_items').select('*').eq('folio',sale.folio));writeFileSync(join(out,'layaway-identities.json'),JSON.stringify(identities,null,2));
  assert.equal(await stock(productIds[1]),before-1);await converge();return documents();
 });
 await verify('Client create/edit/delete and inactive promotion remain scoped',async()=>{
  const client=await A.page.evaluate(prefix=>window.DATA.addClient({nombre:prefix,tel:prefix}),prefix);createdClients.push(client.id);
  const promo=await A.page.evaluate(prefix=>window.DATA.addPromo({nombre:prefix,pausado:true,tipo:'pct',valor:1}),prefix);createdPromos.push(promo.id);
  await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();await documents();
  await B.page.evaluate(({id,promo})=>{window.DATA.updateClient(id,{nombre:'QA editado'});window.DATA.updatePromo(promo,{valor:2});},{id:client.id,promo:promo.id});
  await B.page.evaluate(()=>window.STORE.synchronizeNow());await converge();await documents();
  await C.page.evaluate(({id,promo})=>{window.DATA.removeClient(id);window.DATA.removePromo(promo);},{id:client.id,promo:promo.id});
  await C.page.evaluate(()=>window.STORE.synchronizeNow());await converge();return documents();
 });
 await verify('Commission settlement affects only the test seller',async()=>{
  const operationId=randomUUID();createdAdjustments.push(operationId);
  const adjusted=await A.page.evaluate(({operationId,sellerId,folio,prefix})=>window.DATA.applyCommissionAdjustment({operationId,motivo:prefix,renglones:[{folio,sellerId,comision:1}],porVendedor:[{sellerId,comision:1,ventas:1}],totales:{comision:1,vendedores:1}}),{operationId,sellerId,folio:createdSales[2],prefix});
  assert.ok(adjusted.ok,JSON.stringify(adjusted));await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  const remote=check(await serverClient.from('commission_adjustments').select('*').eq('operation_id',operationId))[0];assert.equal(Number(remote.total),1);
  for(const t of terminals)assert.equal(await t.page.evaluate(id=>window.DATA.commissionAdjustments.find(r=>r.operationId===id)?.totales.comision,operationId),1);
  await A.page.evaluate(id=>window.DATA.liquidarComision(id),sellerId);await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();return documents();
 });
 await verify('Configuration and permission invalidations reach every terminal',async()=>{
  const [lookup,settings]=await Promise.all([rawRows('lookup'),rawRows('settings')]);
  const config={catalogs:{},catalogMeta:undefined,settings:{}};
  for(const row of lookup.sort((a,b)=>a.sort_order-b.sort_order))(config.catalogs[row.kind]||=[]).push({code:row.code,label:row.label,active:row.active,meta:row.meta});
  for(const row of lookup)assert.equal(config.catalogs[row.kind].findIndex(item=>item.code===row.code),row.sort_order,'Test cannot renumber existing catalog positions');
  for(const row of settings){if(row.key==='_catalogMeta')config.catalogMeta=row.value;else if(row.key!=='_resetMark')config.settings[row.key]=row.value;}
  config.settings[prefix]='QA';
  await A.page.evaluate(config=>window.STORE.pushConfig(config),config);await A.page.evaluate(()=>window.STORE.synchronizeNow());await converge();
  for(const t of terminals)assert.equal(await t.page.evaluate(key=>window.CONFIG.get(key),prefix),'QA');
  check(await serverClient.from('user_screen_permission_overrides').upsert({user_id:userId,screen_key:'dashboard',effect:'deny'}));
  await converge();for(const t of terminals)assert.equal(await t.page.evaluate(()=>window.AUTH.canAccess('dashboard')),false);
  check(await serverClient.from('user_screen_permission_overrides').delete().eq('user_id',userId).eq('screen_key','dashboard'));
  await converge();for(const t of terminals)assert.equal(await t.page.evaluate(()=>window.AUTH.canAccess('dashboard')),true);
  return {configuration:true,permissions:true};
 });
 await verify('Lost acknowledgement replays the identical operation once',async()=>{
  const pattern=url+'/rest/v1/rpc/save_products_checked_v2',requests=[];let lost=false;
  await A.context.route(pattern,async route=>{requests.push(route.request().postDataJSON());if(!lost){lost=true;await route.fetch();await route.abort();}else await route.continue();});
  await A.page.evaluate(id=>{window.DATA.updateReference({id,precio:151});window.DATA.saveProducts([id]);},productIds[0]);
  await A.page.waitForFunction(()=>window.STORE.queueStatus().operations.some(op=>op.status==='retry_wait'),null,{timeout:45000});
  assert.equal(Number(check(await serverClient.from('products').select('precio').eq('id',productIds[0]))[0].precio),151);
  await A.page.evaluate(()=>window.STORE.synchronizeNow());await A.context.unroute(pattern);
  assert.ok(requests.length>=2);assert.deepEqual(requests[0],requests[1]);
  assert.equal(check(await serverClient.from('capability_operation_audit').select('operation_id').eq('operation_id',requests[0].p_operation_id)).length,1);
  return converge();
 });
 await verify('Closed terminal reopens to authority and repairs damaged cache',async()=>{
  await C.page.goto('about:blank');
  await A.page.evaluate(ids=>{window.DATA.updateReference({id:ids[0],precio:149});window.DATA.updateReference({id:ids[1],precio:103});window.DATA.saveProducts(ids);},productIds.slice(0,2));
  await A.page.evaluate(()=>window.STORE.synchronizeNow());
  await A.page.evaluate(id=>{window.DATA.updateReference({id,precio:150});window.DATA.saveProducts([id]);},productIds[0]);await A.page.evaluate(()=>window.STORE.synchronizeNow());
  await C.page.goto(address);await C.page.waitForFunction(()=>window.AUTH?.hasSession()&&window.DATA?.isLocalWriter);await converge();
  await C.page.evaluate(id=>{window.DATA.products.find(p=>p.id===id).stockQuantity=999;window.DATA.saveProducts();localStorage.setItem('balam_sync_domain_cursors_v1',JSON.stringify({products:999999999}));},productIds[0]);
  await C.page.reload();await C.page.waitForFunction(()=>window.AUTH?.hasSession()&&window.DATA?.isLocalWriter);await converge();return documents();
 });
 await verify('Visible update control reconciles and fits mobile and desktop',async()=>{
  for(const width of [320,1280]){
   await A.page.setViewportSize({width,height:900});
   await A.page.evaluate(id=>{window.DATA.products.find(p=>p.id===id).stockQuantity=999;window.DATA.saveProducts();},productIds[0]);
   await A.page.getByTestId('sync-update').click();
   await A.page.waitForFunction(id=>window.DATA.products.find(p=>p.id===id)?.stockQuantity!==999&&window.STORE.syncStatus().synchronized,productIds[0],{timeout:120000});
   assert.ok(await A.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
   await A.page.screenshot({path:join(out,`sync-${width}.png`)});
  }
  return converge();
 });
 await verify('H152 open reports remove deleted fixture sellers on A/B/C',async()=>{
  const reportName=prefix+' report witness';
  check(await serverClient.from('sellers').insert({id:reportSellerId,nombre:reportName,role:'vendedor',active:true,comision_pct:0,sync_base_version:0}));
  for(const t of terminals){
   await t.page.evaluate(()=>window.STORE.synchronizeNow());
   await t.page.evaluate(()=>{
    const host=document.createElement('div');host.id='h152-live-reports';host.style.cssText='position:fixed;inset:0;z-index:999;background:white;overflow:auto';document.body.appendChild(host);
    window.h152ReportsRoot=ReactDOM.createRoot(host);window.h152ReportsRoot.render(React.createElement(window.ReportsScreen,{}));
   });
   await t.page.locator('#h152-live-reports').getByText(reportName,{exact:true}).waitFor();
  }
  check(await serverClient.from('sellers').delete().eq('id',reportSellerId));
  for(const t of terminals){
   await t.page.evaluate(()=>window.STORE.reconcileDomains());
   await t.page.waitForFunction(({id,name})=>!window.DATA.sellers.some(s=>s.id===id)
    && !document.querySelector('#h152-live-reports').innerText.includes(name)
    && window.STORE.syncStatus().synchronized,{id:reportSellerId,name:reportName},{timeout:120000});
  }
  const total=check(await serverClient.from('sale_payments').select('monto')).reduce((sum,p)=>sum+Number(p.monto),0);
  for(const t of terminals){
   assert.equal(await t.page.evaluate(()=>window.DATA.payments.reduce((sum,p)=>sum+Number(p.monto),0)),total);
   await t.page.evaluate(()=>{window.h152ReportsRoot.unmount();document.getElementById('h152-live-reports').remove();});
  }
  return {liveReports:true,profiles:3,staleRows:0,paymentsAgree:true};
 });
 await verify('Final projections and device checkpoints agree with authority',async()=>{
  await converge();const projected=await documents();
  const devices=check(await serverClient.from('sync_devices').select('device_id,queue_pending,queue_blocked,data_epoch').in('device_id',terminals.map(t=>`${prefix}-${t.name}`)));
  assert.equal(devices.length,3);for(const device of devices){assert.equal(device.queue_pending,0);assert.equal(device.queue_blocked,0);assert.equal(Number(device.data_epoch),Number(manifest.data_epoch));}
  for(const t of terminals){const state=await t.page.evaluate(()=>window.STORE.syncStatus());assert.equal(state.synchronized,true);assert.deepEqual(t.errors,[],`${t.name} page errors`);}
  result.domains=['products','clients','sellers','promotions','sales','payments','returns','exchanges','loans','liquidations','commissionAdjustments','movements','config','permissions','purges','devices'];
  result.pendingLost=0;result.finalDivergences=0;return {projected,devices};
 });
} catch(error) {result.error=error.message;process.exitCode=1;console.error(error.message);}
finally {
 clearInterval(watchdog);
 if(browser)await browser.close();
 if(server)await new Promise(r=>server.close(r));
 // Only IDs created by this exact run. No cleanup by label, age or broad prefix.
 const devices=terminals.map(t=>`${prefix}-${t.name}`), cleanupErrors=[];
 const clean=async(name,fn)=>{try{check(await fn());}catch(error){cleanupErrors.push({name,error:error.message});}};
 if(devices.length)await clean('recovery directives',()=>serverClient.from('sync_device_recoveries').delete().in('device_id',devices));
 if(devices.length)await clean('devices',()=>serverClient.from('sync_devices').delete().in('device_id',devices));
 if(createdReturns.length){await clean('return receipts',()=>serverClient.from('return_commits').delete().in('return_id',createdReturns));await clean('returns',()=>serverClient.from('returns').delete().in('id',createdReturns));}
 if(createdExchanges.length){await clean('exchange receipts',()=>serverClient.from('exchange_commits').delete().in('exchange_id',createdExchanges));await clean('exchanges',()=>serverClient.from('exchanges').delete().in('id',createdExchanges));}
 if(createdSales.length){
  await clean('layaway receipts',()=>serverClient.from('layaway_liquidation_commits').delete().in('folio',createdSales));
  await clean('sale payments',()=>serverClient.from('sale_payments').delete().in('folio',createdSales));
  await clean('sale receipts',()=>serverClient.from('sale_commits').delete().in('folio',createdSales));
  await clean('stock reservations',()=>serverClient.from('stock_reservations').delete().in('folio',createdSales));
  await clean('sales',()=>serverClient.from('sales').delete().in('folio',createdSales));
 }
 if(createdLoans.length)await clean('loans',()=>serverClient.from('loan_documents').delete().in('id',createdLoans));
 await clean('movements',()=>serverClient.from('movements').delete().in('product_id',productIds));
 await clean('liquidations',()=>serverClient.from('liquidations').delete().eq('seller_id',sellerId));
 if(createdAdjustments.length)await clean('commission adjustments',()=>serverClient.from('commission_adjustments').delete().in('operation_id',createdAdjustments));
 await clean('test setting',()=>serverClient.from('settings').delete().eq('key',prefix));
 if(operations.size)await clean('config receipts',()=>serverClient.from('config_commits').delete().in('operation_id',[...operations]));
 if(createdClients.length)await clean('clients',()=>serverClient.from('clients').delete().in('id',createdClients));
 if(createdPromos.length)await clean('promotions',()=>serverClient.from('promotions').delete().in('id',createdPromos));
 await clean('products',()=>serverClient.from('products').delete().in('id',productIds));
 await clean('fixture conflicts',()=>serverClient.from('sync_conflicts').delete().in('entity_id',productIds));
 if(operations.size)await clean('operation audit',()=>serverClient.from('capability_operation_audit').delete().in('operation_id',[...operations]));
 await clean('sellers',()=>serverClient.from('sellers').delete().in('id',[adminId,sellerId,reportSellerId]));
 if(userId)await clean('auth identity',()=>authAdmin.auth.admin.deleteUser(userId));
 result.cleanup={ok:cleanupErrors.length===0,ids:[adminId,sellerId],devices,errors:cleanupErrors};
 if(baseline){const after=Object.fromEntries(await Promise.all(safetyTables.map(async table=>[table,semanticHash(await rawRows(table))])));result.businessPreservation={ok:JSON.stringify(after)===JSON.stringify(baseline),before:baseline,after};if(!result.businessPreservation.ok)process.exitCode=1;}
 result.finishedAt=new Date().toISOString();
 if(cleanupErrors.length)process.exitCode=1;
 writeFileSync(join(out,'matrix.json'),JSON.stringify(result,null,2));
 console.log('Evidence: '+out);
}
