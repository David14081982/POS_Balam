-- H-83: evidencia documental de ornamento y colores efectivos por talla.
-- El dato editable del producto permanece en products.attrs; estas columnas
-- son snapshots inmutables del renglón comercial, no otra fuente del producto.
begin;

alter table pos.sale_items
  add column if not exists ornamento text,
  add column if not exists orn_colors jsonb;
alter table pos.return_items
  add column if not exists ornamento text,
  add column if not exists orn_colors jsonb;
alter table pos.exchange_items
  add column if not exists ornamento text,
  add column if not exists orn_colors jsonb;

alter table pos.sale_items drop constraint if exists sale_items_orn_colors_array;
alter table pos.sale_items add constraint sale_items_orn_colors_array
  check (orn_colors is null or jsonb_typeof(orn_colors) = 'array');
alter table pos.return_items drop constraint if exists return_items_orn_colors_array;
alter table pos.return_items add constraint return_items_orn_colors_array
  check (orn_colors is null or jsonb_typeof(orn_colors) = 'array');
alter table pos.exchange_items drop constraint if exists exchange_items_orn_colors_array;
alter table pos.exchange_items add constraint exchange_items_orn_colors_array
  check (orn_colors is null or jsonb_typeof(orn_colors) = 'array');

comment on column pos.sale_items.ornamento is
  'H-83: ornamento congelado al vender; null identifica documentos anteriores.';
comment on column pos.sale_items.orn_colors is
  'H-83: códigos canónicos efectivos para la talla al vender; no se recalculan.';
comment on column pos.return_items.orn_colors is
  'H-83: copia de la evidencia usada por la devolución.';
comment on column pos.exchange_items.orn_colors is
  'H-83: evidencia congelada de la pieza entregada o recibida en el cambio.';

create or replace function pos.h83_assert_ornament_items(p_items jsonb)
returns void
language plpgsql
immutable
set search_path = pos, pg_temp
as $$
declare
  v_item jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_ornament_snapshot_items';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item ? 'ornamento'
       and v_item -> 'ornamento' <> 'null'::jsonb
       and jsonb_typeof(v_item -> 'ornamento') <> 'string' then
      raise exception 'invalid_ornament_snapshot';
    end if;
    if v_item ? 'orn_colors' and v_item -> 'orn_colors' <> 'null'::jsonb then
      if jsonb_typeof(v_item -> 'orn_colors') <> 'array' then
        raise exception 'invalid_ornament_color_snapshot';
      end if;
      if exists(select 1
        from jsonb_array_elements(v_item -> 'orn_colors') as color(value)
        where jsonb_typeof(color.value) <> 'string') then
        raise exception 'invalid_ornament_color_snapshot';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function pos.h83_persist_sale_ornaments(
  p_folio text, p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.h83_assert_ornament_items(p_items);
  with incoming as (
    select value as item,
      row_number() over (
        partition by coalesce(value ->> 'product_id', ''),
          coalesce(value ->> 'sku', ''), coalesce(value ->> 'talla', '')
        order by ordinality
      ) as occurrence
    from jsonb_array_elements(p_items) with ordinality
    where value ? 'ornamento' or value ? 'orn_colors'
  ), stored as (
    select id, product_id::text as product_id, sku, talla,
      row_number() over (
        partition by coalesce(product_id::text, ''), coalesce(sku, ''), coalesce(talla, '')
        order by id
      ) as occurrence
    from pos.sale_items where folio = p_folio
  )
  update pos.sale_items target set
    ornamento = case when incoming.item ? 'ornamento'
      then incoming.item ->> 'ornamento' else target.ornamento end,
    orn_colors = case when incoming.item ? 'orn_colors'
      then incoming.item -> 'orn_colors' else target.orn_colors end
  from incoming join stored on
    coalesce(stored.product_id, '') = coalesce(incoming.item ->> 'product_id', '') and
    coalesce(stored.sku, '') = coalesce(incoming.item ->> 'sku', '') and
    coalesce(stored.talla, '') = coalesce(incoming.item ->> 'talla', '') and
    stored.occurrence = incoming.occurrence
  where target.id = stored.id;
end;
$$;

create or replace function pos.h83_persist_return_ornaments(
  p_return_id text, p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.h83_assert_ornament_items(p_items);
  with incoming as (
    select value as item,
      row_number() over (
        partition by coalesce(value ->> 'product_id', ''),
          coalesce(value ->> 'sku', ''), coalesce(value ->> 'talla', '')
        order by ordinality
      ) as occurrence
    from jsonb_array_elements(p_items) with ordinality
    where value ? 'ornamento' or value ? 'orn_colors'
  ), stored as (
    select id, product_id::text as product_id, sku, talla,
      row_number() over (
        partition by coalesce(product_id::text, ''), coalesce(sku, ''), coalesce(talla, '')
        order by id
      ) as occurrence
    from pos.return_items where return_id = p_return_id
  )
  update pos.return_items target set
    ornamento = case when incoming.item ? 'ornamento'
      then incoming.item ->> 'ornamento' else target.ornamento end,
    orn_colors = case when incoming.item ? 'orn_colors'
      then incoming.item -> 'orn_colors' else target.orn_colors end
  from incoming join stored on
    coalesce(stored.product_id, '') = coalesce(incoming.item ->> 'product_id', '') and
    coalesce(stored.sku, '') = coalesce(incoming.item ->> 'sku', '') and
    coalesce(stored.talla, '') = coalesce(incoming.item ->> 'talla', '') and
    stored.occurrence = incoming.occurrence
  where target.id = stored.id;
end;
$$;

create or replace function pos.h83_persist_exchange_ornaments(
  p_exchange_id text, p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.h83_assert_ornament_items(p_items);
  with incoming as (
    select value as item,
      row_number() over (
        partition by coalesce(value ->> 'lado', ''),
          coalesce(value ->> 'product_id', ''), coalesce(value ->> 'sku', ''),
          coalesce(value ->> 'talla', '') order by ordinality
      ) as occurrence
    from jsonb_array_elements(p_items) with ordinality
    where value ? 'ornamento' or value ? 'orn_colors'
  ), stored as (
    select id, lado, product_id::text as product_id, sku, talla,
      row_number() over (
        partition by coalesce(lado, ''), coalesce(product_id::text, ''),
          coalesce(sku, ''), coalesce(talla, '') order by id
      ) as occurrence
    from pos.exchange_items where exchange_id = p_exchange_id
  )
  update pos.exchange_items target set
    ornamento = case when incoming.item ? 'ornamento'
      then incoming.item ->> 'ornamento' else target.ornamento end,
    orn_colors = case when incoming.item ? 'orn_colors'
      then incoming.item -> 'orn_colors' else target.orn_colors end
  from incoming join stored on
    coalesce(stored.lado, '') = coalesce(incoming.item ->> 'lado', '') and
    coalesce(stored.product_id, '') = coalesce(incoming.item ->> 'product_id', '') and
    coalesce(stored.sku, '') = coalesce(incoming.item ->> 'sku', '') and
    coalesce(stored.talla, '') = coalesce(incoming.item ->> 'talla', '') and
    stored.occurrence = incoming.occurrence
  where target.id = stored.id;
end;
$$;

revoke all on function pos.h83_assert_ornament_items(jsonb),
  pos.h83_persist_sale_ornaments(text,jsonb),
  pos.h83_persist_return_ornaments(text,jsonb),
  pos.h83_persist_exchange_ornaments(text,jsonb)
from public, anon, authenticated;

-- Se conservan los nombres RPC públicos. Sus implementaciones vigentes se
-- renombran como delegados internos y la nueva frontera añade el snapshot en
-- la misma transacción solamente después de un resultado comercial exitoso.
alter function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h83_commit_sale_delegate;
alter function pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h83_commit_sale_with_additional_discount_delegate;
alter function pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)
  rename to h83_commit_return_delegate;
alter function pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)
  rename to h83_commit_exchange_delegate;

revoke all on function
  pos.h83_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.h83_commit_sale_with_additional_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.h83_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.h83_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb)
from public, anon, authenticated;

create or replace function pos.commit_sale_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h83_commit_sale_delegate(p_commit_id, p_operation_id, p_sale,
    p_items, p_moves, p_payments, p_stock_lines, p_reserve_stock,
    p_client_effect, p_seller_effects);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform pos.h83_persist_sale_ornaments(p_sale ->> 'folio', p_items);
  end if;
  return v_result;
end;
$$;

create or replace function pos.commit_sale_with_additional_discount_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h83_commit_sale_with_additional_discount_delegate(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, p_reserve_stock, p_client_effect, p_seller_effects);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform pos.h83_persist_sale_ornaments(p_sale ->> 'folio', p_items);
  end if;
  return v_result;
end;
$$;

create or replace function pos.commit_return_checked(
  p_commit_id text, p_return jsonb, p_items jsonb, p_moves jsonb,
  p_stock_lines jsonb, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb, p_legacy boolean default false
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h83_commit_return_delegate(p_commit_id, p_return, p_items,
    p_moves, p_stock_lines, p_client_effect, p_seller_effects, p_legacy);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform pos.h83_persist_return_ornaments(p_return ->> 'id', p_items);
  end if;
  return v_result;
end;
$$;

create or replace function pos.commit_exchange_checked(
  p_commit_id text, p_exchange jsonb, p_items jsonb,
  p_moves jsonb default '[]'::jsonb, p_payment jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h83_commit_exchange_delegate(p_commit_id, p_exchange, p_items,
    p_moves, p_payment, p_seller_effects);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform pos.h83_persist_exchange_ornaments(p_exchange ->> 'id', p_items);
  end if;
  return v_result;
end;
$$;

revoke all on function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)
from public, anon;
grant execute on function
  pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean),
  pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)
to authenticated;

update pos.system_manifest
set schema_version = greatest(schema_version, 20260808012600), updated_at = now()
where singleton;

commit;
