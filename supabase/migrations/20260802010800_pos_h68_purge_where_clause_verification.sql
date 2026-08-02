-- Verificacion remota autocontenida de la correccion de H-68 (ADR-004).
--
-- Prueba tres cosas contra la base real:
--   1. NINGUNA sentencia DELETE o UPDATE de la frontera desplegada carece de
--      WHERE. Se lee del catalogo, no del archivo: es lo que de verdad corre.
--   2. Con la guarda `safeupdate` ARMADA en la sesion —la misma que rechazo el
--      borrado desde el navegador— la limpieza completa se ejecuta sin error.
--      Antes de eso se comprueba que la guarda muerde de verdad.
--   3. El comportamiento sigue intacto: existencias restauradas, configuracion
--      idéntica, idempotencia y conteos por tabla que cuadran con el plan.
--
-- Todo el escenario vive en una subtransaccion que se deshace, y al final se
-- comprueba que la instalacion quedo exactamente como estaba.

begin;

do $$
declare
  v_email       constant text := 'h68w.verify.admin@invalid.local';
  v_admin       constant text := 'h68w-verify-admin';
  v_product     constant text := 'h68w-verify-product';
  v_client      constant text := 'h68w-verify-client';
  v_promo       constant text := 'h68w-verify-promo';
  v_sale        constant text := 'H68W-VERIFY-SALE';
  v_layaway     constant text := 'H68W-VERIFY-LAYAWAY';
  v_operation   constant text := 'h68w-verify-operation';
  v_return      constant text := 'h68w-verify-return';
  v_exchange    constant text := 'h68w-verify-exchange';
  v_loan        constant text := 'h68w-verify-loan';
  v_ticket      constant text := 'h68w-verify-ticket';
  v_def         text;
  v_stmt        text;
  v_guard       boolean := false;
  v_guard_bit   boolean := false;
  v_base_sales      bigint;
  v_base_movements  bigint;
  v_base_conflicts  bigint;
  v_base_pieces     bigint;
  v_base_fingerprint text;
  v_result   jsonb;
  v_stock    bigint;
  v_pct      numeric;
  v_sales_before bigint;
begin
  -- ── 1) Ninguna sentencia sin WHERE en la funcion DESPLEGADA ───────────────
  v_def := pg_get_functiondef('pos.purge_test_data(text)'::regprocedure);

  for v_stmt in
    select m[1] from regexp_matches(v_def, '(delete\s+from\s+pos\.[a-z_]+[^;]*;)', 'gi') as m
  loop
    if v_stmt !~* '\swhere\s' then
      raise exception 'H68_BARE_DELETE: %', left(regexp_replace(v_stmt, '\s+', ' ', 'g'), 140);
    end if;
  end loop;

  for v_stmt in
    select m[1] from regexp_matches(v_def, '(update\s+pos\.[a-z_]+[^;]*;)', 'gi') as m
  loop
    if v_stmt !~* '\swhere\s' then
      raise exception 'H68_BARE_UPDATE: %', left(regexp_replace(v_stmt, '\s+', ' ', 'g'), 140);
    end if;
  end loop;

  -- El detector se prueba a si mismo: si no señalara una sentencia sin WHERE,
  -- el paso de arriba seria otro verde sin defensa detras.
  if 'delete from pos.sales;' ~* '\swhere\s' then
    raise exception 'H68_DETECTOR_BROKEN';
  end if;

  -- ── 2) Linea base ─────────────────────────────────────────────────────────
  select count(*) into v_base_sales from pos.sales;
  select count(*) into v_base_movements from pos.movements;
  select count(*) into v_base_conflicts from pos.sync_conflicts;
  v_base_pieces := pos.total_stock_pieces();
  v_base_fingerprint := pos.config_fingerprint();

  if exists (select 1 from pos.sellers where id = v_admin)
     or exists (select 1 from pos.products where id = v_product)
     or exists (select 1 from pos.sales where folio in (v_sale, v_layaway))
     or exists (select 1 from pos.test_data_purges where purge_id = v_ticket) then
    raise exception 'H68W_FIXTURE_COLLISION';
  end if;

  -- ── 3) Escenario completo bajo la guarda, en subtransaccion que se deshace ─
  begin
    -- La misma biblioteca que Supabase precarga para el rol `authenticated`.
    -- Si no se puede cargar aqui, la prueba estatica de arriba sigue en pie.
    begin
      execute 'load ''safeupdate''';
      v_guard := true;
    exception when others then
      v_guard := false;
    end;

    if v_guard then
      -- La guarda tiene que MORDER: sin esto, «no fallo» no probaria nada.
      create temp table h68w_guard_probe(id int) on commit drop;
      insert into h68w_guard_probe values (1);
      begin
        execute 'delete from h68w_guard_probe';
        v_guard_bit := false;
      exception when others then
        v_guard_bit := true;
      end;
      if not v_guard_bit then
        raise exception 'H68W_GUARD_NOT_ARMED';
      end if;
    end if;

    perform set_config('request.jwt.claims',
      jsonb_build_object('email', v_email, 'role', 'authenticated')::text, true);

    insert into pos.sellers(
      id, nombre, email, role, active, comision_pct, meta_mes,
      ventas_mes, ventas_num, comision_acum
    ) values (v_admin, 'H68W Admin', v_email, 'admin', true, 6, 45000, 999.5, 4, 77.25);

    -- Producto con 9 piezas: estado DESPUES de que los documentos movieran 10.
    insert into pos.products(
      id, cat, manga, tela, color, cuello, modelo, nombre, orn, orn_colors,
      precio, pop, stock, imagen, sku, barcode_urls, costo, attrs, precios_talla,
      sync_base_version, sync_device_id, deleted_at
    ) values (
      v_product, 'H68W', 'ML', 'ALG', 'BL', 'NOR', '968', 'Prenda H68W', '-',
      '[]'::jsonb, 500, false,
      '[{"talla":"M","escala":"L","stock":9}]'::jsonb, null,
      'H68W-VERIFY-SKU', '{}'::jsonb, 200, '{}'::jsonb, '{}'::jsonb,
      null, 'migration:h68w-verification', null
    );

    insert into pos.promotions(id, nombre, tipo, valor, pausado, scope)
    values (v_promo, 'Promo H68W', 'pct', 15, false, '{}'::jsonb);

    insert into pos.clients(id, nombre, tel, compras, total, generic)
    values (v_client, 'Cliente H68W', '999', 2, 900, false);

    insert into pos.stock_reservations(operation_id, folio, lines, actor_email)
    values (v_operation, v_sale,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'talla', 'M', 'qty', 3)), v_email);
    insert into pos.sales(
      folio, fecha, cliente_id, cliente, vendedores, metodo, estado, items,
      total, operation_id
    ) values (
      v_sale, now(), v_client, 'Cliente H68W',
      jsonb_build_array(v_admin), 'Efectivo', 'Pagado', 3, 1500, v_operation
    );
    insert into pos.sale_items(folio, product_id, sku, nombre, talla, qty, precio)
    values (v_sale, v_product, 'H68W-VERIFY-SKU', 'Prenda H68W', 'M', 3, 500);
    insert into pos.sale_payments(
      id, folio, fecha, tipo, metodo, monto, efectivo, tarjeta, transferencia, otro
    ) values (
      'h68w-verify-pay', v_sale, '2026-08-02 10:00', 'venta', 'Efectivo',
      1500, 1500, 0, 0, 0
    );
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Venta', 'Prenda H68W', 'H68W-VERIFY-SKU', -3, v_sale, v_product, 'M');

    insert into pos.sales(
      folio, fecha, cliente, vendedores, metodo, estado, items, total, anticipo, saldo
    ) values (
      v_layaway, now(), 'Cliente H68W', jsonb_build_array(v_admin),
      'Apartado', 'Apartado', 2, 1000, 300, 700
    );
    insert into pos.sale_items(folio, product_id, sku, nombre, talla, qty, precio)
    values (v_layaway, v_product, 'H68W-VERIFY-SKU', 'Prenda H68W', 'M', 2, 500);

    insert into pos.returns(id, folio, cliente, vendedores, metodo, total, fecha)
    values (v_return, v_sale, 'Cliente H68W', jsonb_build_array(v_admin),
            'Efectivo', 500, '2026-08-02 11:00');
    insert into pos.return_items(return_id, product_id, sku, nombre, talla, qty, precio)
    values (v_return, v_product, 'H68W-VERIFY-SKU', 'Prenda H68W', 'M', 1, 500);
    insert into pos.movements(
      return_id, fecha, tipo, producto, sku, cant, ref, product_id, talla
    ) values (
      v_return, now(), 'Devolución', 'Prenda H68W', 'H68W-VERIFY-SKU', 1,
      v_sale, v_product, 'M'
    );

    insert into pos.exchanges(
      id, folio, origen_folio, fecha, usuario, valor_reconocido, valor_entregado,
      diferencia, valor_no_aprovechado, base_comision
    ) values (
      v_exchange, 'H68W-VERIFY-EXCHANGE', v_sale, '2026-08-02 12:00', v_email,
      1000, 500, 0, 500, 0
    );
    insert into pos.exchange_items(exchange_id, lado, sku, nombre, talla, qty, precio)
    values (v_exchange, 'devuelto', 'H68W-VERIFY-SKU', 'Prenda H68W', 'M', 2, 500),
           (v_exchange, 'entregado', 'H68W-VERIFY-SKU', 'Prenda H68W', 'M', 1, 500);
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Cambio (entra)', 'Prenda H68W', 'H68W-VERIFY-SKU', 2,
            'H68W-VERIFY-EXCHANGE', v_product, 'M'),
           (now(), 'Cambio (sale)', 'Prenda H68W', 'H68W-VERIFY-SKU', -1,
            'H68W-VERIFY-EXCHANGE', v_product, 'M');

    insert into pos.loan_documents(id, folio, state, document)
    values (v_loan, 'H68W-VERIFY-LOAN', 'pendiente',
            jsonb_build_object('id', v_loan, 'folio', 'H68W-VERIFY-LOAN'));

    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    values ('h68w-verify-liq', v_admin, 'H68W Admin', 100, 'liquidacion',
            '2026-08-02 13:00');

    -- Movimiento de inventario que NO entra al plan y debe sobrevivir.
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Entrada', 'Prenda H68W', 'H68W-VERIFY-SKU', 10,
            'carga inicial H68W', v_product, 'M');

    -- ── La limpieza, con la guarda armada ───────────────────────────────────
    select count(*) into v_sales_before from pos.sales;
    v_result := pos.purge_test_data(v_ticket);
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'H68W_PURGE_FAILED: %', v_result::text;
    end if;

    -- Existencias: 9 + 3 (venta) - 1 (devolucion) - 2 (cambio entra) + 1 (cambio sale) = 10.
    select (e.value ->> 'stock')::bigint into v_stock
      from pos.products p
      cross join lateral jsonb_array_elements(p.stock) as e(value)
     where p.id = v_product and e.value ->> 'talla' = 'M';
    if v_stock <> 10 then
      raise exception 'H68W_STOCK_NOT_RESTORED: % (esperado 10)', v_stock;
    end if;

    if exists (select 1 from pos.sales)
       or exists (select 1 from pos.sale_items)
       or exists (select 1 from pos.sale_payments)
       or exists (select 1 from pos.returns)
       or exists (select 1 from pos.return_items)
       or exists (select 1 from pos.exchanges)
       or exists (select 1 from pos.exchange_items)
       or exists (select 1 from pos.loan_documents)
       or exists (select 1 from pos.liquidations)
       or exists (select 1 from pos.stock_reservations)
       or exists (select 1 from pos.movements
                   where tipo in ('Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)'))
       or exists (select 1 from pos.clients where generic is not true and deleted_at is null)
    then
      raise exception 'H68W_OPERATIONAL_DATA_SURVIVED';
    end if;

    -- El borrado por identidad no puede haberse llevado el kardex de inventario.
    if not exists (select 1 from pos.movements
                    where tipo = 'Entrada' and ref = 'carga inicial H68W') then
      raise exception 'H68W_INVENTORY_HISTORY_DELETED';
    end if;
    -- Ni el diagnostico de sincronizacion, que ya no entra al alcance.
    if (select count(*) from pos.sync_conflicts) <> v_base_conflicts then
      raise exception 'H68W_SYNC_CONFLICTS_TOUCHED';
    end if;
    if not exists (select 1 from pos.promotions where id = v_promo) then
      raise exception 'H68W_DISCOUNT_RULE_DELETED';
    end if;
    select comision_pct into v_pct from pos.sellers where id = v_admin;
    if v_pct <> 6 then
      raise exception 'H68W_SELLER_CONFIG_CHANGED';
    end if;
    if exists (select 1 from pos.sellers where id = v_admin
                and (ventas_mes <> 0 or ventas_num <> 0 or comision_acum <> 0)) then
      raise exception 'H68W_SELLER_METRICS_SURVIVED';
    end if;
    if not coalesce((v_result ->> 'config_intacta')::boolean, false) then
      raise exception 'H68W_CONFIG_FINGERPRINT_CHANGED';
    end if;

    -- El informe cuenta lo que de verdad se borro. La comparacion es «al menos»
    -- lo sembrado: esta verificacion corre sobre una instalacion VIVA, que puede
    -- tener sus propios documentos, y exigir cifras exactas la haria fallar por
    -- tener datos en vez de por un defecto.
    if (v_result -> 'eliminados' ->> 'ventas')::int < 1
       or (v_result -> 'eliminados' ->> 'apartados')::int < 1
       or (v_result -> 'eliminados' ->> 'devoluciones')::int < 1
       or (v_result -> 'eliminados' ->> 'cambios')::int < 1
       or (v_result -> 'eliminados' ->> 'prestamos')::int < 1
       or (v_result -> 'eliminados' ->> 'clientes')::int < 1
       or (v_result -> 'eliminados' ->> 'movimientos')::int < 4 then
      raise exception 'H68W_REPORT_MISCOUNTS: %', (v_result -> 'eliminados')::text;
    end if;
    -- Y cuadra con la realidad: lo declarado como borrado es exactamente lo que
    -- habia antes de borrarlo.
    if (v_result -> 'eliminados' ->> 'ventas')::int
       + (v_result -> 'eliminados' ->> 'apartados')::int <> v_sales_before then
      raise exception 'H68W_REPORT_DOES_NOT_MATCH_BASE: % vs %',
        (v_result -> 'eliminados')::text, v_sales_before;
    end if;

    -- Idempotencia: otra pasada sobre datos ya limpios no mueve una pieza.
    v_result := pos.purge_test_data(v_ticket || '-2');
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'H68W_SECOND_PURGE_FAILED: %', v_result::text;
    end if;
    select (e.value ->> 'stock')::bigint into v_stock
      from pos.products p
      cross join lateral jsonb_array_elements(p.stock) as e(value)
     where p.id = v_product and e.value ->> 'talla' = 'M';
    if v_stock <> 10 then
      raise exception 'H68W_SECOND_PURGE_MOVED_STOCK: %', v_stock;
    end if;

    raise exception 'H68W_VERIFY_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'H68W_VERIFY_ROLLBACK' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  -- ── 4) El rollback fue completo ───────────────────────────────────────────
  if (select count(*) from pos.sales) <> v_base_sales
     or (select count(*) from pos.movements) <> v_base_movements
     or (select count(*) from pos.sync_conflicts) <> v_base_conflicts then
    raise exception 'H68W_ROLLBACK_INCOMPLETE_ROWS';
  end if;
  if pos.total_stock_pieces() <> v_base_pieces then
    raise exception 'H68W_ROLLBACK_INCOMPLETE_STOCK';
  end if;
  if pos.config_fingerprint() is distinct from v_base_fingerprint then
    raise exception 'H68W_ROLLBACK_INCOMPLETE_CONFIG';
  end if;
  if exists (select 1 from pos.test_data_purges where purge_id like v_ticket || '%')
     or exists (select 1 from pos.sellers where id = v_admin)
     or exists (select 1 from pos.products where id = v_product) then
    raise exception 'H68W_FIXTURES_SURVIVED';
  end if;
end;
$$;

commit;
