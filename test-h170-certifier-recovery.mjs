// Execute the certifier's actual recovery guard without remote writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('test-h164-live-online.mjs','utf8');
const start=source.indexOf("  if(currentCase==='Sale / payment / commission / lost response after COMMIT'");
const end=source.indexOf('  if(retryRejectedCase===currentCase',start);
assert.ok(start>=0&&end>start);
const run=vm.runInNewContext('(async function(f){ const {fixtures,db,check,userId,key,currentCase,label,save}=f; let existing=fixtures.checkpoints[key];'+source.slice(start,end)+';return existing;})',{assert,structuredClone});
const actor='17000000-0000-4000-8000-000000000001';
const ids=['17000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000003'];
const currentCase='Sale / payment / commission / lost response after COMMIT',label='One sale with response loss',key=currentCase+' / '+label;
function fixture(){
  const tables={
    online_requests:ids.map((request_id,i)=>({request_id,actor_id:actor,state:'confirmed',command_kind:i?'sale':'folio',response:{ok:true}})),
    sales:[{folio:'QA-170-1',operation_id:ids[1],cliente_id:'qa-client',estado:'Pagado',total:348}],
    sale_items:[{folio:'QA-170-1',product_id:'qa-product',qty:3,precio:116}],
    sale_payments:[{folio:'QA-170-1',monto:348}],
  };
  const fixtures={sales:['QA-170-1'],clients:['qa-client'],products:['qa-product'],checkpoints:{[key]:{requestIds:[...ids]}}};
  let saves=0;
  const f={fixtures,tables,userId:actor,key,currentCase,label,get saves(){return saves;},save(){saves++;},check:r=>r.data,
    db:{from(table){let rows=structuredClone(tables[table]);return{
      select(){return this;},in(field,values){rows=rows.filter(r=>values.includes(r[field]));return this;},
      eq(field,value){rows=rows.filter(r=>r[field]===value);return this;},
      async single(){assert.equal(rows.length,1);return {data:rows[0]};},
      then(resolve,reject){return Promise.resolve({data:rows}).then(resolve,reject);},
    };}},
  };return f;
}
let passed=0;
const good=fixture(),old=structuredClone(good.fixtures.checkpoints[key]);
const next=await run(good);
assert.equal(good.saves,2);assert.deepEqual(good.fixtures.confirmedTransportInterruptions[0].checkpoint,old);
assert.equal(good.fixtures.confirmedTransportInterruptions[0].replayed,false);
assert.deepEqual(Array.from(next.requestIds),[]);assert.deepEqual(Array.from(next.freshQaAttemptAfter),ids);
passed++;console.log('PASS exact confirmed QA sale retained; fresh attempt has no reused request IDs');
for(const [name,change] of [
  ['foreign actor',f=>{f.tables.online_requests[1].actor_id='other-actor';}],
  ['unresolved receipt',f=>{f.tables.online_requests[1].state='executing';}],
  ['missing receipt',f=>{f.tables.online_requests.pop();}],
  ['unexpected command',f=>{f.tables.online_requests[0].command_kind='config';}],
  ['untracked sale',f=>{f.fixtures.sales=[];}],
  ['other client',f=>{f.tables.sales[0].cliente_id='other-client';}],
  ['different quantity',f=>{f.tables.sale_items[0].qty=2;}],
  ['inconsistent payment',f=>{f.tables.sale_payments[0].monto=100;}],
  ['second fresh attempt',f=>{f.fixtures.confirmedTransportInterruptions=[{}];}],
]){
  const f=fixture();change(f);const before=structuredClone(f.fixtures);
  await assert.rejects(()=>run(f));assert.equal(f.saves,0);assert.deepEqual(f.fixtures,before);
  passed++;console.log('PASS blocks '+name+' before changing checkpoints');
}
console.log(passed+' PASS / 0 FAIL');
