-- H-101: familia administrativa para captura/edición masiva V2.
-- No altera identidad física, logística o comercial y no convierte V1.
begin;

alter table pos.products
  add column if not exists reference_family_id uuid;

-- Sin evidencia autoritativa, cada V2 existente nace como familia singleton.
update pos.products
set reference_family_id = gen_random_uuid()
where record_model = 'v2' and reference_family_id is null;

create or replace function pos.h101_ensure_reference_family()
returns trigger language plpgsql set search_path = pos, pg_temp as $$
begin
  if new.record_model = 'v2' and new.reference_family_id is null then
    new.reference_family_id := gen_random_uuid();
  elsif new.record_model = 'v1' then
    new.reference_family_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists h101_ensure_reference_family on pos.products;
create trigger h101_ensure_reference_family
before insert or update of record_model,reference_family_id on pos.products
for each row execute function pos.h101_ensure_reference_family();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='products_v2_reference_family_check') then
    alter table pos.products add constraint products_v2_reference_family_check
      check ((record_model='v1' and reference_family_id is null)
          or (record_model='v2' and reference_family_id is not null));
  end if;
end $$;

create index if not exists pos_products_reference_family_idx
  on pos.products(reference_family_id, size_category_id, size_code)
  where record_model='v2' and deleted_at is null;

create or replace function pos.commit_reference_family_batch(
  p_operation_id uuid,
  p_reference_family_id uuid,
  p_rows jsonb,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pos as $$
declare
  v_hash text := md5(jsonb_build_object('family',p_reference_family_id,'rows',p_rows)::text);
  v_prior jsonb; v_before jsonb; v_after jsonb; v_ids text[];
begin
  perform pos.assert_sync_write_context(p_protocol_version,p_data_epoch);
  perform pos.require_current_capability('inventory.adjust');
  if p_operation_id is null or p_reference_family_id is null
     or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'INVALID_REFERENCE_FAMILY_BATCH' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
      where coalesce(r->>'record_model','')<>'v2'
         or nullif(r->>'id','') is null
         or (r->>'reference_family_id')::uuid<>p_reference_family_id) then
    raise exception 'REFERENCE_FAMILY_SCOPE_MISMATCH' using errcode='22023';
  end if;
  select array_agg(r->>'id' order by r->>'id') into v_ids from jsonb_array_elements(p_rows) r;
  if cardinality(v_ids)<>jsonb_array_length(p_rows)
     or cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'PRODUCT_SCOPE_INVALID' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  select result into v_prior from pos.capability_operation_audit
   where operation_id=p_operation_id and capability_key='inventory.adjust' and payload_hash=v_hash;
  if found then return v_prior; end if;
  if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id) then
    raise exception 'INVENTORY_OPERATION_CONFLICT' using errcode='40001';
  end if;

  perform 1 from pos.products where id=any(v_ids) order by id for update;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into v_before
    from pos.products p where p.id=any(v_ids);

  insert into pos.products(
    id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,pop,
    stock,imagen,sku,barcode_urls,attrs,precios_talla,sync_base_version,sync_device_id,
    record_model,size_category_id,size_code,size_scale,stock_quantity,barcode_code,
    ornament_color_codes,physical_signature,reference_family_id
  )
  select x.id,x.cat,x.manga,x.tela,x.color,coalesce(x.cuello,'NOR'),x.modelo,x.nombre,
    coalesce(x.orn,'—'),coalesce(x.orn_colors,'[]'),coalesce(x.precio,0),coalesce(x.costo,0),
    coalesce(x.pop,false),coalesce(x.stock,'[]'),x.imagen,x.sku,coalesce(x.barcode_urls,'{}'),
    coalesce(x.attrs,'{}'),coalesce(x.precios_talla,'{}'),x.sync_base_version,x.sync_device_id,
    'v2',x.size_category_id,x.size_code,x.size_scale,x.stock_quantity,x.barcode_code,
    coalesce(x.ornament_color_codes,'[]'),x.physical_signature,x.reference_family_id
  from jsonb_to_recordset(p_rows) as x(
    id text,cat text,manga text,tela text,color text,cuello text,modelo text,nombre text,
    orn text,orn_colors jsonb,precio numeric,costo numeric,pop boolean,stock jsonb,imagen text,
    sku text,barcode_urls jsonb,attrs jsonb,precios_talla jsonb,sync_base_version bigint,
    sync_device_id text,record_model text,size_category_id text,size_code text,size_scale text,
    stock_quantity integer,barcode_code text,ornament_color_codes jsonb,physical_signature text,
    reference_family_id uuid
  )
  on conflict(id) do update set
    cat=excluded.cat,manga=excluded.manga,tela=excluded.tela,color=excluded.color,
    cuello=excluded.cuello,modelo=excluded.modelo,nombre=excluded.nombre,orn=excluded.orn,
    orn_colors=excluded.orn_colors,precio=excluded.precio,costo=excluded.costo,pop=excluded.pop,
    stock=excluded.stock,imagen=excluded.imagen,sku=excluded.sku,barcode_urls=excluded.barcode_urls,
    attrs=excluded.attrs,precios_talla=excluded.precios_talla,
    sync_base_version=excluded.sync_base_version,sync_device_id=excluded.sync_device_id,
    size_category_id=excluded.size_category_id,size_code=excluded.size_code,size_scale=excluded.size_scale,
    stock_quantity=excluded.stock_quantity,ornament_color_codes=excluded.ornament_color_codes,
    physical_signature=excluded.physical_signature,reference_family_id=excluded.reference_family_id;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into v_after
    from pos.products p where p.id=any(v_ids);
  v_prior := jsonb_build_object('ok',true,'operationId',p_operation_id,
    'referenceFamilyId',p_reference_family_id,'productIds',to_jsonb(v_ids),
    'before',v_before,'rows',v_after);
  insert into pos.capability_operation_audit(
    operation_id,capability_key,actor_user_id,subject_key,payload_hash,result
  ) values(p_operation_id,'inventory.adjust',auth.uid(),p_reference_family_id::text,v_hash,v_prior);
  return v_prior;
end;
$$;

revoke all on function pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint) from public,anon;
grant execute on function pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint) to authenticated;

update pos.system_manifest
set schema_version=greatest(schema_version,20260814014300),updated_at=now()
where singleton;

commit;
