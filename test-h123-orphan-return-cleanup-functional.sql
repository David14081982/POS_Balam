-- H-123 · PostgreSQL AISLADO. Ejerce preview → respaldo → ejecución → recibo.
-- Siempre termina ROLLBACK y nunca debe apuntarse a Supabase real.
begin;

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000012300';
  v_preview jsonb;
  v_backup jsonb;
  v_result jsonb;
  v_receipt jsonb;
  v_sales_before bigint;
  v_returns_before bigint;
begin
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claim.email','h123-admin@fixture.invalid',true);
  insert into auth.users(id,email) values(v_user,'h123-admin@fixture.invalid')
    on conflict(id) do update set email=excluded.email;
  insert into pos.sellers(id,nombre,iniciales,color,role,email,active,comision_acum,ventas_mes,ventas_num)
  values('h123-admin','H123 Admin','H3','#131B2E','admin','h123-admin@fixture.invalid',true,77,888,9)
  on conflict(id) do update set email=excluded.email,role='admin',active=true,
    comision_acum=77,ventas_mes=888,ventas_num=9;
  insert into pos.user_permission_role_assignments(user_id,role_code)
  values(v_user,'admin') on conflict(user_id) do update set role_code='admin';

  insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,stock,record_model)
  values('H123-PRODUCT','GUA','MC','ALG','BLA','H123','Producto testigo H123','H123-SKU',
    '[{"talla":"M","stock":7}]','v1');
  insert into pos.returns(id,folio,cliente,vendedores,metodo,total,fecha,comisiones,prior_sale_state)
  values('H123-VALID-RETURN','H123-VALID-FOLIO','Fixture','[]','Efectivo',0,
    '2026-08-20 08:00:00-07','[]','Pagado');
  insert into pos.return_commits(commit_id,return_id,folio,payload_hash,created_at)
  values
    ('H123-VALID-COMMIT','H123-VALID-RETURN','H123-VALID-FOLIO',repeat('a',64),'2026-08-20 08:00:01-07'),
    ('H123-ORPHAN-A','H123-MISSING-A','BG-H123-ORPHAN-A',repeat('b',64),'2026-08-20 08:01:00-07'),
    ('H123-ORPHAN-B','H123-MISSING-B','BG-H123-ORPHAN-B',repeat('c',64),'2026-08-20 08:02:00-07');

  update pos.system_manifest set system_mode='preproduction' where singleton;
  delete from pos.sync_devices;
  select count(*) into v_sales_before from pos.sales;
  select count(*) into v_returns_before from pos.returns;

  v_preview:=pos.preview_test_data_cleanup('custom','{"returns":true}'::jsonb,5);
  if coalesce((v_preview->>'executable')::boolean,true)
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') reason
       where reason->>'code'='orphan_return_evidence') then
    raise exception 'H123_UNSELECTED_GUARD_FAILED:%',v_preview;
  end if;

  v_preview:=pos.preview_test_data_cleanup('custom','{"orphan_return_evidence":true}'::jsonb,5);
  if not coalesce((v_preview->>'executable')::boolean,false)
     or (v_preview->'counts'->>'evidencias_huerfanas_devolucion')::integer<>2
     or jsonb_array_length(v_preview->'documents'->'orphan_return_commit_ids')<>2
     or jsonb_array_length(v_preview->'stock')<>0 then
    raise exception 'H123_ORPHAN_PREVIEW_FAILED:%',v_preview;
  end if;

  v_backup:=pos.create_test_data_cleanup_backup('custom','{"orphan_return_evidence":true}'::jsonb,
    v_preview->>'plan_hash',5,'fixture','H123-DEVICE');
  if jsonb_array_length(v_backup->'document'->'payload'->'return_commits')<>2 then
    raise exception 'H123_BACKUP_SCOPE_FAILED:%',v_backup;
  end if;

  v_result:=pos.execute_test_data_cleanup('H123-CLEANUP','custom',
    '{"orphan_return_evidence":true}'::jsonb,v_preview->>'plan_hash',
    (v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',5,'fixture','H123-DEVICE');
  if not coalesce((v_result->>'ok')::boolean,false)
     or (v_result->'counts'->>'evidencias_huerfanas_devolucion')::integer<>2 then
    raise exception 'H123_EXECUTION_FAILED:%',v_result;
  end if;

  if exists(select 1 from pos.return_commits where commit_id in('H123-ORPHAN-A','H123-ORPHAN-B'))
     or not exists(select 1 from pos.return_commits where commit_id='H123-VALID-COMMIT')
     or not exists(select 1 from pos.returns where id='H123-VALID-RETURN')
     or exists(select 1 from pos.returns where id in('H123-MISSING-A','H123-MISSING-B'))
     or (select count(*) from pos.sales)<>v_sales_before
     or (select count(*) from pos.returns)<>v_returns_before
     or (select (stock->0->>'stock')::integer from pos.products where id='H123-PRODUCT')<>7
     or (select comision_acum from pos.sellers where id='h123-admin')<>77
     or (select ventas_mes from pos.sellers where id='h123-admin')<>888
     or (select ventas_num from pos.sellers where id='h123-admin')<>9 then
    raise exception 'H123_COMMERCIAL_INVARIANT_FAILED';
  end if;
  if not exists(select 1 from pos.purged_documents where kind='return' and identity='H123-MISSING-A')
     or not exists(select 1 from pos.purged_documents where kind='return' and identity='H123-MISSING-B') then
    raise exception 'H123_REPLAY_TOMBSTONE_MISSING';
  end if;

  v_receipt:=pos.test_data_cleanup_receipt('H123-CLEANUP');
  if v_receipt->>'status'<>'completed' then
    raise exception 'H123_RECEIPT_FAILED:%',v_receipt;
  end if;
  raise notice 'H123_FUNCTIONAL_OK orphan=2 valid_return=preserved stock=7 finance=preserved receipt=completed';
end;
$$;

rollback;
