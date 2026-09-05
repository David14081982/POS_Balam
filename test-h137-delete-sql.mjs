// Extiende el PostgreSQL aislado de H-138: altas reales -> baja SQL -> nueva lectura.
// Ejecutar test-h138-registration-sql.mjs --delete-cycle. Nunca conecta a producción.
import fs from 'node:fs';
export async function testDeleteCycle({db,check,read,functionSql}){
 await db.exec(`alter table pos.products add column updated_at timestamptz;
 create table pos.sync_conflicts(entity text,entity_id text,operation text,expected_version bigint,actual_version bigint,attempted jsonb,current_row jsonb,device_id text);
 create table pos.sales(folio text,estado text,return_limit_days integer,return_expires_at date);
 create table pos.sale_items(folio text,line_id text,product_id text,qty integer);
 create table pos.loan_documents(deleted_at timestamptz,state text,document jsonb);
 create table pos.exchanges(id text,origen_folio text);
 create table pos.exchange_items(exchange_id text,lado text,line_id text,product_id text,qty integer,source_sale_line_id text);
 create table pos.return_items(source_sale_line_id text,product_id text,qty integer);`);
 await db.exec(functionSql(read('20260830017200_pos_h133_inventory_v3_contract.sql'),'guard_entity_version'));
 await db.exec(read('20260818015100_pos_h114_product_delete_scope.sql'));
 const livePath=process.argv.find(arg=>arg.startsWith('--delete-live-defs='))?.slice(19);
 if(livePath){
  const data=JSON.parse(fs.readFileSync(livePath,'utf8').replace(/^\uFEFF/,''));
  for(const row of data.rows.filter(x=>['guard_entity_version','delete_products_checked_v2','delete_product_checked_v2'].includes(x.proname)))await db.exec(row.definition);
 }
 await db.exec('create trigger version_guard before insert or update on pos.products for each row execute function pos.guard_entity_version()');
 const uuid=n=>'13700000-0000-4000-8000-'+String(n).padStart(12,'0');
 const template=(await db.query('select * from pos.products limit 1')).rows[0];
 const active=async family=>(await db.query('select * from pos.products where reference_family_id=$1 and deleted_at is null order by id',[family])).rows;
 for(const [index,scope] of ['reference','family'].entries()){
  const family=uuid(10+index),rows=[];
  for(const [offset,size] of ['M','L'].entries()){
   const id=uuid(100+index*10+offset);
   rows.push({...template,id,reference_family_id:family,size_code:size,sku:'1-PRE-ML-POL-TRA-AMAR-'+size,
    physical_signature:'h137-delete-'+id,barcode_code:(await db.query('select pos.h133_barcode_v3_from_id($1) code',[id])).rows[0].code,
    sync_base_version:0,sync_device_id:'h137-isolated',stock_quantity:2});
  }
  await db.query('select pos.commit_reference_family_batch($1,$2,$3,3,6)',[uuid(200+index),family,JSON.stringify(rows)]);
  const saved=await active(family);
  check(scope+': alta familiar confirmada con versión e identidad',saved.length===2&&saved.every(x=>x.sync_version===1&&x.barcode_contract===3&&rows.some(r=>r.id===x.id&&r.sku===x.sku&&r.barcode_code===x.barcode_code)));
  const targets=(scope==='family'?saved:saved.slice(0,1)).map(x=>({id:x.id,baseVersion:x.sync_version}));
  const args=[uuid(300+index),scope,family,JSON.stringify(targets),'h137-isolated'];
  const sql='select pos.delete_products_checked_v2($1,$2,$3,$4,$5,3,6) result';
  const rejects=async(name,code,override=args)=>{let error;try{await db.query(sql,override);}catch(e){error=e;}check(scope+': '+name,error?.message.includes(code)&&(await active(family)).length===2);};
  await rejects('versión antigua no elimina','PRODUCT_VERSION_CONFLICT',[args[0],scope,family,JSON.stringify(targets.map(x=>({...x,baseVersion:0}))),args[4]]);
  if(scope==='family')await rejects('familia incompleta no elimina parcialmente','REFERENCE_FAMILY_SCOPE_MISMATCH',[args[0],scope,family,JSON.stringify(targets.slice(0,1)),args[4]]);
  await db.exec("set h138.denied='true'");await rejects('sin permiso no elimina','PERMISSION_DENIED');await db.exec("set h138.denied='false'");
  await db.exec("insert into pos.sales values('H137','Apartado',null,null)");
  await db.query("insert into pos.sale_items values('H137','H137-LINE',$1,1)",[saved[0].id]);
  await rejects('apartado protege la familia','PRODUCT_ACTIVE_LAYAWAY');
  await db.exec("update pos.sales set estado='Pagado'");
  await rejects('venta con devolución vigente protege la familia','PRODUCT_RETURNABLE_HISTORY');
  await db.exec("update pos.sales set return_limit_days=1,return_expires_at='2020-01-01'");
  await db.query("insert into pos.loan_documents values(null,'pendiente',$1)",[JSON.stringify({lineas:[{productId:saved[0].id,qty:1,devueltas:0}]})]);
  await rejects('préstamo protege la familia','PRODUCT_OPEN_LOAN');
  await db.exec("update pos.loan_documents set state='devuelto'");
  const history=(await db.query('select jsonb_agg(s) rows from pos.sales s')).rows[0].rows;
  const unrelated=(await db.query('select jsonb_agg(p order by id) rows from pos.products p where reference_family_id<>$1',[family])).rows[0].rows;
  const result=(await db.query(sql,args)).rows[0].result;
  check(scope+': baja confirmada con tombstones versionados',result.ok&&result.rows.length===targets.length&&result.rows.every(x=>x.deleted_at&&x.sync_version===2&&targets.some(t=>t.id===x.id)));
  const retry=(await db.query(sql,args)).rows[0].result;
  check(scope+': reintento devuelve la misma confirmación',JSON.stringify(retry)===JSON.stringify(result));
  const remaining=await active(family);
  check(scope+': nueva lectura no resucita referencias',remaining.length===(scope==='family'?0:1)&&remaining.every(x=>x.id===saved[1].id&&x.stock_quantity===2));
  check(scope+': otras familias intactas',JSON.stringify(unrelated)===JSON.stringify((await db.query('select jsonb_agg(p order by id) rows from pos.products p where reference_family_id<>$1',[family])).rows[0].rows));
  check(scope+': historial intacto',JSON.stringify(history)===JSON.stringify((await db.query('select jsonb_agg(s) rows from pos.sales s')).rows[0].rows));
  await db.exec('truncate pos.sales,pos.sale_items,pos.loan_documents');
 }
 if(process.argv.includes('--delete-browser'))await (await import('./test-h137-delete-sync.mjs')).testDeleteSync({db,check});
}
