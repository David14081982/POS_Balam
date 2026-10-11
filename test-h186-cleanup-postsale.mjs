import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as planner from './h171-live-cleanup-plan.mjs';
import {postgresJsonbHash} from './h171-live-reconciliation.mjs';
const prove=planner.proveConfirmedPostSaleWrite||(()=>null);
const actorId='11111111-1111-4111-8111-111111111111',run='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333',priorId='44444444-4444-4444-8444-444444444444';
const sha='a'.repeat(64),md5='b'.repeat(32),deviceId=`qa-h164-${run}-A`;
function fixture(kind='return',table='products'){
 const row={table,body:{id:table==='products'?'product-own':'seller-own',sync_version:3,sync_device_id:kind+':'+id}};
 const c={type:kind,expectedActorId:actorId,operationId:id,id:'doc-own',folio:'QOWN-261010-0001',legacy:false,
  header:{id:'doc-own',folio:'QOWN-261010-0001',vendedores:['seller-own'],vendedor_id:'seller-own'},
  items:[{product_id:'product-own',talla:'XS',qty:1,...(kind==='exchange'?{lado:'entregado'}:{})}],
  stockLines:[{product_id:'product-own',talla:'XS',qty:1}],sellerEffects:[{id:'seller-own',base_version:2}]};
 if(kind==='exchange'){c.seller_effects=c.sellerEffects;delete c.sellerEffects;}
 const context={id,c,e:{kind:'rpc:execute_online_command',actorId,requestId:id,entryHash:sha,sequence:10},
  r:{full_row_md5:md5,body:{actor_id:actorId,request_id:id,state:'confirmed',command_kind:kind,device_id:deviceId,
   command_hash:postgresJsonbHash(c),response:{ok:true,requestId:id,result:{ok:true,idempotent:false,[table]:[structuredClone(row.body)],...(kind==='exchange'?{exchange:{id:c.id,folio:c.folio}}:{})}}}}};
 const priorCommand={type:'upsert',kind:'products',rows:[{id:'product-own',sync_base_version:0}],expectedActorId:actorId};
 const prior={id:priorId,c:priorCommand,e:{kind:'rpc:execute_online_command',actorId,requestId:priorId,entryHash:sha,sequence:5},
  r:{full_row_md5:md5,body:{actor_id:actorId,request_id:priorId,state:'confirmed',command_kind:'upsert',command_hash:postgresJsonbHash(priorCommand),device_id:deviceId,
   response:{ok:true,requestId:priorId,result:[{id:'product-own',sync_version:2}]}}}};
 const device={body:{device_id:deviceId,user_id:actorId,status:'online',client_build:'build',metadata:{online_only:true}}};
 return {row,context,contexts:[prior,context],device,actorId,run,newRow:true,newDevice:true,newDocument:true,newCommit:true,principalProven:true,
  document:{body:{id:c.id,folio:c.folio}},commit:{body:{commit_id:id,[kind+'_id']:c.id,folio:c.folio}},
  presence:{kind:'rpc:online_presence',actorId,entryHash:sha,sequence:1,identities:{deviceId},command:{p_device_id:deviceId,p_client_build:'build'}},
  observation:{sequences:[1],observedContentSha256:postgresJsonbHash(device.body)}};
}
function seal(v){v.context.r.body.command_hash=postgresJsonbHash(v.context.c);}
for(const kind of ['return','exchange'])for(const table of ['products','sellers'])test(`${kind} exact confirmed ${table} marker has typed proof`,()=>{
 const v=fixture(kind,table),p=prove(v);assert.equal(p?.kind,`CONFIRMED_${kind.toUpperCase()}_WRITE_MARKER`);assert.equal(p.requestId,id);
});
const negatives={
 'wrong command kind':v=>{v.context.c.type='sale';seal(v);},
 'unconfirmed receipt':v=>{v.context.r.body.state='executing';},
 'foreign actor':v=>{v.context.e.actorId=priorId;},
 'foreign receipt actor':v=>{v.context.r.body.actor_id=priorId;},
 'wrong UUID marker':v=>{v.row.body.sync_device_id='return:'+priorId;},
 'generic marker':v=>{v.row.body.sync_device_id='custom:'+id;},
 'changed current row':v=>{v.row.body.extra='changed';},
 'wrong version':v=>{v.row.body.sync_version++;v.context.r.body.response.result.products[0].sync_version++;},
 'baseline row':v=>{v.newRow=false;},
 'baseline device':v=>{v.newDevice=false;},
 'baseline document':v=>{v.newDocument=false;},
 'baseline commit':v=>{v.newCommit=false;},
 'unproven Auth':v=>{v.principalProven=false;},
 'foreign device':v=>{v.device.body.user_id=priorId;},
 'changed observation':v=>{v.observation.observedContentSha256='c'.repeat(64);},
 'missing product in command':v=>{v.context.c.items=[];seal(v);},
 'missing stock line':v=>{v.context.c.stockLines=[];seal(v);},
 'legacy return':v=>{v.context.c.legacy=true;seal(v);},
 'missing previous echo':v=>{v.contexts=[v.context];},
 'foreign previous receipt':v=>{v.contexts[0].r.body.actor_id=priorId;},
 'wrong commit ID':v=>{v.commit.body.commit_id=priorId;},
 'wrong document ID':v=>{v.document.body.id='foreign';},
 'changed command hash':v=>{v.context.r.body.command_hash='f'.repeat(64);},
 'unbound seller':v=>{v.row.table='sellers';v.row.body.id='foreign-seller';},
};
for(const [name,mutate]of Object.entries(negatives))test(`rejects ${name}`,()=>{const v=fixture();mutate(v);assert.equal(prove(v),null);});
test('return two sizes requires two product version increments',()=>{const v=fixture();v.context.c.items.push({product_id:'product-own',talla:'S',qty:1});v.context.c.stockLines.push({product_id:'product-own',talla:'S',qty:1});v.row.body.sync_version=4;v.context.r.body.response.result.products[0].sync_version=4;seal(v);assert.ok(prove(v));});
test('exchange zero net stock does not prove a product write marker',()=>{const v=fixture('exchange');v.context.c.items.push({product_id:'product-own',talla:'XS',qty:1,lado:'devuelto'});seal(v);assert.equal(prove(v),null);});
test('duplicate seller effects require exact number of increments',()=>{const v=fixture('return','sellers');v.context.c.sellerEffects.push({id:'seller-own',base_version:2});v.row.body.sync_version=4;v.context.r.body.response.result.sellers[0].sync_version=4;seal(v);assert.ok(prove(v));v.row.body.sync_version=3;v.context.r.body.response.result.sellers[0].sync_version=3;assert.equal(prove(v),null);});
test('exchange requires dispatcher snake-case seller_effects and exact vendedor_id',()=>{
 const v=fixture('exchange','sellers');v.context.c.sellerEffects=v.context.c.seller_effects;delete v.context.c.seller_effects;seal(v);assert.equal(prove(v),null);
 v.context.c.seller_effects=v.context.c.sellerEffects;v.context.c.header.vendedor_id='foreign';seal(v);assert.equal(prove(v),null);
});
test('actual STORE pushExchange mapper produces accepted product and seller proofs',()=>{
 const source=fs.readFileSync('balam/store.jsx','utf8'),start=source.indexOf('  function pushExchange('),end=source.indexOf('  function toConfigState(',start);
 assert.ok(start>0&&end>start);let command;
 const push=vm.runInNewContext('('+source.slice(start,end).trim()+')',{execute:c=>(command=JSON.parse(JSON.stringify(c))),MAP:{payments:{toRow(){throw Error('NO_PAYMENT_FIXTURE');}}}});
 push({id:'doc-own',folio:'QOWN-261010-0001',origenFolio:'QOWN-261010-0000',_operationId:id,vendedorId:'seller-own',
  lineas:[{productId:'product-own',sku:'QA',nombre:'QA',talla:'XS',qty:1,lado:'entregado'}]},
  {productVersions:[{id:'product-own',baseVersion:2}],sellerEffects:[{id:'seller-own',base_version:2}]});
 assert.equal(command.sellerEffects,undefined);assert.equal(command.seller_effects[0].base_version,2);
 for(const table of ['products','sellers']){const v=fixture('exchange',table);v.context.c={...command,expectedActorId:actorId};seal(v);assert.ok(prove(v));}
});
