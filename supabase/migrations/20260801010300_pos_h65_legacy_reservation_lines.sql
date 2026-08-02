-- POS Balam - H-65: compatibilidad exacta con reservas anteriores.
--
-- reserve_sale_stock() conserva historicamente el JSON recibido y compara los
-- reintentos por igualdad exacta. La frontera H-65 deriva una representacion
-- canonica de los renglones del apartado. Si una reserva anterior expresa la
-- misma intencion con otro orden o con pares repetidos, el core debe recibir
-- exactamente prior.lines; de otro modo, la idempotencia historica responderia
-- operation_mismatch aunque el inventario ya se hubiera descontado bien.
--
-- R-DB-03: la redefinicion se genera desde pg_get_functiondef() de la funcion
-- vigente y aplica solamente bloques de sustitucion verificados. La migracion
-- aborta si cualquiera de los bloques base dejo de ser unico.

begin;

do $migration$
declare
  v_oid regprocedure := to_regprocedure(
    'pos.commit_layaway_liquidation(text,text,text,jsonb,jsonb,jsonb)'
  );
  v_definition text;
  v_old_declarations constant text := $old_declarations$  v_sale pos.sales%rowtype;
  v_prior pos.layaway_liquidation_commits%rowtype;
  v_payment jsonb;$old_declarations$;
  v_new_declarations constant text := $new_declarations$  v_sale pos.sales%rowtype;
  v_prior pos.layaway_liquidation_commits%rowtype;
  v_prior_reservation pos.stock_reservations%rowtype;
  v_has_prior_reservation boolean := false;
  v_derived_stock_lines jsonb := '[]'::jsonb;
  v_reserved_canonical_lines jsonb := '[]'::jsonb;
  v_payment jsonb;$new_declarations$;
  v_old_derivation_tail constant text := $old_derivation_tail$    into v_stock_lines from requested;

  select coalesce(jsonb_agg(jsonb_build_object(
      'fecha', p_payment ->> 'fecha', 'tipo', 'Venta',$old_derivation_tail$;
  v_new_derivation_tail constant text := $new_derivation_tail$    into v_stock_lines from requested;

  v_derived_stock_lines := v_stock_lines;

  -- El advisory lock de operation_id se tomo antes de leer el apartado. La
  -- reserva y todos los productos implicados quedan ahora bloqueados dentro de
  -- esa misma seccion critica y en orden estable.
  select * into v_prior_reservation
    from pos.stock_reservations
   where operation_id = p_operation_id
   for update;
  v_has_prior_reservation := found;

  if v_has_prior_reservation then
    if v_prior_reservation.folio <> p_folio then
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
      return jsonb_build_object(
        'ok', false, 'error', 'operation_mismatch',
        'reason', 'reservation_folio_mismatch',
        'stock_reserved', false, 'stock_idempotent', false,
        'reservation_operation_id', null
      );
    end if;
    if jsonb_typeof(v_prior_reservation.lines) <> 'array'
       or jsonb_array_length(v_prior_reservation.lines) = 0
       or exists (
         select 1 from jsonb_array_elements(v_prior_reservation.lines) x
          where jsonb_typeof(x) <> 'object'
             or jsonb_typeof(x -> 'product_id') <> 'string'
             or nullif(trim(x ->> 'product_id'), '') is null
             or jsonb_typeof(x -> 'talla') <> 'string'
             or nullif(trim(x ->> 'talla'), '') is null
             or not (x ? 'qty')
             or jsonb_typeof(x -> 'qty') <> 'number'
       ) then
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
      return jsonb_build_object(
        'ok', false, 'error', 'operation_mismatch',
        'reason', 'reservation_lines_invalid',
        'stock_reserved', true, 'stock_idempotent', false,
        'reservation_operation_id', p_operation_id
      );
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_prior_reservation.lines) x
       where (x ->> 'qty')::numeric <= 0
          or trunc((x ->> 'qty')::numeric) <> (x ->> 'qty')::numeric
          or (x ->> 'qty')::numeric > 2147483647
    ) then
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
      return jsonb_build_object(
        'ok', false, 'error', 'operation_mismatch',
        'reason', 'reservation_lines_invalid',
        'stock_reserved', true, 'stock_idempotent', false,
        'reservation_operation_id', p_operation_id
      );
    end if;
  end if;

  perform p.id
    from pos.products p
   where p.id in (
     select distinct x.product_id
       from jsonb_to_recordset(v_derived_stock_lines)
         as x(product_id text, talla text, qty integer)
     union
     select distinct x.product_id
       from jsonb_to_recordset(case when v_has_prior_reservation
              then v_prior_reservation.lines else '[]'::jsonb end)
         as x(product_id text, talla text, qty integer)
   )
   order by p.id
   for update;

  if v_has_prior_reservation then
    with canonical as (
      select x.product_id, x.talla, sum(x.qty)::integer as qty
        from jsonb_to_recordset(v_prior_reservation.lines)
          as x(product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'talla', talla, 'qty', qty
      ) order by product_id, talla), '[]'::jsonb)
      into v_reserved_canonical_lines
      from canonical;

    if v_reserved_canonical_lines <> v_derived_stock_lines then
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
      return jsonb_build_object(
        'ok', false, 'error', 'operation_mismatch',
        'reason', 'reservation_lines_mismatch',
        'stock_reserved', true, 'stock_idempotent', false,
        'reservation_operation_id', p_operation_id,
        'reserved_lines', v_prior_reservation.lines,
        'reserved_canonical_lines', v_reserved_canonical_lines,
        'derived_lines', v_derived_stock_lines
      );
    end if;

    -- Igualdad canonica autoriza la adopcion; la representacion no se
    -- normaliza. El core, el ledger y authoritative_state reciben exactamente
    -- el valor JSON que reserve_sale_stock() persiste y compara.
    v_stock_lines := v_prior_reservation.lines;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'fecha', p_payment ->> 'fecha', 'tipo', 'Venta',$new_derivation_tail$;
  v_old_wrapper_guard constant text := $old_wrapper_guard$  if nullif(trim(p_operation_id), '') is not null then
    perform pg_advisory_xact_lock(hashtext(p_operation_id));
  end if;
  v_should_reserve := coalesce(p_sale ->> 'estado', '')$old_wrapper_guard$;
  v_new_wrapper_guard constant text := $new_wrapper_guard$  if nullif(trim(p_operation_id), '') is not null then
    perform pg_advisory_xact_lock(hashtext(p_operation_id));
  end if;
  perform 1 from pos.sales where folio = v_folio for update;
  if exists (
    select 1 from pos.layaway_liquidation_commits
     where operation_id = p_operation_id or folio = v_folio
  ) then
    return jsonb_build_object(
      'ok', false, 'error', 'layaway_already_liquidated',
      'operation_id', p_operation_id, 'folio', v_folio,
      'stock_reserved', true,
      'reservation_operation_id', (
        select l.operation_id from pos.layaway_liquidation_commits l
         where l.operation_id = p_operation_id or l.folio = v_folio
         order by (l.operation_id = p_operation_id) desc, l.created_at desc
         limit 1
      )
    );
  end if;
  v_should_reserve := coalesce(p_sale ->> 'estado', '')$new_wrapper_guard$;
  v_wrapper_oid oid;
  v_wrapper_definition text;
  v_replacements integer;
begin
  if v_oid is null then
    raise exception 'H65_LEGACY_RESERVATION_CORE_MISSING';
  end if;

  select pg_get_functiondef(v_oid::oid) into v_definition;

  v_replacements := (
    char_length(v_definition)
      - char_length(replace(v_definition, v_old_declarations, ''))
  ) / char_length(v_old_declarations);
  if v_replacements <> 1 then
    raise exception 'H65_LEGACY_RESERVATION_DECLARATION_DRIFT: %',
      v_replacements;
  end if;

  v_replacements := (
    char_length(v_definition)
      - char_length(replace(v_definition, v_old_derivation_tail, ''))
  ) / char_length(v_old_derivation_tail);
  if v_replacements <> 1 then
    raise exception 'H65_LEGACY_RESERVATION_DERIVATION_DRIFT: %',
      v_replacements;
  end if;

  v_definition := replace(
    v_definition, v_old_declarations, v_new_declarations
  );
  v_definition := replace(
    v_definition, v_old_derivation_tail, v_new_derivation_tail
  );
  execute v_definition;

  -- Un abono/venta generico que quedo en otra cola no puede reabrir una
  -- operacion que la frontera atomica H-65 ya liquido. Los dos wrappers toman
  -- el advisory de la operacion y la fila de la venta antes de consultar el
  -- ledger; cubren tanto operation_id como folio aun si una cola vieja discrepa.
  foreach v_wrapper_oid in array array[
    to_regprocedure(
      'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'
    )::oid,
    to_regprocedure(
      'pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'
    )::oid
  ]
  loop
    if v_wrapper_oid is null then
      raise exception 'H65_GENERIC_COMMIT_WRAPPER_MISSING';
    end if;
    select pg_get_functiondef(v_wrapper_oid) into v_wrapper_definition;
    v_replacements := (
      char_length(v_wrapper_definition)
        - char_length(replace(
            v_wrapper_definition, v_old_wrapper_guard, ''
          ))
    ) / char_length(v_old_wrapper_guard);
    if v_replacements <> 1 then
      raise exception 'H65_GENERIC_COMMIT_WRAPPER_DRIFT: %, %',
        v_wrapper_oid::regprocedure, v_replacements;
    end if;
    v_wrapper_definition := replace(
      v_wrapper_definition, v_old_wrapper_guard, v_new_wrapper_guard
    );
    execute v_wrapper_definition;
  end loop;
end;
$migration$;

-- La redefinicion no cambia la frontera de seguridad de H-65.
revoke all on function pos.commit_layaway_liquidation(
  text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function pos.commit_layaway_liquidation(
  text, text, text, jsonb, jsonb, jsonb
) to service_role;

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

comment on column pos.movements.product_id is
  'H-65: identidad explicita en movimientos de liquidacion de apartado. Otros productores historicos o nuevos pueden conservar NULL hasta adoptar su propio contrato.';
comment on column pos.movements.talla is
  'H-65: talla explicita en movimientos de liquidacion de apartado. No implica cobertura automatica de todos los movimientos nuevos.';

commit;
