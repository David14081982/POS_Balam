\set ON_ERROR_STOP on

-- H-118 A-F: fixtures aislados, sin ejecutar limpieza ni tocar datos reales.
begin;

do $$
declare
  v_prefix text := 'h118-' || substr(md5(clock_timestamp()::text), 1, 8);
  v_epoch bigint;
  v_plan jsonb;
  v_result jsonb;
begin
  select data_epoch into strict v_epoch from pos.system_manifest where singleton;

  insert into pos.sync_devices(device_id, protocol_version, schema_version,
    data_epoch, cursors, queue_pending, queue_blocked, status, last_seen_at,
    display_name, device_type)
  values
    (v_prefix||'-case-a', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'A actual', 'pc'),
    (v_prefix||'-case-b', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'B histÃ³rica', 'pc'),
    (v_prefix||'-case-c', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'C reproducible', 'pc'),
    (v_prefix||'-case-d', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'D administrativa', 'pc'),
    (v_prefix||'-case-e', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'E dominio ajeno', 'pc'),
    (v_prefix||'-case-f', 1, 20260803011300, v_epoch, '{}', 0, 0,
      'online', now()-interval '30 days', 'F no cercable', 'pc');

  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, domain, reference, summary, status, requires_action)
  values
    (v_prefix||'-case-a', v_prefix||'-a-exchange',
      '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
      'H118-A', 'Cambio actual', 'pending', false),
    (v_prefix||'-case-b', v_prefix||'-b-exchange',
      '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
      'H118-B', 'Cambio histÃ³rico sin payload', 'blocked', true),
    (v_prefix||'-case-d', v_prefix||'-d-exchange',
      '00000000-0000-0000-0000-000000000116', 'exchange', 'exchanges',
      'H118-D', 'Incidencia administrativa', 'retrying', true),
    (v_prefix||'-case-e', v_prefix||'-e-config',
      '00000000-0000-0000-0000-000000000116', 'config', 'config', null,
      'ConfiguraciÃ³n actual ajena', 'pending', false);

  insert into pos.sync_quarantine_cases(device_id, operation_id, remote_epoch,
    user_id, operation_type, domain, reference, summary, payload_hash, status)
  values(v_prefix||'-case-c', v_prefix||'-c-exchange', v_epoch,
    '00000000-0000-0000-0000-000000000116',
    'exchange', 'exchanges', 'H118-C', 'Cambio histÃ³rico con replay posible',
    repeat('c', 64), 'pending_review');

  v_plan := jsonb_build_object(
    'ok', true,
    'selection_normalized', jsonb_build_object(
      'sales', false, 'returns', false, 'exchanges', true, 'loans', false,
      'commissions', false, 'reclassifications', false, 'customers', false,
      'inventory_products', false),
    'blocked_reasons', '[]'::jsonb,
    'data_epoch', v_epoch,
    'system_mode', 'preproduction'
  );
  v_result := pos.test_data_cleanup_fleet_risk(v_plan);

  -- A: operaciÃ³n actual que intersecta, bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer)
      where device_id=v_prefix||'-case-a' and blocking and current_pending=1) then
    raise exception 'H118_A_CURRENT_INTERSECTION_MUST_BLOCK';
  end if;

  -- B: proyecciÃ³n antigua, cola cero y sin payload/cuarentena, no bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer,
        historical_incident_count integer)
      where device_id=v_prefix||'-case-b' and not blocking
        and current_pending=0 and historical_incident_count=1) then
    raise exception 'H118_B_HISTORY_WITHOUT_PAYLOAD_MUST_NOT_BLOCK';
  end if;

  -- C: cuarentena conserva payload/replay y sÃ­ bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,reason text)
      where device_id=v_prefix||'-case-c' and blocking
        and reason='pending_operation_intersects_cleanup') then
    raise exception 'H118_C_REPLAYABLE_QUARANTINE_MUST_BLOCK';
  end if;

  -- D: incidencia administrativa sin replay queda visible y no bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,historical_incident_count integer)
      where device_id=v_prefix||'-case-d' and not blocking
        and historical_incident_count=1) then
    raise exception 'H118_D_ADMIN_HISTORY_MUST_NOT_BLOCK';
  end if;

  -- E: operaciÃ³n actual demostrablemente ajena a Cambios no bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,current_pending integer,
        unknown_pending integer)
      where device_id=v_prefix||'-case-e' and not blocking
        and current_pending=1 and unknown_pending=0) then
    raise exception 'H118_E_NON_SELECTED_DOMAIN_MUST_NOT_BLOCK';
  end if;

  -- F: cliente previo al cerco H-77 sigue bloqueando.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,blocking boolean,reason text)
      where device_id=v_prefix||'-case-f' and blocking
        and reason='client_cannot_be_fenced') then
    raise exception 'H118_F_UNFENCEABLE_MUST_BLOCK';
  end if;
end;
$$;

rollback;
select 'H118_RECONCILIATION_A_F_OK' as result;
