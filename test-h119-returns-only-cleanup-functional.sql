-- H-119 · Devoluciones exclusivamente, sobre PostgreSQL AISLADO.
-- La venta, su renglón y su movimiento deben sobrevivir. Siempre hace ROLLBACK.
begin;

do $$
declare
  v_user constant uuid := '00000000-0000-4000-8000-000000011900';
  v_preview jsonb;
  v_backup jsonb;
  v_result jsonb;
  v_sale_movement_id bigint;
  v_return_movement_id bigint;
  v_legacy_return_movement_id bigint;
begin
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.email', 'h119-admin@fixture.invalid', true);

  insert into auth.users(id, email)
  values(v_user, 'h119-admin@fixture.invalid')
  on conflict(id) do update set email = excluded.email;
  update pos.sellers
     set email = 'h119-admin@fixture.invalid', role = 'admin', active = true
   where id = 'h119-admin';
  insert into pos.user_permission_role_assignments(user_id, role_code)
  values(v_user, 'admin')
  on conflict(user_id) do update set role_code = excluded.role_code;

  delete from pos.sync_devices;
  update pos.system_manifest set system_mode = 'preproduction' where singleton;

  v_preview := pos.preview_test_data_cleanup(
    'custom', '{"returns":true}'::jsonb, 3
  );
  if coalesce((v_preview->>'executable')::boolean, true)
     or v_preview->'blocked_reasons'->>0 <> 'cleanup_no_matching_data'
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') reason
       where reason #>> '{}' = 'cleanup_no_matching_data') then
    raise exception 'H119_EMPTY_RETURNS_MUST_BLOCK:%', v_preview;
  end if;

  insert into pos.products(
    id, cat, manga, tela, color, modelo, nombre, sku, stock, record_model
  ) values(
    'H119-PRODUCT', 'GUA', 'MC', 'ALG', 'BLA', 'H119',
    'Guayabera H119', 'H119-SKU',
    '[{"talla":"M","escala":"L","stock":10}]', 'v1'
  );

  alter table pos.sales disable trigger sales_require_stock_reservation;
  insert into pos.sales(
    folio, cliente, vendedores, metodo, estado, items, total, operation_id, comisiones
  ) values(
    'H119-SALE', 'Cliente H119', '[]', 'Efectivo', 'Pagado', 1, 100,
    'H119-SALE-OP', '[]'
  );
  alter table pos.sales enable trigger sales_require_stock_reservation;

  insert into pos.sale_items(folio, product_id, sku, nombre, talla, qty, precio, line_id)
  values('H119-SALE', 'H119-PRODUCT', 'H119-SKU', 'Guayabera H119', 'M', 1, 100, 'H119-SALE-LINE');
  insert into pos.sale_commits(commit_id, operation_id, folio, payload_hash)
  values('H119-SALE-COMMIT', 'H119-SALE-OP', 'H119-SALE', repeat('a', 64));

  insert into pos.returns(id, folio, cliente, vendedores, metodo, total, fecha, comisiones)
  values('H119-RETURN', 'H119-SALE', 'Cliente H119', '[]', 'Efectivo', 100,
    '2026-08-19 12:00:00-07', '[]');
  insert into pos.return_items(
    return_id, product_id, source_sale_line_id, sku, nombre, talla, qty, motivo, precio, line_id
  ) values(
    'H119-RETURN', 'H119-PRODUCT', 'H119-SALE-LINE', 'H119-SKU',
    'Guayabera H119', 'M', 1, 'CAMBIO', 100, 'H119-RETURN-LINE'
  );
  insert into pos.return_commits(commit_id, return_id, folio, payload_hash)
  values('H119-RETURN-COMMIT', 'H119-RETURN', 'H119-SALE', repeat('b', 64));

  insert into pos.movements(fecha, tipo, producto, product_id, sku, talla, cant, ref)
  values('2026-08-19 11:00:00-07', 'Venta', 'Guayabera H119', 'H119-PRODUCT',
    'H119-SKU', 'M', -1, 'H119-SALE') returning id into v_sale_movement_id;
  insert into pos.movements(return_id, fecha, tipo, producto, product_id, sku, talla, cant, ref)
  values('H119-RETURN', '2026-08-19 12:00:00-07', 'Devolución', 'Guayabera H119',
    'H119-PRODUCT', 'H119-SKU', 'M', 1, 'H119-SALE') returning id into v_return_movement_id;
  insert into pos.movements(fecha, tipo, producto, product_id, sku, talla, cant, ref)
  values('2026-08-19 12:00:01-07', 'Devolución', 'Guayabera H119 legacy',
    'H119-PRODUCT', 'H119-SKU', 'M', 1, 'H119-SALE') returning id into v_legacy_return_movement_id;

  v_preview := pos.preview_test_data_cleanup(
    'custom', '{"returns":true}'::jsonb, 3
  );
  if not coalesce((v_preview->>'executable')::boolean, false)
     or (v_preview->'selection_normalized'->>'returns')::boolean is not true
     or (v_preview->'selection_normalized'->>'sales')::boolean is not false
     or (v_preview->'counts'->>'devoluciones')::integer <> 1
     or (select (x->>'current_stock')::integer from jsonb_array_elements(v_preview->'stock') x
          where x->>'product_id' = 'H119-PRODUCT') <> 10
     or (select (x->>'delta')::integer from jsonb_array_elements(v_preview->'stock') x
          where x->>'product_id' = 'H119-PRODUCT') <> -1
     or (select (x->>'target_stock')::integer from jsonb_array_elements(v_preview->'stock') x
          where x->>'product_id' = 'H119-PRODUCT') <> 9 then
    raise exception 'H119_RETURNS_ONLY_PREVIEW_FAILED:%', v_preview;
  end if;

  v_backup := pos.create_test_data_cleanup_backup(
    'custom', '{"returns":true}'::jsonb, v_preview->>'plan_hash', 3,
    'h119-fixture', 'h119-device'
  );
  if exists(select 1 from jsonb_array_elements(v_backup->'document'->'payload'->'movements') x
       where (x->>'id')::bigint = v_sale_movement_id)
     or not exists(select 1 from jsonb_array_elements(v_backup->'document'->'payload'->'movements') x
       where (x->>'id')::bigint = v_return_movement_id)
     or not exists(select 1 from jsonb_array_elements(v_backup->'document'->'payload'->'movements') x
       where (x->>'id')::bigint = v_legacy_return_movement_id) then
    raise exception 'H119_BACKUP_MOVEMENT_SCOPE_FAILED:%', v_backup->'document'->'payload'->'movements';
  end if;
  v_result := pos.execute_test_data_cleanup(
    'H119-CLEANUP', 'custom', '{"returns":true}'::jsonb,
    v_preview->>'plan_hash', (v_backup->>'backup_id')::uuid,
    'LIMPIAR OPERACIONES', 3, 'h119-fixture', 'h119-device'
  );

  if not coalesce((v_result->>'ok')::boolean, false)
     or (select (stock->0->>'stock')::integer from pos.products where id = 'H119-PRODUCT') <> 9
     or not exists(select 1 from pos.sales where folio = 'H119-SALE')
     or not exists(select 1 from pos.sale_items where folio = 'H119-SALE' and line_id = 'H119-SALE-LINE')
     or not exists(select 1 from pos.sale_commits where commit_id = 'H119-SALE-COMMIT')
     or exists(select 1 from pos.returns where id = 'H119-RETURN')
     or exists(select 1 from pos.return_items where return_id = 'H119-RETURN')
     or exists(select 1 from pos.return_commits where return_id = 'H119-RETURN')
     or exists(select 1 from pos.movements where id in(v_return_movement_id, v_legacy_return_movement_id)) then
    raise exception 'H119_RETURNS_ONLY_EXECUTION_FAILED:%', v_result;
  end if;

  if not exists(select 1 from pos.movements where id = v_sale_movement_id
      and tipo = 'Venta' and ref = 'H119-SALE' and return_id is null) then
    raise exception 'H119_SALE_MOVEMENT_WAS_DELETED';
  end if;

  raise notice 'H119_RETURNS_ONLY_OK return=deleted stock=9 sale=preserved sale_movement=preserved';
end;
$$;

rollback;
