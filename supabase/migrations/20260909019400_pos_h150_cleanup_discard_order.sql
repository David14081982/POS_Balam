-- H150 follow-up: move the unchanged discard block after commercial cleanup.
begin;
do $source$ begin if md5(pg_get_functiondef('pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure))<>'7bd1552fed0944c62d5015735b8ba168' then raise exception 'H150 cleanup source drift'; end if; end $source$;
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
  delete from pos.sale_payments p where p.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
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
  update pos.sync_devices set status='must_rebootstrap' where device_id is not null;
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
commit;
