-- H-116: la limpieza selectiva se bloquea por riesgo conocido, no por presencia.
begin;

create or replace function pos.test_data_cleanup_fleet_risk(p_plan jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pos
as $$
declare
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_selection jsonb := coalesce(p_plan->'selection_normalized', '{}'::jsonb);
  v_reasons jsonb;
  v_devices jsonb := '[]'::jsonb;
  v_summary jsonb := jsonb_build_object(
    'ready', 0, 'compatible_offline', 0, 'update_on_return', 0,
    'attention', 0, 'retired', 0, 'unsafe_legacy', 0
  );
  v_domains text[];
  v_manifest_epoch bigint;
  v_device record;
  v_activity jsonb;
  v_quarantine jsonb;
  v_active_count integer;
  v_unknown integer;
  v_conflicts integer;
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

  -- Los grupos H-113 son semanticos. Una venta seleccionada incluye cualquier
  -- intencion pendiente de venta y sus rutas de posventa; configuracion u otro
  -- dominio ajeno puede conservarse y reintentarse despues del rebootstrap.
  v_domains := array_remove(array[
    case when coalesce((v_selection->>'sales')::boolean, false) then 'sales' end,
    case when coalesce((v_selection->>'sales')::boolean, false) then 'payments' end,
    case when coalesce((v_selection->>'sales')::boolean, false)
           or coalesce((v_selection->>'returns')::boolean, false) then 'returns' end,
    case when coalesce((v_selection->>'sales')::boolean, false)
           or coalesce((v_selection->>'exchanges')::boolean, false) then 'exchanges' end,
    case when coalesce((v_selection->>'loans')::boolean, false) then 'loans' end,
    case when coalesce((v_selection->>'commissions')::boolean, false) then 'liquidations' end,
    case when coalesce((v_selection->>'reclassifications')::boolean, false) then 'products' end,
    case when coalesce((v_selection->>'customers')::boolean, false) then 'clients' end
  ], null);

  -- H-113 producia estos dos bloqueos por heartbeat/esquema global. Se retiran
  -- solo del plan efectivo y se sustituyen por razones concretas por terminal.
  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_reasons
  from jsonb_array_elements(coalesce(v_plan->'blocked_reasons', '[]'::jsonb)) e(value)
  where not (jsonb_typeof(e.value) = 'string'
             and e.value #>> '{}' = 'cleanup_not_synchronized')
    and not (jsonb_typeof(e.value) = 'object'
             and e.value->>'code' = 'client_schema_incompatible');

  for v_device in
    select * from pos.sync_devices order by coalesce(display_name, device_id), device_id
  loop
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'operation_id', a.operation_id,
      'operation_type', a.operation_type,
      'domain', a.domain,
      'reference', a.reference,
      'summary', a.summary,
      'status', a.status
    ) order by a.updated_at desc) filter (where a.domain = any(v_domains)), '[]'::jsonb)
    into v_active_count, v_activity
    from pos.sync_activity a
    where a.device_id = v_device.device_id
      and a.status in ('pending', 'retrying', 'blocked', 'quarantined');

    select coalesce(jsonb_agg(jsonb_build_object(
      'operation_id', q.operation_id,
      'operation_type', q.operation_type,
      'domain', q.domain,
      'reference', q.reference,
      'summary', q.summary,
      'status', q.status
    ) order by q.updated_at desc), '[]'::jsonb)
    into v_quarantine
    from pos.sync_quarantine_cases q
    where q.device_id = v_device.device_id
      and q.status in ('pending_review', 'approved', 'delivered', 'failed')
      and q.domain = any(v_domains);

    v_unknown := greatest(coalesce(v_device.queue_pending, 0) - v_active_count, 0);
    v_conflicts := jsonb_array_length(v_activity) + jsonb_array_length(v_quarantine);
    v_recent := v_device.last_seen_at >= statement_timestamp() - interval '2 minutes';
    -- Desde H-77 el cliente consulta manifiesto/epoca antes del flush y conserva
    -- la cola en cuarentena. Un cliente anterior a esa frontera no es cercable.
    v_fenceable := coalesce(v_device.protocol_version, 0) >= 1
      and coalesce(v_device.schema_version, 0) >= 20260806011500;
    v_requires_update := coalesce(v_device.protocol_version, 0) < 2
      or coalesce(v_device.schema_version, 0) < 20260818015300
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
        'operations', v_activity || v_quarantine,
        'unknown_operations', v_unknown
      ));
    end if;

    v_summary := jsonb_set(v_summary, array[v_state],
      to_jsonb(coalesce((v_summary->>v_state)::integer, 0) + 1));
    v_devices := v_devices || jsonb_build_array(jsonb_build_object(
      'device_id', v_device.device_id,
      'display_name', coalesce(nullif(v_device.display_name, ''),
        'Equipo ' || upper(right(v_device.device_id, 6))),
      'state', v_state,
      'blocking', v_blocking,
      'reason', v_reason,
      'known_pending', v_active_count,
      'unknown_pending', v_unknown,
      'conflicts', v_activity || v_quarantine,
      'last_seen_at', v_device.last_seen_at,
      'protocol_version', v_device.protocol_version,
      'schema_version', v_device.schema_version,
      'data_epoch', v_device.data_epoch,
      'status', v_device.status,
      'fenceable', v_fenceable
    ));
  end loop;

  v_core := (v_plan - 'ok' - 'plan_hash' - 'executable' - 'queue_pending'
    - 'active_locks' - 'unsynchronized_devices' - 'incompatible_devices')
    || jsonb_build_object(
      'protocol_version', 3,
      'minimum_client_protocol', 3,
      'blocked_reasons', v_reasons,
      'fleet', jsonb_build_object('summary', v_summary, 'devices', v_devices)
    );
  return v_core || jsonb_build_object(
    'ok', true,
    'plan_hash', pos.point_zero_sha256(v_core),
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
$$;

revoke all on function pos.test_data_cleanup_fleet_risk(jsonb)
  from public, anon, authenticated;

create or replace function pos.preview_test_data_cleanup(
  p_preset text default 'operations', p_selection jsonb default '{}'::jsonb,
  p_client_protocol integer default 3
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos
as $$
declare v_plan jsonb;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  v_plan := pos.test_data_cleanup_fleet_risk(
    pos.test_data_cleanup_plan(p_preset, p_selection)
  );
  if coalesce(p_client_protocol, 0) < (v_plan->>'minimum_client_protocol')::integer then
    return jsonb_set(jsonb_set(v_plan, '{executable}', 'false'::jsonb),
      '{blocked_reasons}', (v_plan->'blocked_reasons')
        || jsonb_build_array('minimum_client_protocol'));
  end if;
  return v_plan;
end;
$$;

create or replace function pos.admin_set_sync_device_retired(
  p_device_id text, p_retired boolean, p_note text default null
) returns pos.sync_devices
language plpgsql security definer
set search_path = pg_catalog, pos
as $$
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
      'retirement_note', nullif(left(btrim(coalesce(p_note, '')), 500), '')
    )
  where device_id = p_device_id
  returning * into v_row;
  if not found then raise exception 'device_not_found'; end if;
  perform pos.bump_sync_domain('devices', p_device_id);
  return v_row;
end;
$$;

revoke all on function pos.admin_set_sync_device_retired(text, boolean, text)
  from public, anon;
grant execute on function pos.admin_set_sync_device_retired(text, boolean, text)
  to authenticated;

-- Un heartbeat posterior no reactiva silenciosamente una instalacion retirada.
do $patch$
declare v_definition text; v_next text;
begin
  v_definition := pg_get_functiondef(
    'pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz)'::regprocedure
  );
  if position('where pos.sync_devices.status<>''revoked''' in v_definition) = 0 then
    v_next := replace(v_definition,
      'last_seen_at=now(), last_synced_at=excluded.last_synced_at;',
      E'last_seen_at=now(), last_synced_at=excluded.last_synced_at\n  where pos.sync_devices.status<>''revoked'';');
    if v_next = v_definition then raise exception 'H116_HEARTBEAT_PATCH_MISMATCH'; end if;
    execute v_next;
  end if;
end;
$patch$;

-- La definicion aplicada se genera desde la RPC H-113 vigente. La limpieza
-- futura eleva epoca y protocolo en el mismo commit; el evento 3 es ilegible
-- para el cliente H-113 anterior, que queda cerrado por sync_protocol_min=2.
do $patch$
declare v_definition text; v_next text;
begin
  v_definition := pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  );
  v_next := v_definition;
  v_next := replace(v_next,
    $old$update pos.system_manifest set data_epoch=data_epoch+1,
    schema_version=case$old$,
    $new$update pos.system_manifest set data_epoch=data_epoch+1,
    sync_protocol_min=greatest(sync_protocol_min,2),
    sync_protocol_current=greatest(sync_protocol_current,2),
    schema_version=case$new$);
  v_next := replace(v_next,
    $old$'protocol_version',2,'minimum_client_protocol',2,$old$,
    $new$'protocol_version',3,'minimum_client_protocol',3,$new$);
  v_next := replace(v_next,
    $old$values(p_cleanup_id,2,2,p_preset,$old$,
    $new$values(p_cleanup_id,3,3,p_preset,$new$);
  if v_next = v_definition
     or position('sync_protocol_min=greatest(sync_protocol_min,2)' in v_next) = 0
     or position('''minimum_client_protocol'',3' in v_next) = 0
     or position('values(p_cleanup_id,3,3,p_preset' in v_next) = 0 then
    raise exception 'H116_EXECUTE_PATCH_MISMATCH';
  end if;
  execute v_next;
end;
$patch$;

update pos.system_manifest set
  schema_version = greatest(schema_version, 20260818015300),
  sync_protocol_current = greatest(sync_protocol_current, 2),
  updated_at = now()
where singleton;

commit;
