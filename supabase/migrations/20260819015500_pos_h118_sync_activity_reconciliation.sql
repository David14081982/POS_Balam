-- H-118: sync_activity es observabilidad; la cola local declarada decide si
-- sus proyecciones representan operaciones actuales. No modifica ninguna fila.
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
           or coalesce((v_selection->>'returns')::boolean, false) then 'returns' end,
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
      and q.status in ('pending_review', 'approved', 'delivered', 'failed')
      and q.domain = any(v_domains);

    v_conflicts := jsonb_array_length(v_current_activity)
      + jsonb_array_length(v_quarantine);
    v_historical_count := jsonb_array_length(v_historical_activity);
    v_recent := v_device.last_seen_at >= statement_timestamp() - interval '2 minutes';
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

commit;
