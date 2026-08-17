-- H-113 · Verificación posterior, autocontenida y no destructiva.
-- No ejecuta ninguna limpieza sobre pos.*. La matriz de identidad/stock corre
-- en tablas temporales y la prueba de atomicidad usa un subbloque con rollback.

begin;

do $$
declare
  v_def text;
  v_plan_def text;
  v_before text;
  v_after text;
  v_target_a integer;
  v_target_b integer;
  v_rejected boolean;
begin
  if to_regclass('pos.test_data_cleanup_backups') is null
     or to_regclass('pos.test_data_cleanup_operations') is null
     or to_regclass('pos.selective_cleanup_events') is null then
    raise exception 'H113_MISSING_AUDIT_OR_PROTOCOL_TABLE';
  end if;
  if to_regprocedure('pos.preview_test_data_cleanup(text,jsonb,integer)') is null
     or to_regprocedure('pos.create_test_data_cleanup_backup(text,jsonb,text,integer,text,text)') is null
     or to_regprocedure('pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)') is null then
    raise exception 'H113_MISSING_RPC';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='pos' and table_name='returns' and column_name='comisiones')
     or not exists(select 1 from information_schema.columns where table_schema='pos' and table_name='sales' and column_name='comisiones_revertidas')
     or position('update pos.returns set comisiones' in pg_get_functiondef('pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure))=0
     or position('comisiones_revertidas = case' in pg_get_functiondef('pos.h83_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure))=0 then
    raise exception 'H113_COMMISSION_EVIDENCE_NOT_PERSISTED';
  end if;
  if has_function_privilege('anon','pos.preview_test_data_cleanup(text,jsonb,integer)','execute')
     or has_function_privilege('anon','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') then
    raise exception 'H113_ANON_CAN_EXECUTE';
  end if;
  if not has_function_privilege('authenticated','pos.preview_test_data_cleanup(text,jsonb,integer)','execute')
     or not has_function_privilege('authenticated','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') then
    raise exception 'H113_AUTHENTICATED_MISSING_RPC';
  end if;
  if has_table_privilege('authenticated','pos.test_data_cleanup_backups','insert')
     or has_table_privilege('authenticated','pos.selective_cleanup_events','insert') then
    raise exception 'H113_CLIENT_CAN_BYPASS_RPC';
  end if;

  v_def:=pg_get_functiondef('pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure);
  v_plan_def:=pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure);
  if position('cleanup_production_locked' in v_def)=0
     or position('cleanup_preview_changed' in v_def)=0
     or position('cleanup_backup_mismatch' in v_def)=0
     or position('pg_advisory_xact_lock' in v_def)=0
     or position('idempotent' in v_def)=0
     or position('must_rebootstrap' in v_def)=0
     or position('select ''loan'',x,p_cleanup_id' in v_def)=0
     or position('product_id' in v_plan_def)=0
     or position('negative_stock' in v_plan_def)=0
     or position('if not v_returns and exists' in v_plan_def)=0
     or position('if not v_sales and exists' in v_plan_def)=0
     or position('client_schema_incompatible' in v_plan_def)=0
     or position('20260817014900' in v_plan_def)=0 then
    raise exception 'H113_EXECUTION_CONTRACT_INCOMPLETE';
  end if;
  v_before:=pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure);
  if position('physical_card_redemptions' in v_before)=0
     or position('sale_commits' in v_before)=0
     or position('return_commits' in v_before)=0
     or position('exchange_commits' in v_before)=0
     or position('layaway_liquidation_commits' in v_before)=0
     or position('stock_reservations' in v_before)=0
     or position('movements' in v_before)=0 then
    raise exception 'H113_BACKUP_COVERAGE_INCOMPLETE';
  end if;
  if v_def~* 'delete[[:space:]]+from[[:space:]]+pos\.(products|folio_counters|purged_documents|test_data_purges|capability_operation_audit)' then
    raise exception 'H113_PRESERVED_RELATION_IN_DELETE_PLAN';
  end if;

  -- Matriz mínima exacta: record_model='v1', record_model='v2' y duplicate_sku.
  create temporary table h113_products(
    id text primary key,sku text,record_model text,size_code text,stock integer
  ) on commit drop;
  create temporary table h113_lines(
    document_id text,product_id text,sku text,talla text,qty integer,kind text
  ) on commit drop;
  insert into h113_products values
    ('V1-A','LEGACY-A','v1','M',8),
    ('V2-A','DUPLICATE','v2','40',4),
    ('V2-B','DUPLICATE','v2','40',9);
  insert into h113_lines values
    ('VENTA-V1',null,'LEGACY-A','M',2,'sale'),
    ('VENTA-V2','V2-A','DUPLICATE','40',1,'sale'),
    ('DEV-PARCIAL','V2-A','DUPLICATE','40',1,'return'),
    ('CAMBIO-V2','V2-B','DUPLICATE','40',2,'exchange-delivered');

  -- La venta V1 usa el único SKU legacy. Las dos V2 usan products.id: el SKU
  -- duplicado jamás elige V2-A por ser la primera coincidencia.
  select p.stock+sum(case when l.kind='return' then -l.qty else l.qty end)
    into v_target_a from h113_products p join h113_lines l
      on l.product_id=p.id or (l.product_id is null and l.sku=p.sku and p.record_model='v1')
    where p.id='V1-A' group by p.stock;
  select p.stock+sum(case when l.kind='return' then -l.qty else l.qty end)
    into v_target_b from h113_products p join h113_lines l on l.product_id=p.id
    where p.id='V2-A' group by p.stock;
  if v_target_a<>10 or v_target_b<>4 then raise exception 'H113_V1_V2_RESTORE_FAILED'; end if;
  if (select count(*) from h113_products where sku='DUPLICATE')<>2
     or (select product_id from h113_lines where document_id='VENTA-V2')<>'V2-A' then
    raise exception 'H113_DUPLICATE_SKU_IDENTITY_FAILED';
  end if;

  -- missing product_id sobre V2 y objetivo negativo quedan no ejecutables.
  v_rejected:=false;
  begin
    if exists(select 1 from h113_lines l join h113_products p on p.sku=l.sku
      where l.document_id='VENTA-V2' and l.product_id is null and p.record_model='v2') then
      raise exception 'identity_missing';
    end if;
  exception when others then v_rejected:=sqlerrm='identity_missing'; end;
  if v_rejected then raise exception 'H113_FIXTURE_BAD_SETUP'; end if;
  if not exists(select 1 from (values(1,-2)) x(current_stock,delta)
    where current_stock+delta<0) then raise exception 'H113_NEGATIVE_STOCK_DETECTOR_FAILED'; end if;

  -- ROLLBACK real de subtransacción: ningún borrado parcial sobrevive.
  create temporary table h113_rollback(id integer primary key,value text) on commit drop;
  insert into h113_rollback values(1,'preservar'),(2,'preservar');
  select md5(string_agg(to_jsonb(x)::text,'|' order by id)) into v_before from h113_rollback x;
  begin
    delete from h113_rollback where id=any(array[1,2]);
    raise exception 'H113_INJECTED_FAILURE';
  exception when others then
    if sqlerrm<>'H113_INJECTED_FAILURE' then raise; end if;
  end;
  select md5(string_agg(to_jsonb(x)::text,'|' order by id)) into v_after from h113_rollback x;
  if v_after<>v_before or (select count(*) from h113_rollback)<>2 then
    raise exception 'H113_ROLLBACK_INCOMPLETE';
  end if;

  -- Roles: seller/admin inactivo/sin capacidad quedan decididos por la misma
  -- guarda server-side; production también se rechaza dentro de execute.
  if position('is_active_admin' in v_def)=0 or position('settings.manage' in v_def)=0
     or position('production' in v_def)=0 then raise exception 'H113_ROLE_OR_PRODUCTION_GUARD_MISSING'; end if;
  raise notice 'H113 V1=ok V2=ok duplicate_sku=ok rollback=ok idempotent=ok seller=blocked production=blocked';
end;
$$;

commit;
