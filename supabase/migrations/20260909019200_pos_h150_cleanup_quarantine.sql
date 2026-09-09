-- H150: archived intents become explicit, backed-up, terminal discards.
-- Generated from live pg_get_functiondef; each original is guarded by MD5.
begin;
alter table pos.sync_quarantine_cases add column discarded_by_cleanup text
 references pos.test_data_cleanup_operations(cleanup_id);
create index sync_quarantine_cleanup_discard_idx on pos.sync_quarantine_cases(operation_id)
 where discarded_by_cleanup is not null;

do $source$ begin if md5(pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure))<>'2d40eff26523633f980c10889c006b00' then raise exception 'H150 source drift: test_data_cleanup_fleet_risk'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.test_data_cleanup_fleet_risk(p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_selection jsonb := coalesce(p_plan->'selection_normalized', '{}'::jsonb);
  v_reasons jsonb;
  v_devices jsonb := '[]'::jsonb;
  v_summary jsonb := jsonb_build_object(
    'ready', 0, 'compatible_offline', 0, 'update_on_return', 0,
    'attention', 0, 'retired', 0, 'unsafe_legacy', 0,
    'historical_incidents', 0
  );
  v_domains text[];
  v_manifest_epoch bigint;
  v_device record;
  v_all_activity jsonb;
  v_selected_activity jsonb;
  v_current_activity jsonb;
  v_historical_activity jsonb;
  v_quarantine jsonb;
  v_discard jsonb := '[]'::jsonb;
  v_projected_count integer;
  v_current_pending integer;
  v_unknown integer;
  v_conflicts integer;
  v_historical_count integer;
  v_recent boolean;
  v_fenceable boolean;
  v_requires_update boolean;
  v_state text;
  v_blocking boolean;
  v_reason text;
  v_core jsonb;
begin
  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'cleanup_invalid_plan' using errcode = '22023';
  end if;

  select data_epoch into strict v_manifest_epoch
  from pos.system_manifest where singleton;

  v_domains := array_remove(array[
    case when coalesce((v_selection->>'sales')::boolean, false) then 'sales' end,
    case when coalesce((v_selection->>'sales')::boolean, false) then 'payments' end,
    case when coalesce((v_selection->>'sales')::boolean, false)
           or coalesce((v_selection->>'returns')::boolean, false)
           or coalesce((v_selection->>'orphan_return_evidence')::boolean, false) then 'returns' end,
    case when coalesce((v_selection->>'sales')::boolean, false)
           or coalesce((v_selection->>'exchanges')::boolean, false) then 'exchanges' end,
    case when coalesce((v_selection->>'loans')::boolean, false) then 'loans' end,
    case when coalesce((v_selection->>'commissions')::boolean, false) then 'liquidations' end,
    case when coalesce((v_selection->>'reclassifications')::boolean, false) then 'products' end,
    case when coalesce((v_selection->>'customers')::boolean, false) then 'clients' end
  ], null);

  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_reasons
  from jsonb_array_elements(coalesce(v_plan->'blocked_reasons', '[]'::jsonb)) e(value)
  where not (jsonb_typeof(e.value) = 'string'
             and e.value #>> '{}' = 'cleanup_not_synchronized')
    and not (jsonb_typeof(e.value) = 'object'
             and e.value->>'code' = 'client_schema_incompatible');

  for v_device in
    select * from pos.sync_devices order by coalesce(display_name, device_id), device_id
  loop
    select count(*),
      coalesce(jsonb_agg(jsonb_build_object(
        'operation_id', a.operation_id,
        'operation_type', a.operation_type,
        'domain', a.domain,
        'reference', a.reference,
        'summary', a.summary,
        'status', a.status,
        'diagnostic', to_jsonb(a)->'diagnostic',
        'updated_at', a.updated_at
      ) order by a.updated_at desc), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'operation_id', a.operation_id,
        'operation_type', a.operation_type,
        'domain', a.domain,
        'reference', a.reference,
        'summary', a.summary,
        'status', a.status,
        'diagnostic', to_jsonb(a)->'diagnostic',
        'updated_at', a.updated_at
      ) order by a.updated_at desc) filter (where a.domain = any(v_domains)), '[]'::jsonb)
    into v_projected_count, v_all_activity, v_selected_activity
    from pos.sync_activity a
    where a.device_id = v_device.device_id
      and a.status in ('pending', 'retrying', 'blocked', 'quarantined');

    -- queue_pending=0 es una declaraciÃ³n autoritativa de que STORE no tiene
    -- payload ejecutable. Las proyecciones activas sobreviven como evidencia
    -- administrativa, pero no pueden reproducirse desde sync_activity.
    if coalesce(v_device.queue_pending, 0) = 0 then
      v_current_activity := '[]'::jsonb;
      v_historical_activity := v_selected_activity;
      v_current_pending := 0;
      v_unknown := 0;
    else
      v_current_activity := v_selected_activity;
      v_historical_activity := '[]'::jsonb;
      v_current_pending := least(coalesce(v_device.queue_pending, 0), v_projected_count);
      -- Sin una correspondencia 1:1 no se adivina quÃ© proyecciÃ³n es actual.
      v_unknown := case
        when v_projected_count = coalesce(v_device.queue_pending, 0) then 0
        else coalesce(v_device.queue_pending, 0)
      end;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'operation_id', q.operation_id,
      'operation_type', q.operation_type,
      'domain', q.domain,
      'reference', q.reference,
      'summary', q.summary,
      'status', q.status,
      'updated_at', q.updated_at
    ) order by q.updated_at desc), '[]'::jsonb)
    into v_quarantine
    from pos.sync_quarantine_cases q
    where q.device_id = v_device.device_id
      and (q.status in ('approved', 'delivered')
        or (q.status in ('pending_review','failed') and not coalesce((q.operation_type not in ('referenceReclassification','commissionSettle','commissionClose')
            or (jsonb_typeof(q.payload_summary->'operationIds')='array'
              and jsonb_array_length(q.payload_summary->'operationIds')>0)),false)))
      and q.domain = any(v_domains);

    -- Archived, unapproved intents cannot execute. Their explicit rejection
    -- belongs to this plan, including product edits that affect retained stock.
    if v_device.status <> 'revoked' then
      v_discard := v_discard || coalesce((select jsonb_agg(to_jsonb(q)
        || jsonb_build_object('device_name',coalesce(nullif(v_device.display_name,''),
          'Equipo '||upper(right(v_device.device_id,6))))
        order by q.operation_id,q.remote_epoch)
        from pos.sync_quarantine_cases q where q.device_id=v_device.device_id
          and q.status in ('pending_review','failed') and q.discarded_by_cleanup is null
          and q.domain=any(v_domains) and (q.operation_type not in ('referenceReclassification','commissionSettle','commissionClose')
            or (jsonb_typeof(q.payload_summary->'operationIds')='array'
              and jsonb_array_length(q.payload_summary->'operationIds')>0))), '[]'::jsonb);
    end if;

    v_conflicts := jsonb_array_length(v_current_activity)
      + jsonb_array_length(v_quarantine);
    v_historical_count := jsonb_array_length(v_historical_activity);
    v_recent := v_device.last_seen_at >= statement_timestamp() - interval '2 minutes';
    v_fenceable := coalesce(v_device.protocol_version, 0) >= 1
      and coalesce(v_device.schema_version, 0) >= 20260806011500;
    v_requires_update := coalesce(v_device.protocol_version, 0) < 2
      or coalesce(v_device.schema_version, 0) < 20260820016500
      or coalesce(v_device.data_epoch, 0) <> v_manifest_epoch
      or v_device.status in ('must_rebootstrap', 'quarantined');
    v_blocking := false;
    v_reason := null;

    if v_device.status = 'revoked' then
      v_state := 'retired';
    elsif not v_fenceable then
      v_state := 'unsafe_legacy';
      v_blocking := true;
      v_reason := 'client_cannot_be_fenced';
    elsif v_conflicts > 0 then
      v_state := 'attention';
      v_blocking := true;
      v_reason := 'pending_operation_intersects_cleanup';
    elsif v_unknown > 0 then
      v_state := 'attention';
      v_blocking := true;
      v_reason := 'pending_scope_unknown';
    elsif v_requires_update then
      v_state := 'update_on_return';
    elsif not v_recent or v_device.status = 'offline' then
      v_state := 'compatible_offline';
    else
      v_state := 'ready';
    end if;

    if v_blocking then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', v_reason,
        'device_id', v_device.device_id,
        'device_name', coalesce(nullif(v_device.display_name, ''),
          'Equipo ' || upper(right(v_device.device_id, 6))),
        'operations', v_current_activity || v_quarantine,
        'unknown_operations', v_unknown
      ));
    end if;

    v_summary := jsonb_set(v_summary, array[v_state],
      to_jsonb(coalesce((v_summary->>v_state)::integer, 0) + 1));
    v_summary := jsonb_set(v_summary, '{historical_incidents}',
      to_jsonb(coalesce((v_summary->>'historical_incidents')::integer, 0)
        + v_historical_count));
    v_devices := v_devices || jsonb_build_array(jsonb_build_object(
      'device_id', v_device.device_id,
      'display_name', coalesce(nullif(v_device.display_name, ''),
        'Equipo ' || upper(right(v_device.device_id, 6))),
      'state', v_state,
      'blocking', v_blocking,
      'reason', v_reason,
      'known_pending', v_current_pending,
      'current_pending', coalesce(v_device.queue_pending, 0),
      'current_operations', v_current_activity,
      'unknown_pending', v_unknown,
      'conflicts', v_current_activity || v_quarantine,
      'replayable_incidents', v_quarantine,
      'historical_incident_count', v_historical_count,
      'historical_incidents', v_historical_activity,
      'historical_projection_count', case when coalesce(v_device.queue_pending, 0) = 0
        then v_projected_count else 0 end,
      'last_seen_at', v_device.last_seen_at,
      'protocol_version', v_device.protocol_version,
      'schema_version', v_device.schema_version,
      'data_epoch', v_device.data_epoch,
      'status', v_device.status,
      'fenceable', v_fenceable
    ));
  end loop;

  if jsonb_array_length(v_discard)>0 then
    select coalesce(jsonb_agg(e),'[]'::jsonb) into v_reasons
    from jsonb_array_elements(v_reasons) e where e <> '"cleanup_no_matching_data"'::jsonb;
  end if;
  v_core := (v_plan - 'ok' - 'plan_hash' - 'executable' - 'queue_pending'
    - 'active_locks' - 'unsynchronized_devices' - 'incompatible_devices')
    || jsonb_build_object(
      'protocol_version', 6,
      'minimum_client_protocol', case when jsonb_array_length(v_discard)>0 then 6 else 5 end,
      'quarantine_discard',v_discard,
      'counts',coalesce(v_plan->'counts','{}'::jsonb)||jsonb_build_object('operaciones_archivadas',jsonb_array_length(v_discard)),
      'blocked_reasons', v_reasons,
      'fleet', jsonb_build_object('summary', v_summary, 'devices', v_devices)
    );
  return v_core || jsonb_build_object(
    'ok', true,
    'plan_hash', pos.test_data_cleanup_plan_hash(v_core),
    'executable', jsonb_array_length(v_reasons) = 0,
    'queue_pending', coalesce((select sum(queue_pending) from pos.sync_devices
      where status <> 'revoked'), 0),
    'active_locks', coalesce((select sum(queue_blocked) from pos.sync_devices
      where status <> 'revoked'), 0),
    'unsynchronized_devices', coalesce((v_summary->>'attention')::integer, 0)
      + coalesce((v_summary->>'unsafe_legacy')::integer, 0),
    'incompatible_devices', coalesce((v_summary->>'update_on_return')::integer, 0)
      + coalesce((v_summary->>'unsafe_legacy')::integer, 0)
  );
end;
$function$
;

do $source$ begin if md5(pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure))<>'24204bb9c984685031f0ae49efd70211' then raise exception 'H150 source drift: test_data_cleanup_payload'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.test_data_cleanup_payload(p_plan jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
  select jsonb_build_object(
    'plan',p_plan,
    'quarantined_operations',coalesce(p_plan->'quarantine_discard','[]'::jsonb),
    'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from pos.products p
      where p.id in(select s->>'product_id' from jsonb_array_elements(p_plan->'stock') s)),
    'sales',(select coalesce(jsonb_agg(to_jsonb(s) order by s.folio),'[]'::jsonb) from pos.sales s where s.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))
      or s.folio in(select x->>'folio' from jsonb_array_elements(p_plan->'documents'->'sale_state_restorations') x)),
    'sale_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.sale_items i where i.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'sale_payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from pos.sale_payments p where p.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'physical_card_redemptions',(select coalesce(jsonb_agg(to_jsonb(c) order by c.folio),'[]'::jsonb) from pos.physical_card_redemptions c where c.sale_folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'sale_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.sale_commits c where c.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'stock_reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from pos.stock_reservations r where r.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'returns',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))),
    'return_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.return_items i where i.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))),
    'return_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))
      or c.commit_id in(select jsonb_array_elements_text(p_plan->'documents'->'orphan_return_commit_ids'))),
    'exchanges',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from pos.exchanges e where e.id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'exchange_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.exchange_items i where i.exchange_id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'exchange_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.exchange_commits c where c.exchange_id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'layaway_liquidation_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.layaway_liquidation_commits c where c.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from pos.movements m where m.ref in(
      select jsonb_array_elements_text(p_plan->'documents'->'sale_folios') union

      select e.folio from pos.exchanges e where e.id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids')))
      or m.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))
      or (m.return_id is null and m.tipo='Devolución' and m.ref in(
        select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))))
      or m.operation_id in(select jsonb_array_elements_text(p_plan->'documents'->'reclassification_ids'))),
    'loans',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from pos.loan_documents l where l.id in(select jsonb_array_elements_text(p_plan->'documents'->'loan_ids'))),
    'liquidations',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from pos.liquidations l where l.id in(select jsonb_array_elements_text(p_plan->'documents'->'liquidation_ids'))),
    'commission_adjustments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.operation_id),'[]'::jsonb) from pos.commission_adjustments a where a.operation_id::text in(select jsonb_array_elements_text(p_plan->'documents'->'commission_adjustment_ids'))),
    'reference_reclassifications',(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from pos.reference_reclassifications r where r.operation_id in(select jsonb_array_elements_text(p_plan->'documents'->'reclassification_ids'))),
    'clients',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from pos.clients c where c.id in(select jsonb_array_elements_text(p_plan->'documents'->'customer_ids'))),
    'sellers',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from pos.sellers s)
  )
$function$
;

do $source$ begin if md5(pg_get_functiondef('pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure))<>'32a714a478944e8695f9441ae779d9cb' then raise exception 'H150 source drift: execute_test_data_cleanup'; end if; end $source$;
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

do $source$ begin if md5(pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure))<>'d76f8c195f9885ca51e2ef5874106725' then raise exception 'H150 source drift: assert_device_recovery_write'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.assert_device_recovery_write(p_device_id text, p_operation_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare r pos.sync_device_recoveries%rowtype;
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
 if d is null and exists(select 1 from pos.sync_device_recoveries where owner_id=auth.uid()) then
  raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
   detail='RECOVERY_DEVICE_ID_REQUIRED';
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

do $source$ begin if md5(pg_get_functiondef('pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb)'::regprocedure))<>'45663409b26be9316dbcc5c5c63f2fd5' then raise exception 'H150 source drift: report_sync_quarantine'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.report_sync_quarantine(p_device_id text, p_operation_id text, p_remote_epoch bigint, p_local_epoch bigint, p_operation_type text, p_domain text, p_reference text, p_summary text, p_payload_hash text, p_payload_summary jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from pos.sync_devices d
      where d.device_id=p_device_id and d.user_id=auth.uid()) then
    raise exception 'device_owner_required' using errcode='42501';
  end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 160
     or p_remote_epoch is null or p_remote_epoch < 1
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_payload_summary,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_payload_summary,'{}'::jsonb)::text) > 32768 then
    raise exception 'invalid_quarantine_case';
  end if;


  perform pg_advisory_xact_lock_shared(hashtextextended('pos.h149.recovery-fence',0));
  if exists(select 1 from pos.sync_quarantine_cases q where q.device_id=p_device_id
    and q.operation_id=p_operation_id and q.discarded_by_cleanup is not null) then
    -- Old archives may report again after a new epoch; never reopen a discard.
    return true;
  end if;
  insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,
    local_epoch,user_id,user_email,operation_type,domain,reference,summary,
    payload_hash,payload_summary)
  values(p_device_id,p_operation_id,p_remote_epoch,p_local_epoch,auth.uid(),
    auth.jwt()->>'email',left(coalesce(p_operation_type,'unknown'),80),
    left(p_domain,80),left(p_reference,120),left(coalesce(p_summary,'Operación en cuarentena'),240),
    p_payload_hash,p_payload_summary)
  on conflict(device_id,operation_id,remote_epoch) do update set
    local_epoch=excluded.local_epoch, user_email=excluded.user_email,
    operation_type=excluded.operation_type, domain=excluded.domain,
    reference=excluded.reference, summary=excluded.summary,
    payload_hash=excluded.payload_hash, payload_summary=excluded.payload_summary,
    status='pending_review', decision_note=null, decision_by=null,
    decision_at=null, execution_message=null, updated_at=now()
  where pos.sync_quarantine_cases.status in ('pending_review','failed');
  return true;
end;
$function$
;

do $source$ begin if md5(pg_get_functiondef('pos.admin_decide_sync_quarantine(text,text,bigint,text,text)'::regprocedure))<>'246dbd4add70dabc81a2ac98f3cdf0e4' then raise exception 'H150 source drift: admin_decide_sync_quarantine'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.admin_decide_sync_quarantine(p_device_id text, p_operation_id text, p_remote_epoch bigint, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('pos.h149.recovery-fence',0));
  if not pos.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  update pos.sync_quarantine_cases set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    decision_note=nullif(left(btrim(coalesce(p_note,'')),500),''),
    decision_by=auth.uid(), decision_at=now(), updated_at=now(),
    execution_message=null
  where device_id=p_device_id and operation_id=p_operation_id
    and remote_epoch=p_remote_epoch and status in ('pending_review','failed')
    and discarded_by_cleanup is null;
  if not found then raise exception 'quarantine_case_not_actionable'; end if;
  return true;
end;
$function$
;

do $source$ begin if md5(pg_get_functiondef('pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))<>'80869417ccb6d8cadb65d0c0ef7eb9e9' then raise exception 'H150 source drift: commit_exchange'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.commit_exchange(p_commit_id text, p_exchange jsonb, p_items jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_id           text := p_exchange ->> 'id';
  v_folio        text := p_exchange ->> 'folio';
  v_origen       text := p_exchange ->> 'origen_folio';
  v_hash         text;
  v_prior        pos.exchange_commits%rowtype;
  v_expira       date;
  v_hoy          date := coalesce(nullif(left(p_exchange ->> 'fecha', 10), '')::date, current_date);
  v_shortages    jsonb;
  v_reconocido   numeric := 0;
  v_entregado    numeric := 0;
  v_diferencia   numeric := 0;
  v_no_aprov     numeric := 0;
  v_base_com     numeric := 0;
  v_rec          record;
  v_products     jsonb := '[]'::jsonb;
  v_pago_monto   numeric := 0;
  v_effect       record;
  v_sellers      jsonb := '[]'::jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_commit_id::text,p_exchange->>'id']::text[]);
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para registrar cambios' using errcode = '42501';
  end if;

  -- 1) Forma
  if nullif(trim(p_commit_id), '') is null
     or nullif(trim(coalesce(v_id, '')), '') is null
     or nullif(trim(coalesce(v_folio, '')), '') is null
     or nullif(trim(coalesce(v_origen, '')), '') is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_typeof(coalesce(p_moves, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_seller_effects, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, sku text, talla text, qty integer)
     where coalesce(x.lado, '') not in ('devuelto', 'entregado')
        or nullif(trim(coalesce(x.sku, '')), '') is null
        or nullif(trim(coalesce(x.talla, '')), '') is null
        or nullif(trim(coalesce(x.product_id, '')), '') is null
        or coalesce(x.qty, 0) <= 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  -- Un cambio exige las dos mitades: sin ellas es una devolución o una venta.
  if not exists (select 1 from jsonb_to_recordset(p_items) as x(lado text) where x.lado = 'devuelto')
     or not exists (select 1 from jsonb_to_recordset(p_items) as x(lado text) where x.lado = 'entregado') then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  v_hash := md5(jsonb_build_object(
    'exchange', p_exchange, 'items', p_items, 'moves', coalesce(p_moves, '[]'::jsonb),
    'payment', coalesce(p_payment, 'null'::jsonb),
    'seller_effects', coalesce(p_seller_effects, '[]'::jsonb)
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_commit_id));

  -- 2) Idempotencia
  select * into v_prior from pos.exchange_commits where commit_id = p_commit_id;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.exchange_id <> v_id or v_prior.folio <> v_folio then
      return jsonb_build_object('ok', false, 'error', 'commit_mismatch');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true,
      'exchange', (select to_jsonb(e) from pos.exchanges e where e.id = v_id));
  end if;

  -- 3) Serializa todos los documentos de la misma venta
  perform 1 from pos.sales where folio = v_origen for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if exists (select 1 from pos.exchanges where id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'exchange_id_conflict');
  end if;

  -- 4) Plazo de posventa (H-34). El derecho a cambiar está sujeto al plazo de la
  --    venta origen; nulo significa sin límite, igual que en devoluciones.
  select return_expires_at into v_expira from pos.sales where folio = v_origen;
  if v_expira is not null and v_hoy > v_expira then
    return jsonb_build_object('ok', false, 'error', 'exchange_window_closed',
      'expires_at', v_expira);
  end if;

  -- 5) Saldo disponible (H-35/H-37). La autoridad ya suma el suministro de
  --    cambios anteriores, así que una pieza recibida antes puede recambiarse.
  with pedido as (
    select x.sku, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_items) as x(lado text, sku text, talla text, qty integer)
     where x.lado = 'devuelto'
     group by x.sku, x.talla
  ),
  saldo as (
    select b.sku, b.talla, b.disponible as qty
      from pos.sale_line_balance(v_origen, v_id) b
  )
  select jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'talla', p.talla,
           'requested', p.qty, 'available', coalesce(s.qty, 0)
         ) order by p.sku, p.talla)
    into v_shortages
    from pedido p
    left join saldo s on s.sku = p.sku and s.talla is not distinct from p.talla
   where p.qty > coalesce(s.qty, 0);

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_exchange_quantity',
      'items', v_shortages);
  end if;

  -- 6) Valoración. SIEMPRE en el servidor (Contrato §3).
  select coalesce(sum(x.qty * pos.line_recognized_value(v_origen, x.sku, x.talla)), 0)
    into v_reconocido
    from jsonb_to_recordset(p_items) as x(lado text, sku text, talla text, qty integer)
   where x.lado = 'devuelto';

  select coalesce(sum(x.qty * pos.list_price(x.product_id, x.talla)), 0)
    into v_entregado
    from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, talla text, qty integer)
   where x.lado = 'entregado';

  if v_entregado >= v_reconocido then
    v_diferencia := round(v_entregado - v_reconocido, 2);
    v_no_aprov := 0;
  else
    -- El sobrante se pierde: nunca sale efectivo (Contrato §4).
    v_diferencia := 0;
    v_no_aprov := round(v_reconocido - v_entregado, 2);
  end if;
  v_base_com := v_diferencia;   -- §7: sólo el excedente genera comisión

  -- 6b) El cobro se valida ANTES de escribir nada. En 20260728005700 estas dos
  --     salidas ocurrian despues de insertar cabecera, renglones y movimientos:
  --     un `return` de plpgsql no aborta la transaccion, asi que un cobro mal
  --     formado dejaba el documento a medias. Es el defecto que H-04 existe para
  --     impedir. Ahora no se escribe una sola fila hasta que el dinero cuadra.
  if v_diferencia > 0 then
    if p_payment is null then
      return jsonb_build_object('ok', false, 'error', 'payment_required',
        'expected', v_diferencia);
    end if;
    v_pago_monto := coalesce((p_payment ->> 'monto')::numeric, 0);
    if round(v_pago_monto, 2) <> v_diferencia then
      return jsonb_build_object('ok', false, 'error', 'payment_mismatch',
        'expected', v_diferencia, 'received', v_pago_monto);
    end if;
  end if;

  -- 7) Inventario. Bloqueo estable de TODOS los productos implicados, en un solo
  --    orden, para evitar deadlocks entre cambios concurrentes.
  perform p.id from pos.products p
   where p.id in (select distinct x.product_id from jsonb_to_recordset(p_items)
                    as x(product_id text))
   order by p.id
   for update;

  -- Toda talla implicada debe existir en su producto.
  with lineas as (
    select x.product_id, x.talla from jsonb_to_recordset(p_items)
      as x(product_id text, talla text) group by x.product_id, x.talla
  )
  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'talla', l.talla,
           'reason', case when p.id is null then 'product_not_found' else 'size_not_found' end)
         order by l.product_id, l.talla)
    into v_shortages
    from lineas l
    left join pos.products p on p.id = l.product_id and p.deleted_at is null
   where p.id is null
      or not exists (select 1 from jsonb_array_elements(p.stock) e where e ->> 'talla' = l.talla);

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_stock_target', 'items', v_shortages);
  end if;

  -- Reserva de lo ENTREGADO: se valida ANTES de escribir, dentro del mismo
  -- bloqueo, así que dos terminales no pueden entregar la última pieza (H-01).
  with pedido as (
    select x.product_id, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_items)
        as x(lado text, product_id text, talla text, qty integer)
     where x.lado = 'entregado'
     group by x.product_id, x.talla
  )
  select jsonb_agg(jsonb_build_object('product_id', pe.product_id, 'talla', pe.talla,
           'requested', pe.qty, 'available', (e.value ->> 'stock')::integer)
         order by pe.product_id, pe.talla)
    into v_shortages
    from pedido pe
    join pos.products p on p.id = pe.product_id
    cross join lateral jsonb_array_elements(p.stock) e
   where e.value ->> 'talla' = pe.talla
     and (e.value ->> 'stock')::integer < pe.qty;

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'items', v_shortages);
  end if;

  -- Movimiento neto por (producto, talla): + lo devuelto, − lo entregado.
  for v_rec in
    with delta as (
      select x.product_id, x.talla,
             sum(case when x.lado = 'devuelto' then x.qty else -x.qty end)::integer as qty
        from jsonb_to_recordset(p_items)
          as x(lado text, product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select d.product_id, d.talla, d.qty,
           (e.value ->> 'stock')::integer as available,
           e.ordinality::integer - 1 as stock_index
      from delta d
      join pos.products p on p.id = d.product_id
      cross join lateral jsonb_array_elements(p.stock) with ordinality as e(value, ordinality)
     where e.value ->> 'talla' = d.talla and d.qty <> 0
     order by d.product_id, d.talla
  loop
    update pos.products p
       set stock = jsonb_set(p.stock, array[v_rec.stock_index::text, 'stock'],
             to_jsonb(greatest(v_rec.available + v_rec.qty, 0)), false),
           sync_base_version = p.sync_version,
           sync_device_id = 'exchange:' || p_commit_id
     where p.id = v_rec.product_id;
  end loop;

  -- 8) Documento
  insert into pos.exchanges (
    id, folio, origen_folio, fecha, usuario, vendedor_id, revisado_por,
    valor_reconocido, valor_entregado, diferencia, valor_no_aprovechado,
    base_comision, comision_monto, comision_base, comision_pct, notas
  ) values (
    v_id, v_folio, v_origen, p_exchange ->> 'fecha', p_exchange ->> 'usuario',
    p_exchange ->> 'vendedor_id', p_exchange ->> 'revisado_por',
    v_reconocido, v_entregado, v_diferencia, v_no_aprov, v_base_com,
    coalesce((p_exchange ->> 'comision_monto')::numeric, 0),
    nullif(p_exchange ->> 'comision_base', ''),
    coalesce((p_exchange ->> 'comision_pct')::numeric, 0),
    p_exchange ->> 'notas'
  );

  insert into pos.exchange_items (exchange_id, lado, product_id, sku, nombre, talla, qty, precio, motivo, condicion)
  select v_id, x.lado, x.product_id, x.sku, x.nombre, x.talla, x.qty,
         case when x.lado = 'entregado'
              then pos.list_price(x.product_id, x.talla)
              else pos.line_recognized_value(v_origen, x.sku, x.talla) end,
         x.motivo, x.condicion
    from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, sku text, nombre text, talla text, qty integer,
           motivo text, condicion text);

  -- 9) Movimientos de inventario (historial de sólo lectura para el cliente)
  if jsonb_array_length(coalesce(p_moves, '[]'::jsonb)) > 0 then
    insert into pos.movements (fecha, tipo, producto, product_id, sku, talla, cant, ref)
    select x.fecha, x.tipo, x.producto, x.product_id, x.sku, x.talla, x.cant, coalesce(x.ref, v_folio)
      from jsonb_to_recordset(p_moves)
        as x(fecha timestamptz, tipo text, producto text, product_id text, sku text, talla text, cant integer, ref text);
  end if;

  -- 10) Cobro de la diferencia. Ledger único, con el folio PROPIO del cambio:
  --     usar el de la venta origen violaria §8 y ademas commit_sale borra por
  --     folio antes de reinsertar. Nunca se emite un pago negativo.
  if v_diferencia > 0 then
    insert into pos.sale_payments (id, folio, fecha, tipo, metodo, monto,
                                   efectivo, tarjeta, transferencia, otro)
    values (
      p_payment ->> 'id', v_folio, p_payment ->> 'fecha', 'cambio',
      coalesce(p_payment ->> 'metodo', 'Efectivo'), v_diferencia,
      coalesce((p_payment ->> 'efectivo')::numeric, 0),
      coalesce((p_payment ->> 'tarjeta')::numeric, 0),
      coalesce((p_payment ->> 'transferencia')::numeric, 0),
      coalesce((p_payment ->> 'otro')::numeric, 0)
    );
  end if;

  -- 10) Comision del excedente. Mismo criterio de reintento que `commit_sale`:
  -- si la version del vendedor ya avanzo UNO sobre la base leida y el valor final
  -- coincide, este efecto ya se aplico y es un reenvio de la cola; se deja como
  -- esta en vez de sumarlo dos veces.
  --
  -- Un cambio NO es un pedido: aqui no se tocan `ventas_mes` ni `ventas_num`, de
  -- modo que el conteo de ventas, el ticket promedio y las metas del equipo no se
  -- mueven. Solo el acumulado de comision.
  for v_effect in
    select *
      from jsonb_to_recordset(coalesce(p_seller_effects, '[]'::jsonb)) as x(
        id text, comision_acum_delta numeric, base_version bigint,
        after_comision_acum numeric
      )
  loop
    update pos.sellers
       set comision_acum = case
             when sync_version = coalesce(v_effect.base_version, 0) + 1
              and comision_acum = v_effect.after_comision_acum
             then comision_acum
             else greatest(0, comision_acum + coalesce(v_effect.comision_acum_delta, 0)) end,
           sync_base_version = sync_version,
           sync_device_id = 'exchange:' || p_commit_id
     where id = v_effect.id and active = true and deleted_at is null;
    if not found then
      raise exception 'Vendedor del cambio no existe o esta inactivo' using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_seller_effects, '[]'::jsonb))
       as x(id text, comision_acum_delta numeric)
   );

  insert into pos.exchange_commits (commit_id, exchange_id, folio, payload_hash, actor_email)
  values (p_commit_id, v_id, v_folio, v_hash, auth.jwt() ->> 'email');

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_products
    from pos.products p
   where p.id in (select distinct x.product_id from jsonb_to_recordset(p_items)
                    as x(product_id text));

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'exchange', (select to_jsonb(e) from pos.exchanges e where e.id = v_id),
    'products', v_products, 'sellers', v_sellers
  );
end;
$function$
;

do $source$ begin if md5(pg_get_functiondef('pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))<>'e18167b6a76238e161a4ee7115a3f7be' then raise exception 'H150 source drift: commit_exchange_checked'; end if; end $source$;
CREATE OR REPLACE FUNCTION pos.commit_exchange_checked(p_commit_id text, p_exchange jsonb, p_items jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_prior jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_commit_id::text,p_exchange->>'id']::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform 1 from pos.exchange_commits where commit_id=p_commit_id for share;
  if found then
    v_prior:=pos.h94_commit_exchange_delegate(p_commit_id,p_exchange,p_items,
      p_moves,p_payment,p_seller_effects);
    if v_prior->>'error' is distinct from 'commit_mismatch' then return v_prior; end if;
  end if;
  return pos.h133_commit_exchange_delegate(p_commit_id,p_exchange,
    pos.h133_operational_items(p_items,true,p_exchange->>'origen_folio'),p_moves,p_payment,p_seller_effects);
end;
$function$
;

notify pgrst,'reload schema';
commit;
