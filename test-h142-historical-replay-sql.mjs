// PostgreSQL execution of the production historical adapter and identity guard.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.BALAM_PGLITE_MODULE?pathToFileURL(process.env.BALAM_PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite(); let count=0;
const check=(ok,name)=>{if(!ok)throw Error(name);count++;console.log('PASS '+name);};
const extract=(file,name)=>{
 const source=readFileSync(file,'utf8'),start=source.toLowerCase().indexOf('create or replace function pos.'+name+'(');
 if(start<0)throw Error('missing '+name);
 const end=source.indexOf('$$;',start); if(end<0)throw Error('missing terminator');
 return source.slice(start,end+3);
};
try{
 await db.exec(`create role anon;create role authenticated;create schema pos;
 create table pos.products(id text primary key,record_model text,barcode_code text,barcode_aliases jsonb,deleted_at timestamptz);
 create table pos.inventory_v1_v2_map(source_v1_product_id text,raw_size_value text,size_scale text,target_v2_product_id text);
 create table pos.sale_items(folio text,line_id text,product_id text,talla text,barcode_code text);
 create table pos.exchanges(id text,origen_folio text);
 create table pos.exchange_items(exchange_id text,lado text,line_id text,product_id text,talla text,barcode_code text);
 insert into pos.products values('p','v2','CURRENT','["OLD"]',null),('other','v2','OTHER','["ALIAS_OTHER"]',null),('v1','v1',null,null,null);
 insert into pos.inventory_v1_v2_map values('v1','M','L','p');
 insert into pos.sale_items values('SALE','source','p','M','OLD'),('OTHER_SALE','foreign-source','p','M','OLD');
 insert into pos.exchanges values('ex','SALE');
 insert into pos.exchange_items values('ex','entregado','exchange-source','p','M','OLD');`);
 await db.exec(extract('supabase/migrations/20260830017200_pos_h133_inventory_v3_contract.sql','h133_operational_items'));
 await db.exec(extract('supabase/migrations/20260810013400_pos_h94_reference_model_v2.sql','h94_assert_v2_document_items'));
 const migration=readFileSync('supabase/migrations/20260905018000_pos_h142_historical_replay.sql','utf8');
 if(!process.argv.includes('--baseline')) await db.exec(migration);
 const base={product_id:'p',line_id:'return-line',source_sale_line_id:'source',talla:'M',barcode_code:'OLD',lado:'devuelto',physical_attrs:{original:true}};
 const adapt=async(item,exchange=false,folio='SALE')=>(await db.query('select pos.h133_operational_items($1::jsonb,$2::boolean,$3::text) result',[JSON.stringify([item]),exchange,folio])).rows[0].result;
 const assertIdentity=async(rows)=>db.query('select pos.h94_assert_v2_document_items($1::jsonb)',[JSON.stringify(rows)]);
 for(const exchange of [false,true]){
  const rows=await adapt(base,exchange);await assertIdentity(rows);
  check(rows[0].barcode_code==='CURRENT'&&rows[0].source_barcode_code==='OLD'&&rows[0].physical_attrs.original,'historical '+(exchange?'exchange':'return'));
 }
 const second=await adapt({...base,source_sale_line_id:'exchange-source'},true);await assertIdentity(second);
 check(second[0].barcode_code==='CURRENT','prior exchange within same origin');
 for(const [name,item,exchange,folio] of [
  ['new delivery',{...base,lado:'entregado'},true,'SALE'],
  ['wrong origin',base,true,'OTHER_SALE'],
  ['foreign source line',{...base,source_sale_line_id:'foreign-source'},false,'SALE'],
  ['missing source',{...base,source_sale_line_id:undefined},false,'SALE'],
  ['unknown source',{...base,source_sale_line_id:'missing'},false,'SALE'],
  ['wrong size',{...base,talla:'L'},false,'SALE'],
  ['unknown alias',{...base,barcode_code:'UNKNOWN'},false,'SALE'],
  ['other product alias',{...base,barcode_code:'ALIAS_OTHER'},false,'SALE'],
 ]){
  let denied=false;try{await assertIdentity(await adapt(item,exchange,folio));}catch(e){denied=e.message.includes('V2_LINE_IDENTITY_REQUIRED');}
  check(denied,'reject '+name);
 }
 await db.exec("insert into pos.sale_items values('SALE','source','p','M','OLD')");
 let denied=false;try{await assertIdentity(await adapt(base));}catch(e){denied=e.message.includes('V2_LINE_IDENTITY_REQUIRED');}
 check(denied,'reject ambiguous source');
 const current=await adapt({...base,barcode_code:'CURRENT'},true,'UNKNOWN');await assertIdentity(current);
 check(current[0].barcode_code==='CURRENT'&&!current[0].source_barcode_code,'current barcode unchanged');
 const legacy=await adapt({...base,product_id:'v1'},false);await assertIdentity(legacy);
 check(legacy[0].source_product_id==='v1'&&legacy[0].product_id==='p','V1 map preserved');
 check((await db.query("select count(*) n from pos.sale_items where barcode_code='OLD'")).rows[0].n===3,'source documents unchanged');
 check(!(await db.query("select has_function_privilege('authenticated','pos.h133_operational_items(jsonb,boolean,text)','execute') allowed")).rows[0].allowed,'adapter stays internal');
 console.log(`${count}/${count} historical replay SQL checks passed`);
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
