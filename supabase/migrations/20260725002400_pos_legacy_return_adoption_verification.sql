-- Verificación autocontenida de adopción de colas antiguas H-04.

do $$
declare
  v_product pos.products%rowtype;
  v_client pos.clients%rowtype;
  v_seller pos.sellers%rowtype;
  v_result jsonb;
  v_folio text := 'H04-LEGACY-VERIFY-20260725';
  v_product_id text := 'h04-legacy-product';
  v_client_id text := 'h04-legacy-client';
  v_seller_id text := 'h04-legacy-seller';
  v_email text := 'h04-legacy@invalid.local';
  v_sale_operation text := 'h04-legacy-sale-operation';
  v_targets jsonb;
begin
  select * into v_product from pos.products where deleted_at is null limit 1;
  select * into v_client from pos.clients where deleted_at is null limit 1;
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_product.id is null or v_client.id is null or v_seller.id is null then
    raise exception 'H-04 legacy requiere semillas de producto, cliente y vendedor';
  end if;

  v_product.id := v_product_id;
  v_product.sku := 'H04-LEGACY-SKU';
  v_product.stock := '[{"talla":"M","escala":"L","stock":0}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_client.id := v_client_id;
  v_client.nombre := 'Cliente legacy H04 temporal';
  v_client.compras := 1;
  v_client.total := 200;
  v_client.sync_version := 0;
  v_client.sync_base_version := 0;
  v_client.sync_device_id := null;
  v_client.deleted_at := null;
  insert into pos.clients values (v_client.*);

  v_seller.id := v_seller_id;
  v_seller.nombre := 'Vendedor legacy H04 temporal';
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

  insert into pos.stock_reservations (operation_id, folio, lines, actor_email)
  values (
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
    v_client_id, 'Cliente legacy H04 temporal', jsonb_build_array(v_seller_id),
    'Efectivo', 'Pagado', 2, 172.41, 27.59, 200, 16, true,
    200, 0, 200, 0, 0, 0
  );
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original
  ) values (
    v_folio, v_product_id, 'H04-LEGACY-SKU',
    'Producto legacy H04 temporal', 'M', 2, 100, 100, 100
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text,
    true
  );

  -- Ruta A: los snapshots antiguos aún no llegaron; el adoptador los aplica.
  v_targets := jsonb_build_object(
    'complete', true,
    'products', jsonb_build_array(jsonb_build_object(
      'id', v_product_id, 'base_version', 1,
      'stock', '[{"talla":"M","escala":"L","stock":1}]'::jsonb
    )),
    'client', jsonb_build_object(
      'id', v_client_id, 'base_version', 1, 'total', 100
    ),
    'sellers', jsonb_build_array(jsonb_build_object(
      'id', v_seller_id, 'base_version', 1,
      'ventas_mes', 100, 'comision_acum', 5
    ))
  );
  v_result := pos.commit_legacy_return(
    'h04-legacy-first-commit',
    jsonb_build_object(
      'id', 'h04-legacy-first', 'folio', v_folio,
      'fecha', '2026-07-25 14:00', 'cliente', 'Cliente legacy H04 temporal',
      'vendedores', jsonb_build_array(v_seller_id),
      'metodo', 'Efectivo', 'total', 100, 'notas', ''
    ),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-legacy-first', 'product_id', v_product_id,
      'sku', 'H04-LEGACY-SKU', 'nombre', 'Producto legacy H04 temporal',
      'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 100
    )),
    jsonb_build_array(jsonb_build_object(
      'fecha', '2026-07-25T14:00:00-07:00', 'tipo', 'Devolución',
      'producto', 'Producto legacy H04 temporal', 'sku', 'H04-LEGACY-SKU',
      'cant', 1, 'ref', v_folio
    )),
    v_targets
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or not coalesce((v_result ->> 'legacy_adopted')::boolean, false)
     or (select (stock -> 0 ->> 'stock')::integer from pos.products where id = v_product_id) <> 1
     or (select sync_version from pos.products where id = v_product_id) <> 2
     or (select total from pos.clients where id = v_client_id) <> 100
     or (select ventas_mes from pos.sellers where id = v_seller_id) <> 100
     or (select comision_acum from pos.sellers where id = v_seller_id) <> 5 then
    raise exception 'H-04 legacy: no adoptó objetivos aún no aplicados result=% product=% pv=% client=% seller=% commission=%',
      v_result,
      (select stock from pos.products where id = v_product_id),
      (select sync_version from pos.products where id = v_product_id),
      (select total from pos.clients where id = v_client_id),
      (select ventas_mes from pos.sellers where id = v_seller_id),
      (select comision_acum from pos.sellers where id = v_seller_id);
  end if;

  -- Reintento: commit y objetivos ya aplicados se reconocen, no se duplican.
  v_result := pos.commit_legacy_return(
    'h04-legacy-first-commit',
    jsonb_build_object(
      'id', 'h04-legacy-first', 'folio', v_folio,
      'fecha', '2026-07-25 14:00', 'cliente', 'Cliente legacy H04 temporal',
      'vendedores', jsonb_build_array(v_seller_id),
      'metodo', 'Efectivo', 'total', 100, 'notas', ''
    ),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-legacy-first', 'product_id', v_product_id,
      'sku', 'H04-LEGACY-SKU', 'nombre', 'Producto legacy H04 temporal',
      'talla', 'M', 'qty', 1, 'motivo', 'Talla', 'precio', 100
    )),
    jsonb_build_array(jsonb_build_object(
      'fecha', '2026-07-25T14:00:00-07:00', 'tipo', 'Devolución',
      'producto', 'Producto legacy H04 temporal', 'sku', 'H04-LEGACY-SKU',
      'cant', 1, 'ref', v_folio
    )),
    v_targets
  );
  if not coalesce((v_result ->> 'idempotent')::boolean, false)
     or (select sync_version from pos.products where id = v_product_id) <> 2
     or (select sync_version from pos.clients where id = v_client_id) <> 2
     or (select sync_version from pos.sellers where id = v_seller_id) <> 2 then
    raise exception 'H-04 legacy: el reintento duplicó objetivos';
  end if;

  -- Ruta B: snapshots antiguos ya aplicados antes de llegar al return.
  update pos.products
     set stock = '[{"talla":"M","escala":"L","stock":2}]'::jsonb,
         sync_base_version = sync_version
   where id = v_product_id;
  update pos.clients
     set total = 0, sync_base_version = sync_version
   where id = v_client_id;
  update pos.sellers
     set ventas_mes = 0, comision_acum = 0, sync_base_version = sync_version
   where id = v_seller_id;

  v_targets := jsonb_build_object(
    'complete', true,
    'products', jsonb_build_array(jsonb_build_object(
      'id', v_product_id, 'base_version', 2,
      'stock', '[{"talla":"M","escala":"L","stock":2}]'::jsonb
    )),
    'client', jsonb_build_object(
      'id', v_client_id, 'base_version', 2, 'total', 0
    ),
    'sellers', jsonb_build_array(jsonb_build_object(
      'id', v_seller_id, 'base_version', 2,
      'ventas_mes', 0, 'comision_acum', 0
    ))
  );
  v_result := pos.commit_legacy_return(
    'h04-legacy-second-commit',
    jsonb_build_object(
      'id', 'h04-legacy-second', 'folio', v_folio,
      'fecha', '2026-07-25 15:00', 'cliente', 'Cliente legacy H04 temporal',
      'vendedores', jsonb_build_array(v_seller_id),
      'metodo', 'Efectivo', 'total', 100, 'notas', ''
    ),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-legacy-second', 'product_id', v_product_id,
      'sku', 'H04-LEGACY-SKU', 'nombre', 'Producto legacy H04 temporal',
      'talla', 'M', 'qty', 1, 'motivo', 'Defecto', 'precio', 100
    )),
    jsonb_build_array(jsonb_build_object(
      'fecha', '2026-07-25T15:00:00-07:00', 'tipo', 'Devolución',
      'producto', 'Producto legacy H04 temporal', 'sku', 'H04-LEGACY-SKU',
      'cant', 1, 'ref', v_folio
    )),
    v_targets
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or v_result ->> 'sale_state' <> 'Devuelto'
     or (select sync_version from pos.products where id = v_product_id) <> 3
     or (select sync_version from pos.clients where id = v_client_id) <> 3
     or (select sync_version from pos.sellers where id = v_seller_id) <> 3 then
    raise exception 'H-04 legacy: no reconoció snapshots ya aplicados';
  end if;

  -- Una tercera versión no se pisa: queda conflicto explícito sin devolución.
  v_result := pos.commit_legacy_return(
    'h04-legacy-conflict-commit',
    jsonb_build_object(
      'id', 'h04-legacy-conflict', 'folio', v_folio,
      'fecha', '2026-07-25 16:00', 'total', 0
    ),
    jsonb_build_array(jsonb_build_object(
      'return_id', 'h04-legacy-conflict', 'product_id', v_product_id,
      'sku', 'H04-LEGACY-SKU', 'talla', 'M', 'qty', 1, 'precio', 0
    )),
    '[]'::jsonb,
    jsonb_build_object(
      'complete', true,
      'products', jsonb_build_array(jsonb_build_object(
        'id', v_product_id, 'base_version', 0,
        'stock', '[{"talla":"M","escala":"L","stock":99}]'::jsonb
      )),
      'client', null, 'sellers', '[]'::jsonb
    )
  );
  if v_result ->> 'error' <> 'legacy_version_conflict'
     or exists (select 1 from pos.returns where id = 'h04-legacy-conflict') then
    raise exception 'H-04 legacy: sobrescribió una versión posterior';
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
