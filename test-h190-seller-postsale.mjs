// Six focused cases across --before and normal mode. PGlite only; no network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './test-fixtures/h189/sql-fixture.mjs';
const before=process.argv.includes('--before'), cases=[];
const migration='supabase/migrations/20261113023000_pos_h190_seller_postsale.sql';
const verification='supabase/migrations/20261113023100_pos_h190_seller_postsale_verification.sql';
const output='docs/fixes/evidence/h190/'+(before?'baseline':'isolated')+'.json';
const {db,run,lit,ident}=await fixture();
const actor=randomUUID(),admin=randomUUID(),inactive=randomUUID(),orphan=randomUUID();
const productId=randomUUID(),targetId=randomUUID(),device='h190-isolated';
const file=p=>fs.readFileSync(p,'utf8');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const email=id=>id+'@h190.invalid.test';
const login=async id=>run('reset role;select set_config(\'request.jwt.claim.sub\','+lit(id||'')+',false);select set_config(\'request.jwt.claims\','+lit(JSON.stringify(id?{sub:id,email:email(id),role:'authenticated'}:{role:'anon'}))+',false);');
const asUser=async(fn,role='authenticated')=>{await run('set role '+role);try{return await fn();}finally{await run('reset role');}};
const wire=p=>{if(!p)return p;const r={...p};if(p.components?.length)r.metodo='__BALAM_MONEY_V1__'+JSON.stringify({nominalMethod:p.metodo,components:p.components});delete r.components;return r;};
const call=async(command,id=randomUUID())=>{const c=structuredClone(command);if(c.payments)c.payments=c.payments.map(wire);if(c.payment)c.payment=wire(c.payment);if(c.type==='return')c.header=wire(c.header);return asUser(()=>scalar('select pos.execute_online_command($1::uuid,$2::jsonb)',[id,JSON.stringify(c)]));};
const snapshot=()=>asUser(()=>scalar('select pos.online_snapshot()'));
const fingerprint=async()=>{
 const tables=(await db.query("select tablename from pg_tables where schemaname='pos' order by tablename")).rows;
 return Object.fromEntries(await Promise.all(tables.map(async t=>[t.tablename,await scalar("select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from pos."+ident(t.tablename)+' t')])));
};
const economic=async()=>{const f=await fingerprint();delete f.online_requests;delete f.online_snapshot_revision;return f;};
const metadata=async()=>({
 functions:(await db.query("select p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pos' and p.prokind='f' order by 1")).rows,
 tables:(await db.query("select c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and c.relkind='r' order by 1")).rows,
 policies:(await db.query("select * from pg_policies where schemaname='pos' order by tablename,policyname")).rows,
 triggers:(await db.query("select tgrelid::regclass::text relation,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by 1,2")).rows,
});
const pass=(id,name)=>{cases.push({id,name,status:'PASS'});console.log('PASS '+id+': '+name);};
const deny=async fn=>{let e;try{await fn();}catch(x){e=x;}assert.equal(e?.code,'42501',e?.message||'expected 42501');};
const makeSale=async()=>{
 const req={inputs:[{key:'source',productId,talla:'M',qty:4}],applications:[],courtesy:false};
 const q=await scalar('select pos.quote_sale($1::jsonb,$2::jsonb,false)',[JSON.stringify(req.inputs),'[]']);
 const p=await scalar('select to_jsonb(p) from pos.products p where id=$1',[productId]);
 const s=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[actor]);
 const folio='H190-'+randomUUID(),op=randomUUID(),amount=Number((q.finalTotal*.05).toFixed(2));
 const commissions=[{sellerId:actor,vendedor:'Synthetic seller',base:q.finalTotal,pct:5,monto:amount,source:'override',policyVersion:1,tramos:[]}];
 const items=q.lines.flatMap(l=>l.parts.map((part,i)=>({folio,product_id:productId,sku:p.sku,nombre:p.nombre,talla:'M',qty:part.qty,precio:part.unit,precio_base:l.res.unit,precio_original:l.res.orig,list_price:l.res.orig,effective_price:part.unit,promos:l.res.promos,descuento_adicional:part.additionalDiscount,line_id:randomUUID(),barcode_code:p.barcode_code,discount_snapshot:{promotions:l.res.promos,additional:part.additionalDiscount,financial:{version:2,key:l.key,part:i}}})));
 return {expectedActorId:actor,type:'sale',mode:'new',operationId:op,quoteContext:await scalar('select pos.online_quote_context()'),expectedProducts:[{id:productId,version:p.sync_version}],
 header:{folio,operation_id:op,fecha:new Date().toISOString(),cliente_id:null,cliente:'Synthetic',vendedores:[actor],items:4,comision:amount,comision_base:'bruto',comisiones:commissions,subtotal:q.subtotal,iva:q.iva,total:q.finalTotal,iva_pct:16,iva_included:true,original_total:q.originalTotal,descuento:q.configuredDiscountTotal,descuento_adicional:q.additionalDiscountTotal,total_antes_descuento_adicional:q.beforeAdditionalTotal,descuentos_adicionales:q.applications,valor_regalado:q.valorRegalado,financial_version:2,financial_request:req,anticipo:q.finalTotal,saldo:0,pago_efectivo:q.finalTotal,pago_otro:0,metodo:'Efectivo',estado:'Pagado'},
 items,moves:[],payments:[{id:randomUUID(),folio,fecha:new Date().toISOString(),tipo:'venta',metodo:'Efectivo',monto:q.finalTotal,efectivo:q.finalTotal,tarjeta:0,transferencia:0,otro:0,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:q.finalTotal}]}],stockLines:[{product_id:productId,talla:'M',qty:4}],reserveStock:true,clientEffect:null,
 sellerEffects:[{id:actor,base_version:s.sync_version,ventas_mes_delta:q.finalTotal,ventas_num_delta:1,comision_acum_delta:amount,after_ventas_mes:Number(s.ventas_mes)+q.finalTotal,after_ventas_num:Number(s.ventas_num)+1,after_comision_acum:Number(s.comision_acum)+amount}]};
};
const makeReturn=async(sale,qty=1)=>{
 const sold=sale.items[0],id=randomUUID(),total=Number(sold.precio)*qty,amount=total*.05;
 const s=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[actor]);
 return {expectedActorId:actor,type:'return',legacy:false,header:{id,folio:sale.header.folio,fecha:new Date().toISOString(),cliente:'Synthetic',vendedores:[actor],comisiones:[{...sale.header.comisiones[0],base:total,monto:amount}],metodo:'Efectivo',total,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:total}]},
 items:[{...sold,return_id:id,qty,line_id:randomUUID(),source_sale_line_id:sold.line_id,motivo:'H190'}],moves:[],stockLines:[{product_id:productId,talla:'M',qty}],clientEffect:null,
 sellerEffects:[{id:actor,base_version:s.sync_version,ventas_mes_delta:-total,comision_acum_delta:-amount,after_ventas_mes:Number(s.ventas_mes)-total,after_comision_acum:Number(s.comision_acum)-amount}]};
};
const makeExchange=async sale=>{
 const p=await scalar('select to_jsonb(p) from pos.products p where id=$1',[targetId]);
 const id=randomUUID(),folio='H190-X-'+randomUUID(),sold=sale.items[0],difference=Number(p.precio)-Number(sold.precio);
 return {expectedActorId:actor,type:'exchange',quoteContext:await scalar('select pos.online_quote_context()'),expectedProducts:[{id:targetId,version:p.sync_version}],
 header:{id,folio,origen_folio:sale.header.folio,fecha:new Date().toISOString(),usuario:'Synthetic',vendedor_id:actor,comision_monto:0,valor_reconocido:Number(sold.precio),valor_entregado:Number(p.precio),diferencia:difference},
 items:[{...sold,qty:1,lado:'devuelto',line_id:randomUUID(),source_sale_line_id:sold.line_id,motivo:'Talla',condicion:'Sin uso'},
 {lado:'entregado',product_id:targetId,sku:p.sku,nombre:p.nombre,talla:'M',qty:1,precio:Number(p.precio),line_id:randomUUID(),barcode_code:p.barcode_code}],moves:[],seller_effects:[],
 payment:{id:randomUUID(),folio,fecha:new Date().toISOString(),tipo:'cambio',metodo:'Efectivo',monto:difference,efectivo:difference,tarjeta:0,transferencia:0,otro:0,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:difference}]}};
};
try{
 await run("set timezone='UTC';begin;update pos.online_runtime set enabled=false,min_financial_version=2 where singleton;");
 for(const id of [admin,actor,inactive,orphan])await db.query('insert into auth.users(id,email) values($1,$2)',[id,email(id)]);
 await run("insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes) values(true,229,2,2,1,'{}') on conflict do nothing;insert into pos.screen_permission_catalog_state(singleton,catalog_version) values(true,1) on conflict do nothing;insert into pos.permission_roles(code,name,active) values('admin','Admin',true),('vendedor','Seller',true);");
 for(const cap of ['sales.create','sales.collect','sales.refund','sales.exchange','customers.create','customers.update','settings.manage','permissions.manage'])await db.query('insert into pos.operational_capabilities(capability_key,description) values($1,$1)',[cap]);
 await run("insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'admin',capability_key,true from pos.operational_capabilities;insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'vendedor',capability_key,true from pos.operational_capabilities where capability_key not in('settings.manage','permissions.manage');");
 for(const key of ['pos','config.usuarios','config.permisos'])await db.query('insert into pos.screen_permission_catalog(screen_key,is_leaf,active,catalog_version) values($1,true,true,1)',[key]);
 await run("insert into pos.role_screen_permissions(role_code,screen_key,allowed) select 'admin',screen_key,true from pos.screen_permission_catalog;insert into pos.role_screen_permissions values('vendedor','pos',true,now(),null);");
 for(const id of [admin,actor,inactive]){await db.query('insert into pos.sellers(id,nombre,email,role,active) values($1,$2,$3,$4,$5)',[id,'Synthetic',email(id),id===admin?'admin':'vendedor',id!==inactive]);await db.query('insert into pos.user_permission_role_assignments(user_id,role_code,active) values($1,$2,true)',[id,id===admin?'admin':'vendedor']);}
 await run('commit;');
 for(const [id,price] of [[productId,100],[targetId,150]])await db.query("insert into pos.products(id,sku,cat,manga,tela,color,modelo,nombre,precio,costo,record_model,reference_family_id,size_category_id,size_code,size_scale,stock_quantity,barcode_code,barcode_contract,barcode_aliases,physical_signature) values($1::text,$2,'QA','QA','QA','QA','QA','Synthetic V2',$3,50,'v2',$1::uuid,'qa-size','M','L',20,pos.h133_barcode_v3_from_id($1::text),3,'[]',$2)",[id,'H190-'+id,price]);
 await run(file('supabase/migrations/20261107022800_pos_h189_seller_v2_stock.sql'));
 await run('select pos.activate_online_only();');await login(admin);
 await run("select set_config('request.headers',"+lit(JSON.stringify({'x-balam-device-id':device,'x-balam-client-build':'h190-isolated'}))+",false);select pos.online_presence("+lit(device)+",'h190-isolated')");
 await login(actor);
 if(!before){
  const data=await fingerprint(),meta=await metadata();
  await run(file(migration));await run(file(verification));
  assert.deepEqual(await fingerprint(),data,'migration changes no POS row');
  const after=await metadata(),guard='pos.restrict_seller_product_update()';
  assert.deepEqual(after.functions.filter(f=>f.identity!==guard),meta.functions.filter(f=>f.identity!==guard));
  const attrs=f=>{const x={...f};delete x.definition;return x;};
  assert.deepEqual(attrs(after.functions.find(f=>f.identity===guard)),attrs(meta.functions.find(f=>f.identity===guard)));
  assert.deepEqual(after.tables,meta.tables);assert.deepEqual(after.triggers,meta.triggers);
  assert.deepEqual(after.policies.filter(p=>!p.policyname.startsWith('h190_')),meta.policies);
  assert.equal(after.policies.filter(p=>p.policyname.startsWith('h190_')).length,2);
  pass(2,'migration and verification preserve all POS rows, other functions, ACL, RLS and triggers');
 }
 const sale=await makeSale(),saleResult=await call(sale);assert.equal(saleResult.ok,true,JSON.stringify(saleResult));
 const original=await scalar('select to_jsonb(s) from pos.sales s where folio=$1',[sale.header.folio]);
 const ret=await makeReturn(sale);
 if(before){
  const data=await economic(),result=await call(ret);assert.equal(result.ok,false);assert.equal(result.error.code,'42501');assert.match(result.error.message,/actualizar existencias/);assert.deepEqual(await economic(),data);
  const exchange=await makeExchange(sale),ex=await call(exchange);assert.equal(ex.ok,false);assert.equal(ex.error.code,'42501');assert.deepEqual(await economic(),data);
  await login(admin);ret.expectedActorId=admin;assert.equal((await call(ret)).ok,true);
  await login(actor);const snap=await snapshot();assert.equal(snap.returns.length,0);assert.equal(snap.returnItems.length,0);
  pass(1,'baseline: seller return/exchange rejected without business effects; admin return invisible to seller');
 }else{
  assert.equal((await call(ret)).ok,true);let snap=await snapshot();
  assert.ok(snap.returns.some(r=>r.id===ret.header.id));assert.ok(snap.returnItems.some(r=>r.return_id===ret.header.id));
  assert.equal(snap.products.find(p=>p.id===productId).stock_quantity,17);
  assert.equal(snap.sales.find(s=>s.folio===sale.header.folio).estado,'Devolución parcial');
  assert.equal(Number(await scalar('select comision_acum from pos.sellers where id=$1',[actor])),15);
  pass(3,'seller sale and first partial return: stock, refund, commission and readable document');
  const second=await makeReturn(sale),request=randomUUID(),response=await call(second,request);assert.equal(response.ok,true);
  const once=await fingerprint();assert.deepEqual(await call(second,request),response);assert.deepEqual(await fingerprint(),once);
  snap=await snapshot();assert.equal(snap.returns.length,2);assert.equal(snap.returnItems.length,2);assert.equal(snap.products.find(p=>p.id===productId).stock_quantity,18);
  assert.equal(Number(await scalar('select sum(total) from pos.returns where folio=$1',[sale.header.folio])),200);
  assert.equal(Number(await scalar('select comision_acum from pos.sellers where id=$1',[actor])),10);
  const stable=await economic(),tooMany=await call(await makeReturn(sale,3));assert.equal(tooMany.ok,false);assert.deepEqual(await economic(),stable);
  pass(4,'second partial return remains readable; replay has no effects and excessive quantity is rejected');
  const exchange=await makeExchange(sale),xid=randomUUID(),xresult=await call(exchange,xid);assert.equal(xresult.ok,true,JSON.stringify(xresult));
  snap=await snapshot();assert.ok(snap.exchanges.some(x=>x.id===exchange.header.id));assert.equal(snap.products.find(p=>p.id===productId).stock_quantity,19);assert.equal(snap.products.find(p=>p.id===targetId).stock_quantity,19);
  assert.equal(Number(await scalar('select sum(monto) from pos.sale_payments where folio=$1',[exchange.header.folio])),50);
  const current=await scalar('select to_jsonb(s) from pos.sales s where folio=$1',[sale.header.folio]);
  for(const key of ['total','subtotal','iva','comision','comisiones','vendedores','financial_request','receipt_snapshot'])assert.deepEqual(current[key],original[key],key);
  const xonce=await fingerprint();assert.deepEqual(await call(exchange,xid),xresult);assert.deepEqual(await fingerprint(),xonce);
  pass(5,'exchange restores source, deducts target, collects exact difference and preserves original finances');
  await deny(()=>asUser(()=>db.exec('update pos.products set stock_quantity=1 where id='+lit(productId))));
  await run('create temp table h190_probe as select * from pos.products where id='+lit(productId)+';create trigger h190_probe_guard before update on h190_probe for each row execute function pos.restrict_seller_product_update();grant select,update on h190_probe to authenticated;');
  const temp=await scalar('select nspname from pg_namespace where oid=pg_my_temp_schema()');await run('grant usage on schema '+ident(temp)+' to authenticated;');
  for(const kind of ['return','exchange'])await deny(()=>asUser(()=>db.exec("select set_config('pos.online_request',"+lit(randomUUID())+",false);update h190_probe set stock_quantity=stock_quantity+1,stock=jsonb_set(stock,'{0,stock}',to_jsonb(stock_quantity+1)),sync_device_id="+lit(kind+':forged'))));
  await run("select set_config('pos.online_request','',false)");
  await deny(()=>asUser(()=>db.exec('update h190_probe set precio=1')));
  for(const who of [inactive,orphan]){await login(who);assert.equal(await asUser(()=>scalar('select count(*) from pos.returns')),0);await deny(()=>call({...ret,expectedActorId:who}));}
  await login(null);await deny(()=>asUser(()=>scalar('select count(*) from pos.returns'),'anon'));
  await login(admin);assert.equal((await snapshot()).returns.length,2);
  await login(null);assert.equal(await asUser(()=>scalar('select count(*) from pos.returns'),'service_role'),2);
  pass(6,'direct and forged writes denied; inactive/orphan/anon denied; admin and service reads preserved');
 }
 fs.mkdirSync('docs/fixes/evidence/h190',{recursive:true});
 const sources=['test-h190-seller-postsale.mjs','test-fixtures/h189/sql-fixture.mjs',...(before?[]:[migration,verification])];
 fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),network:false,cases,passed:cases.length,sourceHashes:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))},null,2)+'\n');
}catch(e){console.error(JSON.stringify({passed:cases,error:e.message,cause:e.cause?.message,where:e.cause?.where,stack:e.stack}));process.exitCode=1;}
finally{await db.close();}
