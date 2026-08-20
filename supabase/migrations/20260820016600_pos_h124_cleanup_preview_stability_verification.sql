do $$
declare
  v_hash_oid regprocedure;
  v_fleet_definition text;
begin
  v_hash_oid:=to_regprocedure('pos.test_data_cleanup_plan_hash(jsonb)');
  if v_hash_oid is null then
    raise exception 'H124_VERIFY_HASH_AUTHORITY_MISSING';
  end if;
  if has_function_privilege('public',v_hash_oid,'execute')
     or has_function_privilege('anon',v_hash_oid,'execute')
     or has_function_privilege('authenticated',v_hash_oid,'execute')
     or not has_function_privilege('service_role',v_hash_oid,'execute') then
    raise exception 'H124_VERIFY_HASH_AUTHORITY_PRIVILEGES';
  end if;

  v_fleet_definition:=pg_get_functiondef(
    'pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure);
  if position('pos.test_data_cleanup_plan_hash(v_core)' in v_fleet_definition)=0
     or position('pos.point_zero_sha256(v_core)' in v_fleet_definition)<>0
     or position('20260820016500' in v_fleet_definition)=0 then
    raise exception 'H124_VERIFY_FLEET_DEFINITION';
  end if;
  if (select schema_version from pos.system_manifest where singleton)<20260820016500 then
    raise exception 'H124_VERIFY_SCHEMA_VERSION';
  end if;
end;
$$;
