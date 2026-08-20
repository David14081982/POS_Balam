\set ON_ERROR_STOP on

-- H-124 · Fixture transaccional. Demuestra que la telemetría no cambia la
-- identidad del plan, pero una operación pendiente que intersecta sí lo hace.
begin;

do $$
declare
  v_prefix text := 'h124-' || substr(md5(clock_timestamp()::text), 1, 8);
  v_epoch bigint;
  v_plan jsonb;
  v_before jsonb;
  v_heartbeat jsonb;
  v_blocked jsonb;
begin
  select data_epoch into strict v_epoch from pos.system_manifest where singleton;

  insert into pos.sync_devices(device_id, user_id, protocol_version,
    schema_version, data_epoch, cursors, queue_pending, queue_blocked, status,
    last_seen_at, display_name, device_type)
  values(v_prefix, '00000000-0000-0000-0000-000000000124', 2,
    20260820016500, v_epoch, '{}', 0, 0, 'online', now() - interval '20 seconds',
    'Equipo H-124', 'pc');

  v_plan := jsonb_build_object(
    'ok', true,
    'protocol_version', 5,
    'minimum_client_protocol', 5,
    'preset_requested', 'custom',
    'selection_requested', jsonb_build_object('sales', true),
    'selection_normalized', jsonb_build_object(
      'sales', true, 'returns', false, 'orphan_return_evidence', false,
      'exchanges', false, 'loans', false, 'commissions', false,
      'reclassifications', false, 'customers', false,
      'inventory_products', false),
    'forced_dependencies', '[]'::jsonb,
    'counts', jsonb_build_object('ventas', 1),
    'documents', jsonb_build_object('sale_folios', jsonb_build_array('H124-V-1')),
    'stock', '[]'::jsonb,
    'blocked_reasons', '[]'::jsonb,
    'data_epoch', v_epoch,
    'system_mode', 'preproduction'
  );

  v_before := pos.test_data_cleanup_fleet_risk(v_plan);
  update pos.sync_devices set last_seen_at = now() where device_id = v_prefix;
  v_heartbeat := pos.test_data_cleanup_fleet_risk(v_plan);

  if v_before->'fleet'->'devices' = v_heartbeat->'fleet'->'devices' then
    raise exception 'H124_FIXTURE_DID_NOT_CHANGE_TELEMETRY';
  end if;
  if v_before->>'plan_hash' is distinct from v_heartbeat->>'plan_hash' then
    raise exception 'H124_HEARTBEAT_CHANGED_PLAN_HASH';
  end if;

  update pos.sync_devices set queue_pending = 1 where device_id = v_prefix;
  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, domain, reference, summary, status, requires_action)
  values(v_prefix, v_prefix||'-sale', '00000000-0000-0000-0000-000000000124',
    'sale', 'sales', 'H124-V-2', 'Venta pendiente', 'pending', false);
  v_blocked := pos.test_data_cleanup_fleet_risk(v_plan);

  if coalesce((v_blocked->>'executable')::boolean, true)
     or not exists(select 1 from jsonb_array_elements(v_blocked->'blocked_reasons') r
       where r->>'code' = 'pending_operation_intersects_cleanup') then
    raise exception 'H124_INTERSECTION_DID_NOT_BLOCK';
  end if;
  if v_before->>'plan_hash' is not distinct from v_blocked->>'plan_hash' then
    raise exception 'H124_BLOCKING_CHANGE_DID_NOT_INVALIDATE_HASH';
  end if;
end;
$$;

rollback;
select 'H124_CLEANUP_PREVIEW_STABILITY_OK' as result;
