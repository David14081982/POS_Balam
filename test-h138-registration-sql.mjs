// PostgreSQL local en memoria. No conecta a Supabase ni usa datos comerciales.
// BALAM_PGLITE_MODULE apunta a dist/index.js de una instalación de PGlite.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.BALAM_PGLITE_MODULE?pathToFileURL(process.env.BALAM_PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();const checks=[];
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const read=file=>fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/\r\n/g,'\n');
const functionSql=(text,name)=>{
 const start=text.toLowerCase().indexOf('create or replace function pos.'+name+'(');
 if(start<0)throw Error('missing function '+name);
 const end=text.indexOf('$$;',text.indexOf('as $$',start))+3;
 return text.slice(start,end);
};
try{
 await db.exec(`create schema pos; create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$select '13800000-0000-4000-8000-000000000001'::uuid$$;
 create function pos.require_current_capability(text) returns void language plpgsql as $$begin
 if current_setting('h138.denied',true)='true' then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if; end$$;
 create function pos.assert_sync_write_context(integer,bigint) returns void language plpgsql as $$begin
 if $1<>3 or $2<>6 then raise exception 'SYNC_CONTEXT_INVALID'; end if; end$$;
 create function pos.h133_internal_enabled() returns boolean language sql as $$select false$$;
 create table pos.inventory_contract_state(singleton boolean,enforced boolean);
 insert into pos.inventory_contract_state values(true,true);
 create table pos.products(id text primary key,cat text,manga text,tela text,color text,cuello text,modelo text,nombre text,
 orn text,orn_colors jsonb,precio numeric,costo numeric,pop boolean,stock jsonb,imagen text,sku text,barcode_urls jsonb,
 attrs jsonb,precios_talla jsonb,sync_base_version bigint,sync_device_id text,sync_version bigint default 1,
 record_model text,size_category_id text,size_code text,size_scale text,stock_quantity integer,barcode_code text,
 ornament_color_codes jsonb,physical_signature text,physical_identity_locked boolean default false,
 reference_family_id uuid,barcode_contract smallint,barcode_aliases jsonb not null default '[]',deleted_at timestamptz);
 create table pos.capability_operation_audit(operation_id uuid primary key,capability_key text,actor_user_id uuid,subject_key text,payload_hash text,result jsonb);`);
 const h94=read('20260810013400_pos_h94_reference_model_v2.sql');
 const h101=read('20260814014300_pos_h101_reference_families.sql');
 await db.exec(functionSql(h94,'save_products_checked'));
 await db.exec(functionSql(h101,'h101_ensure_reference_family'));
 await db.exec(functionSql(h101,'commit_reference_family_batch').replace('pos.commit_reference_family_batch(','pos.commit_reference_family_batch_h101_internal('));
 const wrapper=read('20260814014500_pos_h101_reference_family_scope_guard.sql');
 const wrapperStart=wrapper.indexOf('create function pos.commit_reference_family_batch(');
 await db.exec(wrapper.slice(wrapperStart,wrapper.indexOf('$$;',wrapperStart)+3));
 await db.exec(functionSql(read('20260830017250_pos_h133_barcode_entropy_fix.sql'),'h133_barcode_v3_from_id'));
 await db.exec(functionSql(read('20260830017200_pos_h133_inventory_v3_contract.sql'),'h133_guard_operational_inventory'));
 await db.exec(`create trigger h101_family before insert or update on pos.products for each row execute function pos.h101_ensure_reference_family();
 create trigger h133_guard before insert or update on pos.products for each row execute function pos.h133_guard_operational_inventory();`);
 const livePath=process.argv.find(arg=>arg.startsWith('--live-defs='))?.slice(12);
 if(livePath){
  const bytes=fs.readFileSync(livePath);
  const live=JSON.parse(bytes.toString(bytes[0]===255?'utf16le':'utf8').replace(/^\uFEFF/,''));
  for(const entry of live.rows.filter(row=>['save_products_checked','commit_reference_family_batch_h101_internal','commit_reference_family_batch','h133_guard_operational_inventory'].includes(row.proname)))await db.exec(entry.definition);
 }
 const baseline=process.argv.includes('--baseline');
 if(!baseline&&!livePath)await db.exec(read('20260905017600_pos_h138_registration_v3.sql'));
 const family='13800000-0000-4000-8000-000000000010';
 for(const [index,route] of ['single','family'].entries()){
  const id=`13800000-0000-4000-8000-00000000002${index}`;
  const barcode=(await db.query('select pos.h133_barcode_v3_from_id($1) code',[id])).rows[0].code;
  const row={id,cat:'1',nombre:'PRESIDENCIAL',modelo:'PRE',sku:'1-PRE-ML-POL-TRA-AMAR-48',manga:'ML',tela:'POL',color:'AMAR',cuello:'TRA',orn:'BEL',
   record_model:'v2',reference_family_id:family,size_category_id:'size_number',size_code:'48',size_scale:'N',stock_quantity:2,
   barcode_code:barcode,barcode_contract:3,barcode_aliases:[],physical_signature:'h138-'+route,sync_base_version:0};
  const op=`13800000-0000-4000-8000-00000000003${index}`;
  const sql=route==='family'?'select pos.commit_reference_family_batch($1,$2,$3,3,6) result':'select pos.save_products_checked($1,$2) result';
  const args=route==='family'?[op,family,JSON.stringify([row])]:[op,JSON.stringify([row])];
  const result=(await db.query(sql,args)).rows[0].result;
  const saved=(await db.query('select * from pos.products where id=$1',[id])).rows[0];
  check(route+': contrato V3 persistido',saved.barcode_contract===3);
  check(route+': familia original persistida',saved.reference_family_id===family);
  check(route+': barcode y SKU exactos',saved.barcode_code===barcode&&saved.sku===row.sku);
  check(route+': stock e ID exactos',saved.stock_quantity===2&&saved.id===id);
  const retry=(await db.query(sql,args)).rows[0].result;
  check(route+': reintento idempotente',JSON.stringify(result)===JSON.stringify(retry));
  await db.exec(`update pos.products set barcode_aliases='["ETIQUETA-ANTERIOR"]' where id='${id}'`);
  const edit={...row,precio:1150,sync_base_version:1};
  const editOp=`13800000-0000-4000-8000-00000000004${index}`;
  await db.query(sql,route==='family'?[editOp,family,JSON.stringify([edit])]:[editOp,JSON.stringify([edit])]);
  const updated=(await db.query('select * from pos.products where id=$1',[id])).rows[0];
  check(route+': editar conserva identidad y alias anterior',updated.barcode_code===barcode&&updated.reference_family_id===family&&updated.barcode_aliases[0]==='ETIQUETA-ANTERIOR');
  await db.exec("set h138.denied='true'");let denied=false;
  try{await db.query(sql,args);}catch(e){denied=e.code==='42501';}
  await db.exec("set h138.denied='false'");check(route+': sigue invocando la guarda de permiso',denied);
 }
 let missing=false;try{await db.exec(`insert into pos.products(id,record_model,barcode_code) values('13800000-0000-4000-8000-000000000099','v2',pos.h133_barcode_v3_from_id('13800000-0000-4000-8000-000000000099'))`);}catch(e){missing=e.message.includes('BARCODE_CONTRACT_V3_REQUIRED');}
 check('contrato ausente se rechaza en la base',missing);
 let bad=false;try{await db.exec(`insert into pos.products(id,record_model,barcode_code,barcode_contract) values('13800000-0000-4000-8000-000000000098','v2','39999999999999999999999999',3)`);}catch(e){bad=e.message.includes('BARCODE_CONTRACT_V3_REQUIRED');}
 check('barcode ajeno al ID sigue rechazado',bad);
 const template=(await db.query('select * from pos.products limit 1')).rows[0];
 const batch=[];
 for(const suffix of ['071','072']){
  const id='13800000-0000-4000-8000-000000000'+suffix;
  batch.push({...template,id,reference_family_id:family,barcode_contract:suffix==='072'?null:3,
   barcode_code:(await db.query('select pos.h133_barcode_v3_from_id($1) code',[id])).rows[0].code});
 }
 const beforeCount=(await db.query('select count(*) n from pos.products')).rows[0].n;let rejected=false;
 try{await db.query('select pos.commit_reference_family_batch($1,$2,$3,3,6)',['13800000-0000-4000-8000-000000000070',family,JSON.stringify(batch)]);}catch(e){rejected=e.message.includes('BARCODE_CONTRACT_V3_REQUIRED');}
 check('una referencia inválida revierte toda la familia',rejected&&(await db.query('select count(*) n from pos.products')).rows[0].n===beforeCount);
 if(!baseline){
  await db.exec(read('20260905017700_pos_h138_registration_v3_verification.sql'));
  check('verificación de migración ejecutada y tabla temporal retirada',(await db.query("select to_regclass('pg_temp.h138_registration_probe') absent")).rows[0].absent===null);
 }
 if(process.argv.includes('--delete-cycle'))await (await import('./test-h137-delete-sql.mjs')).testDeleteCycle({db,check,read,functionSql});
}catch(error){check('ejecución SQL completa',false,{message:error.message,detail:error.detail});}
finally{await db.close();}
console.log(`${process.argv.includes('--delete-cycle')?'H-138 + H-137':'H-138 SQL'}: ${checks.filter(x=>x.ok).length}/${checks.length}`);process.exitCode=checks.some(x=>!x.ok)?1:0;
