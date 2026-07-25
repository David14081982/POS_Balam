-- Verificación remota autocontenida de H-04. No conserva datos temporales.

do $$
declare
  v_product pos.products%rowtype;
  v_client pos.clients%rowtype;
  v_seller pos.sellers%rowtype;
  v_result jsonb;
  v_stock integer;
  v_failed boolean := false;
  v_folio text := 'H04-VERIFY-20260725';
  v_product_id text := 'h04-verify-product';
  v_client_id text := 'h04-verify-client';
  v_seller_id text := 'h04-verify-seller';
  v_email text := 'h04-verify@invalid.local';
  v_operation text := 'h04-verify-operation';
  v_commit text := 'h04-verify-commit';
  v_sale jsonb;
  v_items jsonb;
  v_moves jsonb;
  v_stock_lines jsonb;
  v_client_effect jsonb;
  v_seller_effects jsonb;
begin
  select * into v_product from pos.products where deleted_at is null limit 1;
  select * into v_client from pos.clients where deleted_at is null limit 1;
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_product.id is null or v_client.id is null or v_seller.id is null then
    raise exception 'H-04 requiere una fila semilla de producto, cliente y vendedor';
  end if;

  v_product.id := v_product_id;
  v_product.sku := 'H04-VERIFY-SKU';
  v_product.stock := '[{"talla":"M","escala":"L","stock":1}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_client.id := v_client_id;
  v_client.nombre := 'Cliente H04 temporal';
  v_client.compras := 0;
  v_client.total := 0;
  v_client.ultima := null;
  v_client.sync_version := 0;
  v_client.sync_base_version := 0;
  v_client.sync_device_id := null;
  v_client.deleted_at := null;
  insert into pos.clients values (v_client.*);

  v_seller.id := v_seller_id;
  v_seller.nombre := 'Vendedor H04 temporal';
  v_seller.email := v_email;
  v_seller.role := 'vendedor';
  v_seller.active := true;
  v_seller.ventas_mes := 0;
  v_seller.ventas_num := 0;
  v_seller.comision_acum := 0;
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

  v_sale := jsonb_build_object(
    'folio', v_folio, 'operation_id', v_operation,
    'fecha', '2026-07-25T13:00:00-07:00', 'cliente_id', v_client_id,
    'cliente', 'Cliente H04 temporal', 'vendedores', jsonb_build_array(v_seller_id),
    'metodo', 'Efectivo', 'estado', 'Pagado', 'items', 1,
    'subtotal', 86.21, 'iva', 13.79, 'total', 100,
    'iva_pct', 16, 'iva_included', true, 'anticipo', 100, 'saldo', 0,
    'pago_efectivo', 100, 'pago_otro', 0, 'descuento', 0,
    'valor_regalado', 0
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'folio', v_folio, 'product_id', v_product_id, 'sku', 'H04-VERIFY-SKU',
    'nombre', 'Producto H04 temporal', 'talla', 'M', 'qty', 1,
    'precio', 100, 'precio_base', 100, 'precio_original', 100
  ));
  v_moves := jsonb_build_array(jsonb_build_object(
    'fecha', '2026-07-25T13:00:00-07:00', 'tipo', 'Venta',
    'producto', 'Producto H04 temporal', 'sku', 'H04-VERIFY-SKU',
    'cant', -1, 'ref', v_folio
  ));
  v_stock_lines := jsonb_build_array(jsonb_build_object(
    'product_id', v_product_id, 'talla', 'M', 'qty', 1
  ));
  v_client_effect := jsonb_build_object(
    'id', v_client_id, 'base_version', 0, 'compras_delta', 1,
    'total_delta', 100, 'ultima', '2026-07-25',
    'after_compras', 1, 'after_total', 100
  );
  v_seller_effects := jsonb_build_array(jsonb_build_object(
    'id', v_seller_id, 'base_version', 0, 'ventas_mes_delta', 100,
    'ventas_num_delta', 1, 'comision_acum_delta', 5,
    'after_ventas_mes', 100, 'after_ventas_num', 1,
    'after_comision_acum', 5
  ));

  begin
    perform pos.commit_sale(
      'h04-verify-failing-commit', 'h04-verify-failing-operation',
      v_sale || jsonb_build_object('operation_id', 'h04-verify-failing-operation'),
      v_items, v_moves,
      jsonb_build_array(jsonb_build_object(
        'id', 'h04-verify-bad-payment', 'folio', v_folio,
        'fecha', '2026-07-25 13:00', 'tipo', 'venta', 'metodo', 'Efectivo',
        'monto', 100, 'efectivo', 90, 'tarjeta', 0, 'transferencia', 0, 'otro', 0
      )),
      v_stock_lines, true, v_client_effect, v_seller_effects
    );
  exception when check_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'H-04: la falla inyectada no fue rechazada';
  end if;
  if exists (select 1 from pos.sales where folio = v_folio)
     or exists (select 1 from pos.stock_reservations where operation_id = 'h04-verify-failing-operation')
     or exists (select 1 from pos.sale_items where folio = v_folio)
     or exists (select 1 from pos.movements where ref = v_folio)
     or exists (select 1 from pos.sale_payments where folio = v_folio) then
    raise exception 'H-04: el fallo dejó una venta parcial';
  end if;
  select (stock -> 0 ->> 'stock')::integer into v_stock
    from pos.products where id = v_product_id;
  if v_stock <> 1 then
    raise exception 'H-04: el rollback no restauró stock';
  end if;

  v_result := pos.commit_sale(
    v_commit, v_operation, v_sale, v_items, v_moves,
    jsonb_build_array(jsonb_build_object(
      'id', 'h04-verify-payment', 'folio', v_folio,
      'fecha', '2026-07-25 13:00', 'tipo', 'venta', 'metodo', 'Efectivo',
      'monto', 100, 'efectivo', 100, 'tarjeta', 0, 'transferencia', 0, 'otro', 0
    )),
    v_stock_lines, true, v_client_effect, v_seller_effects
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or coalesce((v_result ->> 'idempotent')::boolean, true) then
    raise exception 'H-04: el commit válido no fue confirmado';
  end if;
  if (select count(*) from pos.sales where folio = v_folio) <> 1
     or (select count(*) from pos.sale_items where folio = v_folio) <> 1
     or (select count(*) from pos.movements where ref = v_folio and tipo = 'Venta') <> 1
     or (select count(*) from pos.sale_payments where folio = v_folio) <> 1
     or (select compras from pos.clients where id = v_client_id) <> 1
     or (select total from pos.clients where id = v_client_id) <> 100
     or (select ventas_num from pos.sellers where id = v_seller_id) <> 1
     or (select ventas_mes from pos.sellers where id = v_seller_id) <> 100
     or (select comision_acum from pos.sellers where id = v_seller_id) <> 5 then
    raise exception 'H-04: el commit válido quedó incompleto';
  end if;

  v_result := pos.commit_sale(
    v_commit, v_operation, v_sale, v_items, v_moves,
    jsonb_build_array(jsonb_build_object(
      'id', 'h04-verify-payment', 'folio', v_folio,
      'fecha', '2026-07-25 13:00', 'tipo', 'venta', 'metodo', 'Efectivo',
      'monto', 100, 'efectivo', 100, 'tarjeta', 0, 'transferencia', 0, 'otro', 0
    )),
    v_stock_lines, true, v_client_effect, v_seller_effects
  );
  if not coalesce((v_result ->> 'idempotent')::boolean, false)
     or (select compras from pos.clients where id = v_client_id) <> 1
     or (select ventas_num from pos.sellers where id = v_seller_id) <> 1 then
    raise exception 'H-04: el reintento duplicó efectos';
  end if;

  v_result := pos.commit_sale(
    v_commit, v_operation, v_sale || jsonb_build_object('total', 101),
    v_items, v_moves, '[]'::jsonb, v_stock_lines, true,
    v_client_effect, v_seller_effects
  );
  if v_result ->> 'error' <> 'commit_mismatch' then
    raise exception 'H-04: un payload distinto reutilizó la clave';
  end if;

  delete from pos.sale_payments where folio = v_folio;
  delete from pos.movements where ref = v_folio;
  delete from pos.sales where folio = v_folio;
  delete from pos.sale_commits where commit_id in (v_commit, 'h04-verify-failing-commit');
  delete from pos.stock_reservations where operation_id in (v_operation, 'h04-verify-failing-operation');
  delete from pos.products where id = v_product_id;
  delete from pos.clients where id = v_client_id;
  delete from pos.sellers where id = v_seller_id;
end;
$$;
