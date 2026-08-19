-- H-118: verifica la clasificaciÃ³n; no ejecuta limpieza ni persiste fixtures.
begin;

do $$
declare
  v_prefix text := 'h118v-' || substr(md5(clock_timestamp()::text), 1, 8);
  v_epoch bigint;
  v_plan jsonb;
  v_result jsonb;
begin
  if to_regprocedure('pos.test_data_cleanup_fleet_risk(jsonb)') is null then
    raise exception 'h118_authority_missing';
  end if;
  if has_function_privilege('anon',
       'pos.test_data_cleanup_fleet_risk(jsonb)', 'execute')
     or has_function_privilege('authenticated',
       'pos.test_data_cleanup_fleet_risk(jsonb)', 'execute') then
    raise exception 'h118_acl_invalid';
  end if;

  select data_epoch into strict v_epoch from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id, protocol_version, schema_version,
    data_epoch, cursors, queue_pending, queue_blocked, status, last_seen_at,
    display_name, device_type)
  values
    (v_prefix||'-current', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'Actual', 'pc'),
    (v_prefix||'-history', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'HistÃ³rica', 'pc'),
    (v_prefix||'-quarantine', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'Cuarentena', 'pc'),
    (v_prefix||'-unrelated', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'Ajena', 'pc'),
    (v_prefix||'-unknown', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'Sin detalle', 'pc'),
    (v_prefix||'-legacy', 0, 20260803011300, v_epoch, '{}', 0, 0,
      'offline', now()-interval '30 days', 'Legacy', 'pc');

  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, domain, reference, summary, status, requires_action)
  values
    (v_prefix||'-current', v_prefix||'-current-op',
      '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
      'H118-V-A', 'Cambio actual', 'pending', false),
    (v_prefix||'-history', v_prefix||'-history-op',
      '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
      'H118-V-B', 'Cambio histÃ³rico', 'blocked', true),
    (v_prefix||'-unrelated', v_prefix||'-config-op',
      '00000000-0000-0000-0000-000000000116', 'config', 'config', null,
      'ConfiguraciÃ³n actual', 'pending', false);

  insert into pos.sync_quarantine_cases(device_id, operation_id, remote_epoch,
    user_id, operation_type, domain, reference, summary, payload_hash, status)
  values(v_prefix||'-quarantine', v_prefix||'-quarantine-op', v_epoch,
    '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
    'H118-V-C', 'Cambio con replay', repeat('c', 64), 'pending_review');

  v_plan := jsonb_build_object(
    'ok', true,
    'selection_normalized', jsonb_build_object(
      'sales', false, 'returns', false, 'exchanges', true, 'loans', false,
      'commissions', false, 'reclassifications', false, 'customers', false),
    'blocked_reasons', '[]'::jsonb,
    'data_epoch', v_epoch,
    'system_mode', 'preproduction'
  );
  v_result := pos.test_data_cleanup_fleet_risk(v_plan);

  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer)
      where device_id=v_prefix||'-current' and blocking and current_pending=1) then
    raise exception 'h118_current_intersection_not_blocked';
  end if;
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer,
        historical_incident_count integer)
      where device_id=v_prefix||'-history' and not blocking
        and current_pending=0 and historical_incident_count=1) then
    raise exception 'h118_history_without_payload_blocked';
  end if;
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,reason text)
      where device_id=v_prefix||'-quarantine' and blocking
        and reason='pending_operation_intersects_cleanup') then
    raise exception 'h118_replayable_quarantine_not_blocked';
  end if;
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer)
      where device_id=v_prefix||'-unrelated' and not blocking
        and current_pending=1) then
    raise exception 'h118_unrelated_domain_blocked';
  end if;
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,reason text)
      where device_id=v_prefix||'-unknown' and blocking
        and reason='pending_scope_unknown') then
    raise exception 'h118_unknown_scope_not_blocked';
  end if;
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,reason text)
      where device_id=v_prefix||'-legacy' and blocking
        and reason='client_cannot_be_fenced') then
    raise exception 'h118_unfenceable_not_blocked';
  end if;
end;
$$;

rollback;
