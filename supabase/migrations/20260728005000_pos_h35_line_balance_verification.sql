-- POS Balam — H-35: verificación autocontenida de la autoridad del saldo.
--
-- Comprueba contra la base real: contrato de la vista y la función, que la
-- función NO quedó expuesta al navegador, equivalencia exacta con el cálculo
-- anterior sobre las ventas reales existentes, devolución parcial y total,
-- rechazo de sobredevolución entre dos terminales, reintento idempotente,
-- rollback total ante fallo y venta sin renglones. No deja rastro.

do $$
declare
  v_seller pos.sellers%rowtype;
  v_email text := 'h35-balance-verify@invalid.local';
  v_op text := '7f2504e0-4f89-11d3-9a0c-0305e82c3501';
  v_folio text := 'H35VER-260728-0001';
  v_folio_vacio text := 'H35VER-260728-0002';
  v_op_vacio text := '7f2504e0-4f89-11d3-9a0c-0305e82c3502';
  v_prod text := 'h35-verify-product';
  v_result jsonb;
  v_rec record;
  v_divergentes integer;
  v_sales_antes bigint;
  v_disponible integer;
  v_invoker text;
begin
  -- 1) Contrato -------------------------------------------------------------
  if to_regclass('pos.line_consumption') is null then
    raise exception 'H-35: no existe la vista pos.line_consumption';
  end if;
  if to_regprocedure('pos.sale_line_balance(text,text)') is null then
    raise exception 'H-35: no existe pos.sale_line_balance()';
  end if;
  -- La autoridad es interna: exponerla rompería la contención de H-07/H-08.
  --
  -- Se comprueban DOS condiciones independientes, porque el esquema `pos`
  -- tiene privilegios por defecto que conceden toda relación nueva a
  -- `authenticated`: basta recrear la vista sin el revoke para reabrir el
  -- agujero. La ausencia de permiso es el síntoma; `security_invoker` es la
  -- defensa. La verificación exige las dos y falla si cualquiera decae.
  if has_function_privilege('authenticated', 'pos.sale_line_balance(text,text)', 'execute') then
    raise exception 'H-35: sale_line_balance quedó ejecutable por authenticated';
  end if;
  if has_function_privilege('anon', 'pos.sale_line_balance(text,text)', 'execute') then
    raise exception 'H-35: sale_line_balance quedó ejecutable por anon';
  end if;
  if has_table_privilege('authenticated', 'pos.line_consumption', 'select') then
    raise exception 'H-35: line_consumption quedó legible por authenticated';
  end if;
  if has_table_privilege('anon', 'pos.line_consumption', 'select') then
    raise exception 'H-35: line_consumption quedó legible por anon';
  end if;
  if not has_table_privilege('service_role', 'pos.line_consumption', 'select') then
    raise exception 'H-35: service_role perdió la lectura de pos.line_consumption';
  end if;

  select option_value into v_invoker
    from pg_options_to_table(
      (select c.reloptions
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pos' and c.relname = 'line_consumption')
    )
   where option_name = 'security_invoker';

  if v_invoker is null or lower(v_invoker) not in ('true', 'on', '1') then
    raise exception 'H-35: line_consumption sin security_invoker: la vista evitaría el RLS de sale_items y return_items';
  end if;
  raise notice 'H-35: la autoridad es interna · sin authenticated ni anon · security_invoker activo';

  -- 2) Equivalencia sobre los datos REALES ya existentes ---------------------
  -- Para cada venta con renglones, el disponible nuevo debe coincidir con el
  -- cálculo histórico (vendido menos devuelto). Si difiere en una sola fila, la
  -- migración aborta.
  select count(*) into v_divergentes
    from (
      select si.folio, si.sku, si.talla,
             greatest(sum(si.qty)::integer - coalesce((
               select sum(ri.qty)::integer
                 from pos.return_items ri
                 join pos.returns r on r.id = ri.return_id
                where r.folio = si.folio and ri.sku = si.sku and ri.talla = si.talla
             ), 0), 0) as historico
        from pos.sale_items si
       group by si.folio, si.sku, si.talla
    ) viejo
    join lateral (
      select b.disponible
        from pos.sale_line_balance(viejo.folio) b
       where b.sku = viejo.sku and b.talla = viejo.talla
    ) nuevo on true
   where viejo.historico <> nuevo.disponible;
  if v_divergentes <> 0 then
    raise exception 'H-35: el saldo nuevo difiere del histórico en % renglón(es) reales', v_divergentes;
  end if;
  raise notice 'H-35: el saldo coincide con el cálculo histórico en todos los renglones reales';

  select count(*) into v_sales_antes from pos.sales;

  -- Identidad operativa temporal (vendedor: permiso mínimo que debe bastar).
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_seller.id is null then
    raise exception 'H-35 requiere una semilla de vendedor para verificar permisos';
  end if;
  v_seller.id := 'h35-balance-verify-seller';
  v_seller.nombre := 'Vendedor temporal H35';
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

  -- 3) Escenario: venta con 3 piezas de una talla ---------------------------
  insert into pos.products (id, cat, manga, tela, color, cuello, modelo, nombre, precio, stock, sku)
  values (v_prod, 'GUA', 'LAR', 'LIN', 'BLA', 'NOR', '900', 'Guayabera H35', 1000,
          '[{"talla":"M","escala":"L","stock":10}]'::jsonb, 'H35-SKU');

  v_result := pos.commit_sale(
    'h35-sale-commit', v_op,
    jsonb_build_object(
      'folio', v_folio, 'operation_id', v_op,
      'fecha', '2026-07-28T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'estado', 'Pagado',
      'items', 3, 'subtotal', 2586.21, 'iva', 413.79, 'total', 3000, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 3000, 'saldo', 0,
      'pago_efectivo', 3000, 'pago_otro', 0, 'descuento', 0
    ),
    jsonb_build_array(jsonb_build_object(
      'folio', v_folio, 'product_id', v_prod, 'sku', 'H35-SKU', 'nombre', 'Guayabera H35',
      'talla', 'M', 'qty', 3, 'precio', 1000
    )),
    '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 3)),
    true, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-35: no se pudo crear la venta de prueba: %', v_result;
  end if;

  select disponible into v_disponible from pos.sale_line_balance(v_folio) where sku = 'H35-SKU';
  if v_disponible <> 3 then
    raise exception 'H-35: una venta recién creada no muestra 3 disponibles, muestra %', v_disponible;
  end if;

  -- 4) Devolución parcial de 1 pieza ----------------------------------------
  v_result := pos.commit_return(
    'h35-ret-a',
    jsonb_build_object('id', 'h35-ret-a-id', 'folio', v_folio, 'cliente', 'Público en general',
                       'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'total', 1000,
                       'notas', '', 'fecha', '2026-07-28 17:00'),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-a-id', 'product_id', v_prod,
      'sku', 'H35-SKU', 'nombre', 'Guayabera H35', 'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 1000)),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-a-id', 'fecha', '2026-07-28T17:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Guayabera H35', 'sku', 'H35-SKU', 'cant', 1, 'ref', v_folio)),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 1)),
    null, '[]'::jsonb, false
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or v_result ->> 'sale_state' <> 'Devolución parcial' then
    raise exception 'H-35: la devolución parcial no se comportó como antes: %', v_result;
  end if;
  select disponible into v_disponible from pos.sale_line_balance(v_folio) where sku = 'H35-SKU';
  if v_disponible <> 2 then
    raise exception 'H-35: tras devolver 1 de 3 el disponible es %, debería ser 2', v_disponible;
  end if;
  raise notice 'H-35: devolución parcial correcta · disponible %', v_disponible;

  -- 5) Reintento idempotente: no consume saldo otra vez ---------------------
  v_result := pos.commit_return(
    'h35-ret-a',
    jsonb_build_object('id', 'h35-ret-a-id', 'folio', v_folio, 'cliente', 'Público en general',
                       'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'total', 1000,
                       'notas', '', 'fecha', '2026-07-28 17:00'),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-a-id', 'product_id', v_prod,
      'sku', 'H35-SKU', 'nombre', 'Guayabera H35', 'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 1000)),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-a-id', 'fecha', '2026-07-28T17:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Guayabera H35', 'sku', 'H35-SKU', 'cant', 1, 'ref', v_folio)),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 1)),
    null, '[]'::jsonb, false
  );
  select disponible into v_disponible from pos.sale_line_balance(v_folio) where sku = 'H35-SKU';
  if not coalesce((v_result ->> 'idempotent')::boolean, false) or v_disponible <> 2 then
    raise exception 'H-35: el reintento no fue idempotente (disponible %): %', v_disponible, v_result;
  end if;
  raise notice 'H-35: reintento idempotente sin consumir saldo adicional';

  -- 6) Segunda terminal intenta devolver 3 piezas → rechazo limpio ----------
  v_result := pos.commit_return(
    'h35-ret-b',
    jsonb_build_object('id', 'h35-ret-b-id', 'folio', v_folio, 'cliente', 'Público en general',
                       'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'total', 3000,
                       'notas', '', 'fecha', '2026-07-28 18:00'),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-b-id', 'product_id', v_prod,
      'sku', 'H35-SKU', 'nombre', 'Guayabera H35', 'talla', 'M', 'qty', 3, 'motivo', 'Talla', 'precio', 1000)),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-b-id', 'fecha', '2026-07-28T18:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Guayabera H35', 'sku', 'H35-SKU', 'cant', 3, 'ref', v_folio)),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 3)),
    null, '[]'::jsonb, false
  );
  if v_result ->> 'error' <> 'invalid_return_quantity' then
    raise exception 'H-35: no se rechazó la sobredevolución: %', v_result;
  end if;
  if (v_result -> 'items' -> 0 ->> 'available') <> '2'
     or (v_result -> 'items' -> 0 ->> 'requested') <> '3' then
    raise exception 'H-35: el detalle del rechazo cambió de forma: %', v_result -> 'items';
  end if;
  -- Rollback total: la operación rechazada no dejó rastro.
  if exists (select 1 from pos.returns where id = 'h35-ret-b-id')
     or exists (select 1 from pos.return_commits where commit_id = 'h35-ret-b')
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_prod) <> 8 then
    raise exception 'H-35: la devolución rechazada dejó efectos parciales';
  end if;
  raise notice 'H-35: sobredevolución rechazada con available=2 y sin efectos parciales';

  -- 7) Devolución de las 2 restantes → venta Devuelta -----------------------
  v_result := pos.commit_return(
    'h35-ret-c',
    jsonb_build_object('id', 'h35-ret-c-id', 'folio', v_folio, 'cliente', 'Público en general',
                       'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'total', 2000,
                       'notas', '', 'fecha', '2026-07-28 19:00'),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-c-id', 'product_id', v_prod,
      'sku', 'H35-SKU', 'nombre', 'Guayabera H35', 'talla', 'M', 'qty', 2, 'motivo', 'Talla', 'precio', 1000)),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-c-id', 'fecha', '2026-07-28T19:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Guayabera H35', 'sku', 'H35-SKU', 'cant', 2, 'ref', v_folio)),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 2)),
    null, '[]'::jsonb, false
  );
  select disponible into v_disponible from pos.sale_line_balance(v_folio) where sku = 'H35-SKU';
  if v_result ->> 'sale_state' <> 'Devuelto' or v_disponible <> 0 then
    raise exception 'H-35: la devolución total no dejó la venta Devuelta (disponible %): %', v_disponible, v_result;
  end if;
  raise notice 'H-35: devolución total correcta · estado Devuelto · disponible 0';

  -- 8) Venta SIN renglones: balance vacío y devolución rechazada ------------
  v_result := pos.commit_sale(
    'h35-sale-vacio', v_op_vacio,
    jsonb_build_object(
      'folio', v_folio_vacio, 'operation_id', v_op_vacio,
      'fecha', '2026-07-28T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if exists (select 1 from pos.sale_line_balance(v_folio_vacio)) then
    raise exception 'H-35: una venta sin renglones produjo balance';
  end if;
  v_result := pos.commit_return(
    'h35-ret-vacio',
    jsonb_build_object('id', 'h35-ret-vacio-id', 'folio', v_folio_vacio, 'cliente', 'x',
                       'vendedores', '[]'::jsonb, 'metodo', 'Efectivo', 'total', 0,
                       'notas', '', 'fecha', '2026-07-28 20:00'),
    jsonb_build_array(jsonb_build_object('return_id', 'h35-ret-vacio-id', 'product_id', v_prod,
      'sku', 'H35-SKU', 'nombre', 'Guayabera H35', 'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 0)),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 1)),
    null, '[]'::jsonb, false
  );
  if v_result ->> 'error' <> 'invalid_return_quantity' then
    raise exception 'H-35: una venta sin renglones aceptó devolución: %', v_result;
  end if;
  raise notice 'H-35: venta sin renglones rechaza devolución igual que antes';

  -- Limpieza total ----------------------------------------------------------
  delete from pos.movements where ref in (v_folio, v_folio_vacio);
  delete from pos.return_items where return_id in ('h35-ret-a-id', 'h35-ret-c-id');
  delete from pos.returns where id in ('h35-ret-a-id', 'h35-ret-c-id');
  delete from pos.return_commits where commit_id in ('h35-ret-a', 'h35-ret-c');
  delete from pos.sale_payments where folio in (v_folio, v_folio_vacio);
  delete from pos.sale_items where folio in (v_folio, v_folio_vacio);
  delete from pos.sale_commits where commit_id in ('h35-sale-commit', 'h35-sale-vacio');
  delete from pos.sales where folio in (v_folio, v_folio_vacio);
  delete from pos.stock_reservations where operation_id in (v_op, v_op_vacio);
  delete from pos.products where id = v_prod;
  delete from pos.sellers where id = 'h35-balance-verify-seller';

  if (select count(*) from pos.sales) <> v_sales_antes then
    raise exception 'H-35: la verificación alteró el número de ventas reales';
  end if;
  raise notice 'H-35: limpieza completa · % ventas reales intactas', v_sales_antes;
end;
$$;
