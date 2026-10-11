// Local boundary verification for the LIVE negative cases. No remote connection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {captureFinancialDraft,financialAttempt,expectedReturnCommissionRows,assertReturnCommissionRows,assertCommissionBalances,financialMutation} from './qa-h186-financial-journey.mjs';

let productAdapter,promoAdapter,folios=0,commercialCalls=0;
const window={crypto:{randomUUID},addEventListener(){},dispatchEvent(){},CORE:{
  getDeviceId:()=> 'h186-local-negative',registerCatalogProducts:adapter=>productAdapter=adapter,
  registerCatalogPromotions:adapter=>promoAdapter=adapter,registerMonetaryDocuments(){},
  catalogProducts:()=>productAdapter?.list()||[],catalogPromotions:()=>promoAdapter?.list()||[],
  invokeSync(method){
    if(method==='getQuoteContext')return {configVersion:7,promotionsFingerprint:'owned',sellersFingerprint:'owned'};
    if(method==='serverNow')return new Date('2026-10-10T19:00:00Z');
    if(method==='assertBusinessReady')return true;
    if(method==='allocateFolio'){folios++;return {ok:true,folio:'QABCDE-261010-0001'};}
    commercialCalls++;throw Error('COMMERCIAL_GATEWAY_MUST_NOT_BE_REACHED');
  }
}};
const context=vm.createContext({window,structuredClone,console,setTimeout,clearTimeout,CustomEvent:class{},
  localStorage:new Proxy({},{get(){throw Error('No commercial local storage');}})});
for(const file of ['config','data'])vm.runInContext(fs.readFileSync('balam/'+file+'.jsx','utf8'),context);
const D=window.DATA,C=window.CONFIG;C.load(C.prepareMutation('reset',[]).state);
const size=D.SIZES_LETRA[0],id=randomUUID(),sellerId='h186-own-seller';
const p=D.hydrate({id,recordModel:'v1',cat:'21',modelo:'H186',nombre:'Owned fixture',tela:'ALG',manga:'ML',
  color:'BL',cuello:'NOR',orn:'—',precio:1250,costo:563,sizeCode:size,sizeCategoryId:'size_letter',
  attrs:{__sizeCategoryId:'size_letter'},stock:[{talla:size,escala:'L',stock:20}],_syncVersion:1});
D.replaceFromOnline({products:[p],clients:[],sellers:[{id:sellerId,nombre:'QA',comisionPct:5,active:true}],
  sales:[],payments:[],returns:[],exchanges:[],promotions:[],movements:[],loans:[],liquidations:[],commissionAdjustments:[],
  commissionContext:{periodStart:'',sellerBases:[{sellerId,baseRaw:0}]}});
const originalInvoke=window.CORE.invokeSync,before=JSON.stringify({products:D.products,sales:D.sales,payments:D.payments});
context.input={product:{id},operationId:randomUUID(),sellerId};
const draft=await vm.runInContext('('+captureFinancialDraft.toString()+')(input)',context);
assert.equal(folios,1);assert.equal(commercialCalls,0);assert.equal(window.CORE.invokeSync,originalInvoke);
assert.equal(JSON.stringify({products:D.products,sales:D.sales,payments:D.payments}),before);
assert.equal(draft.sale.total,1250);assert.equal(draft.sale.iva,172.41);assert.equal(draft.effects.payments[0].monto,1250);
console.log('PASS real DATA capture reserves only QA folio and preserves local data/gateway');
context.input={product:{id:randomUUID()},operationId:randomUUID(),sellerId};
await assert.rejects(()=>vm.runInContext('('+captureFinancialDraft.toString()+')(input)',context),/OWN_DRAFT_PRODUCT_REQUIRED/);
assert.equal(window.CORE.invokeSync,originalInvoke);assert.equal(commercialCalls,0);
console.log('PASS failed capture cannot replace the gateway or dispatch a sale');

// Reuse the established isolated transport bootstrap, not its scenario body.
// The real STORE mapper/execute path runs against its in-memory RPC fixture.
const transport=fs.readFileSync('test-h164-online-transport.mjs','utf8');
const boundary=transport.indexOf("if(!process.env.BALAM_TRANSPORT_CASE) {");
assert.ok(boundary>0,'Transport fixture bootstrap boundary required');
const bootstrap=transport.slice(0,boundary).replace(/^import .*;\r?\n/gm,'');
const code=bootstrap+`
const pristine=JSON.stringify(inputDraft),observed=[];
executeHook=async args=>{
 observed.push(clone(args));
 const command=args.p_command,kind=activeKind;
 assert.equal(command.type,'sale');assert.equal(command.header.financial_version,2);
 assert.equal(command.header.folio,inputDraft.sale.folio);assert.equal(command.header.cliente_id,null);
 assert.equal(command.header.operation_id,args.p_request_id);
 assert.ok(command.payments[0].metodo.startsWith('__BALAM_MONEY_V1__'));
 const wire=JSON.parse(command.payments[0].metodo.slice('__BALAM_MONEY_V1__'.length));
 assert.equal(wire.components[0].amount,kind==='payment'?1249.99:1250);
 assert.equal(command.payments[0].monto,kind==='payment'?1249.99:1250);
 assert.equal(command.header.iva,kind==='iva'?172.42:172.41);
 assert.equal(command.header.total,kind==='total'?1250.01:1250);
 const receipt=kind==='correct'?{ok:true,result:{folio:command.header.folio}}:
  {ok:false,error:{code:'22023',message:kind==='payment'?'FINANCIAL_PAYMENT_TOTAL_MISMATCH':'FINANCIAL_QUOTE_MISMATCH'}};
 receipts.set(args.p_request_id,receipt);return {data:receipt};
};
let activeKind;
for(const kind of ['iva','total','payment','correct']){
 activeKind=kind;const requestId=randomUUID(),attempt=financialAttempt(inputDraft,kind,requestId);
 if(kind==='correct')assert.equal((await S.pushSale(attempt.sale,attempt.effects)).ok,true);
 else await assert.rejects(()=>S.pushSale(attempt.sale,attempt.effects),/FINANCIAL_/);
 assert.equal(referenceKeys().length,0);assert.equal(JSON.stringify(inputDraft),pristine);
 console.log('PASS actual STORE wire '+kind+' with a distinct receipt identity');
}
assert.equal(commitCount,4);assert.equal(new Set(observed.map(row=>row.p_request_id)).size,4);
`;
const isolated=vm.createContext({assert,fs,vm,webcrypto,randomUUID,financialAttempt,inputDraft:structuredClone(draft),
  Headers,Request,TextEncoder,URL,Blob,performance,AbortSignal,queueMicrotask,console,setTimeout,clearTimeout,
  fetch(){throw Error('NETWORK_FORBIDDEN');}});
await vm.runInContext('(async()=>{'+code+'})()',isolated);
const frozen={financial_version:2,total:2624,comisiones:[{sellerId:'original',base:2262.07,monto:226.21}]};
const first=expectedReturnCommissionRows(frozen,[],874.67);
assert.deepEqual(first,[{sellerId:'original',base:754.03,monto:75.4}]);
const prior=[{total:874.67,comisiones:first}],second=expectedReturnCommissionRows(frozen,prior,874.67);
assert.deepEqual(second,first);
assert.deepEqual(expectedReturnCommissionRows(frozen,prior,1749.33),[{sellerId:'original',base:1508.04,monto:150.81}]);
console.log('PASS LIVE integer oracle separates exchanged value from full monetary refund');
assert.deepEqual(expectedReturnCommissionRows({financial_version:2,total:20.10,comisiones:[{sellerId:'original',base:17.33,monto:2.01}]},[],10.05),
 [{sellerId:'original',base:8.67,monto:1.01}]);
assert.deepEqual(expectedReturnCommissionRows({financial_version:2,total:0,comisiones:[]},[],0),[]);
console.log('PASS LIVE oracle checks half cents and zero refunds independently of DATA');
assertReturnCommissionRows(second,first);
assert.throws(()=>assertReturnCommissionRows([{...first[0],monto:150.81}],first),/H186_RETURN_COMMISSION_SNAPSHOT_MISMATCH/);
assert.throws(()=>assertReturnCommissionRows([...first,...first],first),/H186_RETURN_COMMISSION_SNAPSHOT_MISMATCH/);
assert.throws(()=>assertReturnCommissionRows([{...first[0],base:754.02}],first),/H186_RETURN_COMMISSION_SNAPSHOT_MISMATCH/);
console.log('PASS LIVE guard rejects excessive, duplicated and altered persisted reversals');
const balances=[{id:'original',comision_acum:150.81},{id:'exchange',comision_acum:4}];
assertCommissionBalances(balances,[{id:'original',comision_acum:150.81},{id:'exchange',comision_acum:20.18}],
 [{sellerId:'exchange',amount:16.18}]);
assert.throws(()=>assertCommissionBalances(balances,[{id:'original',comision_acum:75.41},{id:'exchange',comision_acum:20.18}],
 [{sellerId:'exchange',amount:16.18}]),/H186_COMMISSION_SELLER_DELTA/);
assertCommissionBalances(balances,[{id:'original',comision_acum:75.41},{id:'exchange',comision_acum:4}],
 [{sellerId:'original',amount:-75.4}]);
console.log('PASS LIVE seller guard preserves original commission during exchange and exact refund delta');
// The real STORE lifecycle may withdraw admission between successful commands.
// Retain that lifecycle at its presence read; neither its guard nor DATA is stubbed.
const readinessCode=bootstrap+String.raw`
const storeStorageListener=handlers.get('storage');
Object.assign(window.CORE,{
 registerCatalogProducts(){},registerCatalogPromotions(){},registerMonetaryDocuments(){},
 catalogProducts:()=>window.DATA.products,catalogPromotions:()=>window.DATA.promos,
 invokeSync:(method,...args)=>S[method](...args)
});
for(const file of ['config','data'])vm.runInContext(fs.readFileSync('balam/'+file+'.jsx','utf8'),context);
await S.refresh();
executeHook=async args=>{
 assert.equal(args.p_command.kind,'promotions');
 raw.promotions.push(...args.p_command.rows.map(row=>({...clone(row),sync_version:1})));
 raw.snapshotRevision='revision-'+commitCount;
 const receipt={ok:true,result:{}};receipts.set(args.p_request_id,receipt);return {data:receipt};
};
const D=window.DATA,draft={nombre:'Owned readiness fixture',tipo:'pct',valor:30,scope:{modelos:['OWN']}},terminal={name:'A'};
const originalRpc=client.rpc;
function beginAdmission(){
 let release;const gate=new Promise(resolve=>release=resolve);
 client.rpc=async function(name,args){if(name==='online_presence')await gate;return originalRpc.call(this,name,args);};
 storeStorageListener({key:'balam_pos_promos_v1',newValue:'[]'});
 assert.equal(S.syncStatus().ready,false);
 return {release,finish:async()=>{release();await S.init();client.rpc=originalRpc;}};
}
const awaitAdmission=async current=>{assert.equal(current,terminal);await S.init();assert.equal(S.syncStatus().ready,true);};
await D.addPromo(draft);assert.equal(commitCount,1);
let gate=beginAdmission();
await assert.rejects(()=>D.addPromo(draft),error=>error.code==='ONLINE_NOT_READY');
assert.equal(commitCount,1);assert.equal(D.promos.length,1);assert.equal(referenceKeys().length,0);
console.log('PASS real DATA/STORE rejects unready next promotion before commercial transport');
let actions=0,settled=false;
const pending=financialMutation(terminal,awaitAdmission,()=>{actions++;return D.addPromo({...draft,nombre:'After admission'});})
 .then(value=>{settled=true;return value;});
await Promise.resolve();await Promise.resolve();
assert.equal(actions,0);assert.equal(settled,false);assert.equal(commitCount,1);
await gate.finish();const result=await pending;
assert.ok(result.id);assert.equal(actions,1);assert.equal(commitCount,2);assert.equal(D.promos.length,2);
console.log('PASS readiness wait sends the next real promotion exactly once after admission');
gate=beginAdmission();
const next=financialMutation(terminal,awaitAdmission,()=>{actions++;return D.addPromo({...draft,nombre:'Fresh admission again'});});
await Promise.resolve();assert.equal(actions,1);assert.equal(commitCount,2);
await gate.finish();await next;
assert.equal(actions,2);assert.equal(commitCount,3);assert.equal(D.promos.length,3);
console.log('PASS every new command waits for its own intervening readiness transition');
let actionCalls=0,waits=0;const unavailable=Object.assign(Error('readiness unavailable'),{code:'ONLINE_UNAVAILABLE'});
await assert.rejects(()=>financialMutation(terminal,async()=>{waits++;throw unavailable;},()=>{actionCalls++;}),error=>error===unavailable);
assert.equal(waits,1);assert.equal(actionCalls,0);assert.equal(commitCount,3);
console.log('PASS failed readiness sends zero commands and is not retried');
const rejected=Object.assign(Error('authoritative rejection'),{code:'FINANCIAL_QUOTE_MISMATCH'});
await assert.rejects(()=>financialMutation(terminal,async()=>{waits++;},async()=>{actionCalls++;throw rejected;}),error=>error===rejected);
assert.equal(waits,2);assert.equal(actionCalls,1);assert.equal(commitCount,3);
console.log('PASS a dispatched action rejection propagates once without retry or replay');
await assert.rejects(()=>financialMutation(terminal,async()=>{},()=>{
 actionCalls++;gate=beginAdmission();return D.addPromo({...draft,nombre:'Guard remains authoritative'});
}),error=>error.code==='ONLINE_NOT_READY');
assert.equal(actionCalls,2);assert.equal(commitCount,3);assert.equal(D.promos.length,3);
assert.equal(referenceKeys().length,0);await gate.finish();
console.log('PASS a later readiness loss still reaches the unchanged application guard without retry');
`;
const readinessContext=vm.createContext({assert,fs,vm,webcrypto,randomUUID,financialMutation,
 Headers,Request,TextEncoder,URL,Blob,performance,AbortSignal,queueMicrotask,console,setTimeout,clearTimeout,
 fetch(){throw Error('NETWORK_FORBIDDEN');}});
await vm.runInContext('(async()=>{'+readinessCode+'})()',readinessContext);
console.log(JSON.stringify({passed:16,network:false,scope:'Real DATA/STORE transport, commission guards and readiness admission; SQL rejection authority covered separately'}));
