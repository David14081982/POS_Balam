-- H-94: modelo aditivo de referencias físicas V2.
-- No convierte filas V1 ni reparte sus existencias: sólo habilita nuevos escritores.
begin;

alter table pos.products
  add column if not exists record_model text not null default 'v1',
  add column if not exists size_category_id text,
  add column if not exists size_code text,
  add column if not exists size_scale text,
  add column if not exists stock_quantity integer,
  add column if not exists barcode_code text,
  add column if not exists ornament_color_codes jsonb,
  add column if not exists physical_signature text,
  add column if not exists physical_identity_locked boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_record_model_check') then
    alter table pos.products add constraint products_record_model_check
      check (record_model in ('v1', 'v2'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_v2_shape_check') then
    alter table pos.products add constraint products_v2_shape_check check (
      record_model = 'v1' or (
        nullif(trim(size_category_id), '') is not null and
        nullif(trim(size_code), '') is not null and
        stock_quantity is not null and stock_quantity >= 0 and
        nullif(trim(barcode_code), '') is not null and
        barcode_code ~ '^[A-Z0-9]{8,24}$' and
        jsonb_typeof(ornament_color_codes) = 'array' and
        nullif(trim(physical_signature), '') is not null
      )
    );
  end if;
end $$;

create unique index if not exists pos_products_v2_barcode_code_uq
  on pos.products (barcode_code)
  where record_model = 'v2';
create unique index if not exists pos_products_v2_physical_signature_uq
  on pos.products (physical_signature)
  where record_model = 'v2' and deleted_at is null;
create index if not exists pos_products_record_model_idx
  on pos.products (record_model, size_category_id, size_code);

-- V2 mantiene un espejo de una sola fila en stock[] para que un cliente V1
-- pueda leerlo y las RPC transitorias sigan funcionando. La autoridad es el escalar.
create or replace function pos.h94_sync_v2_stock_shape()
returns trigger language plpgsql set search_path = pos, pg_temp as $$
declare v_from_legacy integer;
begin
  if new.record_model <> 'v2' then return new; end if;
  if tg_op = 'UPDATE' and new.stock is distinct from old.stock
     and new.stock_quantity is not distinct from old.stock_quantity then
    select coalesce(sum(greatest(0, coalesce((entry ->> 'stock')::integer, 0))), 0)::integer
      into v_from_legacy
      from jsonb_array_elements(coalesce(new.stock, '[]'::jsonb)) entry
     where entry ->> 'talla' = new.size_code;
    new.stock_quantity := v_from_legacy;
  end if;
  new.stock_quantity := greatest(0, coalesce(new.stock_quantity, 0));
  new.physical_identity_locked := case when tg_op = 'INSERT'
    then coalesce(new.physical_identity_locked, false) or new.stock_quantity > 0
    else coalesce(old.physical_identity_locked, false)
      or coalesce(new.physical_identity_locked, false) or new.stock_quantity > 0 end;
  new.ornament_color_codes := coalesce(new.ornament_color_codes, '[]'::jsonb);
  new.stock := jsonb_build_array(jsonb_build_object(
    'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
    'stock', new.stock_quantity
  ));
  return new;
end;
$$;

drop trigger if exists h94_sync_v2_stock_shape on pos.products;
create trigger h94_sync_v2_stock_shape
before insert or update of stock, stock_quantity, size_code, size_scale, record_model, physical_identity_locked
on pos.products for each row execute function pos.h94_sync_v2_stock_shape();

-- La autoridad checked de inventario anterior sólo conocía columnas V1. Se
-- amplía en el mismo punto de escritura; de otro modo Supabase aceptaría el
-- lote pero lo reconstruiría como V1, perdiendo barcode/firma/talla escalar.
create or replace function pos.save_products_checked(p_operation_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_rows, 'null'::jsonb)::text);
  v_prior jsonb; v_result jsonb;
begin
  perform pos.require_current_capability('inventory.adjust');
  if p_operation_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'INVALID_INVENTORY_BATCH' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));
  select result into v_prior from pos.capability_operation_audit
   where operation_id=p_operation_id and capability_key='inventory.adjust' and payload_hash=v_hash;
  if found then return v_prior; end if;
  if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id) then
    raise exception 'INVENTORY_OPERATION_CONFLICT' using errcode='40001';
  end if;

  insert into pos.products(
    id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,pop,
    stock,imagen,sku,barcode_urls,attrs,precios_talla,sync_base_version,sync_device_id,
    record_model,size_category_id,size_code,size_scale,stock_quantity,barcode_code,
    ornament_color_codes,physical_signature
  )
  select x.id,x.cat,x.manga,x.tela,x.color,coalesce(x.cuello,'NOR'),x.modelo,x.nombre,
    coalesce(x.orn,'—'),coalesce(x.orn_colors,'[]'),coalesce(x.precio,0),coalesce(x.costo,0),
    coalesce(x.pop,false),coalesce(x.stock,'[]'),x.imagen,x.sku,coalesce(x.barcode_urls,'{}'),
    coalesce(x.attrs,'{}'),coalesce(x.precios_talla,'{}'),x.sync_base_version,x.sync_device_id,
    coalesce(x.record_model,'v1'),x.size_category_id,x.size_code,x.size_scale,x.stock_quantity,
    x.barcode_code,case when x.record_model='v2' then coalesce(x.ornament_color_codes,'[]') else x.ornament_color_codes end,
    x.physical_signature
  from jsonb_to_recordset(p_rows) as x(
    id text,cat text,manga text,tela text,color text,cuello text,modelo text,nombre text,
    orn text,orn_colors jsonb,precio numeric,costo numeric,pop boolean,stock jsonb,imagen text,
    sku text,barcode_urls jsonb,attrs jsonb,precios_talla jsonb,sync_base_version bigint,
    sync_device_id text,record_model text,size_category_id text,size_code text,size_scale text,
    stock_quantity integer,barcode_code text,ornament_color_codes jsonb,physical_signature text
  )
  on conflict(id) do update set
    cat=excluded.cat,manga=excluded.manga,tela=excluded.tela,color=excluded.color,
    cuello=excluded.cuello,modelo=excluded.modelo,nombre=excluded.nombre,orn=excluded.orn,
    orn_colors=excluded.orn_colors,precio=excluded.precio,costo=excluded.costo,pop=excluded.pop,
    stock=excluded.stock,imagen=excluded.imagen,sku=excluded.sku,barcode_urls=excluded.barcode_urls,
    attrs=excluded.attrs,precios_talla=excluded.precios_talla,
    sync_base_version=excluded.sync_base_version,sync_device_id=excluded.sync_device_id,
    record_model=excluded.record_model,size_category_id=excluded.size_category_id,
    size_code=excluded.size_code,size_scale=excluded.size_scale,stock_quantity=excluded.stock_quantity,
    barcode_code=excluded.barcode_code,ornament_color_codes=excluded.ornament_color_codes,
    physical_signature=excluded.physical_signature;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into v_result
    from pos.products p where p.id in(select x.id from jsonb_to_recordset(p_rows) as x(id text));
  insert into pos.capability_operation_audit(operation_id,capability_key,actor_user_id,payload_hash,result)
    values(p_operation_id,'inventory.adjust',v_actor,v_hash,v_result);
  return v_result;
end;
$$;

alter table pos.sale_items
  add column if not exists line_id text,
  add column if not exists barcode_code text,
  add column if not exists physical_attrs jsonb,
  add column if not exists list_price numeric(10,2),
  add column if not exists effective_price numeric(10,2),
  add column if not exists discount_snapshot jsonb;
create unique index if not exists pos_sale_items_line_id_uq
  on pos.sale_items(line_id) where line_id is not null;

alter table pos.return_items
  add column if not exists line_id text,
  add column if not exists source_sale_line_id text,
  add column if not exists barcode_code text,
  add column if not exists physical_attrs jsonb,
  add column if not exists list_price numeric(10,2),
  add column if not exists effective_price numeric(10,2),
  add column if not exists discount_snapshot jsonb;
create unique index if not exists pos_return_items_line_id_uq
  on pos.return_items(line_id) where line_id is not null;

alter table pos.exchange_items
  add column if not exists line_id text,
  add column if not exists source_sale_line_id text,
  add column if not exists barcode_code text,
  add column if not exists physical_attrs jsonb,
  add column if not exists list_price numeric(10,2),
  add column if not exists effective_price numeric(10,2),
  add column if not exists discount_snapshot jsonb;
create unique index if not exists pos_exchange_items_line_id_uq
  on pos.exchange_items(line_id) where line_id is not null;

alter table pos.movements
  add column if not exists product_id text,
  add column if not exists operation_id text;
create index if not exists pos_movements_product_id_idx on pos.movements(product_id);

-- Compuerta transaccional de despliegue. Se toma después de añadir la forma
-- aditiva H-94 (incluidas columnas que ya existían en algún remoto), pero antes
-- de cualquier autoridad ejecutable. Cualquier cambio posterior en una fila o
-- en su conteo aborta y revierte la migración completa.
create temporary table h94_preexisting_rows_baseline (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

insert into h94_preexisting_rows_baseline(relation_name, row_count, row_fingerprint)
select 'products', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text)), '')) from pos.products p
union all
select 'sale_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by md5(to_jsonb(s)::text)), '')) from pos.sale_items s
union all
select 'return_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by md5(to_jsonb(r)::text)), '')) from pos.return_items r
union all
select 'exchange_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by md5(to_jsonb(e)::text)), '')) from pos.exchange_items e
union all
select 'movements', count(*), md5(coalesce(string_agg(md5(to_jsonb(m)::text), ',' order by md5(to_jsonb(m)::text)), '')) from pos.movements m;

create table if not exists pos.reference_reclassifications (
  operation_id text primary key,
  source_product_id text not null references pos.products(id),
  target_product_id text not null references pos.products(id),
  quantity integer not null check (quantity > 0),
  actor text not null,
  actor_user_id uuid not null,
  reason text not null,
  reversed_by text references pos.reference_reclassifications(operation_id),
  reversal_of text references pos.reference_reclassifications(operation_id),
  created_at timestamptz not null default now(),
  check (source_product_id <> target_product_id)
);
alter table pos.reference_reclassifications enable row level security;
drop policy if exists reference_reclassifications_authenticated_read on pos.reference_reclassifications;
create policy reference_reclassifications_authenticated_read on pos.reference_reclassifications
  for select to authenticated using (true);

create or replace function pos.commit_reference_reclassification(
  p_operation_id text, p_source_product_id text, p_target_product_id text,
  p_quantity integer, p_actor text, p_reason text, p_reversal_of text default null
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare
  v_source pos.products%rowtype; v_target pos.products%rowtype;
  v_existing pos.reference_reclassifications%rowtype;
  v_original pos.reference_reclassifications%rowtype;
begin
  perform pos.require_current_capability('inventory.adjust');
  if nullif(trim(p_operation_id), '') is null or p_quantity <= 0
     or nullif(trim(p_actor), '') is null or nullif(trim(p_reason), '') is null then
    raise exception 'INVALID_RECLASSIFICATION';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id));
  select * into v_existing from pos.reference_reclassifications where operation_id=p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.source_product_id<>p_source_product_id or v_existing.target_product_id<>p_target_product_id
       or v_existing.quantity<>p_quantity or v_existing.reversal_of is distinct from p_reversal_of then
      raise exception 'RECLASSIFICATION_OPERATION_CONFLICT' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,'operation',to_jsonb(v_existing));
  end if;
  perform 1 from pos.products where id in(p_source_product_id,p_target_product_id) order by id for update;
  select * into v_source from pos.products where id=p_source_product_id and deleted_at is null;
  select * into v_target from pos.products where id=p_target_product_id and deleted_at is null;
  if v_source.id is null or v_target.id is null or v_source.record_model <> 'v2' or v_target.record_model <> 'v2' then
    raise exception 'REFERENCE_NOT_FOUND';
  end if;
  if v_source.stock_quantity < p_quantity then raise exception 'INSUFFICIENT_REFERENCE_STOCK'; end if;
  if p_reversal_of is not null then
    select * into v_original from pos.reference_reclassifications where operation_id=p_reversal_of for update;
    if v_original.operation_id is null or v_original.reversed_by is not null
       or v_original.source_product_id<>p_target_product_id
       or v_original.target_product_id<>p_source_product_id
       or v_original.quantity<>p_quantity then
      raise exception 'RECLASSIFICATION_NOT_REVERSIBLE';
    end if;
  end if;

  update pos.products set stock_quantity = stock_quantity - p_quantity where id = p_source_product_id;
  update pos.products set stock_quantity = stock_quantity + p_quantity where id = p_target_product_id;
  insert into pos.reference_reclassifications(
    operation_id, source_product_id, target_product_id, quantity, actor, actor_user_id, reason, reversal_of
  ) values (p_operation_id, p_source_product_id, p_target_product_id, p_quantity,
    trim(p_actor), auth.uid(), trim(p_reason), p_reversal_of);
  if p_reversal_of is not null then
    update pos.reference_reclassifications set reversed_by = p_operation_id where operation_id = p_reversal_of;
  end if;
  insert into pos.movements(fecha, tipo, producto, sku, talla, cant, ref, product_id, operation_id)
  values
    (now(), 'Reclasificación', v_source.nombre, v_source.sku, v_source.size_code, -p_quantity, p_reason, v_source.id, p_operation_id),
    (now(), 'Reclasificación', v_target.nombre, v_target.sku, v_target.size_code,  p_quantity, p_reason, v_target.id, p_operation_id);
  return jsonb_build_object('ok', true, 'idempotent', false, 'operation_id', p_operation_id,
    'source_stock', v_source.stock_quantity - p_quantity,
    'target_stock', v_target.stock_quantity + p_quantity);
end;
$$;

-- Protege la identidad física después de que una referencia tenga evidencia.
create or replace function pos.h94_guard_used_reference_identity()
returns trigger language plpgsql set search_path = pos, pg_temp as $$
begin
  if old.record_model is distinct from new.record_model then
    raise exception 'REFERENCE_MODEL_IMMUTABLE';
  end if;
  if old.record_model='v2' and new.barcode_code is distinct from old.barcode_code then
    raise exception 'BARCODE_IMMUTABLE';
  end if;
  if old.record_model = 'v2'
     and (new.physical_signature is distinct from old.physical_signature
       or new.cat is distinct from old.cat or new.manga is distinct from old.manga
       or new.tela is distinct from old.tela or new.color is distinct from old.color
       or new.cuello is distinct from old.cuello or new.modelo is distinct from old.modelo
       or new.orn is distinct from old.orn
       or new.ornament_color_codes is distinct from old.ornament_color_codes
       or new.size_category_id is distinct from old.size_category_id
       or new.size_code is distinct from old.size_code or new.size_scale is distinct from old.size_scale
       or new.attrs is distinct from old.attrs)
     and (coalesce(old.physical_identity_locked, false)
       or coalesce(old.stock_quantity, 0) <> 0
       or exists(select 1 from pos.sale_items where product_id = old.id)
       or exists(select 1 from pos.return_items where product_id = old.id)
       or exists(select 1 from pos.exchange_items where product_id = old.id)
       or exists(select 1 from pos.movements where product_id = old.id)
       or exists(select 1 from pos.reference_reclassifications where source_product_id = old.id or target_product_id = old.id)) then
    raise exception 'REFERENCE_RECLASSIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;
drop trigger if exists h94_guard_used_reference_identity on pos.products;
create trigger h94_guard_used_reference_identity
before update of record_model,barcode_code,physical_signature,cat,manga,tela,color,cuello,modelo,orn,
  ornament_color_codes,size_category_id,size_code,size_scale,attrs on pos.products
for each row execute function pos.h94_guard_used_reference_identity();

create or replace function pos.h94_assert_v2_document_items(p_items jsonb)
returns void language plpgsql stable set search_path = pos, pg_temp as $$
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_REFERENCE_ITEMS'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    join pos.products p on p.id = i ->> 'product_id' and p.record_model = 'v2'
    where nullif(trim(i ->> 'line_id'), '') is null
       or nullif(trim(i ->> 'barcode_code'), '') is null
       or i ->> 'barcode_code' <> p.barcode_code
  ) then raise exception 'V2_LINE_IDENTITY_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    join pos.products p on p.barcode_code=i->>'barcode_code' and p.record_model='v2' and p.deleted_at is null
    where nullif(trim(i->>'product_id'),'') is null or i->>'product_id'<>p.id
  ) then raise exception 'V2_PRODUCT_ID_REQUIRED'; end if;
end;
$$;

create or replace function pos.h94_persist_sale_references(p_folio text, p_items jsonb)
returns void language plpgsql set search_path = pos, pg_temp as $$
begin
  perform pos.h94_assert_v2_document_items(p_items);
  with incoming as (
    select value item, row_number() over (partition by coalesce(value ->> 'product_id',''), coalesce(value ->> 'sku',''), coalesce(value ->> 'talla','')) rn
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  ), stored as (
    select id, product_id::text product_id, sku, talla,
      row_number() over (partition by coalesce(product_id::text,''),coalesce(sku,''),coalesce(talla,'') order by id) rn
    from pos.sale_items where folio = p_folio
  )
  update pos.sale_items s set
    line_id = coalesce(i.item ->> 'line_id', s.line_id),
    barcode_code = coalesce(i.item ->> 'barcode_code', s.barcode_code),
    physical_attrs = coalesce(i.item -> 'physical_attrs', s.physical_attrs),
    list_price = coalesce((i.item ->> 'list_price')::numeric, s.list_price),
    effective_price = coalesce((i.item ->> 'effective_price')::numeric, s.precio),
    discount_snapshot = coalesce(i.item->'discount_snapshot',s.discount_snapshot)
  from incoming i join stored x on coalesce(x.product_id,'')=coalesce(i.item->>'product_id','')
    and coalesce(x.sku,'')=coalesce(i.item->>'sku','') and coalesce(x.talla,'')=coalesce(i.item->>'talla','') and x.rn=i.rn
  where s.id=x.id;
end;
$$;

create or replace function pos.h94_persist_return_references(p_id text, p_items jsonb)
returns void language plpgsql set search_path = pos, pg_temp as $$
begin
  perform pos.h94_assert_v2_document_items(p_items);
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i
    join pos.products p on p.id=i->>'product_id' and p.record_model='v2'
    where nullif(trim(i->>'source_sale_line_id'),'') is null
  ) then raise exception 'V2_SOURCE_LINE_ID_REQUIRED'; end if;
  with incoming as (
    select value item, row_number() over (partition by coalesce(value ->> 'product_id',''),coalesce(value ->> 'sku',''),coalesce(value ->> 'talla','')) rn
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  ), stored as (
    select id, product_id::text product_id, sku, talla,
      row_number() over (partition by coalesce(product_id::text,''),coalesce(sku,''),coalesce(talla,'') order by id) rn
    from pos.return_items where return_id=p_id
  )
  update pos.return_items s set line_id=coalesce(i.item->>'line_id',s.line_id),
    source_sale_line_id=coalesce(i.item->>'source_sale_line_id',s.source_sale_line_id),
    barcode_code=coalesce(i.item->>'barcode_code',s.barcode_code),
    physical_attrs=coalesce(i.item->'physical_attrs',s.physical_attrs),
    list_price=coalesce((i.item->>'list_price')::numeric,s.list_price),
    effective_price=coalesce((i.item->>'effective_price')::numeric,s.precio),
    discount_snapshot=coalesce(i.item->'discount_snapshot',s.discount_snapshot)
  from incoming i join stored x on coalesce(x.product_id,'')=coalesce(i.item->>'product_id','')
    and coalesce(x.sku,'')=coalesce(i.item->>'sku','') and coalesce(x.talla,'')=coalesce(i.item->>'talla','') and x.rn=i.rn
  where s.id=x.id;
end;
$$;

create or replace function pos.h94_persist_exchange_references(p_id text, p_items jsonb)
returns void language plpgsql set search_path = pos, pg_temp as $$
begin
  perform pos.h94_assert_v2_document_items(p_items);
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i
    join pos.products p on p.id=i->>'product_id' and p.record_model='v2'
    where i->>'lado'='devuelto' and nullif(trim(i->>'source_sale_line_id'),'') is null
  ) then raise exception 'V2_SOURCE_LINE_ID_REQUIRED'; end if;
  with incoming as (
    select value item, row_number() over (partition by coalesce(value ->> 'lado',''),coalesce(value ->> 'product_id',''),coalesce(value ->> 'sku',''),coalesce(value ->> 'talla','')) rn
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  ), stored as (
    select id,lado,product_id::text product_id,sku,talla,
      row_number() over (partition by coalesce(lado,''),coalesce(product_id::text,''),coalesce(sku,''),coalesce(talla,'') order by id) rn
    from pos.exchange_items where exchange_id=p_id
  )
  update pos.exchange_items s set line_id=coalesce(i.item->>'line_id',s.line_id),
    source_sale_line_id=coalesce(i.item->>'source_sale_line_id',s.source_sale_line_id),
    barcode_code=coalesce(i.item->>'barcode_code',s.barcode_code),
    physical_attrs=coalesce(i.item->'physical_attrs',s.physical_attrs),
    list_price=coalesce((i.item->>'list_price')::numeric,s.list_price),
    effective_price=coalesce((i.item->>'effective_price')::numeric,s.precio),
    discount_snapshot=coalesce(i.item->'discount_snapshot',s.discount_snapshot)
  from incoming i join stored x on coalesce(x.lado,'')=coalesce(i.item->>'lado','')
    and coalesce(x.product_id,'')=coalesce(i.item->>'product_id','')
    and coalesce(x.sku,'')=coalesce(i.item->>'sku','') and coalesce(x.talla,'')=coalesce(i.item->>'talla','') and x.rn=i.rn
  where s.id=x.id;
end;
$$;

-- Envuelve las autoridades vigentes sin copiar su lógica comercial.
alter function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h94_commit_sale_delegate;
alter function pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h94_commit_sale_with_discount_delegate;
alter function pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)
  rename to h94_commit_return_delegate;
alter function pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)
  rename to h94_commit_exchange_delegate;

-- Los delegados y helpers pertenecen a la envoltura: ningún cliente puede
-- saltarse las aserciones V2 llamándolos directamente.
revoke all on function pos.h94_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.h94_commit_sale_with_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.h94_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.h94_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb),
  pos.h94_assert_v2_document_items(jsonb),
  pos.h94_persist_sale_references(text,jsonb),
  pos.h94_persist_return_references(text,jsonb),
  pos.h94_persist_exchange_references(text,jsonb)
from public,anon,authenticated;

create or replace function pos.commit_sale_checked(p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$ declare r jsonb; begin
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_sale_delegate(p_commit_id,p_operation_id,p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_sale_references(p_sale->>'folio',p_items); end if; return r; end $$;
create or replace function pos.commit_sale_with_additional_discount_checked(p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$ declare r jsonb; begin
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_sale_with_discount_delegate(p_commit_id,p_operation_id,p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_sale_references(p_sale->>'folio',p_items); end if; return r; end $$;
create or replace function pos.commit_return_checked(p_commit_id text,p_return jsonb,p_items jsonb,p_moves jsonb,p_stock_lines jsonb,p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb,p_legacy boolean default false)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$ declare r jsonb; begin
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_return_delegate(p_commit_id,p_return,p_items,p_moves,p_stock_lines,p_client_effect,p_seller_effects,p_legacy);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_return_references(p_return->>'id',p_items); end if; return r; end $$;
create or replace function pos.commit_exchange_checked(p_commit_id text,p_exchange jsonb,p_items jsonb,p_moves jsonb default '[]'::jsonb,p_payment jsonb default null,p_seller_effects jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$ declare r jsonb; begin
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_exchange_delegate(p_commit_id,p_exchange,p_items,p_moves,p_payment,p_seller_effects);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_exchange_references(p_exchange->>'id',p_items); end if; return r; end $$;

revoke all on function pos.commit_reference_reclassification(text,text,text,integer,text,text,text) from public,anon;
grant execute on function pos.commit_reference_reclassification(text,text,text,integer,text,text,text) to authenticated;
revoke all on function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

do $$
declare
  v_mismatch text;
  v_snapshot record;
begin
  with current_rows(relation_name, row_count, row_fingerprint) as (
    select 'products', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by md5(to_jsonb(p)::text)), '')) from pos.products p
    union all
    select 'sale_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by md5(to_jsonb(s)::text)), '')) from pos.sale_items s
    union all
    select 'return_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by md5(to_jsonb(r)::text)), '')) from pos.return_items r
    union all
    select 'exchange_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by md5(to_jsonb(e)::text)), '')) from pos.exchange_items e
    union all
    select 'movements', count(*), md5(coalesce(string_agg(md5(to_jsonb(m)::text), ',' order by md5(to_jsonb(m)::text)), '')) from pos.movements m
  )
  select b.relation_name into v_mismatch
    from h94_preexisting_rows_baseline b
    join current_rows c using(relation_name)
   where b.row_count <> c.row_count or b.row_fingerprint <> c.row_fingerprint
   limit 1;
  if v_mismatch is not null then
    raise exception 'H94_PREEXISTING_DATA_CHANGED:%', v_mismatch;
  end if;
  for v_snapshot in select * from h94_preexisting_rows_baseline order by relation_name loop
    raise notice 'H94_V1_INTACT relation=% rows=% fingerprint=%',
      v_snapshot.relation_name, v_snapshot.row_count, v_snapshot.row_fingerprint;
  end loop;
end;
$$;

update pos.system_manifest set schema_version=greatest(schema_version,20260810013400),updated_at=now() where singleton;
commit;
