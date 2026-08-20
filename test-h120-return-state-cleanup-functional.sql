-- H-120 · venta de 2 piezas → devolución de 1 → limpiar sólo Devoluciones.
-- La venta y su kardex sobreviven con el estado exacto anterior. Siempre ROLLBACK.
begin;

do $$
declare
  v_user constant uuid := '00000000-0000-4000-8000-000000012000';
  v_preview jsonb;
  v_backup jsonb;
  v_result jsonb;
  v_sale_movement_id bigint;
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='pos' and table_name='returns'
      and column_name='prior_sale_state'
  ) then
    raise exception 'H120_PRIOR_SALE_STATE_CONTRACT_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.email', 'h120-admin@fixture.invalid', true);
  insert into auth.users(id,email) values(v_user,'h120-admin@fixture.invalid')
  on conflict(id) do update set email=excluded.email;
  update pos.sellers set email='h120-admin@fixture.invalid',role='admin',active=true
  where id='h119-admin';
  insert into pos.user_permission_role_assignments(user_id,role_code)
  values(v_user,'admin') on conflict(user_id) do update set role_code=excluded.role_code;
  delete from pos.sync_devices;
  update pos.system_manifest set system_mode='preproduction' where singleton;

  -- Históricos incompletos: se muestran, pero no se reinterpretan ni se borran.
  alter table pos.sales disable trigger sales_require_stock_reservation;
  insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
  values('H120-LEGACY-SALE','Cliente histórico','[]','Efectivo','Devolución parcial',1,50,
    'H120-LEGACY-OP','[]');
  alter table pos.sales enable trigger sales_require_stock_reservation;
  insert into pos.returns(id,folio,cliente,vendedores,metodo,total,fecha,comisiones,prior_sale_state)
  values('H120-LEGACY-RETURN','H120-LEGACY-SALE','Cliente histórico','[]','Efectivo',50,
    '2026-08-18 12:00:00-07','[]',null);
  insert into pos.return_commits(commit_id,return_id,folio,payload_hash)
  values('H120-ORPHAN-COMMIT','H120-MISSING-RETURN','H120-ORPHAN-SALE',repeat('c',64));
  v_preview:=pos.preview_test_data_cleanup('custom','{"returns":true}'::jsonb,4);
  if coalesce((v_preview->>'executable')::boolean,true)
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') r
          where r->>'code'='return_state_evidence_missing')
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') r
          where r->>'code'='orphan_return_evidence')
     or v_preview->'documents'->'orphan_return_commits'->0->>'folio'<>'H120-ORPHAN-SALE' then
    raise exception 'H120_HISTORICAL_GUARDS_FAILED:%',v_preview;
  end if;
  delete from pos.return_commits where commit_id='H120-ORPHAN-COMMIT';
  delete from pos.returns where id='H120-LEGACY-RETURN';
  delete from pos.sales where folio='H120-LEGACY-SALE';

  insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,stock,record_model)
  values('H120-PRODUCT','GUA','MC','ALG','BLA','H120','Guayabera H120','H120-SKU',
    '[{"talla":"M","escala":"L","stock":9}]','v1');
  alter table pos.sales disable trigger sales_require_stock_reservation;
  insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
  values('H120-SALE','Cliente H120','[]','Efectivo','Devolución parcial',2,200,
    'H120-SALE-OP','[]');
  alter table pos.sales enable trigger sales_require_stock_reservation;
  insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id)
  values('H120-SALE','H120-PRODUCT','H120-SKU','Guayabera H120','M',2,100,'H120-SALE-LINE');
  insert into pos.sale_commits(commit_id,operation_id,folio,payload_hash)
  values('H120-SALE-COMMIT','H120-SALE-OP','H120-SALE',repeat('a',64));
  insert into pos.stock_reservations(operation_id,folio,lines)
  values('H120-SALE-OP','H120-SALE',
    '[{"product_id":"H120-PRODUCT","talla":"M","qty":2}]');
  insert into pos.returns(id,folio,cliente,vendedores,metodo,total,fecha,comisiones,prior_sale_state)
  values('H120-RETURN','H120-SALE','Cliente H120','[]','Efectivo',100,
    '2026-08-19 12:00:00-07','[]','Pagado');
  insert into pos.return_items(return_id,product_id,source_sale_line_id,sku,nombre,talla,qty,motivo,precio,line_id)
  values('H120-RETURN','H120-PRODUCT','H120-SALE-LINE','H120-SKU',
    'Guayabera H120','M',1,'CAMBIO',100,'H120-RETURN-LINE');
  insert into pos.return_commits(commit_id,return_id,folio,payload_hash)
  values('H120-RETURN-COMMIT','H120-RETURN','H120-SALE',repeat('b',64));
  insert into pos.movements(fecha,tipo,producto,product_id,sku,talla,cant,ref)
  values('2026-08-19 11:00:00-07','Venta','Guayabera H120','H120-PRODUCT',
    'H120-SKU','M',-2,'H120-SALE') returning id into v_sale_movement_id;
  insert into pos.movements(return_id,fecha,tipo,producto,product_id,sku,talla,cant,ref)
  values('H120-RETURN','2026-08-19 12:00:00-07','Devolución','Guayabera H120',
    'H120-PRODUCT','H120-SKU','M',1,'H120-SALE');

  v_preview:=pos.preview_test_data_cleanup('custom','{"returns":true}'::jsonb,4);
  if not coalesce((v_preview->>'executable')::boolean,false)
     or (v_preview->'counts'->>'devoluciones')::integer<>1
     or v_preview->'documents'->'sale_state_restorations'->0->>'prior_state'<>'Pagado'
     or (select (x->>'current_stock')::integer from jsonb_array_elements(v_preview->'stock') x
          where x->>'product_id'='H120-PRODUCT')<>9
     or (select (x->>'target_stock')::integer from jsonb_array_elements(v_preview->'stock') x
          where x->>'product_id'='H120-PRODUCT')<>8 then
    raise exception 'H120_PREVIEW_FAILED:%',v_preview;
  end if;

  v_backup:=pos.create_test_data_cleanup_backup('custom','{"returns":true}'::jsonb,
    v_preview->>'plan_hash',4,'h120-fixture','h120-device');
  if v_backup->'document'->'payload'->'sales'->0->>'folio'<>'H120-SALE'
     or v_backup->'document'->'payload'->'sales'->0->>'estado'<>'Devolución parcial' then
    raise exception 'H120_BACKUP_SALE_STATE_MISSING:%',v_backup;
  end if;
  v_result:=pos.execute_test_data_cleanup('H120-CLEANUP','custom','{"returns":true}'::jsonb,
    v_preview->>'plan_hash',(v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',
    4,'h120-fixture','h120-device');

  if not coalesce((v_result->>'ok')::boolean,false)
     or (select estado from pos.sales where folio='H120-SALE')<>'Pagado'
     or (select (stock->0->>'stock')::integer from pos.products where id='H120-PRODUCT')<>8
     or not exists(select 1 from pos.sale_items where folio='H120-SALE')
     or not exists(select 1 from pos.sale_commits where folio='H120-SALE')
     or not exists(select 1 from pos.movements where id=v_sale_movement_id and tipo='Venta')
     or exists(select 1 from pos.returns where id='H120-RETURN')
     or exists(select 1 from pos.return_items where return_id='H120-RETURN')
     or exists(select 1 from pos.return_commits where return_id='H120-RETURN')
     or v_result->'sale_states'->0->>'prior_state'<>'Pagado' then
    raise exception 'H120_EXECUTION_FAILED:%',v_result;
  end if;

  raise notice 'H120_LIFECYCLE_OK sale=Pagado stock=8 return=deleted sale_kardex=preserved';
end;
$$;

rollback;
