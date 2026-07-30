-- H-56 Fase 5 grupo 3: ajustes y bajas de inventario.
begin;

create or replace function pos.save_products_checked(
  p_operation_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_rows, 'null'::jsonb)::text);
  v_prior jsonb;
  v_result jsonb;
begin
  perform pos.require_current_capability('inventory.adjust');
  if p_operation_id is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'INVALID_INVENTORY_BATCH' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  select result into v_prior from pos.capability_operation_audit
   where operation_id = p_operation_id and capability_key = 'inventory.adjust'
     and payload_hash = v_hash;
  if found then return v_prior; end if;
  if exists (select 1 from pos.capability_operation_audit where operation_id = p_operation_id) then
    raise exception 'INVENTORY_OPERATION_CONFLICT' using errcode = '40001';
  end if;

  insert into pos.products(
    id, cat, manga, tela, color, cuello, modelo, nombre, orn, orn_colors,
    precio, costo, pop, stock, imagen, sku, barcode_urls, attrs,
    precios_talla, sync_base_version, sync_device_id
  )
  select x.id, x.cat, x.manga, x.tela, x.color, coalesce(x.cuello, 'NOR'),
         x.modelo, x.nombre, coalesce(x.orn, '—'), coalesce(x.orn_colors, '[]'),
         coalesce(x.precio, 0), coalesce(x.costo, 0), coalesce(x.pop, false),
         coalesce(x.stock, '[]'), x.imagen, x.sku,
         coalesce(x.barcode_urls, '{}'), coalesce(x.attrs, '{}'),
         coalesce(x.precios_talla, '{}'), x.sync_base_version, x.sync_device_id
  from jsonb_to_recordset(p_rows) as x(
    id text, cat text, manga text, tela text, color text, cuello text,
    modelo text, nombre text, orn text, orn_colors jsonb, precio numeric,
    costo numeric, pop boolean, stock jsonb, imagen text, sku text,
    barcode_urls jsonb, attrs jsonb, precios_talla jsonb,
    sync_base_version bigint, sync_device_id text
  )
  on conflict (id) do update set
    cat=excluded.cat, manga=excluded.manga, tela=excluded.tela,
    color=excluded.color, cuello=excluded.cuello, modelo=excluded.modelo,
    nombre=excluded.nombre, orn=excluded.orn, orn_colors=excluded.orn_colors,
    precio=excluded.precio, costo=excluded.costo, pop=excluded.pop,
    stock=excluded.stock, imagen=excluded.imagen, sku=excluded.sku,
    barcode_urls=excluded.barcode_urls, attrs=excluded.attrs,
    precios_talla=excluded.precios_talla,
    sync_base_version=excluded.sync_base_version,
    sync_device_id=excluded.sync_device_id;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_result from pos.products p
   where p.id in (select x.id from jsonb_to_recordset(p_rows) as x(id text));
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, payload_hash, result
  ) values (p_operation_id, 'inventory.adjust', v_actor, v_hash, v_result);
  return v_result;
end;
$$;

create or replace function pos.delete_product_checked(
  p_operation_id uuid, p_id text, p_base_version bigint, p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(jsonb_build_array(p_id,p_base_version,p_device_id)::text);
  v_result jsonb;
begin
  perform pos.require_current_capability('inventory.delete');
  if p_operation_id is null or nullif(trim(p_id), '') is null then
    raise exception 'INVALID_INVENTORY_DELETE' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  select result into v_result from pos.capability_operation_audit
   where operation_id=p_operation_id and capability_key='inventory.delete'
     and payload_hash=v_hash;
  if found then return v_result; end if;
  if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id) then
    raise exception 'INVENTORY_OPERATION_CONFLICT' using errcode='40001';
  end if;
  update pos.products set deleted_at=now(), sync_base_version=coalesce(p_base_version,0),
         sync_device_id=p_device_id where id=p_id returning to_jsonb(pos.products.*) into v_result;
  if v_result is null then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key, payload_hash, result
  ) values (p_operation_id,'inventory.delete',v_actor,p_id,v_hash,v_result);
  return v_result;
end;
$$;

revoke insert, update, delete, truncate on pos.products from authenticated;
revoke all on function pos.save_products_checked(uuid,jsonb) from public, anon;
revoke all on function pos.delete_product_checked(uuid,text,bigint,text) from public, anon;
grant execute on function pos.save_products_checked(uuid,jsonb) to authenticated;
grant execute on function pos.delete_product_checked(uuid,text,bigint,text) to authenticated;

commit;
