-- POS Balam — H-04: devolución completa, transaccional e idempotente.

begin;

alter table pos.return_items
  add column if not exists product_id text;

alter table pos.movements
  add column if not exists return_id text;

create index if not exists movements_return_id_idx
  on pos.movements (return_id)
  where return_id is not null;

create table if not exists pos.return_commits (
  commit_id    text primary key,
  return_id    text not null,
  folio        text not null,
  payload_hash text not null,
  actor_email  text,
  created_at   timestamptz not null default now()
);

alter table pos.return_commits enable row level security;
drop policy if exists active_admin_select on pos.return_commits;
create policy active_admin_select on pos.return_commits
  for select to authenticated
  using (pos.is_active_admin());

grant select on pos.return_commits to authenticated;
grant all on pos.return_commits to service_role;

create or replace function pos.commit_return(
  p_commit_id text,
  p_return jsonb,
  p_items jsonb,
  p_moves jsonb,
  p_stock_lines jsonb,
  p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb,
  p_legacy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_return_id text := p_return ->> 'id';
  v_folio text := p_return ->> 'folio';
  v_payload_hash text;
  v_prior pos.return_commits%rowtype;
  v_sale_state text;
  v_products jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_sellers jsonb := '[]'::jsonb;
  v_shortages jsonb;
  v_rec record;
  v_stock_row jsonb;
  v_client_id text;
  v_client_base bigint;
  v_client_delta numeric;
  v_client_after numeric;
  v_effect record;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para registrar devoluciones'
      using errcode = '42501';
  end if;

  if nullif(trim(p_commit_id), '') is null
     or nullif(trim(v_return_id), '') is null
     or nullif(trim(v_folio), '') is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_typeof(p_moves) <> 'array'
     or jsonb_typeof(p_stock_lines) <> 'array'
     or jsonb_typeof(p_seller_effects) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items)
        as x(return_id text, product_id text, sku text, talla text, qty integer)
     where x.return_id is distinct from v_return_id
        or nullif(trim(x.sku), '') is null
        or nullif(trim(x.talla), '') is null
        or x.qty is null
        or x.qty <= 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'return', p_return, 'items', p_items, 'moves', p_moves,
    'stock_lines', p_stock_lines, 'client_effect', p_client_effect,
    'seller_effects', p_seller_effects, 'legacy', coalesce(p_legacy, false)
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_commit_id));

  select * into v_prior
    from pos.return_commits
   where commit_id = p_commit_id;

  if found then
    if v_prior.payload_hash <> v_payload_hash
       or v_prior.return_id <> v_return_id
       or v_prior.folio <> v_folio then
      return jsonb_build_object('ok', false, 'error', 'commit_mismatch');
    end if;
    select estado into v_sale_state from pos.sales where folio = v_folio;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      into v_products from pos.products p
     where p.id in (
       select x.product_id from jsonb_to_recordset(p_stock_lines)
         as x(product_id text, talla text, qty integer)
     );
    if p_client_effect is not null then
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        into v_clients from pos.clients c
       where c.id = p_client_effect ->> 'id';
    end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
      into v_sellers from pos.sellers s
     where s.id in (
       select x.id from jsonb_to_recordset(p_seller_effects)
         as x(id text, ventas_mes_delta numeric, comision_acum_delta numeric)
     );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'sale_state', v_sale_state,
      'products', v_products, 'clients', v_clients, 'sellers', v_sellers
    );
  end if;

  -- Serializa todas las devoluciones del mismo folio.
  perform 1 from pos.sales where folio = v_folio for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if exists (select 1 from pos.returns where id = v_return_id)
     and not coalesce(p_legacy, false) then
    return jsonb_build_object('ok', false, 'error', 'return_id_conflict');
  end if;

  -- La autoridad de cantidades es la venta remota menos devoluciones remotas.
  with requested as (
    select x.sku, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_items)
        as x(return_id text, product_id text, sku text, talla text, qty integer)
     group by x.sku, x.talla
  ),
  sold as (
    select sku, talla, sum(qty)::integer as qty
      from pos.sale_items
     where folio = v_folio
     group by sku, talla
  ),
  returned as (
    select ri.sku, ri.talla, sum(ri.qty)::integer as qty
      from pos.return_items ri
      join pos.returns r on r.id = ri.return_id
     where r.folio = v_folio and r.id <> v_return_id
     group by ri.sku, ri.talla
  )
  select jsonb_agg(jsonb_build_object(
           'sku', q.sku, 'talla', q.talla, 'requested', q.qty,
           'available', greatest(coalesce(s.qty, 0) - coalesce(r.qty, 0), 0)
         ) order by q.sku, q.talla)
    into v_shortages
    from requested q
    left join sold s using (sku, talla)
    left join returned r using (sku, talla)
   where q.qty > greatest(coalesce(s.qty, 0) - coalesce(r.qty, 0), 0);

  if v_shortages is not null then
    return jsonb_build_object(
      'ok', false, 'error', 'invalid_return_quantity',
      'items', v_shortages
    );
  end if;

  if coalesce((p_return ->> 'total')::numeric, 0)
     + coalesce((
       select sum(total) from pos.returns
        where folio = v_folio and id <> v_return_id
     ), 0)
     > coalesce((select total from pos.sales where folio = v_folio), 0) + 0.01 then
    return jsonb_build_object('ok', false, 'error', 'refund_exceeds_sale');
  end if;

  if not coalesce(p_legacy, false) then
    if jsonb_array_length(p_stock_lines) = 0
       or (select coalesce(sum(x.qty), 0) from jsonb_to_recordset(p_stock_lines)
             as x(product_id text, talla text, qty integer))
          <> (select coalesce(sum(x.qty), 0) from jsonb_to_recordset(p_items)
                as x(return_id text, product_id text, sku text, talla text, qty integer)) then
      return jsonb_build_object('ok', false, 'error', 'invalid_stock_lines');
    end if;

    perform p.id
      from pos.products p
     where p.id in (
       select distinct x.product_id
         from jsonb_to_recordset(p_stock_lines)
           as x(product_id text, talla text, qty integer)
     )
     order by p.id
     for update;

    with lines as (
      select x.product_id, x.talla, sum(x.qty)::integer as qty
        from jsonb_to_recordset(p_stock_lines)
          as x(product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select jsonb_agg(jsonb_build_object(
             'product_id', l.product_id, 'talla', l.talla,
             'reason', case when p.id is null then 'product_not_found'
                            else 'size_not_found' end
           ) order by l.product_id, l.talla)
      into v_shortages
      from lines l
      left join pos.products p
        on p.id = l.product_id and p.deleted_at is null
     where p.id is null
        or not exists (
          select 1 from jsonb_array_elements(p.stock) e
           where e ->> 'talla' = l.talla
        );

    if v_shortages is not null then
      return jsonb_build_object(
        'ok', false, 'error', 'invalid_stock_target', 'items', v_shortages
      );
    end if;

    for v_rec in
      with lines as (
        select x.product_id, x.talla, sum(x.qty)::integer as qty
          from jsonb_to_recordset(p_stock_lines)
            as x(product_id text, talla text, qty integer)
         group by x.product_id, x.talla
      )
      select l.product_id, l.talla, l.qty,
             (e.value ->> 'stock')::integer as available,
             e.ordinality::integer - 1 as stock_index
        from lines l
        join pos.products p on p.id = l.product_id
        cross join lateral jsonb_array_elements(p.stock)
          with ordinality as e(value, ordinality)
       where e.value ->> 'talla' = l.talla
       order by l.product_id, l.talla
    loop
      update pos.products p
         set stock = jsonb_set(
               p.stock, array[v_rec.stock_index::text, 'stock'],
               to_jsonb(v_rec.available + v_rec.qty), false
             ),
             sync_base_version = p.sync_version,
             sync_device_id = 'return:' || p_commit_id
       where p.id = v_rec.product_id
       returning to_jsonb(p.*) into v_stock_row;
    end loop;
  end if;

  insert into pos.returns (
    id, folio, cliente, vendedores, metodo, total, notas, fecha
  ) values (
    v_return_id, v_folio, p_return ->> 'cliente',
    coalesce(p_return -> 'vendedores', '[]'::jsonb),
    p_return ->> 'metodo', coalesce((p_return ->> 'total')::numeric, 0),
    p_return ->> 'notas', p_return ->> 'fecha'
  )
  on conflict (id) do update set
    folio = excluded.folio,
    cliente = excluded.cliente,
    vendedores = excluded.vendedores,
    metodo = excluded.metodo,
    total = excluded.total,
    notas = excluded.notas,
    fecha = excluded.fecha,
    updated_at = now();

  delete from pos.return_items where return_id = v_return_id;
  insert into pos.return_items (
    return_id, product_id, sku, nombre, talla, qty, motivo, precio
  )
  select v_return_id, x.product_id, x.sku, x.nombre, x.talla,
         x.qty, x.motivo, x.precio
    from jsonb_to_recordset(p_items) as x(
      return_id text, product_id text, sku text, nombre text, talla text,
      qty integer, motivo text, precio numeric
    );

  if coalesce(p_legacy, false) then
    delete from pos.movements where ref = v_folio and tipo = 'Devolución';
  else
    delete from pos.movements where return_id = v_return_id;
  end if;
  insert into pos.movements (
    return_id, fecha, tipo, producto, sku, cant, ref
  )
  select case when coalesce(p_legacy, false) then null else v_return_id end,
         x.fecha::timestamptz, 'Devolución', x.producto, x.sku, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(return_id text, fecha text, tipo text, producto text, sku text, cant integer, ref text);

  select case when exists (
    with sold as (
      select sku, talla, sum(qty)::integer as qty
        from pos.sale_items where folio = v_folio group by sku, talla
    ),
    returned as (
      select ri.sku, ri.talla, sum(ri.qty)::integer as qty
        from pos.return_items ri
        join pos.returns r on r.id = ri.return_id
       where r.folio = v_folio group by ri.sku, ri.talla
    )
    select 1 from sold s
    left join returned r using (sku, talla)
    where coalesce(r.qty, 0) < s.qty
  ) then 'Devolución parcial' else 'Devuelto' end
    into v_sale_state;

  update pos.sales
     set estado = v_sale_state, updated_at = now()
   where folio = v_folio;

  if not coalesce(p_legacy, false) and p_client_effect is not null then
    v_client_id := p_client_effect ->> 'id';
    v_client_base := coalesce((p_client_effect ->> 'base_version')::bigint, 0);
    v_client_delta := coalesce((p_client_effect ->> 'total_delta')::numeric, 0);
    v_client_after := (p_client_effect ->> 'after_total')::numeric;
    update pos.clients
       set total = case
             when sync_version = v_client_base + 1 and total = v_client_after
             then total else greatest(0, total + v_client_delta) end,
           sync_base_version = sync_version,
           sync_device_id = 'return:' || p_commit_id
     where id = v_client_id and deleted_at is null;
    if not found then
      raise exception 'Cliente de la devolución no existe'
        using errcode = 'P0001';
    end if;
  end if;

  if not coalesce(p_legacy, false) then
    for v_effect in
      select * from jsonb_to_recordset(p_seller_effects) as x(
        id text, base_version bigint, ventas_mes_delta numeric,
        comision_acum_delta numeric, after_ventas_mes numeric,
        after_comision_acum numeric
      )
    loop
      update pos.sellers
         set ventas_mes = case
               when sync_version = coalesce(v_effect.base_version, 0) + 1
                and ventas_mes = v_effect.after_ventas_mes
                and comision_acum = v_effect.after_comision_acum
               then ventas_mes else greatest(0, ventas_mes + coalesce(v_effect.ventas_mes_delta, 0)) end,
             comision_acum = case
               when sync_version = coalesce(v_effect.base_version, 0) + 1
                and ventas_mes = v_effect.after_ventas_mes
                and comision_acum = v_effect.after_comision_acum
               then comision_acum else greatest(0, comision_acum + coalesce(v_effect.comision_acum_delta, 0)) end,
             sync_base_version = sync_version,
             sync_device_id = 'return:' || p_commit_id
       where id = v_effect.id and active = true and deleted_at is null;
      if not found then
        raise exception 'Vendedor de la devolución no existe o está inactivo'
          using errcode = 'P0001';
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_products from pos.products p
   where p.id in (
     select x.product_id from jsonb_to_recordset(p_stock_lines)
       as x(product_id text, talla text, qty integer)
   );
  if p_client_effect is not null then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      into v_clients from pos.clients c
     where c.id = p_client_effect ->> 'id';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(p_seller_effects)
       as x(id text, ventas_mes_delta numeric, comision_acum_delta numeric)
   );

  insert into pos.return_commits (
    commit_id, return_id, folio, payload_hash, actor_email
  ) values (
    p_commit_id, v_return_id, v_folio, v_payload_hash, auth.jwt() ->> 'email'
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'sale_state', v_sale_state,
    'products', v_products, 'clients', v_clients, 'sellers', v_sellers
  );
end;
$$;

revoke all on function pos.commit_return(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) from public;
grant execute on function pos.commit_return(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) to authenticated;

commit;
