\set ON_ERROR_STOP on

-- Reconciliacion A/B/C/D solicitada para H-116. Usa exclusivamente fixtures
-- locales y termina con ROLLBACK; no llama execute_test_data_cleanup.
begin;

do $$
declare
  v_prefix text := 'h116r-' || substr(md5(clock_timestamp()::text), 1, 8);
  v_epoch bigint;
  v_plan jsonb;
  v_result jsonb;
begin
  select data_epoch into strict v_epoch from pos.system_manifest where singleton;

  insert into pos.sync_devices(device_id, protocol_version, schema_version,
    data_epoch, cursors, queue_pending, queue_blocked, status, last_seen_at,
    display_name, device_type)
  values
    (v_prefix||'-a-offline', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now()-interval '7 days', 'Caso A', 'pc'),
    (v_prefix||'-b-intersects', 1, 20260810013500, v_epoch, '{}', 1, 0,
      'online', now()-interval '7 days', 'Caso B', 'pc'),
    (v_prefix||'-c-isolated', 1, 20260810013500, v_epoch, '{}', 1, 0,
      'online', now()-interval '7 days', 'Caso C', 'pc'),
    (v_prefix||'-d-pre-h77', 0, 20260803011300, v_epoch, '{}', 0, 0,
      'online', now()-interval '7 days', 'Caso D', 'pc');

  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, domain, reference, summary, status, requires_action)
  values
    (v_prefix||'-b-intersects', v_prefix||'-sale',
      '00000000-0000-0000-0000-000000000116', 'sale', 'sales', 'H116R-V-1',
      'Venta pendiente que intersecta', 'pending', false),
    (v_prefix||'-c-isolated', v_prefix||'-config',
      '00000000-0000-0000-0000-000000000116', 'config', 'config', null,
      'Configuracion pendiente aislable', 'pending', false);

  v_plan := jsonb_build_object(
    'ok', true,
    'selection_normalized', jsonb_build_object(
      'sales', true, 'returns', false, 'exchanges', false, 'loans', false,
      'commissions', false, 'reclassifications', false, 'customers', false,
      'inventory_products', false),
    'blocked_reasons', jsonb_build_array(
      'cleanup_not_synchronized',
      jsonb_build_object('code', 'client_schema_incompatible', 'devices', 4)),
    'data_epoch', v_epoch,
    'system_mode', 'preproduction'
  );
  v_result := pos.test_data_cleanup_fleet_risk(v_plan);

  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean)
      where device_id=v_prefix||'-a-offline'
        and state='compatible_offline' and blocking=false) then
    raise exception 'H116R_A_OFFLINE_MUST_NOT_BLOCK';
  end if;

  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean,reason text)
      where device_id=v_prefix||'-b-intersects'
        and state='attention' and blocking=true
        and reason='pending_operation_intersects_cleanup') then
    raise exception 'H116R_B_INTERSECTION_MUST_BLOCK';
  end if;

  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean,known_pending integer)
      where device_id=v_prefix||'-c-isolated'
        and state='update_on_return' and blocking=false and known_pending=1) then
    raise exception 'H116R_C_ISOLATED_MUST_NOT_BLOCK';
  end if;

  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean,reason text)
      where device_id=v_prefix||'-d-pre-h77'
        and state='unsafe_legacy' and blocking=true
        and reason='client_cannot_be_fenced') then
    raise exception 'H116R_D_PRE_H77_MUST_BLOCK';
  end if;

  if exists(select 1 from jsonb_array_elements(v_result->'blocked_reasons') r
      where r = '"cleanup_not_synchronized"'::jsonb
         or r->>'code'='client_schema_incompatible') then
    raise exception 'H116R_PRE_H116_GLOBAL_GUARD_SURVIVED';
  end if;
end;
$$;

rollback;
select 'H116_RECONCILIATION_A_B_C_D_OK' as result;
