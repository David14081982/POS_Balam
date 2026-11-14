// Four directed SQL scenarios. No network or production data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './test-fixtures/h189/sql-fixture.mjs';
const {db,run,lit,ident}=await fixture(),admin=randomUUID(),seller=randomUUID(),inactive=randomUUID(),orphan=randomUUID(),product=randomUUID();
const scalar=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
const read=p=>fs.readFileSync(p,'utf8'),email=id=>id+'@h192.invalid.test';
const login=async id=>run("reset role;select set_config('request.jwt.claim.sub',"+lit(id||'')+",false);select set_config('request.jwt.claims',"+lit(JSON.stringify(id?{sub:id,email:email(id),role:'authenticated'}:{}))+",false)");
const asUser=async(fn,role='authenticated')=>{await run('set role '+role);try{return await fn();}finally{await run('reset role');}};
const call=async(c,id=randomUUID())=>asUser(async()=>scalar('select pos.execute_online_command($1,$2)',[id,JSON.stringify({...c,expectedActorId:await scalar('select auth.uid()')})]));
const cap=k=>asUser(()=>scalar('select pos.current_has_capability($1)',[k]));
const cases=[];const pass=name=>{cases.push(name);console.log('PASS '+name);};
const screens=['pos','apartados','clientes','inventario','devoluciones','descuentos','prestamos','vendedores','reportes','config.negocio','config.usuarios','config.permisos'];
const caps=['sales.create','sales.collect','sales.refund','sales.exchange','sales.cancel','customers.create','customers.update','customers.delete','inventory.adjust','inventory.delete','inventory.loan','promotions.manage','sellers.manage','permissions.manage','settings.manage','commissions.settle','commissions.close_period','commissions.adjust',...['deliver','return','shortage','close','edit','delete','reopen'].map(k=>'inventory.loan.'+k)];
const edit=async(overrides)=>{await login(admin);const v=await asUser(()=>scalar('select pos.admin_user_permission_snapshot($1,$2::text[])',[seller,screens]));const r=await call({type:'permissions',rpc:'admin_apply_user_screen_permissions_checked',args:{p_target_user_id:seller,p_role_code:'vendedor',p_overrides:overrides,p_expected_version:v.permission_version,p_screen_keys:screens}});assert.equal(r.ok,true,JSON.stringify(r));await login(seller);return v;};
// Paid sale with a registered client: profile editing is not its aggregate update.
const sellToClient=async client=>{
 const req={inputs:[{key:'source',productId:product,talla:'M',qty:1}],applications:[],courtesy:false};
 const q=await asUser(()=>scalar('select pos.quote_sale($1::jsonb,$2::jsonb,false)',[JSON.stringify(req.inputs),'[]']));
 const p=await scalar('select to_jsonb(p) from pos.products p where id=$1',[product]);
 const s=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[seller]);
 const folio='H192-S-'+randomUUID(),op=randomUUID(),fecha=new Date().toISOString();
 const commissions=[{sellerId:seller,vendedor:'Synthetic',base:q.finalTotal,pct:0,monto:0,source:'default',policyVersion:1,tramos:[]}];
 const items=q.lines.flatMap(l=>l.parts.map((part,i)=>({folio,product_id:product,sku:p.sku,nombre:p.nombre,talla:'M',qty:part.qty,precio:part.unit,precio_base:l.res.unit,precio_original:l.res.orig,list_price:l.res.orig,effective_price:part.unit,promos:l.res.promos,descuento_adicional:part.additionalDiscount,line_id:randomUUID(),barcode_code:p.barcode_code,discount_snapshot:{promotions:l.res.promos,additional:part.additionalDiscount,financial:{version:2,key:l.key,part:i}}})));
 const result=await call({type:'sale',mode:'new',operationId:op,quoteContext:await scalar('select pos.online_quote_context()'),expectedProducts:[{id:product,version:p.sync_version}],
  header:{folio,operation_id:op,fecha,cliente_id:client.id,cliente:client.nombre,vendedores:[seller],items:1,comision:0,comision_base:'bruto',comisiones:commissions,subtotal:q.subtotal,iva:q.iva,total:q.finalTotal,iva_pct:16,iva_included:true,original_total:q.originalTotal,descuento:q.configuredDiscountTotal,descuento_adicional:q.additionalDiscountTotal,total_antes_descuento_adicional:q.beforeAdditionalTotal,descuentos_adicionales:q.applications,valor_regalado:q.valorRegalado,financial_version:2,financial_request:req,anticipo:q.finalTotal,saldo:0,pago_efectivo:q.finalTotal,pago_otro:0,metodo:'Efectivo',estado:'Pagado'},
  items,moves:[],payments:[{id:randomUUID(),folio,fecha,tipo:'venta',metodo:'__BALAM_MONEY_V1__'+JSON.stringify({nominalMethod:'Efectivo',components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:q.finalTotal}]}),monto:q.finalTotal,efectivo:q.finalTotal,tarjeta:0,transferencia:0,otro:0}],stockLines:[{product_id:product,talla:'M',qty:1}],reserveStock:true,
  clientEffect:{id:client.id,base_version:client.sync_version,compras_delta:1,total_delta:q.finalTotal,ultima:fecha.slice(0,10),after_compras:Number(client.compras)+1,after_total:Number(client.total)+q.finalTotal},
  sellerEffects:[{id:seller,base_version:s.sync_version,ventas_mes_delta:q.finalTotal,ventas_num_delta:1,comision_acum_delta:0,after_ventas_mes:Number(s.ventas_mes)+q.finalTotal,after_ventas_num:Number(s.ventas_num)+1,after_comision_acum:Number(s.comision_acum)}]});
 assert.equal(result.ok,true,JSON.stringify(result));
 const snapshot=await asUser(()=>scalar('select pos.online_snapshot()'));
 assert.ok(snapshot.sales.some(s=>s.folio===folio&&s.estado==='Pagado'));
 assert.equal(Number(await scalar('select sum(monto) from pos.sale_payments where folio=$1',[folio])),q.finalTotal);
 const after=await scalar('select to_jsonb(c) from pos.clients c where id=$1',[client.id]);
 assert.equal(Number(after.compras),Number(client.compras)+1);assert.equal(Number(after.total),Number(client.total)+q.finalTotal);
 assert.equal(after.nombre,client.nombre);assert.equal(after.tel,client.tel);
};
try{
 await run("begin;insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes) values(true,233,2,2,1,'{}') on conflict do nothing;insert into pos.screen_permission_catalog_state(singleton,catalog_version) values(true,1) on conflict do nothing;insert into pos.permission_roles(code,name,active) values('admin','Admin',true),('vendedor','Seller',true)");
 for(const k of screens)await db.query('insert into pos.screen_permission_catalog(screen_key,is_leaf,active,catalog_version) values($1,true,true,1)',[k]);
 for(const k of caps)await db.query('insert into pos.operational_capabilities(capability_key,description) values($1,$1)',[k]);
 await run("insert into pos.role_screen_permissions(role_code,screen_key,allowed) select 'admin',screen_key,true from pos.screen_permission_catalog;insert into pos.role_screen_permissions(role_code,screen_key,allowed) values('vendedor','pos',true);insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'admin',capability_key,true from pos.operational_capabilities;insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'vendedor',capability_key,true from pos.operational_capabilities where capability_key in('sales.create','sales.collect','sales.refund','sales.exchange','customers.create','customers.update')");
 for(const id of [admin,seller,inactive,orphan]){await db.query('insert into auth.users(id,email) values($1,$2)',[id,email(id)]);if(id!==orphan){await db.query('insert into pos.sellers(id,nombre,email,role,active) values($1,$2,$3,$4,$5)',[id,'Synthetic',email(id),id===admin?'admin':'vendedor',id!==inactive]);await db.query('insert into pos.user_permission_role_assignments(user_id,role_code) values($1,$2)',[id,id===admin?'admin':'vendedor']);}}
 await run('commit');
 await db.query("insert into pos.products(id,sku,cat,manga,tela,color,modelo,nombre,precio,costo,record_model,reference_family_id,size_category_id,size_code,size_scale,stock_quantity,barcode_code,barcode_contract,barcode_aliases,physical_signature) values($1::text,$2,'QA','QA','QA','QA','QA','Synthetic V2',100,50,'v2',$1::uuid,'qa-size','M','L',20,pos.h133_barcode_v3_from_id($1::text),3,'[]',$2)",[product,'H192-'+product]);
 await run(read('supabase/migrations/20261107022800_pos_h189_seller_v2_stock.sql'));await run('select pos.activate_online_only()');
 for(const f of ['20261113023000_pos_h190_seller_postsale.sql','20261114023200_pos_h191_account_role.sql'])await run(read('supabase/migrations/'+f),f);
 await login(seller);assert.equal(await cap('sales.refund'),true);assert.equal(await cap('inventory.loan.deliver'),false);await login(null);
 const adminBefore=await scalar("select jsonb_agg(to_jsonb(r) order by capability_key) from pos.role_capability_permissions r where role_code='admin'");
 for(const f of ['20261114023400_pos_h192_screen_operations.sql','20261114023500_pos_h192_screen_operations_verification.sql']){
  let sql=read('supabase/migrations/'+f);
  const guard=sql.match(/if \((md5\(jsonb_build_array\([\s\S]+?\)::text\))\) is distinct from '([0-9a-f]{32})' then raise exception 'H192_PREVIEW_STALE'/);
  if(guard)sql=sql.replace(guard[2],await scalar('select '+guard[1]));
  await run(sql,f);
 }
 await scalar('select pos.sync_user_screen_capabilities($1)',[seller]);
 await login(admin);await run("select set_config('request.headers','{\"x-balam-device-id\":\"h192-isolated\"}',false);select pos.online_presence('h192-isolated','h192-isolated')");
 await login(seller);assert.equal(await cap('sales.create'),true);assert.equal(await cap('sales.collect'),true);assert.equal(await cap('sales.refund'),false);
 assert.equal(await cap('customers.update'),false,'POS must not grant client profile editing');
 const clientId='cli-'+randomUUID();
 const created=await call({type:'upsert',kind:'clients',rows:[{id:clientId,nombre:'Synthetic customer',tel:'5550000',generic:false,sync_base_version:0}]});
 assert.equal(created.ok,true,JSON.stringify(created));
 const client=await scalar('select to_jsonb(c) from pos.clients c where id=$1',[clientId]);
 assert.equal((await call({type:'upsert',kind:'clients',rows:[{...client,nombre:'Unauthorized edit',sync_base_version:client.sync_version}]})).error.code,'42501');
 await sellToClient(client);
 await edit({clientes:'allow'});assert.equal(await cap('customers.update'),true);
 const current=await scalar('select to_jsonb(c) from pos.clients c where id=$1',[clientId]);
 assert.equal((await call({type:'upsert',kind:'clients',rows:[{...current,nombre:'Authorized edit',sync_base_version:current.sync_version}]})).ok,true);
 await edit({clientes:'deny'});assert.equal(await cap('customers.update'),false);assert.equal(await cap('customers.create'),true);
 let rejected=await call({type:'sale',mode:'payment'});assert.equal(rejected.error.code,'42501');
 // A malformed new sale crosses permission and is rejected by business preconditions.
 rejected=await call({type:'sale',mode:'new'});assert.notEqual(rejected.error.code,'42501');
 await edit({pos:'deny',apartados:'allow',prestamos:'allow',reportes:'allow','config.negocio':'allow','config.usuarios':'allow','config.permisos':'allow'});
 assert.equal(await cap('sales.create'),false);assert.equal(await cap('sales.collect'),true);assert.equal(await cap('inventory.loan.deliver'),true);
 for(const k of ['settings.manage','permissions.manage','sellers.manage'])assert.equal(await cap(k),false);
 assert.equal((await call({type:'sale',mode:'new'})).error.code,'42501');
 assert.notEqual((await call({type:'sale',mode:'payment'})).error.code,'42501');
 await assert.rejects(()=>asUser(()=>scalar('select pos.sync_user_screen_capabilities($1)',[seller])),{code:'42501'});
 assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(r) order by capability_key) from pos.role_capability_permissions r where role_code='admin'"),adminBefore);
 await login(admin);
 for(const effect of ['deny','allow']){
  const snap=await asUser(()=>scalar('select pos.admin_user_permission_snapshot($1,$2::text[])',[admin,screens]));
  const changed=await call({type:'permissions',rpc:'admin_apply_user_screen_permissions_checked',args:{p_target_user_id:admin,p_role_code:'admin',p_overrides:{pos:effect},p_expected_version:snap.permission_version,p_screen_keys:screens}});
  assert.equal(changed.ok,true,JSON.stringify(changed));assert.equal(await cap('sales.create'),effect==='allow');
  assert.equal(await cap('permissions.manage'),true);
  if(effect==='deny')assert.equal((await call({type:'sale',mode:'new'})).error.code,'42501');
 }
 await login(seller);
 pass('5: POS client creation and paid sale without profile editing; atomic screen revocation and admin boundary');
 const beforeStock=await scalar('select to_jsonb(p) from pos.products p where id=$1',[product]);
 const loan={id:randomUUID(),folio:'H192-P-001',estado:'pendiente',fecha:'2026-11-14 10:00',fechaEsperada:'2026-11-15',persona:'Synthetic',usuario:'Synthetic',lineas:[{key:product+'|M',lineId:randomUUID(),productId:product,sku:beforeStock.sku,nombre:'Synthetic V2',talla:'M',qty:2,devueltas:0,precio:100}],devoluciones:[]};
 const rid=randomUUID(),command={type:'loanOperation',action:'deliver',loan,expectedVersion:0};
 const delivered=await call(command,rid);assert.equal(delivered.ok,true,JSON.stringify(delivered));assert.deepEqual(await call(command,rid),delivered);
 let snapshot=await asUser(()=>scalar('select pos.online_snapshot()'));assert.ok(snapshot.loans.some(x=>x.id===loan.id));
 let version=await scalar('select version from pos.loan_documents where id=$1',[loan.id]);loan.lineas[0].devueltas=2;loan.estado='devuelto';loan.devoluciones=[{fecha:'2026-11-14 11:00',lineas:[{key:product+'|M',qty:2}]}];
 assert.equal((await call({type:'loanOperation',action:'return',loan,expectedVersion:version})).ok,true);
 assert.deepEqual(await scalar('select to_jsonb(p) from pos.products p where id=$1',[product]),beforeStock);
 await edit({prestamos:'deny'});assert.equal(await cap('inventory.loan.deliver'),false);assert.equal((await asUser(()=>scalar('select count(*) from pos.loan_documents'))),0);
 assert.equal((await call({...command,loan:{...loan,id:randomUUID(),folio:'H192-P-002',estado:'pendiente'}})).error.code,'42501');
 pass('6: seller loan delivery/return, snapshot, replay and revocation; stock unchanged');
 // Real RLS predicates on harmless temporary sentinels; no fake business docs.
 for(const table of ['returns','return_items','liquidations']){
  const qual=await scalar("select qual from pg_policies where schemaname='pos' and tablename=$1 and policyname='h192_report_read'",[table]);
  await run('create table pos.h192_probe_'+table+'(id int);insert into pos.h192_probe_'+table+' values(1);alter table pos.h192_probe_'+table+' enable row level security;grant select on pos.h192_probe_'+table+' to authenticated;create policy probe on pos.h192_probe_'+table+' for select to authenticated using('+qual+');');
  assert.equal(await asUser(()=>scalar('select count(*) from pos.h192_probe_'+table)),1);
 }
 assert.equal(await cap('sales.refund'),false);
 // Reports reads settlements; only the Sellers screen authorizes settlement writes.
 for(const k of ['commissions.settle','commissions.close_period'])assert.equal(await cap(k),false);
 for(const type of ['commissionSettle','commissionClose'])assert.equal((await call({type,sellerId:seller})).error.code,'42501');
 await edit({vendedores:'allow'});
 for(const k of ['commissions.settle','commissions.close_period'])assert.equal(await cap(k),true);
 await edit({vendedores:'deny'});
 for(const k of ['commissions.settle','commissions.close_period'])assert.equal(await cap(k),false);
 await edit({reportes:'deny'});assert.equal(await asUser(()=>scalar('select count(*) from pos.h192_probe_returns')),0);
 for(const id of [inactive,orphan]){await login(id);assert.equal(await cap('settings.manage'),false);assert.equal(await cap('inventory.loan.deliver'),false);assert.equal(await asUser(()=>scalar('select count(*) from pos.h192_probe_liquidations')),0);}
 await login(null);await assert.rejects(()=>asUser(()=>scalar('select count(*) from pos.loan_documents'),'anon'),{code:'42501'});assert.equal(await asUser(()=>scalar('select count(*) from pos.loan_documents'),'service_role'),1);
 pass('7: report read without refund or settlement writes; Sellers grants/revokes commissions; identity boundaries');
 await edit({inventario:'allow'});
 assert.equal(await cap('inventory.delete'),true);
 const inventoryBeforeClear=await scalar('select jsonb_agg(to_jsonb(p) order by id) from pos.products p');
 const clearTargets=await scalar('select jsonb_agg(jsonb_build_object(\'id\',id,\'baseVersion\',sync_version) order by id) from pos.products where deleted_at is null');
 const forbiddenClear=await call({type:'clearInventory',targets:clearTargets});
 assert.equal(forbiddenClear.ok,false,JSON.stringify(forbiddenClear));
 assert.equal(forbiddenClear.error.code,'42501',JSON.stringify(forbiddenClear));
 assert.equal(forbiddenClear.error.message,'ACTIVE_ADMIN_REQUIRED');
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(p) order by id) from pos.products p'),inventoryBeforeClear);
 const p=await scalar('select to_jsonb(p) from pos.products p where id=$1',[product]);p.precio=110;p.sync_base_version=p.sync_version;
 const saved=await call({type:'upsert',kind:'products',rows:[p]});assert.equal(saved.ok,true,JSON.stringify(saved));
 await assert.rejects(()=>asUser(()=>db.exec('update pos.products set precio=1')),{code:'42501'});
 await run('create temp table h192_guard as select * from pos.products;create trigger probe before update on h192_guard for each row execute function pos.restrict_seller_product_update();grant update,select on h192_guard to authenticated;');
 const temp=await scalar('select nspname from pg_namespace where oid=pg_my_temp_schema()');await run('grant usage on schema '+ident(temp)+' to authenticated');
 await assert.rejects(()=>asUser(()=>db.exec("select set_config('pos.online_request','"+randomUUID()+"',false);update h192_guard set precio=1")),{code:'42501'});
 await edit({inventario:'deny'});assert.equal(await cap('inventory.adjust'),false);
 const latest=await scalar('select to_jsonb(p) from pos.products p where id=$1',[product]);latest.precio=120;latest.sync_base_version=latest.sync_version;
 assert.equal((await call({type:'upsert',kind:'products',rows:[latest]})).error.code,'42501');
 pass('8: inventory gateway edit; seller with inventory.delete cannot clear inventory (42501), rows unchanged; direct/forged updates and revoked screen denied');
 fs.mkdirSync('docs/fixes/evidence/h192',{recursive:true});fs.writeFileSync('docs/fixes/evidence/h192/isolated.json',JSON.stringify({at:new Date().toISOString(),passed:cases.length,cases,network:false},null,2)+'\n');
}catch(e){console.error(e.message,e.cause?.message);process.exitCode=1;}finally{await db.close();}
