// One complete Point Zero scenario in isolated PostgreSQL, never against live pos.
// Uses the applied migration files; removing 218 must make this test fail.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyPointZero(db){
 const actor=randomUUID(),product=randomUUID(),saleId=randomUUID(),operation=randomUUID(),backupRequest=randomUUID();
 const prefix='qa-h164-pz-'+actor,device=prefix+'-device',email=prefix+'@invalid.test',folio='PZ-260912-0001';
 await db.exec(`set session authorization postgres;set role postgres;begin;
 select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true),
  set_config('request.headers','{"x-balam-client-build":"2026-09-12-h164-online"}',true);
 insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes,system_mode)
 values(true,218,3,3,1,'{}','preproduction') on conflict(singleton) do update set system_mode='preproduction';
 update pos.online_runtime set enabled=false where singleton;
 insert into pos.inventory_contract_state(singleton,contract_version,enforced)values(true,3,true)
  on conflict(singleton)do update set contract_version=3,enforced=true;
 insert into pos.lookup(kind,code,label,active,meta)
 select kind,'QA','QA',true,'{}' from unnest(array['cat','manga','tela','color','cuello','modelo','orn'])kind;
 insert into pos.lookup(kind,code,label,active,meta)values('size_letter','M','M',true,'{"value":"M"}');
 insert into pos.settings(key,value)values('storeName','"H164 isolated store"'),('logoDataUrl','"data:image/svg+xml;base64,PHN2Zy8+"'),
 ('metodosPago','["Efectivo","Tarjeta"]'),('skuOrder','["cat","color","size_letter"]');
 insert into pos.products(id,cat,manga,tela,color,cuello,modelo,nombre,precio,costo,record_model,size_category_id,size_code,size_scale,
  stock_quantity,stock,barcode_code,barcode_contract,physical_signature,reference_family_id,ornament_color_codes,sku,attrs)
 values('${product}','QA','QA','QA','QA','QA','QA','H164 isolated V2',100,50,'v2','size_letter','M','L',9,
  '[{"talla":"M","escala":"L","stock":9}]',pos.h133_barcode_v3_from_id('${product}'),3,'${prefix}',gen_random_uuid(),'[]','QA-M','{"__sizeCategoryId":"size_letter"}');
 insert into auth.users(id,email)values('${actor}','${email}');
 insert into pos.sellers(id,nombre,email,role,active,ventas_mes,ventas_num,comision_acum,comision_pct,meta_mes)
 values('${actor}','${prefix}','${email}','admin',true,100,1,5,5,1000);
 insert into pos.promotions(id,nombre,tipo,valor,pausado,scope)values('${prefix}','H164 retained promotion','pct',5,false,'{}');
 insert into pos.permission_roles(code,name,active)values('${prefix}','${prefix}',true);
 insert into pos.user_permission_role_assignments(user_id,role_code,active)values('${actor}','${prefix}',true);
 insert into pos.operational_capabilities(capability_key,description)values('settings.manage','settings.manage'),('permissions.manage','permissions.manage')on conflict do nothing;
 insert into pos.role_capability_permissions(role_code,capability_key,allowed)values('${prefix}','settings.manage',true),('${prefix}','permissions.manage',true);
 insert into pos.screen_permission_catalog(screen_key,parent_key,is_leaf,active,catalog_version)
 values('config.usuarios',null,true,true,1),('config.permisos',null,true,true,1)on conflict(screen_key)do nothing;
 insert into pos.role_screen_permissions(role_code,screen_key,allowed)values('${prefix}','config.usuarios',true),('${prefix}','config.permisos',true);
 insert into pos.sync_devices(device_id,user_id,user_email,protocol_version,data_epoch,status,client_build)
 values('${device}','${actor}','${email}',3,1,'online','2026-09-12-h164-online');
 insert into pos.sync_devices(device_id,protocol_version,data_epoch,status,metadata)
 select '${prefix}-retired-'||x,3,1,'revoked','{"preserve_retirement":true}'from generate_series(1,13)x;
 insert into pos.stock_reservations(operation_id,folio,lines,actor_email)
 values('${saleId}','${folio}',jsonb_build_array(jsonb_build_object('product_id','${product}','talla','M','qty',1)),'${email}');
 insert into pos.sales(folio,fecha,cliente,vendedores,metodo,estado,items,total,operation_id)
 values('${folio}',now(),'Synthetic PZ',jsonb_build_array('${actor}'),'Efectivo','Pagado',1,100,'${saleId}');
 insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio)
 values('${folio}','${product}','QA-M','Synthetic PZ','M',1,100);
 insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro)
 values('${prefix}-payment','${folio}',now()::text,'venta','Efectivo',100,100,0,0,0);
 insert into pos.folio_counters(prefix,business_date,last_seq)values('PZ','2026-09-12',1);
 select set_config('request.jwt.claim.sub','${actor}',true),set_config('request.jwt.claims','{"sub":"${actor}","email":"${email}","role":"authenticated"}',true),
 set_config('request.headers','{"x-balam-device-id":"${device}","x-balam-client-build":"2026-09-12-h164-online"}',true);
 select pos.activate_online_only();set constraints all immediate;`);
 const protectedSql=`select jsonb_build_object(
 'settings',(select jsonb_agg(to_jsonb(x)order by key)from pos.settings x where key<>'_resetMark'),
 'lookup',(select jsonb_agg(to_jsonb(x)order by kind,code)from pos.lookup x),
 'promotions',(select jsonb_agg(to_jsonb(x)order by id)from pos.promotions x),
 'sellers',(select jsonb_agg(to_jsonb(x)-array['ventas_mes','ventas_num','comision_acum','sync_version','sync_base_version','sync_device_id','updated_at']order by id)from pos.sellers x),
 'roles',(select jsonb_agg(to_jsonb(x)order by code)from pos.permission_roles x),
 'screens',(select jsonb_agg(to_jsonb(x)order by role_code,screen_key)from pos.role_screen_permissions x),
 'screenOverrides',(select jsonb_agg(to_jsonb(x)order by user_id,screen_key)from pos.user_screen_permission_overrides x),
 'capabilities',(select jsonb_agg(to_jsonb(x)order by role_code,capability_key)from pos.role_capability_permissions x),
 'capabilityOverrides',(select jsonb_agg(to_jsonb(x)order by user_id,capability_key)from pos.user_capability_overrides x),
 'assignments',(select jsonb_agg(to_jsonb(x)order by user_id,role_code)from pos.user_permission_role_assignments x),
 'auth',(select jsonb_agg(to_jsonb(x)order by id)from auth.users x),
 'retired',(select jsonb_agg(to_jsonb(x)order by device_id)from pos.sync_devices x where status='revoked'),
 'contract',(select to_jsonb(x)from pos.inventory_contract_state x where singleton)) protected`;
 const protectedBefore=(await db.query(protectedSql)).rows[0].protected;
 assert.equal(protectedBefore.contract.enforced,true);assert.equal(protectedBefore.contract.contract_version,3);
 await db.exec('set local role authenticated;');
 const preview=(await db.query('select pos.point_zero_preview()p')).rows[0].p;
 const backup=(await db.query('select pos.execute_online_command($1,$2::jsonb)r',[backupRequest,JSON.stringify({type:'pointZeroBackup',expectedActorId:actor,previewToken:preview.preview_token})])).rows[0].r;
 assert.equal(backup.ok,true,JSON.stringify(backup.error));assert.equal(backup.result.ok,true);
 assert.equal(backup.result.document.payload.products.length,1);
 const result=(await db.query('select pos.execute_online_command($1,$2::jsonb)r',[operation,JSON.stringify({type:'pointZero',expectedActorId:actor,operationId:operation,previewToken:preview.preview_token,backupId:backup.result.backup_id,confirmation:'PUNTO CERO'})])).rows[0].r;
 assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.result.ok,true);assert.equal(result.result.status,'completed');
 assert.ok(Object.values(result.result.counts_after).every(value=>Number(value)===0));
 const receipt=(await db.query('select pos.point_zero_receipt($1)r',[operation])).rows[0].r;
 const onlineReceipt=(await db.query('select pos.online_request_result($1)r',[operation])).rows[0].r;
 assert.equal(receipt.status,'completed');assert.equal(receipt.result.ok,true);assert.equal(onlineReceipt.found,true);assert.equal(onlineReceipt.receipt.ok,true);
 await db.exec('set local role postgres;set constraints all immediate;');
 assert.deepEqual((await db.query(protectedSql)).rows[0].protected,protectedBefore,'Protected configuration is checked independently of repaired hash helpers');
 assert.equal((await db.query(`select status from pos.sync_devices where device_id='${device}'`)).rows[0].status,'online','No heartbeat is needed to remove a false rebootstrap status');
 assert.equal(Number((await db.query(`select ventas_mes from pos.sellers where id='${actor}'`)).rows[0].ventas_mes),0);
 await db.exec('set local role authenticated;');
 const presence=(await db.query('select pos.online_presence($1,$2)r',[device,'2026-09-12-h164-online'])).rows[0].r;
 assert.equal(presence.ok,true);
 const snapshot=(await db.query('select pos.online_snapshot()r')).rows[0].r;
 assert.equal(snapshot.products.length,0);assert.equal(snapshot.sales.length,0);assert.equal(snapshot.payments.length,0);
 const next=(await db.query('select pos.execute_online_command($1,$2::jsonb)r',[randomUUID(),JSON.stringify({type:'folio',expectedActorId:actor,prefix:'PZ',businessDate:'2026-09-12',floor:0})])).rows[0].r;
 assert.equal(next.ok,true);assert.equal(next.result.ok,true);
 await db.exec('set local role postgres;set constraints all immediate;');
 assert.equal(Number((await db.query('select count(*)n from pos.purged_documents where identity=$1',[next.result.folio])).rows[0].n),0);
 assert.equal(Number((await db.query('select count(*)n from pos.purged_documents where kind=$1 and identity=$2',['sale',saleId])).rows[0].n),1);
 await db.exec('rollback;');
 return {completePointZero:true,configurationPreserved:true,inventoryContractEnforced:true,retiredDevicesPreserved:13,
  authenticatedRecovery:true,folioAfterResetUsable:true,commercialCases:1,remotePointZeroExecuted:false};
}
