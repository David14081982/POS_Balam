-- H-133: contrato logístico V3 y autoridad atómica de migración V1 -> V2.
-- Esta migración es aditiva: instala guardas, respaldo y RPC. La conversión
-- real sólo ocurre en 20260830017300 con el manifiesto sellado del censo vivo.
begin;

create extension if not exists pgcrypto;

alter table pos.products
  add column if not exists barcode_contract smallint,
  add column if not exists barcode_aliases jsonb not null default '[]'::jsonb;

alter table pos.products drop constraint if exists products_v2_shape_check;
alter table pos.products add constraint products_v2_shape_check check (
  record_model = 'v1' or deleted_at is not null or (
    nullif(trim(size_category_id), '') is not null and
    nullif(trim(size_code), '') is not null and
    stock_quantity is not null and stock_quantity >= 0 and
    nullif(trim(barcode_code), '') is not null and
    barcode_code ~ '^3[0-9]{25}$' and
    barcode_contract = 3 and
    jsonb_typeof(barcode_aliases) = 'array' and
    jsonb_typeof(ornament_color_codes) = 'array' and
    nullif(trim(physical_signature), '') is not null
  )
) not valid;

create or replace function pos.h133_barcode_v3_from_id(p_id text)
returns text language plpgsql immutable strict
set search_path = pg_catalog, pg_temp as $$
declare
  v_hex text; v_value numeric := 0; v_i integer; v_digit integer; v_char text;
begin
  if p_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
    raise exception 'BARCODE_V3_UUID_REQUIRED' using errcode='22023';
  end if;
  v_hex := lower(replace(p_id, '-', ''));
  for v_i in 13..32 loop
    v_char := substr(v_hex, v_i, 1);
    v_digit := strpos('0123456789abcdef', v_char) - 1;
    if v_digit < 0 then raise exception 'BARCODE_V3_UUID_REQUIRED' using errcode='22023'; end if;
    v_value := v_value * 16 + v_digit;
  end loop;
  return '3' || lpad(trunc(v_value)::text, 25, '0');
end;
$$;

create table if not exists pos.inventory_contract_state (
  singleton boolean primary key default true check(singleton),
  contract_version smallint not null default 2,
  enforced boolean not null default false,
  operation_id uuid,
  manifest_hash text,
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into pos.inventory_contract_state(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists pos.barcode_aliases (
  alias_code text primary key,
  product_id text not null references pos.products(id) on delete restrict,
  contract_version smallint not null,
  source text not null,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  check(nullif(trim(alias_code),'') is not null)
);
create index if not exists pos_barcode_aliases_product_idx on pos.barcode_aliases(product_id);

create table if not exists pos.inventory_v1_v2_map (
  source_v1_product_id text not null,
  size_scale text not null,
  raw_size_value text not null,
  target_v2_product_id text not null references pos.products(id) on delete restrict,
  source_stock integer not null check(source_stock >= 0),
  historical_only boolean not null default false,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(source_v1_product_id,size_scale,raw_size_value),
  unique(target_v2_product_id)
);

create table if not exists pos.inventory_v3_backups (
  backup_id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  manifest_hash text not null,
  payload_hash text not null,
  payload jsonb not null,
  verified_restorable boolean not null default false,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create table if not exists pos.inventory_v3_operations (
  operation_id uuid primary key,
  backup_id uuid not null references pos.inventory_v3_backups(backup_id) on delete restrict,
  manifest_hash text not null,
  status text not null check(status in('completed','restored')),
  data_epoch_before bigint not null,
  data_epoch_after bigint not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function pos.h133_internal_enabled()
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(current_setting('pos.h133_internal', true),'')='on'
$$;

-- La excepción sólo existe dentro de la RPC revocada y permite restaurar
-- literalmente sync_version/updated_at del respaldo.
create or replace function pos.guard_entity_version()
returns trigger language plpgsql security definer set search_path=pos,pg_temp as $$
declare op text;
begin
  if pos.h133_internal_enabled() and tg_table_name='products' then return new; end if;
  if tg_op='INSERT' then
    new.sync_version:=1; new.sync_base_version:=null; new.updated_at:=now(); return new;
  end if;
  op:=case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'upsert' end;
  if new.sync_base_version is not null and new.sync_base_version<>old.sync_version then
    insert into pos.sync_conflicts(entity,entity_id,operation,expected_version,actual_version,
      attempted,current_row,device_id)
    values(tg_table_name,old.id,op,new.sync_base_version,old.sync_version,
      to_jsonb(new)-'sync_base_version',to_jsonb(old),new.sync_device_id);
    return old;
  end if;
  new.sync_version:=old.sync_version+1; new.sync_base_version:=null; new.updated_at:=now(); return new;
end;
$$;

create or replace function pos.h94_guard_used_reference_identity()
returns trigger language plpgsql set search_path=pos,pg_temp as $$
begin
  if pos.h133_internal_enabled() then return new; end if;
  if old.record_model is distinct from new.record_model then raise exception 'REFERENCE_MODEL_IMMUTABLE'; end if;
  if old.record_model='v2' and new.barcode_code is distinct from old.barcode_code then raise exception 'BARCODE_IMMUTABLE'; end if;
  if old.record_model='v2'
     and (new.physical_signature is distinct from old.physical_signature
       or new.cat is distinct from old.cat or new.manga is distinct from old.manga
       or new.tela is distinct from old.tela or new.color is distinct from old.color
       or new.cuello is distinct from old.cuello or new.modelo is distinct from old.modelo
       or new.orn is distinct from old.orn or new.ornament_color_codes is distinct from old.ornament_color_codes
       or new.size_category_id is distinct from old.size_category_id
       or new.size_code is distinct from old.size_code or new.size_scale is distinct from old.size_scale
       or new.attrs is distinct from old.attrs)
     and (coalesce(old.physical_identity_locked,false) or coalesce(old.stock_quantity,0)<>0
       or exists(select 1 from pos.sale_items where product_id=old.id)
       or exists(select 1 from pos.return_items where product_id=old.id)
       or exists(select 1 from pos.exchange_items where product_id=old.id)
       or exists(select 1 from pos.movements where product_id=old.id)
       or exists(select 1 from pos.reference_reclassifications where source_product_id=old.id or target_product_id=old.id)) then
    raise exception 'REFERENCE_RECLASSIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace function pos.h133_guard_operational_inventory()
returns trigger language plpgsql set search_path=pos,pg_temp as $$
declare v_enforced boolean;
begin
  if pos.h133_internal_enabled() then return new; end if;
  select enforced into v_enforced from pos.inventory_contract_state where singleton;
  if not coalesce(v_enforced,false) then return new; end if;
  if new.deleted_at is null and new.record_model='v1' then raise exception 'V1_OPERATIONAL_FORBIDDEN'; end if;
  if new.deleted_at is null and new.record_model='v2' then
    if new.barcode_contract<>3 or new.barcode_code is distinct from pos.h133_barcode_v3_from_id(new.id)
       or jsonb_typeof(new.barcode_aliases)<>'array' then
      raise exception 'BARCODE_CONTRACT_V3_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists h133_guard_operational_inventory on pos.products;
create trigger h133_guard_operational_inventory
before insert or update of id,record_model,barcode_code,barcode_contract,barcode_aliases,deleted_at
on pos.products for each row execute function pos.h133_guard_operational_inventory();

create or replace function pos.h133_alias_immutable()
returns trigger language plpgsql set search_path=pos,pg_temp as $$
begin
  if pos.h133_internal_enabled() then return case when tg_op='DELETE' then old else new end; end if;
  raise exception 'BARCODE_ALIAS_IMMUTABLE';
end;
$$;
drop trigger if exists h133_alias_immutable on pos.barcode_aliases;
create trigger h133_alias_immutable before update or delete on pos.barcode_aliases
for each row execute function pos.h133_alias_immutable();

create or replace function pos.h133_payload_hash(p_payload jsonb)
returns text language sql immutable strict set search_path=pg_catalog,pg_temp as $$
  select pos.point_zero_sha256(p_payload)
$$;

create or replace function pos.h133_restore_inventory_v3_backup(p_backup_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pos,auth as $$
declare v_backup pos.inventory_v3_backups%rowtype; v_row jsonb; v_epoch bigint;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='inventory_restore_requires_admin';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.h133-inventory-v3',0));
  select * into strict v_backup from pos.inventory_v3_backups where backup_id=p_backup_id for update;
  if v_backup.payload_hash<>pos.h133_payload_hash(v_backup.payload) or not v_backup.verified_restorable then
    raise exception 'INVENTORY_V3_BACKUP_NOT_RESTORABLE';
  end if;
  perform set_config('pos.h133_internal','on',true);
  update pos.inventory_contract_state set enforced=false,updated_at=now() where singleton;
  delete from pos.barcode_aliases where operation_id=v_backup.operation_id;
  delete from pos.inventory_v1_v2_map where operation_id=v_backup.operation_id;
  delete from pos.products where id in(select jsonb_array_elements_text(v_backup.payload->'target_product_ids'));
  for v_row in select value from jsonb_array_elements(v_backup.payload->'products') loop
    insert into pos.products select (jsonb_populate_record(null::pos.products,v_row)).*
    on conflict(id) do update set
      cat=excluded.cat,manga=excluded.manga,tela=excluded.tela,color=excluded.color,cuello=excluded.cuello,
      modelo=excluded.modelo,nombre=excluded.nombre,orn=excluded.orn,orn_colors=excluded.orn_colors,
      precio=excluded.precio,pop=excluded.pop,stock=excluded.stock,imagen=excluded.imagen,sku=excluded.sku,
      barcode_urls=excluded.barcode_urls,updated_at=excluded.updated_at,costo=excluded.costo,attrs=excluded.attrs,
      sync_version=excluded.sync_version,sync_base_version=excluded.sync_base_version,
      sync_device_id=excluded.sync_device_id,deleted_at=excluded.deleted_at,precios_talla=excluded.precios_talla,
      record_model=excluded.record_model,size_category_id=excluded.size_category_id,size_code=excluded.size_code,
      size_scale=excluded.size_scale,stock_quantity=excluded.stock_quantity,barcode_code=excluded.barcode_code,
      ornament_color_codes=excluded.ornament_color_codes,physical_signature=excluded.physical_signature,
      physical_identity_locked=excluded.physical_identity_locked,reference_family_id=excluded.reference_family_id,
      barcode_contract=excluded.barcode_contract,barcode_aliases=excluded.barcode_aliases;
  end loop;
  update pos.system_manifest s set data_epoch=(v_backup.payload->'system_manifest'->>'data_epoch')::bigint,
    schema_version=(v_backup.payload->'system_manifest'->>'schema_version')::bigint,
    sync_protocol_min=(v_backup.payload->'system_manifest'->>'sync_protocol_min')::integer,
    sync_protocol_current=(v_backup.payload->'system_manifest'->>'sync_protocol_current')::integer,
    updated_at=now() where singleton returning data_epoch into v_epoch;
  update pos.inventory_contract_state set contract_version=2,enforced=false,operation_id=null,
    manifest_hash=null,activated_at=null,updated_at=now() where singleton;
  update pos.inventory_v3_backups set restored_at=now() where backup_id=p_backup_id;
  update pos.inventory_v3_operations set status='restored',data_epoch_after=v_epoch,
    result=result||jsonb_build_object('restored_at',now()) where operation_id=v_backup.operation_id;
  return jsonb_build_object('ok',true,'backup_id',p_backup_id,'operation_id',v_backup.operation_id,
    'data_epoch',v_epoch,'restored_products',jsonb_array_length(v_backup.payload->'products'));
end;
$$;

create or replace function pos.h133_execute_inventory_v3(
  p_operation_id uuid,p_manifest jsonb,p_existing jsonb,p_manifest_hash text,
  p_expected_v1_products integer,p_expected_v1_references integer,
  p_expected_v1_pieces integer,p_expected_v2_products integer,p_expected_v2_pieces integer
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pos,auth as $$
declare
  v_plan jsonb; v_hash text; v_payload jsonb; v_payload_hash text; v_backup_id uuid;
  v_before_epoch bigint; v_after_epoch bigint; v_result jsonb; v_now timestamptz:=statement_timestamp();
  v_row record; v_count integer; v_pieces bigint;
begin
  if p_operation_id is null or jsonb_typeof(p_manifest)<>'array' or jsonb_typeof(p_existing)<>'array' then
    raise exception 'INVENTORY_V3_MANIFEST_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.h133-inventory-v3',0));
  lock table pos.products in share row exclusive mode;
  if exists(select 1 from pos.inventory_v3_operations where operation_id=p_operation_id) then
    return (select result||jsonb_build_object('idempotent',true) from pos.inventory_v3_operations where operation_id=p_operation_id);
  end if;
  v_plan:=jsonb_build_object('existing',p_existing,'migrated',p_manifest);
  v_hash:=pos.h133_payload_hash(v_plan);
  if v_hash<>coalesce(p_manifest_hash,'') then raise exception 'INVENTORY_V3_MANIFEST_HASH_MISMATCH'; end if;
  if jsonb_array_length(p_manifest)<>p_expected_v1_references
     or jsonb_array_length(p_existing)<>p_expected_v2_products then raise exception 'INVENTORY_V3_MANIFEST_COUNT_MISMATCH'; end if;
  if (select coalesce(sum(queue_pending),0)+coalesce(sum(queue_blocked),0) from pos.sync_devices)<>0 then
    raise exception 'INVENTORY_V3_QUEUE_NOT_DRAINED';
  end if;
  if exists(select 1 from pos.sales where estado='Apartado')
     or exists(select 1 from pos.loan_documents) then raise exception 'INVENTORY_V3_OPEN_OPERATION'; end if;
  select data_epoch into strict v_before_epoch from pos.system_manifest where singleton for update;
  if (select count(*) from pos.products where deleted_at is null and record_model='v1')<>p_expected_v1_products then
    raise exception 'INVENTORY_V3_V1_PRODUCT_CENSUS_CHANGED';
  end if;
  select count(*),coalesce(sum((e->>'stock')::integer),0) into v_count,v_pieces
  from pos.products p cross join lateral jsonb_array_elements(p.stock)e
  where p.deleted_at is null and p.record_model='v1' and (e->>'stock')::integer>0;
  if v_count<>(select count(*) from jsonb_array_elements(p_manifest)m where (m->>'stock')::integer>0)
     or v_pieces<>p_expected_v1_pieces then raise exception 'INVENTORY_V3_V1_STOCK_CENSUS_CHANGED'; end if;
  if (select count(*) from pos.products where deleted_at is null and record_model='v2')<>p_expected_v2_products
     or (select coalesce(sum(stock_quantity),0) from pos.products where deleted_at is null and record_model='v2')<>p_expected_v2_pieces then
    raise exception 'INVENTORY_V3_V2_CENSUS_CHANGED';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_manifest) m(sourceProductId text,sizeScale text,rawSizeValue text,
      sourceSyncVersion bigint,stock integer,targetProductId text,barcodeCode text,physicalSignature text,
      sizeCategoryId text,visibleSku text,referenceFamilyId uuid)
    left join pos.products p on p.id=m.sourceProductId and p.deleted_at is null and p.record_model='v1'
    left join lateral(select e from jsonb_array_elements(p.stock)e where e->>'talla'=m.rawSizeValue
      and coalesce(e->>'escala','')=coalesce(m.sizeScale,'') limit 1)s on true
    where p.id is null or p.sync_version<>m.sourceSyncVersion or s.e is null
       or (s.e->>'stock')::integer<>m.stock or m.targetProductId !~* '^[a-f0-9-]{36}$'
       or m.barcodeCode<>pos.h133_barcode_v3_from_id(m.targetProductId)
       or nullif(m.physicalSignature,'') is null or nullif(m.sizeCategoryId,'') is null
  ) then raise exception 'INVENTORY_V3_SOURCE_OR_TARGET_CHANGED'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_existing)e(productId text,sourceSyncVersion bigint,oldBarcode text,
      newBarcode text,stock integer,physicalSignature text)
    left join pos.products p on p.id=e.productId and p.deleted_at is null and p.record_model='v2'
    where p.id is null or p.sync_version<>e.sourceSyncVersion or p.barcode_code<>e.oldBarcode
       or p.stock_quantity<>e.stock or p.physical_signature<>e.physicalSignature
       or e.newBarcode<>pos.h133_barcode_v3_from_id(e.productId)
  ) then raise exception 'INVENTORY_V3_EXISTING_V2_CHANGED'; end if;
  if (select count(*) from (select m->>'targetProductId' id from jsonb_array_elements(p_manifest)m
      union select e->>'productId' from jsonb_array_elements(p_existing)e)x)
     <>jsonb_array_length(p_manifest)+jsonb_array_length(p_existing)
     or exists(select 1 from pos.products p where p.id in(select m->>'targetProductId' from jsonb_array_elements(p_manifest)m)) then
    raise exception 'INVENTORY_V3_ID_COLLISION';
  end if;
  if (select count(*) from (select m->>'barcodeCode' code from jsonb_array_elements(p_manifest)m
      union select e->>'newBarcode' from jsonb_array_elements(p_existing)e)x)
     <>jsonb_array_length(p_manifest)+jsonb_array_length(p_existing) then raise exception 'INVENTORY_V3_BARCODE_COLLISION'; end if;

  v_payload:=jsonb_build_object(
    'format','balam-inventory-v3-backup-v1','operation_id',p_operation_id,'manifest_hash',v_hash,
    'products',(select jsonb_agg(to_jsonb(p) order by p.id) from pos.products p where p.deleted_at is null),
    'target_product_ids',(select jsonb_agg(m->>'targetProductId' order by m->>'targetProductId') from jsonb_array_elements(p_manifest)m),
    'system_manifest',(select to_jsonb(s) from pos.system_manifest s where singleton),
    'sync_devices',(select coalesce(jsonb_agg(to_jsonb(d) order by d.device_id),'[]'::jsonb) from pos.sync_devices d),
    'plan',v_plan);
  v_payload_hash:=pos.h133_payload_hash(v_payload);
  insert into pos.inventory_v3_backups(operation_id,manifest_hash,payload_hash,payload,verified_restorable)
  values(p_operation_id,v_hash,v_payload_hash,v_payload,
    jsonb_array_length(v_payload->'products')=p_expected_v1_products+p_expected_v2_products
    and jsonb_array_length(v_payload->'target_product_ids')=p_expected_v1_references)
  returning backup_id into v_backup_id;
  if not (select verified_restorable and payload_hash=pos.h133_payload_hash(payload)
      from pos.inventory_v3_backups where backup_id=v_backup_id) then raise exception 'INVENTORY_V3_BACKUP_NOT_RESTORABLE'; end if;

  perform set_config('pos.h133_internal','on',true);
  insert into pos.barcode_aliases(alias_code,product_id,contract_version,source,operation_id)
  select e.oldBarcode,e.productId,2,'v2-current-before-v3',p_operation_id
  from jsonb_to_recordset(p_existing)e(productId text,oldBarcode text)
  where nullif(e.oldBarcode,'') is not null;
  update pos.products p set barcode_aliases=jsonb_build_array(e.oldBarcode),barcode_code=e.newBarcode,
    barcode_contract=3,sync_version=p.sync_version+1,sync_base_version=null,
    sync_device_id='inventory-v3:'||p_operation_id,updated_at=v_now
  from jsonb_to_recordset(p_existing)e(productId text,oldBarcode text,newBarcode text)
  where p.id=e.productId;

  insert into pos.products(id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,pop,
    stock,imagen,sku,barcode_urls,attrs,precios_talla,sync_version,sync_base_version,sync_device_id,deleted_at,
    record_model,size_category_id,size_code,size_scale,stock_quantity,barcode_code,ornament_color_codes,
    physical_signature,physical_identity_locked,reference_family_id,barcode_contract,barcode_aliases)
  select m.targetProductId,p.cat,p.manga,p.tela,p.color,p.cuello,p.modelo,p.nombre,p.orn,p.orn_colors,
    m.listPrice,p.costo,p.pop,jsonb_build_array(jsonb_build_object('talla',m.rawSizeValue,'escala',m.sizeScale,'stock',m.stock)),
    p.imagen,m.visibleSku,'{}'::jsonb,p.attrs||jsonb_build_object('__sizeCategoryId',m.sizeCategoryId,
      '__legacyVisibleSku',m.visibleSku,'__migratedFromV1',p.id),'{}'::jsonb,1,null,
    'inventory-v3:'||p_operation_id,null,'v2',m.sizeCategoryId,m.rawSizeValue,m.sizeScale,m.stock,
    m.barcodeCode,coalesce(m.ornamentColorCodes,'[]'::jsonb),m.physicalSignature,m.stock>0,
    m.referenceFamilyId,3,'[]'::jsonb
  from jsonb_to_recordset(p_manifest)m(sourceProductId text,sizeScale text,rawSizeValue text,stock integer,
    visibleSku text,listPrice numeric,sizeCategoryId text,ornamentColorCodes jsonb,physicalSignature text,
    targetProductId text,referenceFamilyId uuid,barcodeCode text)
  join pos.products p on p.id=m.sourceProductId;

  insert into pos.inventory_v1_v2_map(source_v1_product_id,size_scale,raw_size_value,target_v2_product_id,
    source_stock,historical_only,operation_id)
  select m.sourceProductId,m.sizeScale,m.rawSizeValue,m.targetProductId,m.stock,coalesce(m.historicalOnly,false),p_operation_id
  from jsonb_to_recordset(p_manifest)m(sourceProductId text,sizeScale text,rawSizeValue text,targetProductId text,
    stock integer,historicalOnly boolean);

  update pos.products p set stock=(select jsonb_agg(e.value||jsonb_build_object('stock',0) order by e.ordinality)
      from jsonb_array_elements(p.stock) with ordinality e(value,ordinality)),deleted_at=v_now,
    sync_version=p.sync_version+1,sync_base_version=null,sync_device_id='inventory-v3:'||p_operation_id,updated_at=v_now
  where p.deleted_at is null and p.record_model='v1';

  if exists(select 1 from pos.products where deleted_at is null and record_model='v1')
     or (select count(*) from pos.products where deleted_at is null and record_model='v2')
        <>p_expected_v2_products+p_expected_v1_references
     or (select coalesce(sum(stock_quantity),0) from pos.products where deleted_at is null and record_model='v2')
        <>p_expected_v1_pieces+p_expected_v2_pieces
     or exists(select barcode_code from pos.products where deleted_at is null and record_model='v2'
       group by barcode_code having count(*)>1)
     or exists(select physical_signature from pos.products where deleted_at is null and record_model='v2'
       group by physical_signature having count(*)>1) then raise exception 'INVENTORY_V3_POST_CENSUS_FAILED'; end if;

  alter table pos.products validate constraint products_v2_shape_check;
  update pos.inventory_contract_state set contract_version=3,enforced=true,operation_id=p_operation_id,
    manifest_hash=v_hash,activated_at=v_now,updated_at=v_now where singleton;
  update pos.system_manifest set data_epoch=data_epoch+1,schema_version=greatest(schema_version,20260830017300),
    sync_protocol_min=3,sync_protocol_current=3,updated_at=now() where singleton returning data_epoch into v_after_epoch;
  update pos.sync_devices set status='must_rebootstrap',data_epoch=v_after_epoch,
    queue_pending=0,queue_blocked=0 where device_id is not null;
  v_result:=jsonb_build_object('ok',true,'operation_id',p_operation_id,'backup_id',v_backup_id,
    'manifest_hash',v_hash,'data_epoch_before',v_before_epoch,'data_epoch_after',v_after_epoch,
    'migrated_references',p_expected_v1_references,'existing_v2_rebarcoded',p_expected_v2_products,
    'active_v2',p_expected_v1_references+p_expected_v2_products,
    'pieces',p_expected_v1_pieces+p_expected_v2_pieces,'v1_active',0,'protocol',3,'barcode_contract',3);
  insert into pos.inventory_v3_operations(operation_id,backup_id,manifest_hash,status,
    data_epoch_before,data_epoch_after,result)
  values(p_operation_id,v_backup_id,v_hash,'completed',v_before_epoch,v_after_epoch,v_result);
  return v_result;
end;
$$;

-- Los documentos históricos conservan su product_id V1. Para una devolución
-- o el lado devuelto de un cambio, sólo el efecto operativo se traduce por la
-- clave exacta producto+escala+talla. Nunca se busca por SKU.
create or replace function pos.h133_operational_items(p_items jsonb,p_exchange boolean default false)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pos as $$
declare v_result jsonb;
begin
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'INVALID_REFERENCE_ITEMS'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_items)i join pos.products p on p.id=i->>'product_id'
    where p.record_model='v1' and p_exchange and coalesce(i->>'lado','')<>'devuelto'
  ) then raise exception 'V1_OPERATIONAL_FORBIDDEN'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_items)i join pos.products p on p.id=i->>'product_id'
    left join pos.inventory_v1_v2_map m on m.source_v1_product_id=p.id
      and m.raw_size_value=i->>'talla'
      and (m.size_scale=coalesce(i->>'size_scale',m.size_scale))
    where p.record_model='v1' and m.target_v2_product_id is null
  ) then raise exception 'HISTORICAL_REFERENCE_MAP_MISSING'; end if;
  select coalesce(jsonb_agg(
    case when p.record_model='v1' then i||jsonb_build_object(
      'source_product_id',p.id,'product_id',m.target_v2_product_id,
      'barcode_code',target.barcode_code,'size_scale',m.size_scale)
    else i end order by ordinality),'[]'::jsonb) into v_result
  from jsonb_array_elements(p_items) with ordinality x(i,ordinality)
  left join pos.products p on p.id=i->>'product_id'
  left join pos.inventory_v1_v2_map m on m.source_v1_product_id=p.id and m.raw_size_value=i->>'talla'
  left join pos.products target on target.id=m.target_v2_product_id;
  return v_result;
end;
$$;

alter function pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)
  rename to h133_commit_return_delegate;
alter function pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)
  rename to h133_commit_exchange_delegate;

create or replace function pos.commit_return_checked(p_commit_id text,p_return jsonb,p_items jsonb,p_moves jsonb,
  p_stock_lines jsonb,p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb,
  p_legacy boolean default false)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
declare v_items jsonb;v_stock jsonb;
begin
  v_items:=pos.h133_operational_items(p_items,false);
  v_stock:=pos.h133_operational_items(p_stock_lines,false);
  return pos.h133_commit_return_delegate(p_commit_id,p_return,v_items,p_moves,v_stock,
    p_client_effect,p_seller_effects,p_legacy);
end;
$$;

create or replace function pos.commit_exchange_checked(p_commit_id text,p_exchange jsonb,p_items jsonb,
  p_moves jsonb default '[]'::jsonb,p_payment jsonb default null,p_seller_effects jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
begin
  return pos.h133_commit_exchange_delegate(p_commit_id,p_exchange,
    pos.h133_operational_items(p_items,true),p_moves,p_payment,p_seller_effects);
end;
$$;

revoke all on function pos.h133_operational_items(jsonb,boolean),
  pos.h133_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.h133_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb)
from public,anon,authenticated;
revoke all on function pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

revoke all on table pos.inventory_contract_state,pos.barcode_aliases,pos.inventory_v1_v2_map,
  pos.inventory_v3_backups,pos.inventory_v3_operations from public,anon,authenticated;
revoke all on function pos.h133_barcode_v3_from_id(text),pos.h133_internal_enabled(),
  pos.h133_payload_hash(jsonb),pos.h133_execute_inventory_v3(uuid,jsonb,jsonb,text,integer,integer,integer,integer,integer)
  from public,anon,authenticated;
revoke all on function pos.h133_restore_inventory_v3_backup(uuid) from public,anon;
grant execute on function pos.h133_restore_inventory_v3_backup(uuid) to authenticated;

comment on table pos.barcode_aliases is 'Aliases exactos e inmutables; nunca resuelven por SKU.';
comment on table pos.inventory_v1_v2_map is 'Mapa histórico exacto V1 producto+escala+talla -> referencia V2.';

commit;
