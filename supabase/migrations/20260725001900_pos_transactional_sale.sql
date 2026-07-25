-- POS Balam — H-04: venta completa, transaccional e idempotente.

begin;

create table if not exists pos.sale_commits (
  commit_id    text primary key,
  operation_id text not null,
  folio        text not null,
  payload_hash text not null,
  actor_email  text,
  created_at   timestamptz not null default now()
);

alter table pos.sale_commits enable row level security;
drop policy if exists active_admin_select on pos.sale_commits;
create policy active_admin_select on pos.sale_commits
  for select to authenticated
  using (pos.is_active_admin());

grant select on pos.sale_commits to authenticated;
grant all on pos.sale_commits to service_role;

create or replace function pos.commit_sale(
  p_commit_id text,
  p_operation_id text,
  p_sale jsonb,
  p_items jsonb,
  p_moves jsonb,
  p_payments jsonb,
  p_stock_lines jsonb,
  p_reserve_stock boolean,
  p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := p_sale ->> 'folio';
  v_payload_hash text;
  v_prior pos.sale_commits%rowtype;
  v_stock jsonb := jsonb_build_object('ok', true, 'products', '[]'::jsonb);
  v_products jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_sellers jsonb := '[]'::jsonb;
  v_client_id text;
  v_client_compras integer;
  v_client_total numeric;
  v_client_ultima date;
  v_client_base bigint;
  v_client_after_compras integer;
  v_client_after_total numeric;
  v_effect record;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para registrar ventas'
      using errcode = '42501';
  end if;

  if nullif(trim(p_commit_id), '') is null
     or nullif(trim(p_operation_id), '') is null
     or nullif(trim(v_folio), '') is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_typeof(p_moves) <> 'array'
     or jsonb_typeof(p_payments) <> 'array'
     or jsonb_typeof(p_stock_lines) <> 'array'
     or jsonb_typeof(p_seller_effects) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'operation_id', p_operation_id,
    'sale', p_sale,
    'items', p_items,
    'moves', p_moves,
    'payments', p_payments,
    'stock_lines', p_stock_lines,
    'reserve_stock', coalesce(p_reserve_stock, false),
    'client_effect', p_client_effect,
    'seller_effects', p_seller_effects
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_commit_id));

  select * into v_prior
    from pos.sale_commits
   where commit_id = p_commit_id;

  if found then
    if v_prior.payload_hash <> v_payload_hash
       or v_prior.operation_id <> p_operation_id
       or v_prior.folio <> v_folio then
      return jsonb_build_object('ok', false, 'error', 'commit_mismatch');
    end if;

    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      into v_products
      from pos.products p
     where p.id in (
       select distinct x.product_id
         from jsonb_to_recordset(p_stock_lines)
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
       select x.id
         from jsonb_to_recordset(p_seller_effects)
           as x(id text, ventas_mes_delta numeric, ventas_num_delta integer, comision_acum_delta numeric)
     );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'products', v_products,
      'clients', v_clients, 'sellers', v_sellers
    );
  end if;

  if exists (
    select 1 from pos.sales
     where folio = v_folio
       and operation_id is distinct from p_operation_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'folio_conflict');
  end if;

  if coalesce(p_reserve_stock, false) then
    v_stock := pos.reserve_sale_stock(p_operation_id, v_folio, p_stock_lines);
    if not coalesce((v_stock ->> 'ok')::boolean, false) then
      return v_stock;
    end if;
    v_products := coalesce(v_stock -> 'products', '[]'::jsonb);
  end if;

  insert into pos.sales (
    folio, operation_id, fecha, cliente_id, cliente, vendedores, metodo, estado,
    items, subtotal, iva, total, iva_pct, iva_included, anticipo, saldo,
    pago_efectivo, pago_otro, descuento, valor_regalado
  ) values (
    v_folio, p_operation_id, (p_sale ->> 'fecha')::timestamptz,
    nullif(p_sale ->> 'cliente_id', ''), p_sale ->> 'cliente',
    coalesce(p_sale -> 'vendedores', '[]'::jsonb), p_sale ->> 'metodo',
    p_sale ->> 'estado', coalesce((p_sale ->> 'items')::integer, 0),
    (p_sale ->> 'subtotal')::numeric, (p_sale ->> 'iva')::numeric,
    coalesce((p_sale ->> 'total')::numeric, 0), (p_sale ->> 'iva_pct')::numeric,
    (p_sale ->> 'iva_included')::boolean, (p_sale ->> 'anticipo')::numeric,
    (p_sale ->> 'saldo')::numeric, (p_sale ->> 'pago_efectivo')::numeric,
    (p_sale ->> 'pago_otro')::numeric, (p_sale ->> 'descuento')::numeric,
    coalesce((p_sale ->> 'valor_regalado')::numeric, 0)
  )
  on conflict (folio) do update set
    operation_id = excluded.operation_id,
    fecha = excluded.fecha,
    cliente_id = excluded.cliente_id,
    cliente = excluded.cliente,
    vendedores = excluded.vendedores,
    metodo = excluded.metodo,
    estado = excluded.estado,
    items = excluded.items,
    subtotal = excluded.subtotal,
    iva = excluded.iva,
    total = excluded.total,
    iva_pct = excluded.iva_pct,
    iva_included = excluded.iva_included,
    anticipo = excluded.anticipo,
    saldo = excluded.saldo,
    pago_efectivo = excluded.pago_efectivo,
    pago_otro = excluded.pago_otro,
    descuento = excluded.descuento,
    valor_regalado = excluded.valor_regalado,
    updated_at = now();

  delete from pos.sale_items where folio = v_folio;
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original
  )
  select v_folio, x.product_id, x.sku, x.nombre, x.talla, x.qty,
         x.precio, x.precio_base, x.precio_original
    from jsonb_to_recordset(p_items) as x(
      folio text, product_id text, sku text, nombre text, talla text,
      qty integer, precio numeric, precio_base numeric, precio_original numeric
    );

  delete from pos.movements where ref = v_folio and tipo = 'Venta';
  insert into pos.movements (fecha, tipo, producto, sku, cant, ref)
  select x.fecha::timestamptz, x.tipo, x.producto, x.sku, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(fecha text, tipo text, producto text, sku text, cant integer, ref text);

  delete from pos.sale_payments where folio = v_folio;
  insert into pos.sale_payments (
    id, folio, fecha, tipo, metodo, monto, efectivo, tarjeta, transferencia, otro
  )
  select x.id, v_folio, x.fecha, x.tipo, x.metodo, x.monto,
         x.efectivo, x.tarjeta, x.transferencia, x.otro
    from jsonb_to_recordset(p_payments) as x(
      id text, folio text, fecha text, tipo text, metodo text, monto numeric,
      efectivo numeric, tarjeta numeric, transferencia numeric, otro numeric
    );

  if p_client_effect is not null then
    v_client_id := p_client_effect ->> 'id';
    v_client_compras := coalesce((p_client_effect ->> 'compras_delta')::integer, 0);
    v_client_total := coalesce((p_client_effect ->> 'total_delta')::numeric, 0);
    v_client_ultima := (p_client_effect ->> 'ultima')::date;
    v_client_base := coalesce((p_client_effect ->> 'base_version')::bigint, 0);
    v_client_after_compras := (p_client_effect ->> 'after_compras')::integer;
    v_client_after_total := (p_client_effect ->> 'after_total')::numeric;
    update pos.clients
       set compras = case
             when sync_version = v_client_base + 1
              and compras = v_client_after_compras
              and total = v_client_after_total
             then compras else compras + v_client_compras end,
           total = case
             when sync_version = v_client_base + 1
              and compras = v_client_after_compras
              and total = v_client_after_total
             then total else total + v_client_total end,
           ultima = coalesce(v_client_ultima, ultima),
           sync_base_version = sync_version,
           sync_device_id = 'sale:' || p_commit_id
     where id = v_client_id and deleted_at is null;
    if not found then
      raise exception 'Cliente de la venta no existe'
        using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      into v_clients from pos.clients c where c.id = v_client_id;
  end if;

  for v_effect in
    select *
      from jsonb_to_recordset(p_seller_effects) as x(
        id text, ventas_mes_delta numeric, ventas_num_delta integer,
        comision_acum_delta numeric, base_version bigint,
        after_ventas_mes numeric, after_ventas_num integer,
        after_comision_acum numeric
      )
  loop
    update pos.sellers
       set ventas_mes = case
             when sync_version = coalesce(v_effect.base_version, 0) + 1
              and ventas_mes = v_effect.after_ventas_mes
              and ventas_num = v_effect.after_ventas_num
              and comision_acum = v_effect.after_comision_acum
             then ventas_mes else ventas_mes + coalesce(v_effect.ventas_mes_delta, 0) end,
           ventas_num = case
             when sync_version = coalesce(v_effect.base_version, 0) + 1
              and ventas_mes = v_effect.after_ventas_mes
              and ventas_num = v_effect.after_ventas_num
              and comision_acum = v_effect.after_comision_acum
             then ventas_num else ventas_num + coalesce(v_effect.ventas_num_delta, 0) end,
           comision_acum = case
             when sync_version = coalesce(v_effect.base_version, 0) + 1
              and ventas_mes = v_effect.after_ventas_mes
              and ventas_num = v_effect.after_ventas_num
              and comision_acum = v_effect.after_comision_acum
             then comision_acum else comision_acum + coalesce(v_effect.comision_acum_delta, 0) end,
           sync_base_version = sync_version,
           sync_device_id = 'sale:' || p_commit_id
     where id = v_effect.id and active = true and deleted_at is null;
    if not found then
      raise exception 'Vendedor de la venta no existe o está inactivo'
        using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id
       from jsonb_to_recordset(p_seller_effects)
         as x(id text, ventas_mes_delta numeric, ventas_num_delta integer, comision_acum_delta numeric)
   );

  insert into pos.sale_commits (
    commit_id, operation_id, folio, payload_hash, actor_email
  ) values (
    p_commit_id, p_operation_id, v_folio, v_payload_hash, auth.jwt() ->> 'email'
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'products', v_products,
    'clients', v_clients, 'sellers', v_sellers
  );
end;
$$;

revoke all on function pos.commit_sale(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public;
grant execute on function pos.commit_sale(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) to authenticated;

commit;
