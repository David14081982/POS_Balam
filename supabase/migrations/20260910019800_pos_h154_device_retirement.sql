-- H-154: preserve administrative retirement and fence retired installations.
-- Generated from the live definitions; existing contracts and ACL remain in place.
begin;
set local lock_timeout = '10s';

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='establish_sync_point_zero' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='c03f311cf5a28f38e422237c64ffbb7c') then
  raise exception 'H154_DEFINITION_DRIFT: establish_sync_point_zero';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.establish_sync_point_zero(p_protocol_version integer, p_expected_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare v_epoch bigint; v_products bigint; v_pieces numeric; v_fingerprint text;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception 'sync_point_zero_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.sync.point-zero',0));
  perform pos.assert_sync_write_context(p_protocol_version,p_expected_epoch);
  select count(distinct p.id), coalesce(sum(case when p.record_model='v2'
      then coalesce(p.stock_quantity,0) else coalesce((s.item->>'stock')::numeric,0) end),0)
    into v_products,v_pieces from pos.products p
    left join lateral jsonb_array_elements(case when p.record_model='v2' then '[]'::jsonb else coalesce(p.stock,'[]'::jsonb) end) s(item) on true
    where p.deleted_at is null;
  select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id),''))
    into v_fingerprint from pos.products p where p.deleted_at is null;
  update pos.system_manifest set data_epoch=data_epoch+1,updated_at=now()
    where singleton returning data_epoch into v_epoch;
  insert into pos.inventory_sync_baselines(data_epoch,product_count,piece_count,fingerprint,created_by)
  values(v_epoch,v_products,v_pieces,v_fingerprint,auth.uid());
  update pos.sync_devices set status='must_rebootstrap' where device_id is not null and status <> 'revoked';
  perform pos.bump_sync_domain('products','point-zero');
  perform pos.bump_sync_domain('config','point-zero');
  return jsonb_build_object('ok',true,'data_epoch',v_epoch,'product_count',v_products,
    'piece_count',v_pieces,'fingerprint',v_fingerprint);
end;
$function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='execute_point_zero' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='622c560d4c564ffad15a6593095ccca7') then
  raise exception 'H154_DEFINITION_DRIFT: execute_point_zero';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.execute_point_zero(p_operation_id text, p_preview_token text, p_backup_id uuid, p_confirmation text, p_client_build text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare
  v_preview jsonb; v_after jsonb; v_backup pos.point_zero_backups%rowtype;
  v_prior pos.point_zero_operations%rowtype; v_preserved text; v_preserved_after text;
  v_product_ids text[]; v_move_ids bigint[]; v_reclass_ids text[]; v_adjust_ids uuid[];
  v_rows bigint; v_epoch bigint; v_result jsonb; v_error text;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='point_zero_requires_admin';
  end if;
  if nullif(trim(coalesce(p_operation_id,'')),'') is null then raise exception 'point_zero_invalid_operation_id'; end if;
  if p_confirmation is distinct from 'PUNTO CERO' then raise exception 'point_zero_confirmation_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.point-zero.execute',0));
  select * into v_prior from pos.point_zero_operations where operation_id=p_operation_id;
  if found then return v_prior.result || jsonb_build_object('idempotent',true); end if;
  v_preview := pos.point_zero_preview();
  if v_preview->>'system_mode' <> 'preproduction' then raise exception 'point_zero_production_locked'; end if;
  if v_preview->>'preview_token' <> coalesce(p_preview_token,'') then raise exception 'point_zero_preview_changed'; end if;
  if not coalesce((v_preview->>'sync_complete')::boolean,false) then raise exception 'point_zero_not_synchronized'; end if;
  select * into v_backup from pos.point_zero_backups where backup_id=p_backup_id and created_by=auth.uid();
  if not found or v_backup.preview_token<>p_preview_token or v_backup.payload_hash<>v_preview->>'snapshot_hash' then
    raise exception 'point_zero_backup_mismatch';
  end if;
  insert into pos.point_zero_operations(operation_id,backup_id,status,actor_user_id,actor_email,
    device_id,client_build,schema_version,preview_token,counts_before)
  values(p_operation_id,p_backup_id,'running',auth.uid(),auth.jwt()->>'email',p_device_id,
    p_client_build,(v_preview->>'schema_version')::bigint,p_preview_token,v_preview->'counts');
  v_preserved := pos.point_zero_preserved_hash();
  begin
    -- H-68 elimina documentos/clientes/contadores y pone acumulados en cero.
    v_result := pos.purge_test_data(p_operation_id);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'point_zero_operational_purge_failed: %', v_result; end if;

    select coalesce(array_agg(operation_id order by operation_id),'{}'::text[]) into v_reclass_ids from pos.reference_reclassifications;
    update pos.reference_reclassifications set reversed_by=null, reversal_of=null where operation_id=any(v_reclass_ids);
    delete from pos.reference_reclassifications where operation_id=any(v_reclass_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_reclass_ids) then raise exception 'point_zero_delete_mismatch: reference_reclassifications'; end if;

    select coalesce(array_agg(operation_id order by operation_id),'{}'::uuid[]) into v_adjust_ids from pos.commission_adjustments;
    delete from pos.commission_adjustments where operation_id=any(v_adjust_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_adjust_ids) then raise exception 'point_zero_delete_mismatch: commission_adjustments'; end if;

    select coalesce(array_agg(id order by id),'{}'::bigint[]) into v_move_ids from pos.movements;
    delete from pos.movements where id=any(v_move_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_move_ids) then raise exception 'point_zero_delete_mismatch: movements'; end if;

    select coalesce(array_agg(id order by id),'{}'::text[]) into v_product_ids from pos.products;
    delete from pos.products where id=any(v_product_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_product_ids) then raise exception 'point_zero_delete_mismatch: products'; end if;

    v_preserved_after := pos.point_zero_preserved_hash();
    if v_preserved_after<>v_preserved then raise exception 'point_zero_preserved_data_changed'; end if;
    update pos.system_manifest set data_epoch=data_epoch+1,
      schema_version=greatest(schema_version,20260812013900),updated_at=now()
      where singleton returning data_epoch into v_epoch;
    update pos.sync_devices set status='must_rebootstrap' where device_id is not null and status <> 'revoked';
    perform pos.bump_sync_domain('products','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('clients','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('sales','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('movements','point-zero:'||p_operation_id);
    v_after := pos.point_zero_preview();
    if exists(select 1 from jsonb_each_text(v_after->'counts') x where x.key not in ('cola','bloqueos') and x.value::numeric<>0) then
      raise exception 'point_zero_postcondition_failed';
    end if;
    v_result := jsonb_build_object('ok',true,'status','completed','operation_id',p_operation_id,
      'backup_id',p_backup_id,'completed_at',statement_timestamp(),'data_epoch',v_epoch,
      'counts_before',v_preview->'counts','counts_after',v_after->'counts',
      'preserved',v_after->'preserved','preserved_hash',v_preserved_after,
      'schema_version',20260812013900,'client_build',p_client_build,'device_id',p_device_id,
      'sync',jsonb_build_object('queue',0,'locks',0,'status','correcta'));
    update pos.point_zero_operations set status='completed',completed_at=now(),
      counts_after=v_after->'counts',result=v_result where operation_id=p_operation_id;
    return v_result;
  exception when others then
    get stacked diagnostics v_error=message_text;
    v_result := jsonb_build_object('ok',false,'status','failed','operation_id',p_operation_id,
      'backup_id',p_backup_id,'error',v_error,'rolled_back',true);
    update pos.point_zero_operations set status='failed',completed_at=now(),result=v_result
      where operation_id=p_operation_id;
    return v_result;
  end;
end;
$function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='execute_test_data_cleanup' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='5c0c84a0cc18131990721cead20830df') then
  raise exception 'H154_DEFINITION_DRIFT: execute_test_data_cleanup';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.execute_test_data_cleanup(p_cleanup_id text, p_preset text, p_selection jsonb, p_plan_hash text, p_backup_id uuid, p_confirmation text, p_client_protocol integer DEFAULT 2, p_client_build text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos', 'auth'
AS $function$
declare
  v_plan jsonb;v_backup pos.test_data_cleanup_backups%rowtype;
  v_prior pos.test_data_cleanup_operations%rowtype;v_epoch bigint;v_result jsonb;
  v_stock record;v_orphan record;v_orphan_deleted integer;
  v_idx integer;v_now timestamptz:=statement_timestamp();
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  if nullif(trim(coalesce(p_cleanup_id,'')),'') is null then raise exception 'cleanup_invalid_id'; end if;
  if p_confirmation is distinct from 'LIMPIAR OPERACIONES' then raise exception 'cleanup_confirmation_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.execute-test-data-cleanup',0));
  -- Serialize with legacy RPC writes and quarantine approval/reporting.
  perform pg_advisory_xact_lock(hashtextextended('pos.h149.recovery-fence',0));
  select * into v_prior from pos.test_data_cleanup_operations where cleanup_id=p_cleanup_id;
  if found then return v_prior.result||jsonb_build_object('idempotent',true); end if;
  v_plan:=pos.preview_test_data_cleanup(p_preset,p_selection,p_client_protocol);
  if v_plan->>'system_mode'='production' then raise exception 'cleanup_production_locked'; end if;
  if not coalesce((v_plan->>'executable')::boolean,false) then raise exception 'cleanup_plan_not_executable'; end if;
  if v_plan->>'plan_hash'<>coalesce(p_plan_hash,'') then raise exception 'cleanup_preview_changed'; end if;
  select * into v_backup from pos.test_data_cleanup_backups where backup_id=p_backup_id and created_by=auth.uid();
  if not found or v_backup.plan_hash<>p_plan_hash or v_backup.data_epoch<>(v_plan->>'data_epoch')::bigint
     or v_backup.selection_normalized<>v_plan->'selection_normalized'
     or v_backup.payload_hash<>pos.point_zero_sha256(v_backup.payload) then
    raise exception 'cleanup_backup_mismatch';
  end if;
  insert into pos.test_data_cleanup_operations(cleanup_id,backup_id,status,actor_user_id,
    actor_email,device_id,client_build,protocol_version,data_epoch_before,preset,
    selection_normalized,plan_hash)
  values(p_cleanup_id,p_backup_id,'running',auth.uid(),auth.jwt()->>'email',p_device_id,
    p_client_build,p_client_protocol,(v_plan->>'data_epoch')::bigint,p_preset,
    v_plan->'selection_normalized',p_plan_hash);

  -- Inventario primero, bajo el mismo lock/transacción. Nunca se recorta a cero.
  for v_stock in select * from jsonb_to_recordset(v_plan->'stock') as x(
    product_id text,talla text,record_model text,current_stock bigint,delta bigint,target_stock bigint)
  loop
    if v_stock.target_stock<0 then raise exception 'negative_stock'; end if;
    if v_stock.record_model='v2' then
      update pos.products set stock_quantity=v_stock.target_stock::integer,
        sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
      where id=v_stock.product_id and record_model='v2' and stock_quantity=v_stock.current_stock;
      if not found then raise exception 'cleanup_preview_changed'; end if;
    else
      select (z.ordinality-1)::integer into strict v_idx from pos.products p
        cross join lateral jsonb_array_elements(p.stock) with ordinality z(value,ordinality)
        where p.id=v_stock.product_id and p.record_model='v1'
          and z.value->>'talla'=v_stock.talla and (z.value->>'stock')::bigint=v_stock.current_stock;
      update pos.products set stock=jsonb_set(stock,array[v_idx::text,'stock'],to_jsonb(v_stock.target_stock),false),
        sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id where id=v_stock.product_id;
      if not found then raise exception 'cleanup_preview_changed'; end if;
    end if;
  end loop;

  insert into pos.purged_documents(kind,identity,purge_id)
    select 'sale',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'sale_operation_ids') x
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'return',x,p_cleanup_id from (
      select jsonb_array_elements_text(v_plan->'documents'->'return_ids') x
      union
      select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_ids') x
    ) selected_returns
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'exchange',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'exchange_ids') x
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'loan',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'loan_ids') x
    on conflict(kind,identity) do nothing;

  -- Hijos, evidencias transaccionales y kardex se eliminan sólo por identidad.
  delete from pos.physical_card_redemptions c where c.sale_folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  -- H123: evidencia técnica exacta; no toca stock, dinero ni documentos.
  for v_orphan in
    select c.commit_id from pos.return_commits c
    where c.commit_id in(select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids'))
    order by c.commit_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_orphan.commit_id));
  end loop;
  if exists(
    select 1
    from jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids') x(commit_id)
    left join pos.return_commits c on c.commit_id=x.commit_id
    left join pos.returns r on r.id=c.return_id
    where c.commit_id is null or r.id is not null
  ) then
    raise exception 'cleanup_preview_changed';
  end if;
  delete from pos.return_commits c
  where c.commit_id in(select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids'))
    and not exists(select 1 from pos.returns r where r.id=c.return_id);
  get diagnostics v_orphan_deleted = row_count;
  if v_orphan_deleted<>jsonb_array_length(v_plan->'documents'->'orphan_return_commit_ids') then
    raise exception 'cleanup_preview_changed';
  end if;

  -- H120: restore retained sale state from exact forward evidence.
  update pos.sales s set estado=x.prior_state
  from jsonb_to_recordset(v_plan->'documents'->'sale_state_restorations')
    as x(folio text,prior_state text,evidence_count integer,distinct_states integer)
  where s.folio=x.folio
    and s.folio not in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchange_commits c where c.exchange_id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.layaway_liquidation_commits c where c.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.sale_commits c where c.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.stock_reservations r where r.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.movements m where m.ref in(
    select jsonb_array_elements_text(v_plan->'documents'->'sale_folios') union

    select e.folio from pos.exchanges e where e.id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids')))
    or m.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))
    or (m.return_id is null and m.tipo='Devolución' and m.ref in(
      select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))))
    or m.operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  delete from pos.sale_payments p where p.id in(select jsonb_array_elements_text(v_plan->'documents'->'payment_ids'));
  delete from pos.return_items i where i.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchange_items i where i.exchange_id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.sale_items i where i.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchanges e where e.id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.sales s where s.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.loan_documents l where l.id in(select jsonb_array_elements_text(v_plan->'documents'->'loan_ids'));
  delete from pos.liquidations l where l.id in(select jsonb_array_elements_text(v_plan->'documents'->'liquidation_ids'));
  delete from pos.commission_adjustments a where a.operation_id::text in(select jsonb_array_elements_text(v_plan->'documents'->'commission_adjustment_ids'));
  update pos.reference_reclassifications set reversed_by=null,reversal_of=null
    where operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  delete from pos.reference_reclassifications r where r.operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  update pos.clients c set deleted_at=v_now,sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
    where c.id in(select jsonb_array_elements_text(v_plan->'documents'->'customer_ids'));

  -- H-122: préstamos, reclasificaciones y clientes no cambian esta autoridad.
  if pos.test_data_cleanup_affects_financials(v_plan) then
  -- Autoridad H-69: saldo derivado de documentos CONGELADOS conservados.
  with generated as (
    select j->>'sellerId' seller_id,sum(coalesce((j->>'monto')::numeric,0)) amount
      from pos.sales s cross join lateral jsonb_array_elements(coalesce(s.comisiones,'[]'::jsonb)) j group by j->>'sellerId'
    union all select e.vendedor_id,sum(case when e.comision_revertida is null then coalesce(e.comision_monto,0) else 0 end) from pos.exchanges e group by e.vendedor_id
    union all select j->>'sellerId',-sum(coalesce((j->>'monto')::numeric,0)) from pos.returns r cross join lateral jsonb_array_elements(coalesce(r.comisiones,'[]'::jsonb)) j group by j->>'sellerId'
    union all select j->>'sellerId',-sum(coalesce((j->>'monto')::numeric,0)) from pos.sales s cross join lateral jsonb_array_elements(coalesce(s.comisiones_revertidas,'[]'::jsonb)) j where s.estado='Cancelado' group by j->>'sellerId'
    union all select j->>'seller_id',sum(coalesce((j->>'monto')::numeric,0)) from pos.commission_adjustments a cross join lateral jsonb_array_elements(a.detalle) j group by j->>'seller_id'
    union all select l.seller_id,-sum(l.monto) from pos.liquidations l where coalesce(l.tipo,'liquidacion')<>'ajuste' group by l.seller_id
  ), totals as (select seller_id,sum(amount) amount from generated where seller_id is not null group by seller_id)
  update pos.sellers s set comision_acum=coalesce(t.amount,0),sync_base_version=null,
    sync_device_id='cleanup:'||p_cleanup_id from (select s2.id,coalesce(t2.amount,0) amount
      from pos.sellers s2 left join totals t2 on t2.seller_id=s2.id) t where s.id=t.id;

  end if;

  -- H-122: sólo borrar ventas cambia ventas_mes/ventas_num.
  if coalesce((v_plan->'selection_normalized'->>'sales')::boolean,false) then
  with sale_volume as (
    select seller_id,sum(total/parts)::numeric amount,count(*)::integer documents from (
      select jsonb_array_elements_text(s.vendedores) seller_id,s.total,
        case when jsonb_array_length(s.vendedores)>0 then jsonb_array_length(s.vendedores) else 1 end parts
      from pos.sales s where s.estado<>'Cancelado' and jsonb_typeof(s.vendedores)='array') x
    group by seller_id)
  update pos.sellers s set ventas_mes=coalesce(v.amount,0),ventas_num=coalesce(v.documents,0),
    sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
    from (select s2.id,coalesce(x.amount,0) amount,coalesce(x.documents,0) documents
      from pos.sellers s2 left join sale_volume x on x.seller_id=s2.id) v where s.id=v.id;
  end if;

  update pos.system_manifest set data_epoch=data_epoch+1,
    sync_protocol_min=greatest(sync_protocol_min,2),
    sync_protocol_current=greatest(sync_protocol_current,2),
    schema_version=case when schema_version<20260817014900 then 20260817014900 else schema_version end,
    updated_at=now() where singleton returning data_epoch into v_epoch;
  -- Cliente anterior al protocolo 2 falla cerrado y debe rebootstrap, nunca purga total.
  update pos.sync_devices set status='must_rebootstrap' where device_id is not null and status <> 'revoked';
  perform pos.bump_sync_domain('products','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('clients','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('sellers','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('sales','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('movements','selective-cleanup:'||p_cleanup_id);

  -- H150 follow-up: retire confirmed rows before fencing their archived retry.
  -- The same exclusive lock and transaction cover both stages; no replay gap.
  -- Rejection is atomic with cleanup, and retains the forensic backup.
  update pos.sync_quarantine_cases q set status='rejected',
    discarded_by_cleanup=p_cleanup_id, decision_by=auth.uid(),decision_at=v_now,
    decision_note='Descartada con la limpieza de datos de prueba',updated_at=v_now
  from jsonb_array_elements(coalesce(v_plan->'quarantine_discard','[]'::jsonb)) x
  where q.device_id=x->>'device_id' and q.operation_id=x->>'operation_id'
    and q.remote_epoch=(x->>'remote_epoch')::bigint and q.payload_hash=x->>'payload_hash'
    and q.status in ('pending_review','failed') and q.discarded_by_cleanup is null;
  if (select count(*) from pos.sync_quarantine_cases where discarded_by_cleanup=p_cleanup_id)
    <>jsonb_array_length(coalesce(v_plan->'quarantine_discard','[]'::jsonb)) then
    raise exception 'cleanup_preview_changed';
  end if;

  v_result:=jsonb_build_object('ok',true,'status','completed','cleanup_id',p_cleanup_id,
    'backup_id',p_backup_id,'protocol_version',5,'minimum_client_protocol',5,
    'preset',p_preset,'selection_normalized',v_plan->'selection_normalized',
    'forced_dependencies',v_plan->'forced_dependencies','plan_hash',p_plan_hash,
    'data_epoch',v_epoch,'purged_at',v_now,'counts',v_plan->'counts',
    'identities',v_plan->'documents','stock',v_plan->'stock',
    'quarantine_discard',coalesce(v_plan->'quarantine_discard','[]'::jsonb),
    'sale_states',v_plan->'documents'->'sale_state_restorations');
  insert into pos.selective_cleanup_events(cleanup_id,protocol_version,minimum_client_protocol,
    preset,selection_normalized,plan_hash,data_epoch,purged_at,identities)
  values(p_cleanup_id,5,5,p_preset,v_plan->'selection_normalized',p_plan_hash,v_epoch,v_now,v_plan->'documents');
  -- `test_data_purges` se conserva como auditoría H-68, pero NO recibe este
  -- evento: un cliente antiguo lo leería como purga total. La evidencia de esta
  -- operación vive en selective_cleanup_events y en las dos tablas de auditoría.
  update pos.test_data_cleanup_operations set status='completed',completed_at=now(),
    data_epoch_after=v_epoch,result=v_result where cleanup_id=p_cleanup_id;
  return v_result;
end;
$function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='h133_execute_inventory_v3' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='e14baa5c9bcff2736b96bb21ac47a272') then
  raise exception 'H154_DEFINITION_DRIFT: h133_execute_inventory_v3';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.h133_execute_inventory_v3(p_operation_id uuid, p_manifest jsonb, p_existing jsonb, p_manifest_hash text, p_expected_v1_products integer, p_expected_v1_references integer, p_expected_v1_pieces integer, p_expected_v2_products integer, p_expected_v2_pieces integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos', 'auth'
AS $function$
declare
  v_plan jsonb; v_hash text; v_payload jsonb; v_payload_hash text; v_backup_id uuid;
  v_before_epoch bigint; v_after_epoch bigint; v_result jsonb; v_now timestamptz:=statement_timestamp();
  v_row record; v_count integer; v_pieces bigint;
begin
  if p_operation_id is null or jsonb_typeof(p_manifest)<>'array' or jsonb_typeof(p_existing)<>'array' then
    raise exception 'INVENTORY_V3_MANIFEST_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.h133-inventory-v3',0));
  lock table pos.products in share row exclusive mode;
  if exists(select 1 from pos.inventory_v3_operations where operation_id=p_operation_id) then
    return (select result||jsonb_build_object('idempotent',true) from pos.inventory_v3_operations where operation_id=p_operation_id);
  end if;
  v_plan:=jsonb_build_object('existing',p_existing,'migrated',p_manifest);
  v_hash:=pos.h133_payload_hash(v_plan);
  if v_hash<>coalesce(p_manifest_hash,'') then raise exception 'INVENTORY_V3_MANIFEST_HASH_MISMATCH'; end if;
  if jsonb_array_length(p_manifest)<>p_expected_v1_references
     or jsonb_array_length(p_existing)<>p_expected_v2_products then raise exception 'INVENTORY_V3_MANIFEST_COUNT_MISMATCH'; end if;
  if (select coalesce(sum(queue_pending),0)+coalesce(sum(queue_blocked),0) from pos.sync_devices)<>0 then
    raise exception 'INVENTORY_V3_QUEUE_NOT_DRAINED';
  end if;
  if exists(select 1 from pos.sales where estado='Apartado')
     or exists(select 1 from pos.loan_documents) then raise exception 'INVENTORY_V3_OPEN_OPERATION'; end if;
  select data_epoch into strict v_before_epoch from pos.system_manifest where singleton for update;
  if (select count(*) from pos.products where deleted_at is null and record_model='v1')<>p_expected_v1_products then
    raise exception 'INVENTORY_V3_V1_PRODUCT_CENSUS_CHANGED';
  end if;
  select count(*),coalesce(sum((e->>'stock')::integer),0) into v_count,v_pieces
  from pos.products p cross join lateral jsonb_array_elements(p.stock)e
  where p.deleted_at is null and p.record_model='v1' and (e->>'stock')::integer>0;
  if v_count<>(select count(*) from jsonb_array_elements(p_manifest)m where (m->>'stock')::integer>0)
     or v_pieces<>p_expected_v1_pieces then raise exception 'INVENTORY_V3_V1_STOCK_CENSUS_CHANGED'; end if;
  if (select count(*) from pos.products where deleted_at is null and record_model='v2')<>p_expected_v2_products
     or (select coalesce(sum(stock_quantity),0) from pos.products where deleted_at is null and record_model='v2')<>p_expected_v2_pieces then
    raise exception 'INVENTORY_V3_V2_CENSUS_CHANGED';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_manifest) m(sourceProductId text,sizeScale text,rawSizeValue text,
      sourceSyncVersion bigint,stock integer,targetProductId text,barcodeCode text,physicalSignature text,
      sizeCategoryId text,visibleSku text,referenceFamilyId uuid)
    left join pos.products p on p.id=m.sourceProductId and p.deleted_at is null and p.record_model='v1'
    left join lateral(select e from jsonb_array_elements(p.stock)e where e->>'talla'=m.rawSizeValue
      and coalesce(e->>'escala','')=coalesce(m.sizeScale,'') limit 1)s on true
    where p.id is null or p.sync_version<>m.sourceSyncVersion or s.e is null
       or (s.e->>'stock')::integer<>m.stock or m.targetProductId !~* '^[a-f0-9-]{36}$'
       or m.barcodeCode<>pos.h133_barcode_v3_from_id(m.targetProductId)
       or nullif(m.physicalSignature,'') is null or nullif(m.sizeCategoryId,'') is null
  ) then raise exception 'INVENTORY_V3_SOURCE_OR_TARGET_CHANGED'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_existing)e(productId text,sourceSyncVersion bigint,oldBarcode text,
      newBarcode text,stock integer,physicalSignature text)
    left join pos.products p on p.id=e.productId and p.deleted_at is null and p.record_model='v2'
    where p.id is null or p.sync_version<>e.sourceSyncVersion or p.barcode_code<>e.oldBarcode
       or p.stock_quantity<>e.stock or p.physical_signature<>e.physicalSignature
       or e.newBarcode<>pos.h133_barcode_v3_from_id(e.productId)
  ) then raise exception 'INVENTORY_V3_EXISTING_V2_CHANGED'; end if;
  if (select count(*) from (select m->>'targetProductId' id from jsonb_array_elements(p_manifest)m
      union select e->>'productId' from jsonb_array_elements(p_existing)e)x)
     <>jsonb_array_length(p_manifest)+jsonb_array_length(p_existing)
     or exists(select 1 from pos.products p where p.id in(select m->>'targetProductId' from jsonb_array_elements(p_manifest)m)) then
    raise exception 'INVENTORY_V3_ID_COLLISION';
  end if;
  if (select count(*) from (select m->>'barcodeCode' code from jsonb_array_elements(p_manifest)m
      union select e->>'newBarcode' from jsonb_array_elements(p_existing)e)x)
     <>jsonb_array_length(p_manifest)+jsonb_array_length(p_existing) then raise exception 'INVENTORY_V3_BARCODE_COLLISION'; end if;

  v_payload:=jsonb_build_object(
    'format','balam-inventory-v3-backup-v1','operation_id',p_operation_id,'manifest_hash',v_hash,
    'products',(select jsonb_agg(to_jsonb(p) order by p.id) from pos.products p where p.deleted_at is null),
    'target_product_ids',(select jsonb_agg(m->>'targetProductId' order by m->>'targetProductId') from jsonb_array_elements(p_manifest)m),
    'system_manifest',(select to_jsonb(s) from pos.system_manifest s where singleton),
    'sync_devices',(select coalesce(jsonb_agg(to_jsonb(d) order by d.device_id),'[]'::jsonb) from pos.sync_devices d),
    'plan',v_plan);
  v_payload_hash:=pos.h133_payload_hash(v_payload);
  insert into pos.inventory_v3_backups(operation_id,manifest_hash,payload_hash,payload,verified_restorable)
  values(p_operation_id,v_hash,v_payload_hash,v_payload,
    jsonb_array_length(v_payload->'products')=p_expected_v1_products+p_expected_v2_products
    and jsonb_array_length(v_payload->'target_product_ids')=p_expected_v1_references)
  returning backup_id into v_backup_id;
  if not (select verified_restorable and payload_hash=pos.h133_payload_hash(payload)
      from pos.inventory_v3_backups where backup_id=v_backup_id) then raise exception 'INVENTORY_V3_BACKUP_NOT_RESTORABLE'; end if;

  perform set_config('pos.h133_internal','on',true);
  insert into pos.barcode_aliases(alias_code,product_id,contract_version,source,operation_id)
  select e.oldBarcode,e.productId,2,'v2-current-before-v3',p_operation_id
  from jsonb_to_recordset(p_existing)e(productId text,oldBarcode text)
  where nullif(e.oldBarcode,'') is not null;
  update pos.products p set barcode_aliases=jsonb_build_array(e.oldBarcode),barcode_code=e.newBarcode,
    barcode_contract=3,sync_version=p.sync_version+1,sync_base_version=null,
    sync_device_id='inventory-v3:'||p_operation_id,updated_at=v_now
  from jsonb_to_recordset(p_existing)e(productId text,oldBarcode text,newBarcode text)
  where p.id=e.productId;

  insert into pos.products(id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,pop,
    stock,imagen,sku,barcode_urls,attrs,precios_talla,sync_version,sync_base_version,sync_device_id,deleted_at,
    record_model,size_category_id,size_code,size_scale,stock_quantity,barcode_code,ornament_color_codes,
    physical_signature,physical_identity_locked,reference_family_id,barcode_contract,barcode_aliases)
  select m.targetProductId,p.cat,p.manga,p.tela,p.color,p.cuello,p.modelo,p.nombre,p.orn,p.orn_colors,
    m.listPrice,p.costo,p.pop,jsonb_build_array(jsonb_build_object('talla',m.rawSizeValue,'escala',m.sizeScale,'stock',m.stock)),
    p.imagen,m.visibleSku,'{}'::jsonb,p.attrs||jsonb_build_object('__sizeCategoryId',m.sizeCategoryId,
      '__legacyVisibleSku',m.visibleSku,'__migratedFromV1',p.id),'{}'::jsonb,1,null,
    'inventory-v3:'||p_operation_id,null,'v2',m.sizeCategoryId,m.rawSizeValue,m.sizeScale,m.stock,
    m.barcodeCode,coalesce(m.ornamentColorCodes,'[]'::jsonb),m.physicalSignature,m.stock>0,
    m.referenceFamilyId,3,'[]'::jsonb
  from jsonb_to_recordset(p_manifest)m(sourceProductId text,sizeScale text,rawSizeValue text,stock integer,
    visibleSku text,listPrice numeric,sizeCategoryId text,ornamentColorCodes jsonb,physicalSignature text,
    targetProductId text,referenceFamilyId uuid,barcodeCode text)
  join pos.products p on p.id=m.sourceProductId;

  insert into pos.inventory_v1_v2_map(source_v1_product_id,size_scale,raw_size_value,target_v2_product_id,
    source_stock,historical_only,operation_id)
  select m.sourceProductId,m.sizeScale,m.rawSizeValue,m.targetProductId,m.stock,coalesce(m.historicalOnly,false),p_operation_id
  from jsonb_to_recordset(p_manifest)m(sourceProductId text,sizeScale text,rawSizeValue text,targetProductId text,
    stock integer,historicalOnly boolean);

  update pos.products p set stock=(select jsonb_agg(e.value||jsonb_build_object('stock',0) order by e.ordinality)
      from jsonb_array_elements(p.stock) with ordinality e(value,ordinality)),deleted_at=v_now,
    sync_version=p.sync_version+1,sync_base_version=null,sync_device_id='inventory-v3:'||p_operation_id,updated_at=v_now
  where p.deleted_at is null and p.record_model='v1';

  if exists(select 1 from pos.products where deleted_at is null and record_model='v1')
     or (select count(*) from pos.products where deleted_at is null and record_model='v2')
        <>p_expected_v2_products+p_expected_v1_references
     or (select coalesce(sum(stock_quantity),0) from pos.products where deleted_at is null and record_model='v2')
        <>p_expected_v1_pieces+p_expected_v2_pieces
     or exists(select barcode_code from pos.products where deleted_at is null and record_model='v2'
       group by barcode_code having count(*)>1)
     or exists(select physical_signature from pos.products where deleted_at is null and record_model='v2'
       group by physical_signature having count(*)>1) then raise exception 'INVENTORY_V3_POST_CENSUS_FAILED'; end if;

  alter table pos.products validate constraint products_v2_shape_check;
  update pos.inventory_contract_state set contract_version=3,enforced=true,operation_id=p_operation_id,
    manifest_hash=v_hash,activated_at=v_now,updated_at=v_now where singleton;
  update pos.system_manifest set data_epoch=data_epoch+1,schema_version=greatest(schema_version,20260830017300),
    sync_protocol_min=3,sync_protocol_current=3,updated_at=now() where singleton returning data_epoch into v_after_epoch;
  update pos.sync_devices set status='must_rebootstrap',data_epoch=v_after_epoch,
    queue_pending=0,queue_blocked=0 where device_id is not null and status <> 'revoked';
  v_result:=jsonb_build_object('ok',true,'operation_id',p_operation_id,'backup_id',v_backup_id,
    'manifest_hash',v_hash,'data_epoch_before',v_before_epoch,'data_epoch_after',v_after_epoch,
    'migrated_references',p_expected_v1_references,'existing_v2_rebarcoded',p_expected_v2_products,
    'active_v2',p_expected_v1_references+p_expected_v2_products,
    'pieces',p_expected_v1_pieces+p_expected_v2_pieces,'v1_active',0,'protocol',3,'barcode_contract',3);
  insert into pos.inventory_v3_operations(operation_id,backup_id,manifest_hash,status,
    data_epoch_before,data_epoch_after,result)
  values(p_operation_id,v_backup_id,v_hash,'completed',v_before_epoch,v_after_epoch,v_result);
  return v_result;
end;
$function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='assert_device_recovery_write' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='bbd504487a709f37ff500ca64c82103a') then
  raise exception 'H154_DEFINITION_DRIFT: assert_device_recovery_write';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.assert_device_recovery_write(p_device_id text, p_operation_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare r pos.sync_device_recoveries%rowtype;
 device_row pos.sync_devices%rowtype; minimum_build text; actual_build text;
 h jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 d text := coalesce(nullif(p_device_id,''),h->>'x-balam-device-id');
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('pos.h149.recovery-fence',0));
 if exists(select 1 from pos.sync_quarantine_cases q where q.discarded_by_cleanup is not null
    and (q.operation_id=any(coalesce(p_operation_ids,'{}'::text[]))
      or coalesce(q.payload_summary->'operationIds','[]'::jsonb) ?| coalesce(p_operation_ids,'{}'::text[]))) then
   raise exception using errcode='P0001',message='Esta operación se descartó al limpiar los datos de prueba.',
     detail='TEST_PENDING_DISCARDED';
 end if;
 -- Legacy finance has no device argument. Resolve a uniquely reported origin,
 -- or the enclosing checked RPC. Missing identity can never bypass a directive.
 if d is null and coalesce(current_setting('pos.h149_rpc',true),'')='on' then
  d:=nullif(current_setting('pos.h149_device',true),'');
 end if;
 if d is null and cardinality(p_operation_ids)>0 then
  select min(device_id) into d from pos.sync_activity
   where operation_id=any(p_operation_ids) and user_id=auth.uid()
   having count(distinct device_id)=1;
 end if;
 if d is null and (exists(select 1 from pos.sync_device_recoveries where owner_id=auth.uid())
    or exists(select 1 from pos.sync_devices where user_id=auth.uid() and status='revoked')) then
  raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
   detail='RECOVERY_DEVICE_ID_REQUIRED';
 end if;
 -- Serialize the administrative decision with this transaction's writes.
 select minimum_client_build into minimum_build from pos.system_manifest where singleton;
 actual_build := h->>'x-balam-client-build';
 if minimum_build is not null and actual_build is distinct from minimum_build then
  if actual_build is null or actual_build !~ '^\d{4}-\d{2}-\d{2}-h\d+$'
     or minimum_build !~ '^\d{4}-\d{2}-\d{2}-h\d+$'
     or row(left(actual_build,10),split_part(actual_build,'-h',2)::numeric)
       < row(left(minimum_build,10),split_part(minimum_build,'-h',2)::numeric) then
   raise exception using errcode='P0001',message='Actualiza BALAM antes de continuar.',detail='SYNC_PROTOCOL_OUTDATED';
  end if;
 end if;
 select * into device_row from pos.sync_devices where device_id=d for share;
 if device_row.status='revoked' then
  raise exception using errcode='P0001',message='Este equipo fue retirado. Un administrador debe reactivarlo.',detail='DEVICE_RETIRED';
 end if;
 if coalesce((device_row.metadata->>'reactivation_requires_sync')::boolean,false) then
  raise exception using errcode='P0001',message='Este equipo debe actualizar su información antes de guardar.',detail='REBOOTSTRAP_REQUIRED';
 end if;
 perform set_config('pos.h149_device',coalesce(d,''),true);
 for r in select * from pos.sync_device_recoveries
  where device_id=d or candidate_ids && coalesce(p_operation_ids,'{}'::text[])
  order by device_id for share
 loop
  if r.candidate_ids && coalesce(p_operation_ids,'{}'::text[]) then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='TEST_PENDING_DISCARDED';
  end if;
  if r.state<>'completed' or h->>'x-balam-recovery-token' is distinct from r.write_token::text then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='DEVICE_RECOVERY_REQUIRED';
  end if;
 end loop;
end $function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='admin_set_sync_device_retired' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='5fe9d43e5da0923061944ed7e7e91a69') then
  raise exception 'H154_DEFINITION_DRIFT: admin_set_sync_device_retired';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.admin_set_sync_device_retired(p_device_id text, p_retired boolean, p_note text DEFAULT NULL::text)
 RETURNS pos.sync_devices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare v_row pos.sync_devices;
begin
  if not pos.is_active_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  update pos.sync_devices set
    status = case when p_retired then 'revoked' else 'must_rebootstrap' end,
    metadata = metadata || jsonb_build_object(
      case when p_retired then 'retired_at' else 'reactivated_at' end, now(),
      case when p_retired then 'retired_by' else 'reactivated_by' end, auth.uid(),
      'reactivation_requires_sync', not p_retired,
      'retirement_note', nullif(left(btrim(coalesce(p_note, '')), 500), '')
    )
  where device_id = p_device_id
  returning * into v_row;
  if not found then raise exception 'device_not_found'; end if;
  perform pos.bump_sync_domain('devices', p_device_id);
  return v_row;
end;
$function$
;

do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='report_sync_device' and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='a5f9fe496fa8532ddc97ee6e01864e11') then
  raise exception 'H154_DEFINITION_DRIFT: report_sync_device';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.report_sync_device(p_device_id text, p_client_build text, p_protocol_version integer, p_schema_version bigint, p_data_epoch bigint, p_cursors jsonb, p_queue_pending integer, p_queue_blocked integer, p_status text, p_last_synced_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_row pos.sync_devices;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_queue_pending < 0 or p_queue_blocked < 0 or p_queue_blocked > p_queue_pending then
    raise exception 'invalid_queue_counts';
  end if;
  if p_status not in ('online','offline','behind','pending','quarantined','must_rebootstrap') then
    raise exception 'invalid_device_status';
  end if;
  insert into pos.sync_devices(device_id,user_id,user_email,client_build,
    protocol_version,schema_version,data_epoch,cursors,queue_pending,queue_blocked,
    status,last_seen_at,last_synced_at)
  values(p_device_id,auth.uid(),auth.jwt()->>'email',p_client_build,
    p_protocol_version,p_schema_version,p_data_epoch,coalesce(p_cursors,'{}'::jsonb),
    p_queue_pending,p_queue_blocked,p_status,now(),p_last_synced_at)
  on conflict(device_id) do update set
    user_id=excluded.user_id, user_email=excluded.user_email,
    client_build=excluded.client_build, protocol_version=excluded.protocol_version,
    schema_version=excluded.schema_version, data_epoch=excluded.data_epoch,
    cursors=excluded.cursors, queue_pending=excluded.queue_pending,
    queue_blocked=excluded.queue_blocked,
    status=case when pos.sync_devices.status='revoked' then 'revoked' else excluded.status end,
    last_seen_at=now(), last_synced_at=coalesce(excluded.last_synced_at,pos.sync_devices.last_synced_at)
  returning * into v_row;
  -- Presence is observable even for a retired installation; only an admin can reactivate it.
  if v_row.status='revoked' then return false; end if;
  if coalesce((v_row.metadata->>'reactivation_requires_sync')::boolean,false) then
    if p_status='online' and p_queue_pending=0 and p_queue_blocked=0
       and p_last_synced_at >= (v_row.metadata->>'reactivated_at')::timestamptz
       and exists(select 1 from pos.system_manifest m where m.singleton
          and m.data_epoch=p_data_epoch
          and p_protocol_version between m.sync_protocol_min and m.sync_protocol_current)
       and exists(select 1 from pos.system_manifest m, lateral jsonb_each_text(m.domain_modes) dm where dm.value='active' and dm.key<>'devices')
       and not exists(select 1 from pos.system_manifest m,
          lateral jsonb_each_text(m.domain_modes) dm
          left join pos.sync_domain_versions v on v.domain=dm.key
          where dm.value='active' and dm.key<>'devices'
            and (v.domain is null or not coalesce(p_cursors,'{}'::jsonb) ? dm.key
              or (p_cursors->>dm.key)::bigint is distinct from v.version)) then
      update pos.sync_devices set metadata=metadata || '{"reactivation_requires_sync":false}'::jsonb
        where device_id=p_device_id;
    else
      update pos.sync_devices set status='must_rebootstrap' where device_id=p_device_id;
    end if;
  end if;
  return true;
end;
$function$
;

-- Direct table writes retain the existing RLS but cannot override an administrative decision.
-- SECURITY INVOKER distinguishes a checked definer RPC from a direct authenticated write.
create or replace function pos.protect_sync_device_retirement() returns trigger
language plpgsql set search_path='pg_catalog','pos' as $guard$
begin
 if current_user not in ('postgres','service_role') and (
   (old.status='revoked' and new.status is distinct from old.status)
   or (new.status='revoked' and old.status is distinct from new.status)
   or (new.metadata - array['last_heartbeat_error']) is distinct from (old.metadata - array['last_heartbeat_error'])
 ) then raise exception using errcode='42501',message='La administración del equipo requiere el Centro de equipos.'; end if;
 return new;
end $guard$;
revoke all on function pos.protect_sync_device_retirement() from public,anon,authenticated;
create or replace trigger h154_protect_device_retirement before update on pos.sync_devices
for each row execute function pos.protect_sync_device_retirement();
commit;
