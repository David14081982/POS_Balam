-- POS Balam — H-34: verificación autocontenida del plazo de posventa.
--
-- Comprueba contra la base real: existencia y contrato de las dos columnas, que
-- `commit_sale` transporta el plazo, que un cliente ANTERIOR a H-34 (payload sin
-- las claves nuevas) sigue produciendo exactamente el resultado histórico, que
-- un reintento sin plazo no borra el ya registrado y que ninguna venta real
-- existente recibió vencimiento. No deja rastro: todas las filas temporales se
-- eliminan antes de terminar.

do $$
declare
  v_seller pos.sellers%rowtype;
  v_email text := 'h34-deadline-verify@invalid.local';
  v_op_legacy text := '5f2504e0-4f89-11d3-9a0c-0305e82c3401';
  v_op_plazo  text := '5f2504e0-4f89-11d3-9a0c-0305e82c3402';
  v_result jsonb;
  v_sale jsonb;
  v_days integer;
  v_expires date;
  v_real_sales bigint;
  v_real_with_deadline bigint;
begin
  -- 1) Contrato del esquema ---------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'sales'
       and column_name = 'return_limit_days' and data_type = 'integer'
  ) then
    raise exception 'H-34: falta pos.sales.return_limit_days';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'sales'
       and column_name = 'return_expires_at' and data_type = 'date'
  ) then
    raise exception 'H-34: falta pos.sales.return_expires_at';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.sales'::regclass
       and conname = 'sales_return_deadline_pair_chk'
  ) then
    raise exception 'H-34: falta la restricción que impide un vencimiento sin política';
  end if;

  -- Toda venta YA existente debe haber quedado sin límite: H-34 no vence nada
  -- hacia atrás.
  select count(*) into v_real_sales from pos.sales;
  select count(*) into v_real_with_deadline
    from pos.sales where return_limit_days is not null or return_expires_at is not null;
  if v_real_with_deadline <> 0 then
    raise exception 'H-34: % de % ventas existentes recibieron plazo retroactivo',
      v_real_with_deadline, v_real_sales;
  end if;
  raise notice 'H-34: las % venta(s) existentes quedaron sin límite, como antes', v_real_sales;

  -- Identidad operativa temporal (vendedor: el permiso mínimo que debe bastar).
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_seller.id is null then
    raise exception 'H-34 requiere una semilla de vendedor para verificar permisos';
  end if;
  v_seller.id := 'h34-deadline-verify-seller';
  v_seller.nombre := 'Vendedor temporal H34';
  v_seller.email := v_email;
  v_seller.role := 'vendedor';
  v_seller.active := true;
  v_seller.sync_version := 0;
  v_seller.sync_base_version := 0;
  v_seller.sync_device_id := null;
  v_seller.deleted_at := null;
  insert into pos.sellers values (v_seller.*);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text,
    true
  );

  -- 2) Cliente ANTERIOR a H-34: payload sin las claves nuevas ----------------
  -- Es el escenario de compatibilidad crítico: una terminal que todavía no se
  -- actualizó debe seguir registrando ventas exactamente como antes.
  v_result := pos.commit_sale(
    'h34-legacy-commit', v_op_legacy,
    jsonb_build_object(
      'folio', 'H34VER-260728-0001', 'operation_id', v_op_legacy,
      'fecha', '2026-07-28T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-34: un cliente anterior a H-34 dejó de poder registrar ventas: %', v_result;
  end if;
  select return_limit_days, return_expires_at into v_days, v_expires
    from pos.sales where operation_id = v_op_legacy;
  if v_days is not null or v_expires is not null then
    raise exception 'H-34: una venta sin plazo recibió uno inventado (% / %)', v_days, v_expires;
  end if;
  raise notice 'H-34: el payload sin claves nuevas produjo una venta sin límite';

  -- 3) Cliente H-34: el plazo viaja y se persiste tal cual --------------------
  v_sale := jsonb_build_object(
    'folio', 'H34VER-260728-0002', 'operation_id', v_op_plazo,
    'fecha', '2026-07-28T16:00:00-07:00', 'cliente', 'Público en general',
    'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
    'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
    'iva_included', true, 'anticipo', 0, 'saldo', 0,
    'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0,
    'return_limit_days', 15, 'return_expires_at', '2026-08-12'
  );
  v_result := pos.commit_sale(
    'h34-plazo-commit', v_op_plazo, v_sale,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-34: no se confirmó la venta con plazo: %', v_result;
  end if;
  select return_limit_days, return_expires_at into v_days, v_expires
    from pos.sales where operation_id = v_op_plazo;
  if v_days <> 15 or v_expires <> date '2026-08-12' then
    raise exception 'H-34: el plazo no se persistió correctamente (% / %)', v_days, v_expires;
  end if;
  raise notice 'H-34: la venta con plazo conservó % días con vencimiento %', v_days, v_expires;

  -- 4) Un reintento SIN el plazo no borra el ya registrado -------------------
  -- Sucede cuando una terminal antigua reenvía una operación de otra terminal
  -- ya actualizada. El plazo es evidencia: no puede desaparecer por reintento.
  v_result := pos.commit_sale(
    'h34-plazo-recommit', v_op_plazo,
    (v_sale - 'return_limit_days') - 'return_expires_at',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  select return_limit_days, return_expires_at into v_days, v_expires
    from pos.sales where operation_id = v_op_plazo;
  if v_days is null or v_expires is null then
    raise exception 'H-34: un reintento sin plazo borró la evidencia (% / %)', v_days, v_expires;
  end if;
  raise notice 'H-34: el reintento sin plazo conservó % días / %', v_days, v_expires;

  -- 5) La restricción de pareja rechaza un vencimiento sin política ----------
  begin
    update pos.sales
       set return_limit_days = null, return_expires_at = date '2026-08-12'
     where operation_id = v_op_plazo;
    raise exception 'H-34: se aceptó un vencimiento sin días congelados';
  exception
    when check_violation then
      raise notice 'H-34: la base rechaza un vencimiento sin política que lo explique';
  end;

  -- Limpieza total: la base vuelve a su estado exacto previo.
  delete from pos.sale_commits
   where commit_id in ('h34-legacy-commit', 'h34-plazo-commit', 'h34-plazo-recommit');
  delete from pos.sales where operation_id in (v_op_legacy, v_op_plazo);
  delete from pos.sellers where id = 'h34-deadline-verify-seller';

  -- 6) Ninguna venta real quedó con plazo tras la verificación ---------------
  select count(*) into v_real_with_deadline
    from pos.sales where return_limit_days is not null or return_expires_at is not null;
  if v_real_with_deadline <> 0 then
    raise exception 'H-34: quedaron % ventas con plazo después de limpiar', v_real_with_deadline;
  end if;
  if (select count(*) from pos.sales) <> v_real_sales then
    raise exception 'H-34: la verificación alteró el número de ventas reales';
  end if;
end;
$$;
