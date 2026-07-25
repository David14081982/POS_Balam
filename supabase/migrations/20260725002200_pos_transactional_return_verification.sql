-- Verificación remota autocontenida de la devolución H-04.

do $$
declare
  v_product pos.products%rowtype;
  v_client pos.clients%rowtype;
  v_seller pos.sellers%rowtype;
  v_result jsonb;
  v_failed boolean := false;
  v_folio text := 'H04-RETURN-VERIFY-20260725';
  v_product_id text := 'h04-return-product';
  v_client_id text := 'h04-return-client';
  v_seller_id text := 'h04-return-seller';
  v_email text := 'h04-return@invalid.local';
  v_sale_operation text := 'h04-return-sale-operation';
  v_return_id text := 'h04-return-first';
  v_commit text := 'h04-return-first-commit';
  v_header jsonb;
  v_items jsonb;
  v_stock_lines jsonb;
  v_client_effect jsonb;
  v_seller_effects jsonb;
begin
  select * into v_product from pos.products where deleted_at is null limit 1;
  select * into v_client from pos.clients where deleted_at is null limit 1;
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_product.id is null or v_client.id is null or v_seller.id is null then
    raise exception 'H-04 devolución requiere semillas de producto, cliente y vendedor';
  end if;

  v_product.id := v_product_id;
  v_product.sku := 'H04-RETURN-SKU';
  v_product.stock := '[{"talla":"M","escala":"L","stock":0}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_client.id := v_client_id;
  v_client.nombre := 'Cliente devolución H04 temporal';
  v_client.compras := 1;
  v_client.total := 200;
  v_client.sync_version := 0;
  v_client.sync_base_version := 0;
  v_client.sync_device_id := null;
  v_client.deleted_at := null;
  insert into pos.clients values (v_client.*);

  v_seller.id := v_seller_id;
  v_seller.nombre := 'Vendedor devolución H04 temporal';
  v_seller.email := v_email;
  v_seller.role := 'vendedor';
  v_seller.active := true;
  v_seller.ventas_mes := 200;
  v_seller.ventas_num := 1;
  v_seller.comision_acum := 10;
  v_seller.sync_version := 0;
  v_seller.sync_base_version := 0;
  v_seller.sync_device_id := null;
  v_seller.deleted_at := null;
  insert into pos.sellers values (v_seller.*);

  insert into pos.stock_reservations (
    operation_id, folio, lines, actor_email
  ) values (
    v_sale_operation, v_folio,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'talla', 'M', 'qty', 2
    )),
    v_email
  );

  insert into pos.sales (
    folio, operation_id, fecha, cliente_id, cliente, vendedores, metodo, estado,
    items, subtotal, iva, total, iva_pct, iva_included, anticipo, saldo,
    pago_efectivo, pago_otro, descuento, valor_regalado
  ) values (
    v_folio, v_sale_operation, '2026-07-25T13:00:00-07:00',
    v_client_id, 'Cliente devolución H04 temporal',
    jsonb_build_array(v_seller_id), 'Efectivo', 'Pagado',
    2, 172.41, 27.59, 200, 16, true, 200, 0, 200, 0, 0, 0
  );
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original
  ) values (
    v_folio, v_product_id, 'H04-RETURN-SKU',
    'Producto devolución H04 temporal', 'M', 2, 100, 100, 100
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text,
    true
  );

  v_header := jsonb_build_object(
    'id', v_return_id, 'folio', v_folio, 'fecha', '2026-07-25 14:00',
    'cliente', 'Cliente devolución H04 temporal',
    'vendedores', jsonb_build_array(v_seller_id),
    'metodo', 'Efectivo', 'total', 100, 'notas', ''
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'return_id', v_return_id, 'product_id', v_product_id,
    'sku', 'H04-RETURN-SKU', 'nombre', 'Producto devolución H04 temporal',
    'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 100
  ));
  v_stock_lines := jsonb_build_array(jsonb_build_object(
    'product_id', v_product_id, 'talla', 'M', 'qty', 1
  ));
  v_client_effect := jsonb_build_object(
    'id', v_client_id, 'base_version', 0,
    'total_delta', -100, 'after_total', 100
  );
  v_seller_effects := jsonb_build_array(jsonb_build_object(
    'id', v_seller_id, 'base_version', 0,
    'ventas_mes_delta', -100, 'comision_acum_delta', -5,
    'after_ventas_mes', 100, 'after_comision_acum', 5
  ));

  begin
    perform pos.commit_return(
      'h04-return-failing-commit', v_header, v_items,
      jsonb_build_array(jsonb_build_object(
        'return_id', v_return_id, 'fecha', '2026-07-25T14:00:00-07:00',
        'tipo', 'Devolución', 'producto', 'Producto devolución H04 temporal',
        'sku', 'H04-RETURN-SKU', 'cant', null, 'ref', v_folio
      )),
      v_stock_lines, v_client_effect, v_seller_effects, false
    );
  exception when not_null_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'H-04 devolución: la falla inyectada no fue rechazada';
  end if;
  if exists (select 1 from pos.returns where id = v_return_id)
     or exists (select 1 from pos.return_items where return_id = v_return_id)
     or exists (select 1 from pos.movements where return_id = v_return_id)
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_product_id) <> 0
     or (select estado from pos.sales where folio = v_folio) <> 'Pagado'
     or (select total from pos.clients where id = v_client_id) <> 200
     or (select ventas_mes from pos.sellers where id = v_seller_id) <> 200 then
    raise exception 'H-04 devolución: el fallo dejó efectos parciales';
  end if;

  v_result := pos.commit_return(
    v_commit, v_header, v_items,
    jsonb_build_array(jsonb_build_object(
      'return_id', v_return_id, 'fecha', '2026-07-25T14:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Producto devolución H04 temporal',
      'sku', 'H04-RETURN-SKU', 'cant', 1, 'ref', v_folio
    )),
    v_stock_lines, v_client_effect, v_seller_effects, false
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or v_result ->> 'sale_state' <> 'Devolución parcial'
     or (select count(*) from pos.returns where id = v_return_id) <> 1
     or (select count(*) from pos.return_items where return_id = v_return_id) <> 1
     or (select count(*) from pos.movements where return_id = v_return_id) <> 1
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_product_id) <> 1
     or (select total from pos.clients where id = v_client_id) <> 100
     or (select ventas_mes from pos.sellers where id = v_seller_id) <> 100
     or (select comision_acum from pos.sellers where id = v_seller_id) <> 5 then
    raise exception 'H-04 devolución: el commit parcial válido quedó incompleto';
  end if;

  v_result := pos.commit_return(
    v_commit, v_header, v_items,
    jsonb_build_array(jsonb_build_object(
      'return_id', v_return_id, 'fecha', '2026-07-25T14:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Producto devolución H04 temporal',
      'sku', 'H04-RETURN-SKU', 'cant', 1, 'ref', v_folio
    )),
    v_stock_lines, v_client_effect, v_seller_effects, false
  );
  if not coalesce((v_result ->> 'idempotent')::boolean, false)
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_product_id) <> 1
     or (select total from pos.clients where id = v_client_id) <> 100 then
    raise exception 'H-04 devolución: el reintento duplicó efectos';
  end if;

  v_result := pos.commit_return(
    'h04-return-over-commit',
    v_header || jsonb_build_object('id', 'h04-return-over', 'total', 200),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-return-over', 'product_id', v_product_id,
      'sku', 'H04-RETURN-SKU', 'nombre', 'Producto devolución H04 temporal',
      'talla', 'M', 'qty', 2, 'motivo', 'Talla', 'precio', 100
    )),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'talla', 'M', 'qty', 2
    )),
    null, '[]'::jsonb, false
  );
  if v_result ->> 'error' <> 'invalid_return_quantity'
     or exists (select 1 from pos.returns where id = 'h04-return-over') then
    raise exception 'H-04 devolución: la sobredevolución concurrente no fue rechazada';
  end if;

  v_result := pos.commit_return(
    'h04-return-second-commit',
    v_header || jsonb_build_object('id', 'h04-return-second'),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-return-second', 'product_id', v_product_id,
      'sku', 'H04-RETURN-SKU', 'nombre', 'Producto devolución H04 temporal',
      'talla', 'M', 'qty', 1, 'motivo', 'Defecto', 'precio', 100
    )),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-return-second', 'fecha', '2026-07-25T15:00:00-07:00',
      'tipo', 'Devolución', 'producto', 'Producto devolución H04 temporal',
      'sku', 'H04-RETURN-SKU', 'cant', 1, 'ref', v_folio
    )),
    v_stock_lines,
    jsonb_build_object(
      'id', v_client_id, 'base_version', 1,
      'total_delta', -100, 'after_total', 0
    ),
    jsonb_build_array(jsonb_build_object(
      'id', v_seller_id, 'base_version', 1,
      'ventas_mes_delta', -100, 'comision_acum_delta', -5,
      'after_ventas_mes', 0, 'after_comision_acum', 0
    )),
    false
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or v_result ->> 'sale_state' <> 'Devuelto'
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_product_id) <> 2
     or (select total from pos.clients where id = v_client_id) <> 0
     or (select ventas_mes from pos.sellers where id = v_seller_id) <> 0
     or (select comision_acum from pos.sellers where id = v_seller_id) <> 0
     or (select count(*) from pos.movements where return_id is not null and ref = v_folio) <> 2 then
    raise exception 'H-04 devolución: la devolución final quedó incompleta';
  end if;

  v_result := pos.commit_return(
    v_commit, v_header || jsonb_build_object('total', 99), v_items,
    '[]'::jsonb, v_stock_lines, v_client_effect, v_seller_effects, false
  );
  if v_result ->> 'error' <> 'commit_mismatch' then
    raise exception 'H-04 devolución: un payload distinto reutilizó la clave';
  end if;

  delete from pos.movements where ref = v_folio;
  delete from pos.returns where folio = v_folio;
  delete from pos.return_commits where folio = v_folio;
  delete from pos.sales where folio = v_folio;
  delete from pos.stock_reservations where operation_id = v_sale_operation;
  delete from pos.products where id = v_product_id;
  delete from pos.clients where id = v_client_id;
  delete from pos.sellers where id = v_seller_id;
end;
$$;
