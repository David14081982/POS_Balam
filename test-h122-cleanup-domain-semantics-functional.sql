-- H-122 · PostgreSQL AISLADO. Verifica que una limpieza no financiera no
-- hereda guardas ni mutaciones de comisión. Siempre termina ROLLBACK.
begin;

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000012200';
  v_preview jsonb;
  v_backup jsonb;
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claim.email','h122-admin@fixture.invalid',true);
  insert into auth.users(id,email) values(v_user,'h122-admin@fixture.invalid')
    on conflict(id) do update set email=excluded.email;
  insert into pos.sellers(id,nombre,iniciales,color,role,email,active,comision_acum,ventas_mes,ventas_num)
  values('h122-admin','H122 Admin','H1','#131B2E','admin','h122-admin@fixture.invalid',true,999,888,7)
  on conflict(id) do update set email=excluded.email,role='admin',active=true,
    comision_acum=999,ventas_mes=888,ventas_num=7;
  insert into pos.user_permission_role_assignments(user_id,role_code)
  values(v_user,'admin') on conflict(user_id) do update set role_code='admin';

  alter table pos.sales disable trigger sales_require_stock_reservation;
  insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
  values('H122-LEGACY-SALE','Fixture','["h122-admin"]','Efectivo','Pagado',1,100,
    'H122-LEGACY-OP',null);
  alter table pos.sales enable trigger sales_require_stock_reservation;
  insert into pos.loan_documents(id,folio,state,document)
  values('H122-LOAN','H122-LOAN-FOLIO','pendiente','{}');

  update pos.system_manifest set system_mode='preproduction' where singleton;
  delete from pos.sync_devices;

  v_preview:=pos.preview_test_data_cleanup('custom','{"loans":true}',4);
  if not (v_preview->>'executable')::boolean
     or exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') reason
       where reason->>'code'='commission_evidence_missing') then
    raise exception 'H122_LOAN_PREVIEW_INHERITED_COMMISSION_GUARD:%',v_preview;
  end if;

  v_backup:=pos.create_test_data_cleanup_backup('custom','{"loans":true}',
    v_preview->>'plan_hash',4,'fixture','H122-DEVICE');
  v_result:=pos.execute_test_data_cleanup('H122-CLEANUP','custom','{"loans":true}',
    v_preview->>'plan_hash',(v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',
    4,'fixture','H122-DEVICE');
  if not (v_result->>'ok')::boolean
     or exists(select 1 from pos.loan_documents where id='H122-LOAN')
     or (select comision_acum from pos.sellers where id='h122-admin')<>999
     or (select ventas_mes from pos.sellers where id='h122-admin')<>888
     or (select ventas_num from pos.sellers where id='h122-admin')<>7 then
    raise exception 'H122_NON_FINANCIAL_EXECUTION_MUTATED_SELLER:%',v_result;
  end if;

  v_preview:=pos.test_data_cleanup_plan('custom','{"exchanges":true}');
  if not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') reason
    where reason->>'code'='commission_evidence_missing' and reason->>'document'='sale') then
    raise exception 'H122_FINANCIAL_GUARD_WAS_RELAXED:%',v_preview;
  end if;
  raise notice 'H122_FUNCTIONAL_OK loan=deleted seller=preserved financial_guard=closed';
end;
$$;

rollback;
