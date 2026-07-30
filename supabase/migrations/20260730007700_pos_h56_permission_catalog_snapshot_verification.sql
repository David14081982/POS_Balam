-- H-56 Fase 4: verificación de lectura del catálogo, sin escrituras.

begin;

do $$
declare
  v_actor uuid;
  v_snapshot jsonb;
  v_oid oid;
  v_rejected boolean := false;
  v_migration_role name := current_user;
begin
  select u.id into v_actor
  from auth.users u
  where pos.can_manage_screen_permissions(u.id)
  order by u.created_at
  limit 1;
  if v_actor is null then
    raise exception 'H56_CATALOG_SNAPSHOT_ADMIN_REQUIRED';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  v_snapshot := pos.admin_screen_permission_catalog_snapshot();
  if (v_snapshot ->> 'catalog_version')::bigint < 1
     or jsonb_typeof(v_snapshot -> 'entries') <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements(v_snapshot -> 'entries') e
       where e ? 'screen_key'
         and e ? 'parent_key'
         and e ? 'is_leaf'
         and e ? 'active'
         and e ? 'catalog_version'
     ) then
    raise exception 'H56_CATALOG_SNAPSHOT_SHAPE_FAILED';
  end if;

  v_oid := 'pos.admin_screen_permission_catalog_snapshot()'::regprocedure;
  if not (select prosecdef from pg_proc where oid = v_oid)
     or (select array_to_string(proconfig, ',') from pg_proc where oid = v_oid)
        not like '%search_path=pos, auth, pg_temp%'
     or pg_get_userbyid((select proowner from pg_proc where oid = v_oid))
        <> 'postgres'
     or has_function_privilege('public', v_oid, 'execute')
     or has_function_privilege('anon', v_oid, 'execute')
     or not has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'H56_CATALOG_SNAPSHOT_ACL_FAILED';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute 'set local role anon';
    perform pos.admin_screen_permission_catalog_snapshot();
    execute format('set local role %I', v_migration_role);
  exception when insufficient_privilege then
    execute format('set local role %I', v_migration_role);
    v_rejected := true;
  end;
  execute format('set local role %I', v_migration_role);
  if not v_rejected then
    raise exception 'H56_CATALOG_SNAPSHOT_ANON_FAILED';
  end if;

  raise notice
    'H56_CATALOG_SNAPSHOT version=% entries=% hierarchy=ok acl=ok anon=ok',
    v_snapshot ->> 'catalog_version',
    jsonb_array_length(v_snapshot -> 'entries');
end;
$$;

commit;
