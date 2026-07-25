-- POS Balam — Migración 017: reserva atómica e idempotente de stock por venta.

begin;

alter table pos.sale_items
  add column if not exists product_id text;

create table if not exists pos.stock_reservations (
  operation_id text primary key,
  folio        text not null,
  lines        jsonb not null,
  actor_email  text,
  created_at   timestamptz not null default now()
);

alter table pos.stock_reservations enable row level security;
drop policy if exists active_admin_select on pos.stock_reservations;
create policy active_admin_select on pos.stock_reservations
  for select to authenticated
  using (pos.is_active_admin());

grant select on pos.stock_reservations to authenticated;
grant all on pos.stock_reservations to service_role;

-- El vendedor ya no puede alterar stock con PATCH directo. Toda salida de una
-- venta debe atravesar reserve_sale_stock(), que bloquea y valida las filas.
drop policy if exists seller_update on pos.products;

create or replace function pos.reserve_sale_stock(
  p_operation_id text,
  p_folio text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  prior pos.stock_reservations%rowtype;
  shortages jsonb;
  rec record;
  updated_row jsonb;
  updated_products jsonb := '[]'::jsonb;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para reservar inventario'
      using errcode = '42501';
  end if;

  if nullif(trim(p_operation_id), '') is null
     or nullif(trim(p_folio), '') is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_lines)
        as x(product_id text, talla text, qty integer)
     where nullif(trim(x.product_id), '') is null
        or nullif(trim(x.talla), '') is null
        or x.qty is null
        or x.qty <= 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  -- Serializa reintentos de la misma operación antes de consultar idempotencia.
  perform pg_advisory_xact_lock(hashtext(p_operation_id));

  select * into prior
    from pos.stock_reservations
   where operation_id = p_operation_id;

  if found then
    if prior.folio <> p_folio or prior.lines <> p_lines then
      return jsonb_build_object('ok', false, 'error', 'operation_mismatch');
    end if;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      into updated_products
      from pos.products p
     where p.id in (
       select distinct x.product_id
         from jsonb_to_recordset(p_lines)
           as x(product_id text, talla text, qty integer)
     );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'operation_id', p_operation_id,
      'products', updated_products
    );
  end if;

  -- El orden estable evita deadlocks cuando dos ventas incluyen varios modelos.
  perform p.id
    from pos.products p
   where p.id in (
     select distinct x.product_id
       from jsonb_to_recordset(p_lines)
         as x(product_id text, talla text, qty integer)
   )
   order by p.id
   for update;

  with requested as (
    select x.product_id, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_lines)
        as x(product_id text, talla text, qty integer)
     group by x.product_id, x.talla
  ),
  availability as (
    select r.*,
           p.id is not null as product_exists,
           coalesce((
             select (elem ->> 'stock')::integer
               from jsonb_array_elements(p.stock) elem
              where elem ->> 'talla' = r.talla
              limit 1
           ), 0) as available
      from requested r
      left join pos.products p
        on p.id = r.product_id and p.deleted_at is null
  )
  select jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'talla', talla,
           'requested', qty,
           'available', available,
           'reason', case when not product_exists then 'product_not_found'
                          else 'insufficient_stock' end
         ) order by product_id, talla)
    into shortages
    from availability
   where not product_exists or available < qty;

  if shortages is not null then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_stock', 'shortages', shortages
    );
  end if;

  for rec in
    with requested as (
      select x.product_id, x.talla, sum(x.qty)::integer as qty
        from jsonb_to_recordset(p_lines)
          as x(product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select r.product_id, r.talla, r.qty,
           (elem.value ->> 'stock')::integer as available,
           elem.ordinality::integer - 1 as stock_index
      from requested r
      join pos.products p on p.id = r.product_id
      cross join lateral jsonb_array_elements(p.stock)
        with ordinality as elem(value, ordinality)
     where elem.value ->> 'talla' = r.talla
     order by r.product_id, r.talla
  loop
    update pos.products p
       set stock = jsonb_set(
             p.stock,
             array[rec.stock_index::text, 'stock'],
             to_jsonb(rec.available - rec.qty),
             false
           ),
           sync_base_version = p.sync_version,
           sync_device_id = 'sale:' || p_operation_id
     where p.id = rec.product_id
     returning to_jsonb(p.*) into updated_row;

  end loop;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into updated_products
    from pos.products p
   where p.id in (
     select distinct x.product_id
       from jsonb_to_recordset(p_lines)
         as x(product_id text, talla text, qty integer)
   );

  insert into pos.stock_reservations (
    operation_id, folio, lines, actor_email
  ) values (
    p_operation_id, p_folio, p_lines, auth.jwt() ->> 'email'
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'operation_id', p_operation_id,
    'products', updated_products
  );
end;
$$;

revoke all on function pos.reserve_sale_stock(text, text, jsonb) from public;
grant execute on function pos.reserve_sale_stock(text, text, jsonb)
  to authenticated;

commit;
