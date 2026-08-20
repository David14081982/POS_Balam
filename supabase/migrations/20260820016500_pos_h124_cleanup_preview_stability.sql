-- H-124: la telemetría de flota es visible, pero no identifica el alcance
-- comercial de una limpieza. Los bloqueos concretos siguen en blocked_reasons.
begin;

create or replace function pos.test_data_cleanup_plan_hash(p_plan jsonb)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, pos
as $$
  select pos.point_zero_sha256(coalesce(p_plan, '{}'::jsonb) - 'fleet')
$$;

revoke all on function pos.test_data_cleanup_plan_hash(jsonb)
  from public, anon, authenticated;
grant execute on function pos.test_data_cleanup_plan_hash(jsonb) to service_role;

do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(
    pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure),
    E'\r\n',E'\n');
  v_old:='pos.point_zero_sha256(v_core)';
  v_new:='pos.test_data_cleanup_plan_hash(v_core)';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H124_FLEET_PATCH_MISMATCH:hash';
  end if;
  v_next:=replace(v_definition,v_old,v_new);

  v_old:='coalesce(v_device.schema_version, 0) < 20260820016300';
  v_new:='coalesce(v_device.schema_version, 0) < 20260820016500';
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H124_FLEET_PATCH_MISMATCH:schema';
  end if;
  v_next:=replace(v_next,v_old,v_new);
  execute v_next;
end;
$patch$;

update pos.system_manifest
set schema_version=greatest(schema_version,20260820016500),updated_at=now()
where singleton;

commit;
