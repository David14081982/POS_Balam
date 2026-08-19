-- H-116: verificacion funcional autocontenida. No ejecuta ninguna limpieza.
begin;

do $$
declare
  v_plan jsonb;
  v_result jsonb;
  v_reasons jsonb;
  v_prefix text := 'h116-' || substr(md5(clock_timestamp()::text), 1, 8);
  v_epoch bigint;
  v_def text;
begin
  if to_regprocedure('pos.test_data_cleanup_fleet_risk(jsonb)') is null
     or to_regprocedure('pos.admin_set_sync_device_retired(text,boolean,text)') is null then
    raise exception 'h116_authority_missing';
  end if;
  if has_function_privilege('anon', 'pos.test_data_cleanup_fleet_risk(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'pos.test_data_cleanup_fleet_risk(jsonb)', 'execute')
     or has_function_privilege('anon',
       'pos.admin_set_sync_device_retired(text,boolean,text)', 'execute')
     or not has_function_privilege('authenticated',
       'pos.admin_set_sync_device_retired(text,boolean,text)', 'execute') then
    raise exception 'h116_acl_invalid';
  end if;

  select data_epoch into strict v_epoch from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id, protocol_version, schema_version,
    data_epoch, cursors, queue_pending, queue_blocked, status, last_seen_at,
    display_name, device_type)
  values
    (v_prefix||'-online', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now(), 'Caja vigente', 'pc'),
    (v_prefix||'-compatible_offline', 2, 20260818015300, v_epoch, '{}', 0, 0,
      'online', now()-interval '7 days', 'Caja apagada', 'laptop'),
    (v_prefix||'-old_empty_queue', 1, 20260810013500, v_epoch, '{}', 0, 0,
      'online', now()-interval '7 days', 'Caja antigua limpia', 'pc'),
    (v_prefix||'-old_intersecting', 1, 20260810013500, v_epoch, '{}', 1, 0,
      'online', now()-interval '7 days', 'Caja 2', 'pc'),
    (v_prefix||'-pending_unrelated', 2, 20260818015300, v_epoch, '{}', 1, 0,
      'online', now(), 'Administracion', 'laptop'),
    (v_prefix||'-retired_device', 1, 20260807012000, v_epoch, '{}', 7, 3,
      'revoked', now()-interval '90 days', 'Equipo retirado', 'pc');

  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, domain, reference, summary, status, requires_action)
  values
    (v_prefix||'-old_intersecting', v_prefix||'-sale',
      '00000000-0000-0000-0000-000000000116', 'sale', 'sales', 'H116-V-1',
      'Venta pendiente', 'pending', false),
    (v_prefix||'-pending_unrelated', v_prefix||'-config',
      '00000000-0000-0000-0000-000000000116', 'config', 'config', null,
      'Configuracion pendiente no relacionada', 'pending', false);

  v_plan := jsonb_build_object(
    'ok', true,
    'protocol_version', 2,
    'minimum_client_protocol', 2,
    'selection_normalized', jsonb_build_object(
      'sales', true, 'returns', false, 'exchanges', false, 'loans', false,
      'commissions', false, 'reclassifications', false, 'customers', false,
      'inventory_products', false),
    'documents', jsonb_build_object('sale_folios', jsonb_build_array('H116-V-1')),
    'blocked_reasons', jsonb_build_array(
      'cleanup_not_synchronized',
      jsonb_build_object('code', 'client_schema_incompatible', 'devices', 4)),
    'data_epoch', v_epoch,
    'system_mode', 'preproduction'
  );
  v_result := pos.test_data_cleanup_fleet_risk(v_plan);
  v_reasons := v_result->'blocked_reasons';

  -- Caso 1: compatible apagada no bloquea.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean)
      where device_id=v_prefix||'-compatible_offline'
        and state='compatible_offline' and blocking=false) then
    raise exception 'h116_case_compatible_offline';
  end if;
  -- Caso 2: cliente anterior con cola cero actualiza/rebootstrap al volver.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean)
      where device_id=v_prefix||'-old_empty_queue'
        and state='update_on_return' and blocking=false) then
    raise exception 'h116_case_old_empty_queue_must_rebootstrap';
  end if;
  -- Caso 3: venta pendiente intersecta y nombra el equipo.
  if not exists(select 1 from jsonb_array_elements(v_reasons) r
      where r->>'code'='pending_operation_intersects_cleanup'
        and r->>'device_name'='Caja 2') then
    raise exception 'h116_case_old_intersecting';
  end if;
  -- Caso 4: configuracion pendiente no relacionada no bloquea la limpieza.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean,known_pending integer)
      where device_id=v_prefix||'-pending_unrelated'
        and state='ready' and blocking=false and known_pending=1) then
    raise exception 'h116_case_pending_unrelated_nonblocking';
  end if;
  -- Caso 5: equipo retirado no bloquea y conserva su registro.
  if not exists(select 1 from jsonb_to_recordset(v_result->'fleet'->'devices')
      as x(device_id text,state text,blocking boolean)
      where device_id=v_prefix||'-retired_device'
        and state='retired' and blocking=false) then
    raise exception 'h116_case_retired_device';
  end if;
  if exists(select 1 from jsonb_array_elements(v_reasons) r
      where r = '"cleanup_not_synchronized"'::jsonb
         or r->>'code'='client_schema_incompatible') then
    raise exception 'h116_general_presence_guard_survived';
  end if;
  -- El proyecto puede contener equipos reales. El agregado debe incluir, no
  -- igualar, la contribución mínima de los fixtures aislados por prefijo.
  if coalesce((v_result->'fleet'->'summary'->>'attention')::integer,0) < 1
     or coalesce((v_result->'fleet'->'summary'->>'compatible_offline')::integer,0) < 1
     or coalesce((v_result->'fleet'->'summary'->>'update_on_return')::integer,0) < 1
     or coalesce((v_result->'fleet'->'summary'->>'retired')::integer,0) < 1 then
    raise exception 'h116_summary_invalid %', v_result->'fleet'->'summary';
  end if;

  select pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  ) into v_def;
  if position('sync_protocol_min=greatest(sync_protocol_min,2)' in v_def)=0
     or position('data_epoch=data_epoch+1' in v_def)=0
     or position('''minimum_client_protocol'',3' in v_def)=0
     or position('values(p_cleanup_id,3,3,p_preset' in v_def)=0 then
    raise exception 'h116_epoch_protocol_fence_missing';
  end if;
  select pg_get_functiondef(
    'pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz)'::regprocedure
  ) into v_def;
  if position('where pos.sync_devices.status<>''revoked''' in v_def)=0 then
    raise exception 'h116_retired_heartbeat_guard_missing';
  end if;

  delete from pos.sync_activity where device_id like v_prefix||'%';
  delete from pos.sync_devices where device_id like v_prefix||'%';
end;
$$;

rollback;
