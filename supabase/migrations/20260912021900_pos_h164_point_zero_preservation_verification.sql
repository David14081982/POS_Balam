-- H164: one rollback-only V2/profile fixture verifies Point Zero fingerprints.
-- Never calls the global purge, creates Auth users, or changes existing profiles.
begin;
do $verify$
declare
 migration_owner name:=current_user;
 product_id text:=gen_random_uuid()::text;
 seller_id text:='qa-h164-pz-hash-'||gen_random_uuid()::text;
 v_config_global text; v_preserved_global text; v_config text; v_preserved text;
 v_runtime jsonb; v_contract jsonb; v_devices text; v_seller_version bigint;
 v_product jsonb; v_seller jsonb; v_message text; v_definition text;
begin
 if has_function_privilege('anon','pos.config_fingerprint()','execute')
  or has_function_privilege('anon','pos.point_zero_preserved_hash()','execute')
  or has_function_privilege('authenticated','pos.point_zero_preserved_hash()','execute')
  or has_function_privilege('anon','pos.execute_point_zero(text,text,uuid,text,text,text)','execute')
  or has_function_privilege('authenticated','pos.execute_point_zero(text,text,uuid,text,text,text)','execute')
  or not has_function_privilege('authenticated','pos.execute_online_command(uuid,jsonb)','execute') then
  raise exception 'H164_POINT_ZERO_PRESERVATION_ACL';
 end if;
 select pg_get_functiondef('pos.execute_point_zero(text,text,uuid,text,text,text)'::regprocedure) into v_definition;
 if position('if not (select enabled from pos.online_runtime where singleton) then' in v_definition)=0
  or position('status <> ''revoked''' in v_definition)=0 then
  raise exception 'H164_POINT_ZERO_ONLINE_STATUS_BRANCH_MISSING';
 end if;
 v_config_global:=pos.config_fingerprint();
 v_preserved_global:=pos.point_zero_preserved_hash();
 select to_jsonb(r) into v_runtime from pos.online_runtime r where singleton;
 select to_jsonb(r) into v_contract from pos.inventory_contract_state r where singleton;
 select md5(coalesce(jsonb_agg(jsonb_build_array(device_id,status) order by device_id)::text,'[]'))
  into v_devices from pos.sync_devices;
 begin
  -- This transaction-local switch is invisible to other sessions and rolls back.
  -- The NOINHERIT migration login is not a browser commercial request.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.headers','{}',true);
  perform set_config('pos.h133_internal','',true);
  update pos.online_runtime set enabled=false where singleton;
  insert into pos.inventory_contract_state(singleton,contract_version,enforced)
   values(true,3,true) on conflict(singleton) do update set enforced=true;
  insert into pos.products(id,cat,manga,tela,color,cuello,modelo,nombre,record_model,
   reference_family_id,size_category_id,size_code,size_scale,stock_quantity,
   barcode_code,barcode_contract,barcode_aliases,ornament_color_codes,physical_signature,
   precio,costo,sku)
  values(product_id,'QA','QA','QA','QA','NOR','HASH','Synthetic preservation fixture','v2',
   gen_random_uuid(),'qa-h164-pz-size','M','QA',9,
   pos.h133_barcode_v3_from_id(product_id),3,'[]','[]','qa-h164-pz:'||product_id,
   110,60,'qa-h164-pz:'||product_id);
  insert into pos.sellers(id,nombre,role,active,ventas_mes,ventas_num,comision_acum,
   comision_pct,meta_mes,commission_policy_version)
  values(seller_id,'Synthetic preservation fixture','vendedor',false,100,1,5,5,1000,0);
  set constraints all immediate;
  if not (select enforced from pos.inventory_contract_state where singleton) then
   raise exception 'H164_POINT_ZERO_V3_CONTRACT_DISABLED';
  end if;
  select to_jsonb(p) into v_product from pos.products p where p.id=product_id;
  select to_jsonb(s),s.sync_version into v_seller,v_seller_version from pos.sellers s where s.id=seller_id;
  v_config:=pos.config_fingerprint();
  v_preserved:=pos.point_zero_preserved_hash();

  -- These are exactly the operational changes made by the stock/metrics purge.
  update pos.products set stock_quantity=10 where id=product_id;
  update pos.sellers set ventas_mes=0,ventas_num=0,comision_acum=0 where id=seller_id;
  set constraints all immediate;
  if (select stock_quantity from pos.products where id=product_id)<>10
   or (select stock#>>'{0,stock}' from pos.products where id=product_id)<>'10'
   or (select sync_version from pos.sellers where id=seller_id)<=v_seller_version
   or (select ventas_mes<>0 or ventas_num<>0 or comision_acum<>0 from pos.sellers where id=seller_id) then
   raise exception 'H164_POINT_ZERO_OPERATIONAL_FIXTURE_NOT_EXERCISED';
  end if;
  if v_config is distinct from pos.config_fingerprint()
   or v_preserved is distinct from pos.point_zero_preserved_hash() then
   raise exception 'H164_POINT_ZERO_OPERATIONAL_STATE_MISCLASSIFIED';
  end if;
  if (v_product-array['stock','stock_quantity','sync_version','sync_base_version','sync_device_id','updated_at'])
    is distinct from(select to_jsonb(p)-array['stock','stock_quantity','sync_version','sync_base_version','sync_device_id','updated_at'] from pos.products p where p.id=product_id)
   or (v_seller-array['ventas_mes','ventas_num','comision_acum','sync_version','sync_base_version','sync_device_id','updated_at'])
    is distinct from(select to_jsonb(s)-array['ventas_mes','ventas_num','comision_acum','sync_version','sync_base_version','sync_device_id','updated_at'] from pos.sellers s where s.id=seller_id) then
   raise exception 'H164_POINT_ZERO_PROTECTED_FIXTURE_CHANGED';
  end if;

  -- Independent protected changes must still change the relevant fingerprint.
  begin
   update pos.products set precio=111 where id=product_id;
   set constraints all immediate;
   if v_config is not distinct from pos.config_fingerprint() then
    raise exception 'H164_POINT_ZERO_PRICE_PROTECTION_MISSING';
   end if;
   raise exception 'rollback price probe' using errcode='ZX21P';
  exception when sqlstate 'ZX21P' then null;
  end;
  begin
   update pos.sellers set comision_pct=6 where id=seller_id;
   set constraints all immediate;
   if v_config is not distinct from pos.config_fingerprint()
    or v_preserved is not distinct from pos.point_zero_preserved_hash() then
    raise exception 'H164_POINT_ZERO_COMMISSION_POLICY_PROTECTION_MISSING';
   end if;
   raise exception 'rollback policy probe' using errcode='ZX21S';
  exception when sqlstate 'ZX21S' then null;
  end;
  begin
   update pos.products set barcode_code=pos.h133_barcode_v3_from_id(gen_random_uuid()::text) where id=product_id;
   set constraints all immediate;
   raise exception 'H164_POINT_ZERO_BARCODE_GUARD_MISSING';
  exception when sqlstate 'P0001' then
   get stacked diagnostics v_message=message_text;
   if v_message not in('BARCODE_IMMUTABLE','BARCODE_CONTRACT_V3_REQUIRED') then raise; end if;
  end;
  begin
   -- With no Auth identity the administration guard must fail before any plan.
   perform pos.execute_point_zero(seller_id,null,null,'INVALID',null,null);
   raise exception 'H164_POINT_ZERO_ADMIN_GUARD_MISSING';
  exception when insufficient_privilege then
   get stacked diagnostics v_message=message_text;
   if v_message<>'point_zero_requires_admin' then raise; end if;
  end;
  if v_config is distinct from pos.config_fingerprint()
   or v_preserved is distinct from pos.point_zero_preserved_hash()
   or not (select enforced from pos.inventory_contract_state where singleton) then
   raise exception 'H164_POINT_ZERO_PROTECTED_PROBE_NOT_REVERTED';
  end if;
  raise exception 'rollback entire preservation fixture' using errcode='ZX219';
 exception when sqlstate 'ZX219' then null;
 end;
 execute format('set local role %I',migration_owner);
 set constraints all immediate;
 if v_config_global is distinct from pos.config_fingerprint()
  or v_preserved_global is distinct from pos.point_zero_preserved_hash()
  or v_runtime is distinct from(select to_jsonb(r) from pos.online_runtime r where singleton)
  or v_contract is distinct from(select to_jsonb(r) from pos.inventory_contract_state r where singleton)
  or v_devices is distinct from(select md5(coalesce(jsonb_agg(jsonb_build_array(device_id,status) order by device_id)::text,'[]')) from pos.sync_devices)
  or exists(select 1 from pos.products where id=product_id)
  or exists(select 1 from pos.sellers where id=seller_id)
  or exists(select 1 from pos.point_zero_operations where operation_id=seller_id) then
  raise exception 'H164_POINT_ZERO_PRESERVATION_FIXTURE_LEAK';
 end if;
end $verify$;
commit;
