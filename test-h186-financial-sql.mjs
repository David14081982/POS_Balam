// H186: isolated PostgreSQL, catalog definitions only, no network or production rows.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const catalog=JSON.parse(fs.readFileSync('test-fixtures/h164/sql-authority-baseline.json','utf8')).catalog;
const db=new PGlite({extensions:{pgcrypto}});
const ident=x=>'"'+String(x).replaceAll('"','""')+'"';
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
let passed=0;
const check=(value,message)=>{assert.ok(value,message);passed++;};
const run=async(sql,label)=>{try{return await db.exec(sql);}catch(e){throw new Error((label||'SQL')+': '+e.message,{cause:e});}};
try {
 await run(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema pos;create schema extensions;
 create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz,last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant execute on all functions in schema auth to public;set check_function_bodies=off;`,'bootstrap');
 for(const s of catalog.schemas){
  await run(`revoke all on schema ${ident(s.name)} from public,anon,authenticated,service_role;`);
  for(const item of (s.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['U','usage'],['C','create']].filter(([c])=>acl.includes(c)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on schema ${ident(s.name)} to ${role?ident(role):'public'};`);
  }
 }
 const identities=new Set(catalog.columns.filter(c=>c.is_identity==='YES').map(c=>c.table_name+'_'+c.column_name+'_seq'));
 for(const s of catalog.sequences)if(!identities.has(s.sequencename))await run(`create sequence pos.${ident(s.sequencename)};`);
 for(const t of catalog.tables){
  const cols=catalog.columns.filter(c=>c.table_name===t.name).sort((a,b)=>a.ordinal_position-b.ordinal_position).map(c=>
   `${ident(c.column_name)} ${c.data_type==='ARRAY'?ident(c.udt_name.slice(1))+'[]':ident(c.udt_name)}${c.is_identity==='YES'?' generated '+c.identity_generation+' as identity':c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`);
  await run(`create table pos.${ident(t.name)}(${cols.join(',')});`,t.name);
 }
 for(const f of catalog.functions)await run(f.definition+';',f.name);
 for(const v of catalog.views)await run(`create view pos.${ident(v.name)}${v.options?.includes('security_invoker=true')?' with(security_invoker=true)':''} as ${v.definition};`,v.name);
 for(const c of [...catalog.constraints].sort((a,b)=>Number(a.definition.startsWith('FOREIGN'))-Number(b.definition.startsWith('FOREIGN'))))
  if(!c.definition.startsWith('TRIGGER'))await run(`alter table ${c.table} add constraint ${ident(c.name)} ${c.definition};`,c.name);
 const cn=new Set(catalog.constraints.map(c=>c.name));
 for(const ix of catalog.indexes){const n=ix.match(/^CREATE (?:UNIQUE )?INDEX (\S+)/)?.[1]?.replaceAll('"','');if(!cn.has(n))await run(ix+';',n);}
 for(const t of catalog.triggers)await run(t+';','trigger');
 for(const t of catalog.tables){
  if(t.rls)await run(`alter table pos.${ident(t.name)} enable row level security;`);
  for(const item of (t.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['r','select'],['a','insert'],['w','update'],['d','delete'],['D','truncate'],['x','references'],['t','trigger']].filter(([c])=>acl.includes(c)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on pos.${ident(t.name)} to ${role?ident(role):'public'};`);
  }
 }
 for(const p of catalog.policies)await run(`create policy ${ident(p.policyname)} on pos.${ident(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(ident).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''};`);
 for(const f of catalog.functions){
  await run(`revoke all on function ${f.identity} from public,anon,authenticated;`);
  if(f.acl===null||/(?:\{|,)=X\//.test(f.acl||''))await run(`grant execute on function ${f.identity} to public;`);
  for(const role of ['anon','authenticated','service_role'])if((f.acl||'').includes(role+'=X/'))await run(`grant execute on function ${f.identity} to ${role};`);
 }
 await run('grant usage on all sequences in schema pos to authenticated,service_role;set check_function_bodies=on;');
 for(const file of ['20260911020800_pos_h164_online_authority.sql','20260912021000_pos_h164_legacy_exact_discard.sql','20260912021200_pos_h164_optional_json_null.sql'])
  await run(fs.readFileSync('supabase/migrations/'+file,'utf8'),file);
 const migration='supabase/migrations/20261010022500_pos_h186_financial_authority.sql';
 if(fs.existsSync(migration))await run(fs.readFileSync(migration,'utf8'),'H186 migration');
 // Supabase's migration session is not the postgres bypass used by an empty
 // PGlite bootstrap. Exercise installation with the actual online fence active.
 await run('update pos.online_runtime set enabled=true where singleton;create role h186_migration_session superuser login;set session authorization h186_migration_session;');
 const installationContext=(await db.query("select (select enabled from pos.online_runtime where singleton) enabled,auth.uid() is null auth_absent,pos.online_request_context() command_context,session_user not in('postgres','service_role','supabase_admin') non_bypass")).rows[0];
 assert.deepEqual(installationContext,{enabled:true,auth_absent:true,command_context:false,non_bypass:true});
 check(true,'227 installs with online runtime enabled and no Auth or online-command bypass');
 const installationState=async()=>{
  const tables=(await db.query("select tablename from pg_tables where schemaname='pos' order by tablename")).rows;
  const sequences=(await db.query("select sequencename from pg_sequences where schemaname='pos' order by sequencename")).rows;
  return {tables:await Promise.all(tables.map(async t=>[t.tablename,(await db.query("select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos."+ident(t.tablename)+' t')).rows[0].hash])),
   sequences:await Promise.all(sequences.map(async s=>[s.sequencename,(await db.query('select last_value,is_called from pos.'+ident(s.sequencename))).rows[0]]))};
 };
 const beforeInstallation=await installationState();
 await run(fs.readFileSync('supabase/migrations/20261011022700_pos_h186_commission_snapshot.sql','utf8'),'H186 commission snapshot');
 assert.deepEqual(await installationState(),beforeInstallation);
 check(true,'227 pure verification preserves all POS rows and sequence states');
 let directWriteFailure;
 try{await db.exec("insert into pos.sales(folio,operation_id,metodo,estado,total) values('h186-denied-migration-seed','h186-denied-migration-seed','Apartado','Apartado',25)");}
 catch(error){directWriteFailure={code:error.code,message:error.message};}
 assert.deepEqual(directWriteFailure,{code:'42501',message:'ONLINE_COMMAND_REQUIRED'});
 assert.deepEqual(await installationState(),beforeInstallation);
 check(true,'227 leaves the active online write fence intact for a migration session');
 // PGlite retains its changed session authorization across RESET; explicitly
 // restore the fixture owner before the existing authenticated-flow cases.
 await run('set session authorization postgres;');
 assert.equal((await db.query('select session_user')).rows[0].session_user,'postgres');
 check((await db.query("select to_regprocedure('pos.quote_sale(jsonb,jsonb,boolean)') is not null as present")).rows[0].present,'server financial authority must exist');
 check((await db.query('select min_financial_version from pos.online_runtime where singleton')).rows[0].min_financial_version===1,'expansion preserves published client until explicit activation');
 const actor=randomUUID(),productId=randomUUID(),clientId=randomUUID(),device='qa-h186-device';
 await run(`update pos.online_runtime set enabled=false,min_financial_version=2 where singleton;
 insert into auth.users(id,email) values(${lit(actor)},'h186@invalid.test');
 insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes) values(true,207,2,2,1,'{}') on conflict(singleton) do nothing;
 insert into pos.sellers(id,nombre,email,role,active) values(${lit(actor)},'H186','h186@invalid.test','admin',true);
 insert into pos.permission_roles(code,name,active) values('h186','H186',true);
 insert into pos.user_permission_role_assignments(user_id,role_code,active) values(${lit(actor)},'h186',true);
 insert into pos.operational_capabilities(capability_key,description) select x,x from unnest(array['sales.create','sales.collect','sales.refund','sales.exchange','permissions.manage']) x on conflict do nothing;
 insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'h186',x,true from unnest(array['sales.create','sales.collect','sales.refund','sales.exchange','permissions.manage']) x;
 insert into pos.screen_permission_catalog(screen_key,parent_key,is_leaf,active,catalog_version) values('config.usuarios',null,true,true,1),('config.permisos',null,true,true,1) on conflict do nothing;
 insert into pos.role_screen_permissions(role_code,screen_key,allowed) values('h186','config.usuarios',true),('h186','config.permisos',true);
 insert into pos.clients(id,nombre,generic) values(${lit(clientId)},'H186 registered',false);
 insert into pos.products(id,sku,cat,manga,tela,color,modelo,nombre,precio,costo,record_model,reference_family_id,size_category_id,size_code,size_scale,stock_quantity,barcode_code,barcode_contract,barcode_aliases,physical_signature)
 values(${lit(productId)},'H186-JOEL','QA','QA','QA','QA','QA','H186 JOEL',1250,563,'v2',${lit(productId)},'h186-size','M','L',60,pos.h133_barcode_v3_from_id(${lit(productId)}),3,'[]','h186-physical');
 insert into pos.promotions(id,nombre,tipo,valor,scope) values('h186-promo','Aniversario','pct',30,'{}');
 insert into pos.lookup(kind,code,label,meta) values('additional_benefit','MANUAL_AMOUNT','Manual',
 '{"origin":"Promoción especial","benefitType":"fixed","scope":"ticket","value":0,"allowsCustomValue":true,"requiresReason":true,"combinable":false}');
 update pos.online_runtime set enabled=true where singleton;
 select set_config('request.jwt.claim.sub',${lit(actor)},false);
 select set_config('request.jwt.claims',${lit(JSON.stringify({sub:actor,email:'h186@invalid.test',role:'authenticated'}))},false);
 select set_config('request.headers',${lit(JSON.stringify({'x-balam-device-id':device,'x-balam-client-build':'h186-test'}))},false);
 select pos.online_presence(${lit(device)},'h186-test');`,'H186 fixtures');
 const owner=async(sql)=>run('reset role;'+sql);
 const edit=async(sql)=>owner('update pos.online_runtime set enabled=false where singleton;'+sql+';update pos.online_runtime set enabled=true where singleton;');
 const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
 const inputs=(qty=1)=>[{key:'joel',productId,talla:'M',qty}];
 const app=(value=1)=>({benefitCode:'MANUAL_AMOUNT',benefitName:'Manual',origin:'Promoción especial',benefitType:'fixed',scope:'ticket',value,combinable:false,reason:'H186 synthetic'});
 const quote=async(ins=inputs(),apps=[],courtesy=false)=>scalar('select pos.quote_sale($1::jsonb,$2::jsonb,$3) q',[JSON.stringify(ins),JSON.stringify(apps),courtesy]);
 const wire=p=>{if(!p)return p;const row={...p};if(p.components?.length)row.metodo='__BALAM_MONEY_V1__'+JSON.stringify({nominalMethod:p.metodo,components:p.components});delete row.components;return row;};
 const call=async(command,id=randomUUID())=>{
  command=structuredClone(command);
  if(command.payments)command.payments=command.payments.map(wire);
  if(command.payment)command.payment=wire(command.payment);
  if(command.type==='return')command.header=wire(command.header);
  await run('set role authenticated;');
  try{return await scalar('select pos.execute_online_command($1::uuid,$2::jsonb)',[id,JSON.stringify(command)]);}
  finally {await run('reset role;');}
 };
 const rejected=async(fn,pattern,message)=>{let error,result;try{result=await fn();}catch(e){error=e;}const evidence=error?.message||JSON.stringify(result);check((error||result?.ok===false)&&new RegExp(pattern).test(evidence),message+': '+evidence);};
 const tableFingerprints=async()=>{
  const tables=(await db.query("select tablename from pg_tables where schemaname='pos' order by tablename")).rows;
  return Object.fromEntries(await Promise.all(tables.map(async t=>[t.tablename,await scalar("select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from pos."+ident(t.tablename)+' t')])));
 };
 const beforeReadOnly=await tableFingerprints();
 const oldDeviceGuard=await scalar("select pg_get_functiondef('pos.assert_online_device()'::regprocedure)");
 const oldQuote=(await db.query("select prosrc,proacl::text,proconfig,prosecdef,provolatile,proowner from pg_proc where oid='pos.quote_sale(jsonb,jsonb,boolean)'::regprocedure")).rows[0];
 await run('set role authenticated;begin read only;');
 let readonlyFailure;
 try{await quote();}catch(error){readonlyFailure=error;}
 finally{await run('rollback;reset role;');}
 check(readonlyFailure?.code==='25006'&&/SELECT FOR SHARE/.test(readonlyFailure.message),'225 reproduces the real PostgREST READ ONLY failure with authorized actor/device');
 const readOnlyMigration='supabase/migrations/20261011022600_pos_h186_quote_readonly_device.sql';
 await run(fs.readFileSync(readOnlyMigration,'utf8'),'H186 readonly quote migration');
 const newQuote=(await db.query("select prosrc,proacl::text,proconfig,prosecdef,provolatile,proowner from pg_proc where oid='pos.quote_sale(jsonb,jsonb,boolean)'::regprocedure")).rows[0];
 assert.deepEqual(newQuote,{...oldQuote,prosrc:oldQuote.prosrc.replace('perform pos.assert_online_device();','perform pos.h186_assert_quote_device();')});
 check(true,'226 changes only the admission call and preserves quote STABLE, owner, search path and ACL');
 check(await scalar("select pg_get_functiondef('pos.assert_online_device()'::regprocedure)")===oldDeviceGuard,'write admission retains its exact FOR SHARE definition');
 assert.deepEqual(await tableFingerprints(),beforeReadOnly);
 check(true,'226 and its self-contained verification mutate no POS data');
 await run('set role authenticated;begin read only;');
 const readonlyScope=(await db.query("select current_user role,current_setting('transaction_read_only') read_only,auth.uid()=$1::uuid actor_matches,pos.current_has_capability('sales.create') capable",[actor])).rows[0];
 assert.deepEqual(readonlyScope,{role:'authenticated',read_only:'on',actor_matches:true,capable:true});
 const readonlyQuote=await quote();
 await run('commit;reset role;');
 check(readonlyQuote.finalTotal===875&&readonlyQuote.subtotal===754.31&&readonlyQuote.iva===120.69,'226 serves authoritative JOEL quote through an authenticated READ ONLY transaction');
 assert.deepEqual(await tableFingerprints(),beforeReadOnly);
 check(true,'successful READ ONLY quotation changes no commercial, device, request or stock row');
 const guardCases=[
  {name:'active registered device',setup:'',expected:{value:device}},
  {name:'missing device header',setup:"select set_config('request.headers','{}',true);",expected:{code:'22023',error:'DEVICE_ID_REQUIRED'}},
  {name:'unregistered device',setup:`select set_config('request.headers',${lit(JSON.stringify({'x-balam-device-id':'h186-unregistered'}))},true);`,expected:{code:'22023',error:'DEVICE_REGISTRATION_REQUIRED'}},
  {name:'revoked device',setup:`update pos.sync_devices set status='revoked' where device_id=${lit(device)};`,expected:{code:'42501',error:'DEVICE_RETIRED'}},
  {name:'missing identity',setup:"select set_config('request.jwt.claim.sub','',true);",expected:{code:'42501',error:'ACTIVE_PROFILE_REQUIRED'}},
  {name:'unknown identity',setup:`select set_config('request.jwt.claim.sub',${lit(randomUUID())},true);select set_config('request.jwt.claims','{"email":"h186-unknown@invalid.test","role":"authenticated"}',true);`,expected:{code:'42501',error:'ACTIVE_PROFILE_REQUIRED'}},
  {name:'inactive profile',setup:`update pos.online_runtime set enabled=false where singleton;update pos.sellers set active=false,sync_base_version=sync_version,sync_device_id='h186-test' where id=${lit(actor)};update pos.online_runtime set enabled=true where singleton;`,expected:{code:'42501',error:'ACTIVE_PROFILE_REQUIRED'}},
 ];
 for(const fixture of guardCases){
  await run('begin;'+fixture.setup);
  try{
   const outcomes=[];
   for(const name of ['assert_online_device','h186_assert_quote_device']){
    await run('savepoint device_guard;');
    try{outcomes.push({value:await scalar('select pos.'+name+'()')});}
    catch(error){outcomes.push({code:error.code,error:error.message});}
    finally{await run('rollback to savepoint device_guard;release savepoint device_guard;');}
   }
   assert.deepEqual(outcomes,[fixture.expected,fixture.expected],fixture.name);
   check(true,'read and write device guards have identical admission: '+fixture.name);
  }finally{await run('rollback;');}
 }
 await run('begin read only;');
 let writeGuardFailure;
 try{await scalar('select pos.assert_online_device()');}catch(error){writeGuardFailure=error;}
 finally{await run('rollback;');}
 check(writeGuardFailure?.code==='25006'&&/SELECT FOR SHARE/.test(writeGuardFailure.message),'write admission still requires its original row lock');
 for(const role of ['anon','authenticated','service_role'])check(!await scalar('select has_function_privilege($1,$2,$3)',[role,'pos.h186_assert_quote_device()','execute']),'quote admission helper remains private to '+role);
 await run('set role authenticated;begin read only;');
 await rejected(()=>quote([{key:'missing',productId:randomUUID(),talla:'M',qty:1}]),'FINANCIAL_PRODUCT_NOT_FOUND','READ ONLY quote retains authoritative product validation');
 await run('rollback;reset role;');
 const metadata=(await db.query(`select p.proname,p.pronargs,p.oid::regprocedure::text identity,
  md5(btrim(replace(p.prosrc,E'\\r\\n',E'\\n'),E' \\t\\r\\n')) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,p.proconfig,p.prosecdef,p.provolatile::text,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute,
  has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') service_role_execute
  from pg_proc p where p.oid in('pos.quote_sale(jsonb,jsonb,boolean)'::regprocedure,'pos.h186_assert_quote_device()'::regprocedure,'pos.assert_online_device()'::regprocedure) order by p.proname`)).rows;
 fs.mkdirSync('.evidence-h186-deploy',{recursive:true});
 fs.writeFileSync('.evidence-h186-deploy/after226-function-metadata.json',JSON.stringify({functions:metadata,migration:readOnlyMigration,
  migrationSha256:createHash('sha256').update(fs.readFileSync(readOnlyMigration)).digest('hex'),readOnlyQuote:true,deviceGuardUnchanged:true,network:false},null,2)+'\n');
 const q30=await quote();check(q30.finalTotal===875&&q30.subtotal===754.31&&q30.iva===120.69,'JOEL 30%, IVA included exact');
 for(const [percent,total] of [[50,625],[60,500],[100,0]]){
  await edit(`update pos.promotions set valor=${percent},sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'`);
  const q=await quote();check(q.finalTotal===total,'JOEL '+percent+'% exact despite cost563');
 }
 await edit("update pos.promotions set valor=30,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 const split=await quote(inputs(3),[app()]);
 check(split.finalTotal===2624&&split.lines[0].parts.length===2&&split.lines[0].parts[0].qty===2&&split.lines[0].parts[0].unit===874.67&&split.lines[0].parts[1].unit===874.66,'qty3 monetary remainder assigned exactly');
 const makeSale=async({qty=1,apps=[],courtesy=false,layaway=false}={})=>{
  const req={inputs:inputs(qty),applications:apps,courtesy},q=await quote(req.inputs,apps,courtesy),folio='H186-'+randomUUID(),operationId=randomUUID();
  const product=await scalar('select to_jsonb(p) from pos.products p where id=$1',[productId]);
  const items=q.lines.flatMap(l=>l.parts.map((part,i)=>({folio,product_id:productId,sku:product.sku,nombre:'JOEL',talla:'M',qty:part.qty,
   precio:part.unit,precio_base:l.res.unit,precio_original:l.res.orig,list_price:l.res.orig,effective_price:part.unit,promos:l.res.promos,
   descuento_adicional:part.additionalDiscount,line_id:randomUUID(),barcode_code:product.barcode_code,
   discount_snapshot:{promotions:l.res.promos,additional:part.additionalDiscount,financial:{version:2,key:l.key,part:i}}})));
  const paid=layaway?Math.min(10,q.finalTotal):q.finalTotal;
  const payment={id:randomUUID(),folio,fecha:new Date().toISOString(),tipo:layaway?'anticipo':'venta',metodo:'Efectivo',monto:paid,efectivo:paid,tarjeta:0,transferencia:0,otro:0,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:paid}]};
  return {expectedActorId:actor,type:'sale',mode:'new',operationId,quoteContext:await scalar('select pos.online_quote_context()'),expectedProducts:[{id:productId,version:product.sync_version}],
   header:{folio,operation_id:operationId,fecha:new Date().toISOString(),cliente_id:courtesy?clientId:null,cliente:'H186',vendedores:[],items:qty,
    comision:0,comision_base:'bruto',comisiones:[],
    subtotal:q.subtotal,iva:q.iva,total:q.finalTotal,iva_pct:16,iva_included:true,original_total:q.originalTotal,
    descuento:q.configuredDiscountTotal,descuento_adicional:q.additionalDiscountTotal,total_antes_descuento_adicional:q.beforeAdditionalTotal,descuentos_adicionales:q.applications,
    valor_regalado:q.valorRegalado,financial_version:2,financial_request:req,anticipo:paid,saldo:q.finalTotal-paid,pago_efectivo:paid,pago_otro:0,
    metodo:courtesy?'Cortesía':layaway?'Apartado':'Efectivo',estado:layaway?'Apartado':'Pagado'},
   items,moves:[],payments:paid>0?[payment]:[],stockLines:[{product_id:productId,talla:'M',qty}],reserveStock:!layaway,clientEffect:null,sellerEffects:[]};
 };
 const addCommission=async(command,ids=[actor])=>{
  const total=command.header.total,share=Number((total/ids.length).toFixed(2));
  const rows=ids.map((id,index)=>{const base=index===ids.length-1?Number((total-share*(ids.length-1)).toFixed(2)):share;
   return {sellerId:id,vendedor:'H186',base,pct:5,monto:Number((base*.05).toFixed(2)),source:'override',policyVersion:1,tramos:[]};});
  Object.assign(command.header,{vendedores:ids,comision:Number(rows.reduce((sum,row)=>sum+row.monto,0).toFixed(2)),comisiones:rows});
  command.sellerEffects=await Promise.all(rows.map(async row=>{
   const seller=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[row.sellerId]);
   return {id:row.sellerId,base_version:seller.sync_version,ventas_mes_delta:total/ids.length,ventas_num_delta:1,comision_acum_delta:row.monto,
    after_ventas_mes:Number(seller.ventas_mes)+total/ids.length,after_ventas_num:Number(seller.ventas_num)+1,after_comision_acum:Number(seller.comision_acum)+row.monto};
  }));
  return command;
 };
 const assertCommissionStored=async command=>{
  const stored=await scalar('select jsonb_build_object(\'amount\',comision,\'base\',comision_base,\'rows\',comisiones) from pos.sales where folio=$1',[command.header.folio]);
  assert.deepEqual(stored,{amount:command.header.comision,base:command.header.comision_base,rows:command.header.comisiones});
  check(true,'commission scalar, base and complete policy rows survive the financial gateway');
 };
 const assertSaleReceipt=async(response,folio)=>{
  const canonical=await scalar('select jsonb_build_object(\'sale\',to_jsonb(s),\'items\',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),\'[]\') from pos.sale_items i where i.folio=s.folio)) from pos.sales s where folio=$1',[folio]);
  assert.deepEqual(response.result.sale,canonical.sale);assert.deepEqual(response.result.items,canonical.items);
  assert.deepEqual(await scalar('select response from pos.online_requests where actor_id=$1 and request_id=$2',[actor,response.requestId]),response);
  check(true,'immediate response and durable idempotency receipt equal final sale/items rows');
 };
 const secondSeller=randomUUID();
 await edit(`insert into pos.sellers(id,nombre,role,active) values(${lit(secondSeller)},'H186 second seller','vendedor',true)`);
 const sharedCommission=await addCommission(await makeSale({qty:3,apps:[app(.99)]}),[actor,secondSeller]);
 check(sharedCommission.header.total===2624.01&&sharedCommission.sellerEffects[0].ventas_mes_delta===1312.005,'odd-cent shared sale preserves existing fractional sales effects');
 check((await call(sharedCommission)).ok===true,'two distinct sellers retain odd-cent commission snapshot');
 await assertCommissionStored(sharedCommission);
 const plainCommission=await addCommission(await makeSale());
 check((await call(plainCommission)).ok===true,'empty additional array still persists commission evidence');
 await assertCommissionStored(plainCommission);
 for(const [label,change,pattern] of [
  ['scalar mismatch',c=>{c.header.comision+=.01;},'FINANCIAL_COMMISSION_TOTAL_MISMATCH'],
  ['missing snapshot',c=>{delete c.header.comisiones;},'FINANCIAL_COMMISSION_SNAPSHOT_REQUIRED'],
  ['missing effect',c=>{c.sellerEffects=[];},'FINANCIAL_COMMISSION_EFFECT_MISMATCH'],
  ['different effect',c=>{c.sellerEffects[0].comision_acum_delta+=.01;},'FINANCIAL_COMMISSION_EFFECT_MISMATCH']
 ]){
  const invalid=await addCommission(await makeSale());change(invalid);
  const balance=await scalar('select comision_acum from pos.sellers where id=$1',[actor]);
  await rejected(()=>call(invalid),pattern,'commission '+label+' rejected before economic effects');
  check(!await scalar('select exists(select 1 from pos.sales where folio=$1)',[invalid.header.folio])&&
   await scalar('select comision_acum from pos.sellers where id=$1',[actor])===balance,'rejected commission leaves sale absent and seller balance unchanged');
 }
 await scalar('select pos.h186_assert_commission_snapshot($1::jsonb,$2::jsonb)',[
  JSON.stringify({comision:1.25,comision_base:'bruto',comisiones:[{sellerId:actor,base:12.50,monto:.63},{sellerId:actor,base:12.50,monto:.62}]}),
  JSON.stringify([{id:actor,comision_acum_delta:.63},{id:actor,comision_acum_delta:.62}])]);
 check(true,'existing repeated-seller commission semantics are compared as grouped amounts');
 const tamper=await makeSale();tamper.header.subtotal=1;tamper.header.iva=2;
 const beforeStock=await scalar('select stock_quantity from pos.products where id=$1',[productId]);
 await rejected(()=>call(tamper),'FINANCIAL_QUOTE_MISMATCH','SQL rejects altered IVA/subtotal');
 check(!await scalar('select exists(select 1 from pos.sales where folio=$1)',[tamper.header.folio])&&await scalar('select stock_quantity from pos.products where id=$1',[productId])===beforeStock,'rejection changes no sale/stock');
 const badPayment=await makeSale();badPayment.payments[0].monto-=1;badPayment.payments[0].efectivo-=1;badPayment.payments[0].components[0].amount-=1;
 await rejected(()=>call(badPayment),'FINANCIAL_PAYMENT_TOTAL_MISMATCH','SQL rejects ledger/header disagreement');
 const missingVersion=await makeSale();delete missingVersion.header.financial_version;
 await rejected(()=>call(missingVersion),'CLIENT_VERSION_UNSUPPORTED.*FINANCIAL_VERSION_REQUIRED','old clients receive the supported update message before new sales');
 const splitCommand=await addCommission(await makeSale({qty:3,apps:[app()]}));
 const requestId=randomUUID(),response=await call(splitCommand,requestId);
 check(response.ok===true,'split sale gateway commit');
 await assertCommissionStored(splitCommand);
 await assertSaleReceipt(response,splitCommand.header.folio);
 const stored=await scalar('select jsonb_build_object(\'total\',s.total,\'original\',s.original_total,\'version\',s.financial_version,\'lines\',(select sum(qty*precio) from pos.sale_items where folio=s.folio),\'additional\',(select sum(descuento_adicional) from pos.sale_items where folio=s.folio),\'paid\',(select sum(monto) from pos.sale_payments where folio=s.folio)) from pos.sales s where folio=$1',[splitCommand.header.folio]);
 check(stored.total===2624&&stored.lines===2624&&stored.paid===2624&&stored.original===3750&&stored.version===2&&stored.additional===1,'sale, lines, discount and paid ledger agree');
 check(JSON.stringify(await call(splitCommand,requestId))===JSON.stringify(response),'request retry reuses financial receipt');
 await assertCommissionStored(splitCommand);
 await assertSaleReceipt(await call(splitCommand,requestId),splitCommand.header.folio);
 check(await scalar('select stock_quantity from pos.products where id=$1',[productId])===beforeStock-3,'split reserves physical quantity once');
 const replaceExisting=structuredClone(splitCommand);delete replaceExisting.mode;
 await rejected(()=>call(replaceExisting),'SALE_ALREADY_EXISTS','a new request cannot overwrite an existing sale');
 const gift=await makeSale({courtesy:true,apps:[app()]});check(gift.header.valor_regalado===874&&gift.header.original_total===1250,'courtesy values original and configured gift separately');
 check((await call(gift)).ok===true&&!await scalar('select exists(select 1 from pos.sale_payments where folio=$1)',[gift.header.folio]),'courtesy has zero VAT/total and no fictitious payment');
 await assertCommissionStored(gift);
 await edit("update pos.promotions set valor=100,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 const free=await addCommission(await makeSale());check((await call(free)).ok===true&&!await scalar('select exists(select 1 from pos.sale_payments where folio=$1)',[free.header.folio]),'100% ordinary promotion has no payment');
 await assertCommissionStored(free);
 await edit("update pos.promotions set valor=30,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 const makeReturn=(sale,index=0,qty=1)=>{
  const sold=sale.items[index],id=randomUUID(),total=Number((sold.precio*qty).toFixed(2));
  return {expectedActorId:actor,type:'return',legacy:false,
   header:{id,folio:sale.header.folio,fecha:new Date().toISOString(),cliente:'H186',vendedores:[],metodo:'Efectivo',total,components:total>0?[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:total}]:[]},
   items:[{...sold,return_id:id,qty,line_id:randomUUID(),source_sale_line_id:sold.line_id,motivo:'H186'}],moves:[],stockLines:[{product_id:productId,talla:'M',qty}],clientEffect:null,sellerEffects:[]};
 };
 const addReturnCommission=async(ret,sale,amount)=>{
  const seller=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[actor]);
  ret.header.vendedores=[actor];
  ret.header.comisiones=[{...sale.header.comisiones[0],base:ret.header.total,monto:amount}];
  ret.sellerEffects=[{id:actor,base_version:seller.sync_version,ventas_mes_delta:-ret.header.total,comision_acum_delta:-amount,
   after_ventas_mes:Number(seller.ventas_mes)-ret.header.total,after_comision_acum:Number(seller.comision_acum)-amount}];
  return ret;
 };
 const zeroReturn=makeReturn(free);
 check((await call(zeroReturn)).ok===true,'zero-price item returns without fictitious payment');
 check(JSON.stringify(await scalar('select components from pos.returns where id=$1',[zeroReturn.header.id]))==='[]','zero-refund plain H90 wire persists empty components');
 const wrongReturn=makeReturn(splitCommand);wrongReturn.items[0].precio=875;wrongReturn.header.total=875;wrongReturn.header.components[0].amount=875;
 await rejected(()=>call(wrongReturn),'FINANCIAL_POSTSALE_PRICE_MISMATCH','refund cannot recognize pre-additional amount');
 const firstReturn=await addReturnCommission(makeReturn(splitCommand),splitCommand,43.73);
 check((await call(firstReturn)).ok===true,'partial return uses exact high-price segment');
 assert.deepEqual(await scalar('select comisiones from pos.returns where id=$1',[firstReturn.header.id]),firstReturn.header.comisiones);
 await assertCommissionStored(splitCommand);
 check(true,'first partial return preserves the actual frozen sale commission and its 43.73 reversal');
 const tooMany=makeReturn(splitCommand,0,2);
 await rejected(()=>call(tooMany),'FINANCIAL_SOURCE_QUANTITY_EXCEEDED','one segment cannot consume another segment quantity');
 const secondReturn=await addReturnCommission(makeReturn(splitCommand,0,1),splitCommand,43.73);
 check((await call(secondReturn)).ok===true,'second split segment returns exact frozen commission proportion');
 const thirdReturn=await addReturnCommission(makeReturn(splitCommand,1,1),splitCommand,43.74);
 check((await call(thirdReturn)).ok===true,'last split segment returns the exact commission remainder');
 check(Number(await scalar('select sum((c->>\'monto\')::numeric) from pos.returns r cross join lateral jsonb_array_elements(r.comisiones) c where folio=$1',[splitCommand.header.folio]))===131.20,'all returned commission rows add to exactly the original 131.20');
 await assertCommissionStored(splitCommand);
 check(await scalar('select sum(total) from pos.returns where folio=$1',[splitCommand.header.folio])==='2624.00'||Number(await scalar('select sum(total) from pos.returns where folio=$1',[splitCommand.header.folio]))===2624,'full return sum equals exact paid amount');
 const source=await makeSale({apps:[app()]});check((await call(source)).ok===true,'exchange source saved');
 const makeExchange=async(sourceItem,origin)=>{
  const product=await scalar('select to_jsonb(p) from pos.products p where id=$1',[productId]);
  const id=randomUUID(),folio='H186-X-'+randomUUID(),recognized=sourceItem.precio,delivered=product.precio,difference=Math.max(0,delivered-recognized);
  return {expectedActorId:actor,type:'exchange',quoteContext:await scalar('select pos.online_quote_context()'),expectedProducts:[{id:productId,version:product.sync_version}],
   header:{id,folio,origen_folio:origin,fecha:new Date().toISOString(),usuario:'H186',vendedor_id:actor,comision_monto:0,valor_reconocido:recognized,valor_entregado:delivered,diferencia:difference},
   items:[{...sourceItem,qty:1,lado:'devuelto',line_id:randomUUID(),source_sale_line_id:sourceItem.line_id,motivo:'Talla',condicion:'Sin uso'},
    {lado:'entregado',product_id:productId,sku:product.sku,nombre:'JOEL',talla:'M',qty:1,precio:delivered,line_id:randomUUID(),barcode_code:product.barcode_code}],moves:[],seller_effects:[],
   payment:difference>0?{id:randomUUID(),folio,fecha:new Date().toISOString(),tipo:'cambio',metodo:'Efectivo',monto:difference,efectivo:difference,tarjeta:0,transferencia:0,otro:0,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:difference}]}:null};
 };
 const exchange=await makeExchange(source.items[0],source.header.folio),exResult=await call(exchange);
 check(exResult.ok===true,'exchange uses source final price plus current delivered price: '+JSON.stringify(exResult));
 check(Number(await scalar('select valor_reconocido from pos.exchanges where id=$1',[exchange.header.id]))===874,'SQL exchange recognized actual paid874, not promo875/list1250');
 const chained=await makeExchange(exchange.items[1],source.header.folio),chainResult=await call(chained);
 check(chainResult.ok===true,'second exchange recognizes exact delivered source line: '+JSON.stringify(chainResult));
 const reused=await makeExchange(source.items[0],source.header.folio);
 await rejected(()=>call(reused),'FINANCIAL_SOURCE_QUANTITY_EXCEEDED','exchange cannot reuse consumed source');
 const layaway=await makeSale({layaway:true,apps:[app()]});layaway.header.vendedores=[actor];
 check((await call(layaway)).ok===true,'layaway freezes financial contract');
 await edit("update pos.promotions set valor=60,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 const pay=structuredClone(layaway);pay.mode='payment';pay.reserveStock=false;pay.stockLines=[];
 pay.expectedSale=Object.fromEntries(['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id'].map(k=>[k,layaway.header[k]]));
 pay.header.anticipo=30;pay.header.saldo=layaway.header.total-30;pay.header.pago_efectivo=30;
 pay.payments.push({...pay.payments[0],id:randomUUID(),tipo:'abono',monto:20,efectivo:20,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:20}]});
 const paidResult=await call(pay);check(paidResult.ok===true,'payment retains original quote after promotions changed: '+JSON.stringify(paidResult));
 await assertCommissionStored(pay);
 await assertSaleReceipt(paidResult,pay.header.folio);
 const tamperedCommissionPayment=structuredClone(pay);tamperedCommissionPayment.header.comision=1;
 await rejected(()=>call(tamperedCommissionPayment),'FINANCIAL_FROZEN_SALE_MISMATCH: comision','payment cannot rewrite frozen commission');
 const tamperedCommissionEffect=structuredClone(pay);tamperedCommissionEffect.sellerEffects=[{id:actor,comision_acum_delta:1}];
 await rejected(()=>call(tamperedCommissionEffect),'FINANCIAL_FROZEN_COMMISSION_EFFECT_MISMATCH','payment cannot add a second seller commission');
 const changed=structuredClone(pay);changed.header.total-=1;
 await rejected(()=>call(changed),'FINANCIAL_FROZEN_SALE_MISMATCH','payment cannot change frozen total');
 const remainder=layaway.header.total-30;
 const liquidationSeller=await scalar('select to_jsonb(s) from pos.sellers s where id=$1',[actor]);
 const liquidationRows=[{sellerId:actor,vendedor:'H186',base:layaway.header.total,pct:5,monto:43.70,source:'override',policyVersion:1,tramos:[]}];
 const liquidation={expectedActorId:actor,type:'sale',mode:'layaway_liquidation',operationId:layaway.operationId,saleOperationId:layaway.operationId,folio:layaway.header.folio,
  payment:{id:randomUUID(),folio:layaway.header.folio,fecha:new Date().toISOString(),tipo:'liquidacion',metodo:'Efectivo',monto:remainder,efectivo:remainder,tarjeta:0,transferencia:0,otro:0,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:remainder}]},sellerEffects:[],itemIdentities:[],commissionSnapshot:{amount:0,base:'neto',rows:[]}};
 liquidation.commissionSnapshot={amount:43.70,base:'bruto',rows:liquidationRows};
 liquidation.sellerEffects=[{id:actor,base_version:liquidationSeller.sync_version,ventas_mes_delta:layaway.header.total,ventas_num_delta:1,comision_acum_delta:43.70,
  after_ventas_mes:Number(liquidationSeller.ventas_mes)+layaway.header.total,after_ventas_num:Number(liquidationSeller.ventas_num)+1,after_comision_acum:Number(liquidationSeller.comision_acum)+43.70}];
 const beforeLiquidationStock=await scalar('select stock_quantity from pos.products where id=$1',[productId]);
 const beforeLiquidationPayments=await scalar('select count(*) from pos.sale_payments where folio=$1',[layaway.header.folio]);
 for(const variant of ['rows','effect']){
  const inconsistent=structuredClone(liquidation),rejectedRequest=randomUUID();
  if(variant==='rows')inconsistent.commissionSnapshot.rows[0].monto=43.69;
  else {inconsistent.sellerEffects[0].comision_acum_delta=43.69;inconsistent.sellerEffects[0].after_comision_acum-=.01;}
  const refused=await call(inconsistent,rejectedRequest);
  check(refused.ok===false&&refused.error.message===(variant==='rows'?'FINANCIAL_COMMISSION_TOTAL_MISMATCH':'FINANCIAL_COMMISSION_EFFECT_MISMATCH'),'V2 liquidation rejects inconsistent commission '+variant);
  const receipt=await scalar('select jsonb_build_object(\'state\',state,\'response\',response) from pos.online_requests where actor_id=$1 and request_id=$2',[actor,rejectedRequest]);
  assert.deepEqual(receipt,{state:'rejected',response:refused});
  check(await scalar('select stock_quantity from pos.products where id=$1',[productId])===beforeLiquidationStock&&
   await scalar('select count(*) from pos.sale_payments where folio=$1',[layaway.header.folio])===beforeLiquidationPayments&&
   Number(await scalar('select comision_acum from pos.sellers where id=$1',[actor]))===Number(liquidationSeller.comision_acum)&&
   await scalar('select estado from pos.sales where folio=$1',[layaway.header.folio])==='Apartado','rejected liquidation preserves stock, seller, payments and sale state; durable receipt agrees');
 }
 const wrongLiquidation=structuredClone(liquidation);wrongLiquidation.payment.monto-=1;wrongLiquidation.payment.efectivo-=1;wrongLiquidation.payment.components[0].amount-=1;
 await rejected(()=>call(wrongLiquidation),'FINANCIAL_LIQUIDATION_AMOUNT_MISMATCH','liquidation must pay the frozen remaining balance');
 const liquidated=await call(liquidation);check(liquidated.ok===true,'liquidation after promotion change uses frozen sale: '+JSON.stringify(liquidated));
 await assertSaleReceipt(liquidated,layaway.header.folio);
 assert.deepEqual(await call(liquidation,liquidated.requestId),liquidated);
 check(true,'liquidation replay returns the same frozen receipt without repeating effects');
 const frozenLiquidationSale=await scalar('select to_jsonb(s) from pos.sales s where folio=$1',[layaway.header.folio]);
 const frozenLiquidationStock=await scalar('select stock_quantity from pos.products where id=$1',[productId]);
 const frozenLiquidationPayments=await scalar('select count(*) from pos.sale_payments where folio=$1',[layaway.header.folio]);
 const frozenLiquidationBalance=await scalar('select comision_acum from pos.sellers where id=$1',[actor]);
 for(const variant of ['amount','base','rowAmount','rowPolicy']){
  const alteredReplay=structuredClone(liquidation);
  if(variant==='amount')alteredReplay.commissionSnapshot.amount=43.69;
  if(variant==='base')alteredReplay.commissionSnapshot.base='neto';
  if(variant==='rowAmount')alteredReplay.commissionSnapshot.rows[0].monto=43.69;
  if(variant==='rowPolicy')alteredReplay.commissionSnapshot.rows[0].pct=4.99;
  const refused=await call(alteredReplay);
  check(refused.ok===false&&refused.error.message==='FINANCIAL_FROZEN_COMMISSION_REPLAY_MISMATCH','new request cannot rewrite liquidated commission '+variant);
  assert.deepEqual(await scalar('select to_jsonb(s) from pos.sales s where folio=$1',[layaway.header.folio]),frozenLiquidationSale);
  check(await scalar('select stock_quantity from pos.products where id=$1',[productId])===frozenLiquidationStock&&
   await scalar('select count(*) from pos.sale_payments where folio=$1',[layaway.header.folio])===frozenLiquidationPayments&&
   await scalar('select comision_acum from pos.sellers where id=$1',[actor])===frozenLiquidationBalance,'rejected liquidation replay preserves the frozen sale, stock, payments and seller');
 }
 const matchingReplay=await call(liquidation);
 check(matchingReplay.ok===true,'same liquidation under new request preserves existing idempotency');
 await assertSaleReceipt(matchingReplay,layaway.header.folio);
 check(await scalar('select stock_quantity from pos.products where id=$1',[productId])===frozenLiquidationStock&&
  await scalar('select count(*) from pos.sale_payments where folio=$1',[layaway.header.folio])===frozenLiquidationPayments&&
  await scalar('select comision_acum from pos.sellers where id=$1',[actor])===frozenLiquidationBalance,'matching liquidation replay repeats no stock, payment or seller effect');
 assert.deepEqual(await scalar('select comisiones from pos.sales where folio=$1',[layaway.header.folio]),liquidationRows);
 check(Number(await scalar('select comision_acum from pos.sellers where id=$1',[actor]))===Number((Number(liquidationSeller.comision_acum)+43.70).toFixed(2)),'H69 liquidation freezes actual commission once and keeps its seller effect');
 const frozen=await scalar('select jsonb_build_object(\'total\',total,\'version\',financial_version,\'request\',financial_request,\'original\',original_total,\'saldo\',saldo,\'paid\',(select sum(monto) from pos.sale_payments where folio=s.folio)) from pos.sales s where folio=$1',[layaway.header.folio]);
 assert.deepEqual(frozen.request,layaway.header.financial_request);
 check(frozen.total===874&&frozen.original===1250&&frozen.version===2&&frozen.saldo===0&&frozen.paid===874,'liquidation preserves the financial snapshot and exact ledger');
 await edit("update pos.promotions set valor=30,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 for(const cost of [0,99999]){
  await edit(`update pos.products set costo=${cost},sync_base_version=sync_version,sync_device_id='h186' where id=${lit(productId)}`);
  check((await quote()).finalTotal===875,'discount does not depend on cost '+cost);
 }
 await edit(`update pos.products set precios_talla='{"M":1499.99}',sync_base_version=sync_version,sync_device_id='h186' where id=${lit(productId)}`);
 const sizeQuote=await quote();check(sizeQuote.originalTotal===1499.99&&sizeQuote.finalTotal===1049.99,'authoritative size price and cents');
 await edit("update pos.promotions set scope='{\"tallas\":[\"L\"]}',sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 check((await quote()).finalTotal===1499.99,'promotion size filter respected');
 await edit("update pos.promotions set scope='{}',inicio=current_date+1,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 check((await quote()).finalTotal===1499.99,'future promotion is not applied');
 await edit("update pos.promotions set inicio=null,fin=current_date-1,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'");
 check((await quote()).finalTotal===1499.99,'expired promotion is not applied');
 await edit(`update pos.promotions set fin=null,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo';update pos.products set precios_talla='{}',sync_base_version=sync_version,sync_device_id='h186' where id=${lit(productId)};insert into pos.promotions(id,nombre,tipo,valor,scope) values('h186-fixed','Fixed','fijo',100,'{}')`);
 check((await quote()).finalTotal===775,'existing percentage then fixed stacking order preserved');
 await edit("update pos.promotions set pausado=true,sync_base_version=sync_version,sync_device_id='h186' where id='h186-fixed'");
 await edit(`update pos.products set precio=.01,sync_base_version=sync_version,sync_device_id='h186' where id=${lit(productId)};update pos.promotions set pausado=true,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'`);
 const pennies=n=>Array.from({length:n},(_,i)=>({key:'p'+i,productId,talla:'M',qty:1}));
 const smallFour=await quote(pennies(4),[app(.02)]),smallTen=await quote(pennies(10),[app(.04)]);
 check(smallFour.additionalDiscountTotal===.02&&smallFour.finalTotal===.02,'rounded proportions cannot over-allocate');
 check(smallTen.additionalDiscountTotal===.04&&smallTen.finalTotal===.06,'reverse residual finishes exact benefit for tiny lines');
 await rejected(()=>quote(inputs(),[{...app(),benefitName:'False approved label'}]),'FINANCIAL_BENEFIT_SNAPSHOT_MISMATCH','frozen benefit name comes from configured authority');
 await run("select set_config('request.headers','{}',false);");
 await rejected(()=>quote(),'DEVICE_ID_REQUIRED','quote RPC requires active registered device');
 await run(`select set_config('request.headers',${lit(JSON.stringify({'x-balam-device-id':device,'x-balam-client-build':'h186-test'}))},false);`);
 await run(`select set_config('request.jwt.claim.sub',${lit(randomUUID())},false);`);
 await rejected(()=>quote(),'CAPABILITY_REQUIRED','quote RPC requires authorized active staff');
 await run(`select set_config('request.jwt.claim.sub',${lit(actor)},false);`);
 await rejected(()=>edit("update pos.promotions set valor=101,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'"),'promotions_financial_value_chk','server rejects individual percentage above100');
 check(!await scalar("select has_function_privilege('anon','pos.quote_sale(jsonb,jsonb,boolean)','execute')"),'anonymous quote RPC denied');
 await edit(`update pos.products set precio=1250,sync_base_version=sync_version,sync_device_id='h186' where id=${lit(productId)};update pos.promotions set pausado=false,sync_base_version=sync_version,sync_device_id='h186' where id='h186-promo'`);
 const legacyTransition=await makeSale();delete legacyTransition.header.financial_version;delete legacyTransition.header.financial_request;delete legacyTransition.header.original_total;
 await run('update pos.online_runtime set min_financial_version=1 where singleton;');
 check((await call(legacyTransition)).ok===true,'published legacy client remains usable only during rollout window');
 const activation=fs.readFileSync('supabase/operations/h186-activate-financial-contract.sql','utf8');
 await run('update pos.online_runtime set enabled=false where singleton;');
 await rejected(()=>run(activation),'H186_RUNTIME_NOT_ENABLED','activation rejects a disabled online runtime');
 await run('rollback;');
 check(await scalar('select min_financial_version=1 from pos.online_runtime where singleton'),'failed activation leaves version unchanged');
 await run('update pos.online_runtime set enabled=true where singleton;');
 await run(activation,'explicit activation');
 check(await scalar('select min_financial_version=2 from pos.online_runtime where singleton'),'activation requires V2');
 await run(activation,'idempotent activation');
 check(await scalar('select min_financial_version=2 from pos.online_runtime where singleton'),'activation can safely repeat');
 const legacyUpgrade=structuredClone(legacyTransition);legacyUpgrade.mode='payment';legacyUpgrade.reserveStock=false;legacyUpgrade.stockLines=[];
 legacyUpgrade.expectedSale=Object.fromEntries(['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id'].map(k=>[k,legacyTransition.header[k]]));
 Object.assign(legacyUpgrade.header,{financial_version:2,financial_request:{inputs:inputs(),applications:[]},original_total:1250});
 await rejected(()=>call(legacyUpgrade),'FINANCIAL_HISTORICAL_VERSION_MISMATCH','historical payment cannot upgrade into an unvalidated v2 document');
 check(await scalar('select financial_version is null from pos.sales where folio=$1',[legacyTransition.header.folio]),'historical financial contract remains unversioned');
 const cardToken=randomUUID();
 await edit(`insert into pos.lookup(kind,code,label,meta) values('additional_benefit','CARD50','Card50','{"origin":"Tarjeta física","benefitType":"percentage","scope":"item","value":50,"allowsCustomValue":false,"requiresFolio":true,"combinable":false}');insert into pos.physical_card_redemptions(folio,claim_token,claimed_at) values('H186-CARD',${lit(cardToken)},now())`);
 const cardApp={benefitCode:'CARD50',benefitName:'Card50',origin:'Tarjeta física',benefitType:'percentage',scope:'item',targetKey:'joel',value:50,combinable:false,cardFolio:'H186-CARD',claimToken:cardToken,onlineVerified:true};
 const cardSale=await makeSale({layaway:true,apps:[cardApp]}),cardInitial=await call(cardSale);
 check(cardInitial.ok===true,'physical card benefit freezes on layaway: '+JSON.stringify(cardInitial));
 const redemptionBefore=await scalar("select to_jsonb(r) from pos.physical_card_redemptions r where folio='H186-CARD'");
 const cardPay=structuredClone(cardSale);cardPay.mode='payment';cardPay.reserveStock=false;cardPay.stockLines=[];
 cardPay.expectedSale=Object.fromEntries(['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id'].map(k=>[k,cardSale.header[k]]));
 cardPay.header.anticipo=30;cardPay.header.saldo=cardSale.header.total-30;cardPay.header.pago_efectivo=30;
 cardPay.payments.push({...cardPay.payments[0],id:randomUUID(),tipo:'abono',monto:20,efectivo:20,components:[{methodCode:'Efectivo',methodLabel:'Efectivo',amount:20}]});
 const cardPaid=await call(cardPay);
 check(cardPaid.ok===true,'partial payment preserves prior physical-card redemption: '+JSON.stringify(cardPaid));
 check(Number(await scalar("select count(*) from pos.physical_card_redemptions where folio='H186-CARD' and sale_folio=$1",[cardSale.header.folio]))===1,'card is consumed once for its original sale');
 assert.deepEqual(await scalar("select to_jsonb(r) from pos.physical_card_redemptions r where folio='H186-CARD'"),redemptionBefore);
 check(true,'partial payment does not change the card redemption snapshot');
 const reusedCard=await makeSale({apps:[cardApp]});
 await rejected(()=>call(reusedCard),'23505','a redeemed card cannot benefit a different sale');
 check(!await scalar('select exists(select 1 from pos.sales where folio=$1)',[reusedCard.header.folio]),'rejected card reuse leaves no sale');
 const duplicateToken=randomUUID();
 await edit(`update pos.lookup set meta=meta||'{"combinable":true}'::jsonb where kind='additional_benefit' and code='CARD50';insert into pos.physical_card_redemptions(folio,claim_token,claimed_at) values('H186-DUPLICATE-CARD',${lit(duplicateToken)},now())`);
 const duplicateApp={...cardApp,combinable:true,cardFolio:'H186-DUPLICATE-CARD',claimToken:duplicateToken};
 const duplicateCard=await makeSale({apps:[duplicateApp,duplicateApp]});
 await rejected(()=>call(duplicateCard),'23505','a combinable physical card cannot be redeemed twice in a new sale');
 check(!await scalar('select exists(select 1 from pos.sales where folio=$1)',[duplicateCard.header.folio])&&await scalar("select sale_folio is null from pos.physical_card_redemptions where folio='H186-DUPLICATE-CARD'"),'duplicate card rejection rolls back the sale and first redemption');
 await run(fs.readFileSync('supabase/migrations/20260912021300_pos_h164_optional_json_null_verification.sql','utf8'),'historical payment/exchange compatibility');
 check(true,'historical payment and exchange gateway regressions preserve prior contracts');
 console.log(JSON.stringify({ok:true,passed,engine:'isolated PGlite',network:false}));
} catch(error) {
 console.error(JSON.stringify({ok:false,passed,error:error.message,detail:error.cause?.detail,where:error.cause?.where}));process.exitCode=1;
} finally {await db.close();}
