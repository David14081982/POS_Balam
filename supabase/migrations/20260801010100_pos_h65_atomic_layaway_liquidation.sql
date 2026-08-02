-- POS Balam - H-65: liquidacion atomica y confirmacion explicita de inventario.
--
-- La liquidacion deja de reconstruirse como una venta completa en el cliente.
-- Esta frontera toma el apartado ya persistido, deriva sus renglones, pagos,
-- movimientos y lineas de inventario por product_id, y delega el commit a la
-- autoridad transaccional existente. Los snapshots H-52 se conservan sin
-- volver a consumir una tarjeta fisica.

begin;

-- Identidad explicita en el kardex nuevo. Las filas historicas quedan NULL y
-- siguen siendo legibles; no se intenta inferirlas por SKU.
alter table pos.movements
  add column if not exists product_id text,
  add column if not exists talla text;

-- La comision de una venta es evidencia congelada del documento. Los cores
-- historicos no conocian estas columnas; las fronteras checked de abajo las
-- conservan sin obligar a reescribir la autoridad transaccional vigente.
alter table pos.sales
  add column if not exists comision numeric(12,2),
  add column if not exists comision_base text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.sales'::regclass
       and conname = 'sales_comision_base_check'
  ) then
    alter table pos.sales add constraint sales_comision_base_check
      check (comision_base is null or comision_base in ('neto', 'bruto'));
  end if;
end;
$$;

create index if not exists movements_product_size_fecha_idx
  on pos.movements (product_id, talla, fecha)
  where product_id is not null;

-- Idempotencia propia de la transicion Apartado -> Pagado. operation_id es la
-- identidad estable de la venta; commit_id es la identidad de una entrega de
-- la cola. Un segundo commit para la misma operacion solo puede ser replay del
-- mismo payload.
create table if not exists pos.layaway_liquidation_commits (
  commit_id      text primary key,
  operation_id   text not null unique,
  folio          text not null,
  payment_id     text not null,
  payload_hash   text not null,
  stock_lines    jsonb not null,
  context        jsonb not null default '{}'::jsonb,
  adopted_operation_id boolean not null default false,
  adopted_item_identities jsonb not null default '[]'::jsonb,
  actor_email    text,
  created_at     timestamptz not null default now()
);

alter table pos.layaway_liquidation_commits
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists adopted_operation_id boolean not null default false,
  add column if not exists adopted_item_identities jsonb not null default '[]'::jsonb;

alter table pos.layaway_liquidation_commits enable row level security;
drop policy if exists active_admin_select on pos.layaway_liquidation_commits;
create policy active_admin_select on pos.layaway_liquidation_commits
  for select to authenticated using (pos.is_active_admin());

revoke all on pos.layaway_liquidation_commits from public, anon, authenticated;
grant select on pos.layaway_liquidation_commits to authenticated;
grant all on pos.layaway_liquidation_commits to service_role;

-- Snapshot autoritativo de una venta despues de un commit. Es privado: las
-- fronteras checked lo agregan a su respuesta y la RPC batch de estado expone
-- solamente la parte necesaria para pulls.
create or replace function pos.sale_commit_authoritative_state(
  p_operation_id text,
  p_folio text,
  p_stock_lines jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pos, pg_temp
as $$
declare
  v_reservation jsonb;
  v_products jsonb := '[]'::jsonb;
  v_sale jsonb;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
begin
  select to_jsonb(r)
    into v_reservation
    from pos.stock_reservations r
   where r.operation_id = p_operation_id
     and r.folio = p_folio
     and r.lines = coalesce(p_stock_lines, '[]'::jsonb);

  if v_reservation is not null then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      into v_products
      from pos.products p
     where p.id in (
       select distinct x.product_id
         from jsonb_to_recordset(v_reservation -> 'lines')
           as x(product_id text, talla text, qty integer)
     );
  end if;

  select to_jsonb(s) into v_sale
    from pos.sales s where s.folio = p_folio;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb)
    into v_items from pos.sale_items i where i.folio = p_folio;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha, p.id), '[]'::jsonb)
    into v_payments from pos.sale_payments p where p.folio = p_folio;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_movements
    from pos.movements m
   where m.ref = p_folio and m.tipo = 'Venta';

  return jsonb_build_object(
    'stock_reserved', v_reservation is not null,
    'reservation_operation_id',
      case when v_reservation is null then null else p_operation_id end,
    'reservation', v_reservation,
    'products', v_products,
    'sale', v_sale,
    'items', v_items,
    'payments', v_payments,
    'movements', v_movements
  );
end;
$$;

revoke all on function pos.sale_commit_authoritative_state(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function pos.sale_commit_authoritative_state(text, text, jsonb)
  to service_role;

-- Estado explicito para reconstruir ventas descargadas. Devuelve tambien una
-- fila negativa cuando la operacion solicitada no tiene reserva; el cliente no
-- necesita inferir _stockReserved desde estado + operation_id.
create or replace function pos.sale_stock_reservation_status(
  p_operation_ids text[]
)
returns table (
  operation_id text,
  folio text,
  sale_state text,
  stock_reserved boolean,
  reservation_operation_id text,
  lines jsonb,
  reserved_at timestamptz,
  actor_email text
)
language plpgsql
stable
security definer
set search_path = pos, pg_temp
as $$
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para consultar reservas de venta'
      using errcode = '42501';
  end if;
  if coalesce(array_length(p_operation_ids, 1), 0) = 0 then return; end if;
  if array_length(p_operation_ids, 1) > 500 then
    raise exception 'Demasiadas operaciones solicitadas' using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct nullif(trim(x), '') as operation_id
      from unnest(p_operation_ids) x
  )
  select q.operation_id,
         coalesce(r.folio, s.folio),
         s.estado,
         r.operation_id is not null,
         r.operation_id,
         r.lines,
         r.created_at,
         r.actor_email
    from requested q
    left join pos.sales s on s.operation_id = q.operation_id
    left join pos.stock_reservations r on r.operation_id = q.operation_id
   where q.operation_id is not null
   order by q.operation_id;
end;
$$;

revoke all on function pos.sale_stock_reservation_status(text[])
  from public, anon;
grant execute on function pos.sale_stock_reservation_status(text[])
  to authenticated;

create or replace function pos.commit_layaway_liquidation(
  p_commit_id text,
  p_operation_id text,
  p_folio text,
  p_payment jsonb,
  p_seller_effects jsonb default '[]'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_sale pos.sales%rowtype;
  v_prior pos.layaway_liquidation_commits%rowtype;
  v_payment jsonb;
  v_payment_id text;
  v_payment_at timestamptz;
  v_amount numeric;
  v_cash numeric;
  v_card numeric;
  v_transfer numeric;
  v_other numeric;
  v_balance numeric;
  v_deadline date;
  v_payload_hash text;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
  v_stock_lines jsonb := '[]'::jsonb;
  v_sale_payload jsonb;
  v_core jsonb;
  v_before jsonb;
  v_state jsonb;
  v_stock_idempotent boolean := false;
  v_context jsonb;
  v_item_identities jsonb := '[]'::jsonb;
  v_commission_amount numeric := 0;
  v_commission_base text := 'neto';
  v_adopt_operation boolean := false;
  v_adopted_items jsonb := '[]'::jsonb;
  v_item record;
  v_identity_count integer;
  v_identity_product_id text;
  v_identity_sku text;
  v_identity_talla text;
  v_product_count integer;
  v_unique_product_id text;
  v_adopted_count integer := 0;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para liquidar apartados'
      using errcode = '42501';
  end if;
  if nullif(trim(p_commit_id), '') is null
     or nullif(trim(p_operation_id), '') is null
     or nullif(trim(p_folio), '') is null
     or jsonb_typeof(p_payment) <> 'object'
     or jsonb_typeof(p_seller_effects) <> 'array'
     or jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  v_item_identities := coalesce(p_context -> 'item_identities', '[]'::jsonb);
  if jsonb_typeof(v_item_identities) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_context',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  if (p_context ? 'commission_amount'
         and jsonb_typeof(p_context -> 'commission_amount') <> 'number')
     or (p_context ? 'commission_base'
         and jsonb_typeof(p_context -> 'commission_base') <> 'string')
     or exists (
       select 1 from jsonb_array_elements(v_item_identities) x
        where jsonb_typeof(x) <> 'object'
           or nullif(trim(x ->> 'product_id'), '') is null
           or (x ? 'sale_item_id' and x -> 'sale_item_id' <> 'null'::jsonb
               and (jsonb_typeof(x -> 'sale_item_id') <> 'number'
                    or x ->> 'sale_item_id' !~ '^[0-9]+$'))
     ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_context',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  select coalesce(jsonb_agg(x order by
      case when x ->> 'sale_item_id' ~ '^[0-9]+$'
        then (x ->> 'sale_item_id')::bigint end nulls last,
      x ->> 'product_id', x ->> 'sku', x ->> 'talla'), '[]'::jsonb)
    into v_item_identities
    from jsonb_array_elements(v_item_identities) x;
  v_commission_amount := coalesce((p_context ->> 'commission_amount')::numeric, 0);
  v_commission_base := coalesce(nullif(trim(p_context ->> 'commission_base'), ''), 'neto');
  if v_commission_amount < 0
     or round(v_commission_amount, 2) <> v_commission_amount
     or v_commission_base not in ('neto', 'bruto') then
    return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  v_context := jsonb_build_object(
    'item_identities', v_item_identities,
    'commission_amount', v_commission_amount,
    'commission_base', v_commission_base
  );

  v_payment_id := nullif(trim(p_payment ->> 'id'), '');
  if v_payment_id is null
     or nullif(trim(p_payment ->> 'fecha'), '') is null
     or nullif(trim(p_payment ->> 'metodo'), '') is null
     or (nullif(trim(p_payment ->> 'folio'), '') is not null
         and p_payment ->> 'folio' <> p_folio)
     or (nullif(trim(p_payment ->> 'tipo'), '') is not null
         and p_payment ->> 'tipo' <> 'liquidacion') then
    return jsonb_build_object('ok', false, 'error', 'invalid_payment',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  v_payment_at := (p_payment ->> 'fecha')::timestamptz;
  v_amount := coalesce((p_payment ->> 'monto')::numeric, 0);
  v_cash := coalesce((p_payment ->> 'efectivo')::numeric, 0);
  v_card := coalesce((p_payment ->> 'tarjeta')::numeric, 0);
  v_transfer := coalesce((p_payment ->> 'transferencia')::numeric, 0);
  v_other := coalesce((p_payment ->> 'otro')::numeric, 0);
  if v_amount <= 0 or least(v_cash, v_card, v_transfer, v_other) < 0
     or round(v_cash + v_card + v_transfer + v_other, 2) <> round(v_amount, 2) then
    return jsonb_build_object('ok', false, 'error', 'invalid_payment_parts',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  v_payment := jsonb_build_object(
    'id', v_payment_id, 'folio', p_folio,
    'fecha', p_payment ->> 'fecha', 'tipo', 'liquidacion',
    'metodo', p_payment ->> 'metodo', 'monto', v_amount,
    'efectivo', v_cash, 'tarjeta', v_card,
    'transferencia', v_transfer, 'otro', v_other
  );
  v_payload_hash := md5(jsonb_build_object(
    'contract', 'h65-v2', 'operation_id', p_operation_id,
    'folio', p_folio, 'payment', v_payment,
    'seller_effects', p_seller_effects, 'context', v_context
  )::text);

  -- Usa exactamente el mismo candado que reserve_sale_stock(); la lectura de
  -- idempotencia y el eventual descuento forman una sola seccion critica.
  perform pg_advisory_xact_lock(hashtext(p_operation_id));

  select * into v_prior from pos.layaway_liquidation_commits
   where commit_id = p_commit_id;
  if found then
    if v_prior.operation_id <> p_operation_id
       or v_prior.folio <> p_folio
       or v_prior.payload_hash <> v_payload_hash then
      return jsonb_build_object('ok', false, 'error', 'commit_mismatch',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    v_state := pos.sale_commit_authoritative_state(
      v_prior.operation_id, v_prior.folio, v_prior.stock_lines
    );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'commit_idempotent', true,
      'liquidation_idempotent', true, 'stock_idempotent', true,
      'adopted_operation_id', v_prior.adopted_operation_id,
      'adopted_item_identities', v_prior.adopted_item_identities,
      'context', v_prior.context
    ) || v_state;
  end if;

  select * into v_prior from pos.layaway_liquidation_commits
   where operation_id = p_operation_id;
  if found then
    if v_prior.folio <> p_folio or v_prior.payload_hash <> v_payload_hash then
      return jsonb_build_object('ok', false, 'error', 'operation_mismatch',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    v_state := pos.sale_commit_authoritative_state(
      v_prior.operation_id, v_prior.folio, v_prior.stock_lines
    );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'commit_idempotent', true,
      'liquidation_idempotent', true, 'stock_idempotent', true,
      'original_commit_id', v_prior.commit_id,
      'adopted_operation_id', v_prior.adopted_operation_id,
      'adopted_item_identities', v_prior.adopted_item_identities,
      'context', v_prior.context
    ) || v_state;
  end if;

  select * into v_sale from pos.sales
   where folio = p_folio for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'layaway_not_found',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  if v_sale.estado is distinct from 'Apartado' then
    return jsonb_build_object('ok', false, 'error', 'layaway_not_pending',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  if nullif(trim(v_sale.operation_id), '') is null then
    if exists (
      select 1 from pos.sales
       where operation_id = p_operation_id and folio <> p_folio
    ) or exists (
      select 1 from pos.stock_reservations
       where operation_id = p_operation_id and folio <> p_folio
    ) or exists (
      select 1 from pos.sale_commits
       where operation_id = p_operation_id and folio <> p_folio
    ) then
      return jsonb_build_object('ok', false, 'error', 'operation_id_conflict',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    v_adopt_operation := true;
  elsif v_sale.operation_id <> p_operation_id then
    return jsonb_build_object('ok', false, 'error', 'operation_mismatch',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  v_balance := round(coalesce(v_sale.saldo,
    v_sale.total - coalesce(v_sale.anticipo, 0)), 2);
  if v_balance <= 0 or round(v_amount, 2) <> v_balance then
    return jsonb_build_object(
      'ok', false, 'error', 'payment_balance_mismatch',
      'expected', v_balance, 'received', v_amount,
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null
    );
  end if;
  if exists (select 1 from pos.sale_payments where id = v_payment_id) then
    return jsonb_build_object('ok', false, 'error', 'payment_id_conflict',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;
  if not exists (select 1 from pos.sale_items where folio = p_folio)
     or exists (
       select 1 from pos.sale_items
        where folio = p_folio
          and (nullif(trim(talla), '') is null or qty <= 0)
     ) then
    return jsonb_build_object('ok', false,
      'error', 'layaway_items_invalid',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  -- Un renglon historico sin product_id solo se adopta por su PK remota, con
  -- SKU/talla exactos y cuando ese SKU identifica un solo producto vigente en
  -- el servidor. El contexto del navegador nunca decide entre duplicados.
  for v_item in
    select i.id, i.product_id, i.sku, i.talla
      from pos.sale_items i
     where i.folio = p_folio and nullif(trim(i.product_id), '') is null
     order by i.id
     for update
  loop
    select count(*), min(x.product_id), min(x.sku), min(x.talla)
      into v_identity_count, v_identity_product_id, v_identity_sku, v_identity_talla
      from jsonb_to_recordset(v_item_identities) as x(
        sale_item_id bigint, product_id text, sku text, talla text
      )
     where x.sale_item_id = v_item.id;
    if v_identity_count = 0 then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_identity_missing', 'sale_item_id', v_item.id,
        'sku', v_item.sku, 'talla', v_item.talla,
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    if v_identity_count <> 1 then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_identity_ambiguous', 'sale_item_id', v_item.id,
        'sku', v_item.sku, 'talla', v_item.talla,
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    if v_identity_sku is distinct from v_item.sku
       or v_identity_talla is distinct from v_item.talla then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_identity_mismatch', 'sale_item_id', v_item.id,
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;

    select count(*), min(p.id)
      into v_product_count, v_unique_product_id
      from pos.products p
     where p.deleted_at is null and p.sku = v_item.sku;
    if v_product_count = 0 then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_product_missing', 'sale_item_id', v_item.id,
        'sku', v_item.sku, 'stock_reserved', false,
        'stock_idempotent', false, 'reservation_operation_id', null);
    end if;
    if v_product_count <> 1 then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_sku_ambiguous', 'sale_item_id', v_item.id,
        'sku', v_item.sku, 'matches', v_product_count,
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    if v_identity_product_id is distinct from v_unique_product_id then
      return jsonb_build_object('ok', false,
        'error', 'layaway_item_identity_mismatch', 'sale_item_id', v_item.id,
        'expected_product_id', v_unique_product_id,
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
    v_adopted_items := v_adopted_items || jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_item.id, 'product_id', v_unique_product_id,
      'sku', v_item.sku, 'talla', v_item.talla
    ));
  end loop;

  -- El vendedor acreditado debe ser exactamente uno de los vendedores
  -- congelados en el apartado; omitir un efecto o acreditar a un tercero falla
  -- antes de tocar inventario.
  if exists (
    select 1 from jsonb_to_recordset(p_seller_effects) as e(id text)
     where nullif(trim(e.id), '') is null or not (v_sale.vendedores ? e.id)
  ) or (
    select count(*) <> count(distinct e.id)
      from jsonb_to_recordset(p_seller_effects) as e(id text)
  ) or exists (
    select 1 from jsonb_array_elements_text(v_sale.vendedores) sid
     where not exists (
       select 1 from jsonb_to_recordset(p_seller_effects) as e(id text)
        where e.id = sid
     )
  ) then
    return jsonb_build_object('ok', false, 'error', 'seller_effects_mismatch',
      'stock_reserved', false, 'stock_idempotent', false,
      'reservation_operation_id', null);
  end if;

  -- Las adopciones se hacen solo despues de validar toda la intencion y bajo el
  -- lock de la venta. Si el core devuelve un rechazo estructurado se revierten
  -- explicitamente; una excepcion posterior revierte la sentencia completa.
  if v_adopt_operation then
    update pos.sales set operation_id = p_operation_id
     where folio = p_folio and operation_id is null and estado = 'Apartado';
    if not found then
      return jsonb_build_object('ok', false, 'error', 'operation_adoption_conflict',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
  end if;
  if jsonb_array_length(v_adopted_items) > 0 then
    update pos.sale_items i set product_id = x.product_id
      from jsonb_to_recordset(v_adopted_items) as x(
        sale_item_id bigint, product_id text, sku text, talla text
      )
     where i.id = x.sale_item_id and i.folio = p_folio
       and i.product_id is null and i.sku is not distinct from x.sku
       and i.talla is not distinct from x.talla;
    get diagnostics v_adopted_count = row_count;
    if v_adopted_count <> jsonb_array_length(v_adopted_items) then
      update pos.sale_items i set product_id = null
       where i.folio = p_folio and exists (
         select 1 from jsonb_to_recordset(v_adopted_items) as x(
           sale_item_id bigint, product_id text, sku text, talla text
         ) where x.sale_item_id = i.id and x.product_id = i.product_id
       );
      if v_adopt_operation then
        update pos.sales set operation_id = null
         where folio = p_folio and operation_id = p_operation_id;
      end if;
      return jsonb_build_object('ok', false, 'error', 'item_adoption_conflict',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null);
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(i) - 'id' order by i.id), '[]'::jsonb)
    into v_items from pos.sale_items i where i.folio = p_folio;

  with requested as (
    select i.product_id, i.talla, sum(i.qty)::integer as qty
      from pos.sale_items i where i.folio = p_folio
     group by i.product_id, i.talla
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'talla', talla, 'qty', qty
    ) order by product_id, talla), '[]'::jsonb)
    into v_stock_lines from requested;

  select coalesce(jsonb_agg(jsonb_build_object(
      'fecha', p_payment ->> 'fecha', 'tipo', 'Venta',
      'producto', i.nombre, 'sku', i.sku, 'cant', -i.qty,
      'ref', p_folio, 'product_id', i.product_id, 'talla', i.talla
    ) order by i.id), '[]'::jsonb)
    into v_moves from pos.sale_items i where i.folio = p_folio;

  select coalesce(jsonb_agg(x.payload order by x.fecha, x.id), '[]'::jsonb)
    into v_payments
    from (
      select p.id, p.fecha, to_jsonb(p) - 'created_at' as payload
        from pos.sale_payments p where p.folio = p_folio
      union all
      select v_payment_id, p_payment ->> 'fecha', v_payment
    ) x;

  v_deadline := case
    when v_sale.return_limit_days is null then null
    else (v_payment_at at time zone 'America/Hermosillo')::date
         + v_sale.return_limit_days
  end;
  v_sale_payload := to_jsonb(v_sale) || jsonb_build_object(
    'estado', 'Pagado', 'anticipo', v_sale.total, 'saldo', 0,
    'pago_efectivo', coalesce(v_sale.pago_efectivo, 0) + v_cash,
    'pago_otro', coalesce(v_sale.pago_otro, 0)
      + v_card + v_transfer + v_other,
    'return_expires_at', v_deadline,
    'operation_id', p_operation_id,
    'comision', v_commission_amount,
    'comision_base', v_commission_base
  );

  v_before := pos.sale_commit_authoritative_state(
    p_operation_id, p_folio, v_stock_lines
  );
  v_stock_idempotent := coalesce((v_before ->> 'stock_reserved')::boolean, false);

  -- Misma transaccion SQL: reserva, venta, renglones, movimiento, pagos y
  -- efectos. Una excepcion posterior revierte tambien la reserva y el stock.
  v_core := pos.commit_sale(
    p_commit_id, p_operation_id, v_sale_payload, v_items, v_moves, v_payments,
    v_stock_lines, true, null, p_seller_effects
  );
  if not coalesce((v_core ->> 'ok')::boolean, false) then
    if jsonb_array_length(v_adopted_items) > 0 then
      update pos.sale_items i set product_id = null
       where i.folio = p_folio and exists (
         select 1 from jsonb_to_recordset(v_adopted_items) as x(
           sale_item_id bigint, product_id text, sku text, talla text
         ) where x.sale_item_id = i.id and x.product_id = i.product_id
       );
    end if;
    if v_adopt_operation then
      update pos.sales set operation_id = null
       where folio = p_folio and operation_id = p_operation_id
         and estado = 'Apartado';
    end if;
    v_state := pos.sale_commit_authoritative_state(
      p_operation_id, p_folio, v_stock_lines
    );
    return v_core || v_state || jsonb_build_object(
      'stock_idempotent', v_stock_idempotent,
      'commit_idempotent', coalesce((v_core ->> 'idempotent')::boolean, false)
    );
  end if;

  -- commit_sale vigente antecede a H-52: al reemplazar sale_items no transporta
  -- descuento_adicional. Se reescribe el mismo snapshot derivado, todavia dentro
  -- de esta transaccion, sin invocar claim_physical_card ni consumirlo de nuevo.
  delete from pos.sale_items where folio = p_folio;
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio,
    precio_base, precio_original, promos, descuento_adicional
  )
  select p_folio, x.product_id, x.sku, x.nombre, x.talla, x.qty, x.precio,
         x.precio_base, x.precio_original, x.promos, x.descuento_adicional
    from jsonb_to_recordset(v_items) as x(
      folio text, product_id text, sku text, nombre text, talla text,
      qty integer, precio numeric, precio_base numeric,
      precio_original numeric, promos jsonb, descuento_adicional numeric
    );
  update pos.sales set
    descuento_adicional = v_sale.descuento_adicional,
    total_antes_descuento_adicional = v_sale.total_antes_descuento_adicional,
    descuentos_adicionales = v_sale.descuentos_adicionales,
    comision = v_commission_amount,
    comision_base = v_commission_base
  where folio = p_folio;

  -- El core historico ignora las dos columnas nuevas. El reemplazo exacto se
  -- hace con el mismo payload ya incluido en su hash y en la misma transaccion.
  delete from pos.movements where ref = p_folio and tipo = 'Venta';
  insert into pos.movements (
    fecha, tipo, producto, sku, cant, ref, product_id, talla
  )
  select x.fecha::timestamptz, 'Venta', x.producto, x.sku, x.cant,
         p_folio, x.product_id, x.talla
    from jsonb_to_recordset(v_moves) as x(
      fecha text, tipo text, producto text, sku text, cant integer, ref text,
      product_id text, talla text
    );

  insert into pos.layaway_liquidation_commits (
    commit_id, operation_id, folio, payment_id, payload_hash,
    stock_lines, context, adopted_operation_id, adopted_item_identities,
    actor_email
  ) values (
    p_commit_id, p_operation_id, p_folio, v_payment_id, v_payload_hash,
    v_stock_lines, v_context, v_adopt_operation, v_adopted_items,
    auth.jwt() ->> 'email'
  );

  v_state := pos.sale_commit_authoritative_state(
    p_operation_id, p_folio, v_stock_lines
  );
  return v_core || v_state || jsonb_build_object(
    'idempotent', coalesce((v_core ->> 'idempotent')::boolean, false),
    'commit_idempotent', coalesce((v_core ->> 'idempotent')::boolean, false),
    'liquidation_idempotent', false,
    'stock_idempotent', v_stock_idempotent,
    'adopted_operation_id', v_adopt_operation,
    'adopted_item_identities', v_adopted_items,
    'context', v_context
  );
end;
$$;

revoke all on function pos.commit_layaway_liquidation(
  text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function pos.commit_layaway_liquidation(
  text, text, text, jsonb, jsonb, jsonb
) to service_role;

create or replace function pos.commit_layaway_liquidation_checked(
  p_commit_id text,
  p_operation_id text,
  p_folio text,
  p_payment jsonb,
  p_seller_effects jsonb default '[]'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.require_current_capability('sales.collect');
  return pos.commit_layaway_liquidation(
    p_commit_id, p_operation_id, p_folio, p_payment, p_seller_effects,
    p_context
  );
end;
$$;

revoke all on function pos.commit_layaway_liquidation_checked(
  text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function pos.commit_layaway_liquidation_checked(
  text, text, text, jsonb, jsonb, jsonb
) to authenticated;

-- Las dos fronteras generales conservan su firma y su autorizacion H-56. Para
-- commits nuevos, la necesidad de reserva se deriva del estado y no de una
-- bandera cliente. En replay se prueba ademas el payload historico si el hash
-- anterior habia conservado una bandera distinta.
create or replace function pos.commit_sale_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := p_sale ->> 'folio';
  v_result jsonb;
  v_before jsonb;
  v_state jsonb;
  v_prior_reserved boolean := false;
  v_existing_commit boolean := false;
  v_should_reserve boolean := false;
  v_effective_reserve boolean := false;
begin
  perform pos.require_sale_commit_capabilities(p_sale, p_payments);
  if p_sale ? 'comision' and p_sale -> 'comision' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
    if (p_sale ->> 'comision')::numeric < 0
       or round((p_sale ->> 'comision')::numeric, 2)
          <> (p_sale ->> 'comision')::numeric then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if p_sale ? 'comision_base' and p_sale -> 'comision_base' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision_base') <> 'string'
       or nullif(trim(p_sale ->> 'comision_base'), '') is null
       or p_sale ->> 'comision_base' not in ('neto', 'bruto') then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if nullif(trim(p_operation_id), '') is not null then
    perform pg_advisory_xact_lock(hashtext(p_operation_id));
  end if;
  v_should_reserve := coalesce(p_sale ->> 'estado', '')
      not in ('Apartado', 'Cancelado')
    and jsonb_typeof(p_stock_lines) = 'array'
    and jsonb_array_length(p_stock_lines) > 0;
  select exists(select 1 from pos.sale_commits where commit_id = p_commit_id)
    into v_existing_commit;
  v_effective_reserve := v_should_reserve;
  v_before := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  v_prior_reserved := coalesce((v_before ->> 'stock_reserved')::boolean, false);

  v_result := pos.commit_sale(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, v_effective_reserve, p_client_effect, p_seller_effects
  );
  -- Compatibilidad con commits creados por el wrapper anterior: su hash podia
  -- contener la bandera cliente false aunque la reserva ya existiera. La
  -- primera llamada solo leyo el commit y devolvio commit_mismatch, por lo que
  -- es seguro probar el payload historico sin duplicar efectos.
  if v_existing_commit
     and v_result ->> 'error' = 'commit_mismatch'
     and v_effective_reserve is distinct from coalesce(p_reserve_stock, false) then
    v_result := pos.commit_sale(
      p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
      p_stock_lines, coalesce(p_reserve_stock, false),
      p_client_effect, p_seller_effects
    );
  end if;
  if coalesce((v_result ->> 'ok')::boolean, false) then
    update pos.sales set
      comision = case when p_sale ? 'comision'
        then (p_sale ->> 'comision')::numeric else comision end,
      comision_base = case when p_sale ? 'comision_base'
        then nullif(trim(p_sale ->> 'comision_base'), '') else comision_base end
     where folio = v_folio and operation_id = p_operation_id;
  end if;
  v_state := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  return v_result || v_state || jsonb_build_object(
    'commit_idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'stock_idempotent', v_prior_reserved
      and coalesce((v_state ->> 'stock_reserved')::boolean, false)
  );
end;
$$;

create or replace function pos.commit_sale_with_additional_discount_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := p_sale ->> 'folio';
  v_result jsonb;
  v_before jsonb;
  v_state jsonb;
  v_prior_reserved boolean := false;
  v_existing_commit boolean := false;
  v_should_reserve boolean := false;
  v_effective_reserve boolean := false;
begin
  perform pos.require_sale_commit_capabilities(p_sale, p_payments);
  if p_sale ? 'comision' and p_sale -> 'comision' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
    if (p_sale ->> 'comision')::numeric < 0
       or round((p_sale ->> 'comision')::numeric, 2)
          <> (p_sale ->> 'comision')::numeric then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if p_sale ? 'comision_base' and p_sale -> 'comision_base' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision_base') <> 'string'
       or nullif(trim(p_sale ->> 'comision_base'), '') is null
       or p_sale ->> 'comision_base' not in ('neto', 'bruto') then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if nullif(trim(p_operation_id), '') is not null then
    perform pg_advisory_xact_lock(hashtext(p_operation_id));
  end if;
  v_should_reserve := coalesce(p_sale ->> 'estado', '')
      not in ('Apartado', 'Cancelado')
    and jsonb_typeof(p_stock_lines) = 'array'
    and jsonb_array_length(p_stock_lines) > 0;
  select exists(select 1 from pos.sale_commits where commit_id = p_commit_id)
    into v_existing_commit;
  v_effective_reserve := v_should_reserve;
  v_before := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  v_prior_reserved := coalesce((v_before ->> 'stock_reserved')::boolean, false);

  v_result := pos.commit_sale_with_additional_discount(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, v_effective_reserve, p_client_effect, p_seller_effects
  );
  if v_existing_commit
     and v_result ->> 'error' = 'commit_mismatch'
     and v_effective_reserve is distinct from coalesce(p_reserve_stock, false) then
    v_result := pos.commit_sale_with_additional_discount(
      p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
      p_stock_lines, coalesce(p_reserve_stock, false),
      p_client_effect, p_seller_effects
    );
  end if;
  if coalesce((v_result ->> 'ok')::boolean, false) then
    update pos.sales set
      comision = case when p_sale ? 'comision'
        then (p_sale ->> 'comision')::numeric else comision end,
      comision_base = case when p_sale ? 'comision_base'
        then nullif(trim(p_sale ->> 'comision_base'), '') else comision_base end
     where folio = v_folio and operation_id = p_operation_id;
  end if;
  v_state := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  return v_result || v_state || jsonb_build_object(
    'commit_idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'stock_idempotent', v_prior_reserved
      and coalesce((v_state ->> 'stock_reserved')::boolean, false)
  );
end;
$$;

-- No se reabre execute sobre los cores: H-56 exige pasar por checked.
revoke all on function pos.commit_sale(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function pos.commit_sale_with_additional_discount(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function pos.commit_sale_checked(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public, anon;
revoke all on function pos.commit_sale_with_additional_discount_checked(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public, anon;
grant execute on function pos.commit_sale_checked(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) to authenticated;
grant execute on function pos.commit_sale_with_additional_discount_checked(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) to authenticated;

commit;
