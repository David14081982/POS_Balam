-- Verificacion remota autocontenida de H-68 (ADR-004).
--
-- El comportamiento que hay que probar es DESTRUCTIVO por naturaleza: vacia todo
-- lo operativo. Por eso el escenario completo corre dentro de una SUBTRANSACCION
-- que termina deshaciendose siempre, y despues se comprueba que la base quedo
-- exactamente como estaba. Ese rollback no es solo una precaucion: es la prueba
-- de que un fallo a mitad de la limpieza no deja datos borrados a medias ni
-- existencias movidas.

begin;

do $$
declare
  v_email       constant text := 'h68.verify.admin@invalid.local';
  v_email_other constant text := 'h68.verify.seller@invalid.local';
  v_admin       constant text := 'h68-verify-admin';
  v_seller      constant text := 'h68-verify-seller';
  v_product     constant text := 'h68-verify-product';
  v_client      constant text := 'h68-verify-client';
  v_promo       constant text := 'h68-verify-promo';
  v_sale        constant text := 'H68-VERIFY-SALE';
  v_layaway     constant text := 'H68-VERIFY-LAYAWAY';
  v_operation   constant text := 'h68-verify-operation';
  v_return      constant text := 'h68-verify-return';
  v_exchange    constant text := 'h68-verify-exchange';
  v_loan        constant text := 'h68-verify-loan';
  v_ticket      constant text := 'h68-verify-ticket';
  v_ticket2     constant text := 'h68-verify-ticket-2';
  -- Linea base de la instalacion real: nada de esto puede cambiar.
  v_base_sales      bigint;
  v_base_returns    bigint;
  v_base_exchanges  bigint;
  v_base_loans      bigint;
  v_base_clients    bigint;
  v_base_movements  bigint;
  v_base_promos     bigint;
  v_base_pieces     bigint;
  v_base_fingerprint text;
  v_result   jsonb;
  v_state    jsonb;
  v_stock    bigint;
  v_denied   boolean := false;
  v_blocked  boolean := false;
  v_pct      numeric;
  v_meta     numeric;
begin
  -- ── 0) Estructura ─────────────────────────────────────────────────────────
  if to_regclass('pos.test_data_purges') is null then
    raise exception 'H68_MISSING_TABLE_test_data_purges';
  end if;
  if to_regclass('pos.purged_documents') is null then
    raise exception 'H68_MISSING_TABLE_purged_documents';
  end if;
  if to_regprocedure('pos.purge_test_data(text)') is null then
    raise exception 'H68_MISSING_FUNCTION_purge_test_data';
  end if;
  if to_regprocedure('pos.test_data_purge_state()') is null then
    raise exception 'H68_MISSING_FUNCTION_purge_state';
  end if;
  if to_regprocedure('pos.config_fingerprint()') is null then
    raise exception 'H68_MISSING_FUNCTION_config_fingerprint';
  end if;
  if to_regprocedure('pos.total_stock_pieces()') is null then
    raise exception 'H68_MISSING_FUNCTION_total_stock_pieces';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'sales_reject_purged' and tgrelid = 'pos.sales'::regclass
  ) or not exists (
    select 1 from pg_trigger
     where tgname = 'returns_reject_purged' and tgrelid = 'pos.returns'::regclass
  ) or not exists (
    select 1 from pg_trigger
     where tgname = 'exchanges_reject_purged' and tgrelid = 'pos.exchanges'::regclass
  ) or not exists (
    select 1 from pg_trigger
     where tgname = 'loan_documents_reject_purged'
       and tgrelid = 'pos.loan_documents'::regclass
  ) then
    raise exception 'H68_MISSING_PURGE_TRIGGERS';
  end if;
  -- La frontera es de administrador autenticado; anon jamas la alcanza.
  if has_function_privilege('anon', 'pos.purge_test_data(text)', 'execute') then
    raise exception 'H68_ANON_CAN_PURGE';
  end if;
  if not has_function_privilege('authenticated', 'pos.purge_test_data(text)', 'execute') then
    raise exception 'H68_AUTHENTICATED_CANNOT_PURGE';
  end if;

  -- La huella de configuracion tiene que ser estable: si cambiara sola, la
  -- garantia «configuracion intacta» seria ruido y bloquearia toda limpieza.
  if pos.config_fingerprint() is distinct from pos.config_fingerprint() then
    raise exception 'H68_FINGERPRINT_UNSTABLE';
  end if;

  -- ── 1) Colisiones de fixtures ─────────────────────────────────────────────
  if exists (select 1 from pos.sellers where id in (v_admin, v_seller))
     or exists (select 1 from pos.products where id = v_product)
     or exists (select 1 from pos.sales where folio in (v_sale, v_layaway))
     or exists (select 1 from pos.test_data_purges where purge_id in (v_ticket, v_ticket2))
  then
    raise exception 'H68_FIXTURE_COLLISION';
  end if;

  -- ── 2) Linea base ─────────────────────────────────────────────────────────
  select count(*) into v_base_sales from pos.sales;
  select count(*) into v_base_returns from pos.returns;
  select count(*) into v_base_exchanges from pos.exchanges;
  select count(*) into v_base_loans from pos.loan_documents;
  select count(*) into v_base_clients from pos.clients where deleted_at is null;
  select count(*) into v_base_movements from pos.movements;
  select count(*) into v_base_promos from pos.promotions;
  v_base_pieces := pos.total_stock_pieces();
  v_base_fingerprint := pos.config_fingerprint();

  -- ── 3) Escenario completo, dentro de una subtransaccion que SIEMPRE se deshace
  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('email', v_email, 'role', 'authenticated')::text, true);

    insert into pos.sellers(
      id, nombre, email, role, active, comision_pct, meta_mes,
      ventas_mes, ventas_num, comision_acum
    ) values
      (v_admin, 'H68 Admin', v_email, 'admin', true, 7, 50000, 12345.67, 9, 864.20),
      (v_seller, 'H68 Vendedor', v_email_other, 'vendedor', true, 5, 30000, 500, 2, 25);

    -- Producto con 9 piezas: es el estado DESPUES de que los documentos de abajo
    -- movieran el inventario partiendo de 10.
    insert into pos.products(
      id, cat, manga, tela, color, cuello, modelo, nombre, orn, orn_colors,
      precio, pop, stock, imagen, sku, barcode_urls, costo, attrs, precios_talla,
      sync_base_version, sync_device_id, deleted_at
    ) values (
      v_product, 'H68', 'ML', 'ALG', 'BL', 'NOR', '968', 'Prenda H68', '-',
      '[]'::jsonb, 500, false,
      '[{"talla":"M","escala":"L","stock":9}]'::jsonb, null,
      'H68-VERIFY-SKU', '{}'::jsonb, 200, '{}'::jsonb, '{}'::jsonb,
      null, 'migration:h68-verification', null
    );

    -- Descuento configurado: DEBE sobrevivir intacto.
    insert into pos.promotions(id, nombre, tipo, valor, pausado, scope)
    values (v_promo, 'Promo H68', 'pct', 10, false, '{}'::jsonb);

    -- Cliente de prueba: debe desaparecer.
    insert into pos.clients(id, nombre, tel, compras, total, generic)
    values (v_client, 'Cliente H68', '999', 3, 1500, false);

    -- Venta cobrada de 3 piezas. La reserva va primero: sin ella el disparador
    -- H-01 rechaza la venta, y ademas es la evidencia que la limpieza revierte.
    insert into pos.stock_reservations(operation_id, folio, lines, actor_email)
    values (v_operation, v_sale,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'talla', 'M', 'qty', 3)), v_email);
    insert into pos.sales(
      folio, fecha, cliente_id, cliente, vendedores, metodo, estado, items,
      total, operation_id
    ) values (
      v_sale, now(), v_client, 'Cliente H68',
      jsonb_build_array(v_seller), 'Efectivo', 'Pagado', 3, 1500, v_operation
    );
    insert into pos.sale_items(folio, product_id, sku, nombre, talla, qty, precio)
    values (v_sale, v_product, 'H68-VERIFY-SKU', 'Prenda H68', 'M', 3, 500);
    insert into pos.sale_payments(
      id, folio, fecha, tipo, metodo, monto, efectivo, tarjeta, transferencia, otro
    ) values (
      'h68-verify-pay', v_sale, '2026-08-02 10:00', 'venta', 'Efectivo',
      1500, 1500, 0, 0, 0
    );
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Venta', 'Prenda H68', 'H68-VERIFY-SKU', -3, v_sale, v_product, 'M');

    -- Apartado de 2 piezas: NUNCA descontó. Al limpiarlo no puede devolver nada.
    insert into pos.sales(
      folio, fecha, cliente, vendedores, metodo, estado, items, total, anticipo, saldo
    ) values (
      v_layaway, now(), 'Cliente H68', jsonb_build_array(v_seller),
      'Apartado', 'Apartado', 2, 1000, 300, 700
    );
    insert into pos.sale_items(folio, product_id, sku, nombre, talla, qty, precio)
    values (v_layaway, v_product, 'H68-VERIFY-SKU', 'Prenda H68', 'M', 2, 500);

    -- Devolucion de 1 pieza: habia REINGRESADO stock.
    insert into pos.returns(id, folio, cliente, vendedores, metodo, total, fecha)
    values (v_return, v_sale, 'Cliente H68', jsonb_build_array(v_seller),
            'Efectivo', 500, '2026-08-02 11:00');
    insert into pos.return_items(return_id, product_id, sku, nombre, talla, qty, precio)
    values (v_return, v_product, 'H68-VERIFY-SKU', 'Prenda H68', 'M', 1, 500);
    insert into pos.movements(
      return_id, fecha, tipo, producto, sku, cant, ref, product_id, talla
    ) values (
      v_return, now(), 'Devolución', 'Prenda H68', 'H68-VERIFY-SKU', 1,
      v_sale, v_product, 'M'
    );

    -- Cambio: entraron 2 y salio 1. Revertirlo tiene que deshacer LOS DOS lados.
    insert into pos.exchanges(
      id, folio, origen_folio, fecha, usuario, valor_reconocido, valor_entregado,
      diferencia, valor_no_aprovechado, base_comision
    ) values (
      v_exchange, 'H68-VERIFY-EXCHANGE', v_sale, '2026-08-02 12:00', v_email,
      1000, 500, 0, 500, 0
    );
    insert into pos.exchange_items(exchange_id, lado, sku, nombre, talla, qty, precio)
    values (v_exchange, 'devuelto', 'H68-VERIFY-SKU', 'Prenda H68', 'M', 2, 500),
           (v_exchange, 'entregado', 'H68-VERIFY-SKU', 'Prenda H68', 'M', 1, 500);
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Cambio (entra)', 'Prenda H68', 'H68-VERIFY-SKU', 2,
            'H68-VERIFY-EXCHANGE', v_product, 'M'),
           (now(), 'Cambio (sale)', 'Prenda H68', 'H68-VERIFY-SKU', -1,
            'H68-VERIFY-EXCHANGE', v_product, 'M');

    -- Prestamo: no mueve existencias, pero es dato operativo y se borra.
    insert into pos.loan_documents(id, folio, state, document)
    values (v_loan, 'H68-VERIFY-LOAN', 'pendiente',
            jsonb_build_object('id', v_loan, 'folio', 'H68-VERIFY-LOAN'));

    -- Comision liquidada y movimiento de inventario que DEBE sobrevivir.
    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    values ('h68-verify-liq', v_seller, 'H68 Vendedor', 100, 'liquidacion',
            '2026-08-02 13:00');
    insert into pos.movements(fecha, tipo, producto, sku, cant, ref, product_id, talla)
    values (now(), 'Entrada', 'Prenda H68', 'H68-VERIFY-SKU', 10,
            'carga inicial H68', v_product, 'M');

    -- Ticket vacio: se rechaza sin tocar nada.
    v_result := pos.purge_test_data('   ');
    if coalesce((v_result ->> 'ok')::boolean, true) then
      raise exception 'H68_EMPTY_TICKET_ACCEPTED';
    end if;

    -- ── La limpieza ─────────────────────────────────────────────────────────
    v_result := pos.purge_test_data(v_ticket);
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'H68_PURGE_FAILED: %', v_result::text;
    end if;
    if coalesce((v_result ->> 'idempotent')::boolean, true) then
      raise exception 'H68_FIRST_RUN_REPORTED_IDEMPOTENT';
    end if;

    -- 1) Las existencias vuelven al valor previo a las pruebas: 9 + 3 - 1 - 2 + 1 = 10.
    select (e.value ->> 'stock')::bigint into v_stock
      from pos.products p
      cross join lateral jsonb_array_elements(p.stock) as e(value)
     where p.id = v_product and e.value ->> 'talla' = 'M';
    if v_stock <> 10 then
      raise exception 'H68_STOCK_NOT_RESTORED: % (esperado 10)', v_stock;
    end if;

    -- 2) Lo operativo quedo en cero.
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
      raise exception 'H68_OPERATIONAL_DATA_SURVIVED';
    end if;

    -- 3) El movimiento de inventario y el catalogo siguen ahi.
    if not exists (select 1 from pos.movements where tipo = 'Entrada'
                    and ref = 'carga inicial H68') then
      raise exception 'H68_INVENTORY_HISTORY_DELETED';
    end if;
    if not exists (select 1 from pos.products where id = v_product) then
      raise exception 'H68_PRODUCT_DELETED';
    end if;

    -- 4) Los descuentos configurados NO son datos operativos.
    if not exists (select 1 from pos.promotions where id = v_promo) then
      raise exception 'H68_DISCOUNT_RULE_DELETED';
    end if;

    -- 5) El vendedor sobrevive con su configuracion y sus acumulados en cero.
    select comision_pct, meta_mes into v_pct, v_meta
      from pos.sellers where id = v_admin;
    if v_pct <> 7 or v_meta <> 50000 then
      raise exception 'H68_SELLER_CONFIG_CHANGED';
    end if;
    if exists (select 1 from pos.sellers
                where id in (v_admin, v_seller)
                  and (ventas_mes <> 0 or ventas_num <> 0 or comision_acum <> 0)) then
      raise exception 'H68_SELLER_METRICS_SURVIVED';
    end if;

    -- 6) La huella de configuracion no se movio.
    if not coalesce((v_result ->> 'config_intacta')::boolean, false)
       or (v_result ->> 'config_huella_antes') is distinct from (v_result ->> 'config_huella_despues') then
      raise exception 'H68_CONFIG_FINGERPRINT_CHANGED';
    end if;

    -- 7) La epoca quedo sellada y es legible por la terminal.
    v_state := pos.test_data_purge_state();
    if (v_state ->> 'epoch') is null
       or (v_state ->> 'epoch')::bigint <> (v_result ->> 'epoch')::bigint then
      raise exception 'H68_EPOCH_NOT_PUBLISHED';
    end if;

    -- 8) Idempotencia por ticket: el reintento no vuelve a mover existencias.
    v_result := pos.purge_test_data(v_ticket);
    if not coalesce((v_result ->> 'idempotent')::boolean, false) then
      raise exception 'H68_RETRY_NOT_IDEMPOTENT';
    end if;
    -- 9) Idempotencia real: una SEGUNDA limpieza, con otro ticket, sobre datos ya
    --    limpios no puede volver a sumar ni restar piezas.
    v_result := pos.purge_test_data(v_ticket2);
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'H68_SECOND_PURGE_FAILED: %', v_result::text;
    end if;
    select (e.value ->> 'stock')::bigint into v_stock
      from pos.products p
      cross join lateral jsonb_array_elements(p.stock) as e(value)
     where p.id = v_product and e.value ->> 'talla' = 'M';
    if v_stock <> 10 then
      raise exception 'H68_SECOND_PURGE_MOVED_STOCK: %', v_stock;
    end if;

    -- 10) Lapida activa: la venta borrada no puede volver por una cola vieja.
    begin
      insert into pos.stock_reservations(operation_id, folio, lines, actor_email)
      values (v_operation || '-x', v_sale, '[]'::jsonb, v_email);
      insert into pos.sales(
        folio, fecha, cliente, vendedores, metodo, estado, items, total, operation_id
      ) values (
        v_sale, now(), 'Cliente H68', '[]'::jsonb, 'Efectivo', 'Pagado', 3, 1500,
        v_operation
      );
    exception when others then
      if position('operation_purged' in sqlerrm) > 0 then v_blocked := true;
      else raise;
      end if;
    end;
    if not v_blocked then
      raise exception 'H68_PURGED_SALE_RESURRECTED';
    end if;

    -- 11) Sin administrador activo no hay limpieza.
    perform set_config('request.jwt.claims',
      jsonb_build_object('email', v_email_other, 'role', 'authenticated')::text, true);
    begin
      perform pos.purge_test_data('h68-verify-denied');
    exception when others then
      if position('purge_requires_admin' in sqlerrm) > 0 then v_denied := true;
      else raise;
      end if;
    end;
    if not v_denied then
      raise exception 'H68_NON_ADMIN_COULD_PURGE';
    end if;

    -- Todo comprobado: se deshace el escenario ENTERO.
    raise exception 'H68_VERIFY_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'H68_VERIFY_ROLLBACK' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  -- ── 4) El rollback fue completo: la instalacion quedo como estaba ─────────
  -- Es la prueba de la atomicidad: un fallo a mitad no deja ni un documento
  -- borrado ni una pieza movida.
  if (select count(*) from pos.sales) <> v_base_sales
     or (select count(*) from pos.returns) <> v_base_returns
     or (select count(*) from pos.exchanges) <> v_base_exchanges
     or (select count(*) from pos.loan_documents) <> v_base_loans
     or (select count(*) from pos.clients where deleted_at is null) <> v_base_clients
     or (select count(*) from pos.movements) <> v_base_movements
     or (select count(*) from pos.promotions) <> v_base_promos then
    raise exception 'H68_ROLLBACK_INCOMPLETE_ROWS';
  end if;
  if pos.total_stock_pieces() <> v_base_pieces then
    raise exception 'H68_ROLLBACK_INCOMPLETE_STOCK';
  end if;
  if pos.config_fingerprint() is distinct from v_base_fingerprint then
    raise exception 'H68_ROLLBACK_INCOMPLETE_CONFIG';
  end if;
  if exists (select 1 from pos.test_data_purges where purge_id in (v_ticket, v_ticket2))
     or exists (select 1 from pos.sellers where id in (v_admin, v_seller))
     or exists (select 1 from pos.products where id = v_product) then
    raise exception 'H68_FIXTURES_SURVIVED';
  end if;
end;
$$;

commit;
