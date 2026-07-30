-- H-56 Fase 3 — verificación de snapshot sin escrituras.

begin;

do $$
declare
  v_admin uuid;
  v_snapshot jsonb;
  v_owner text;
  v_security_definer boolean;
  v_search_path text;
  v_function_oid oid;
  v_migration_role name := current_user;
  v_anon_rejected boolean := false;
begin
  select u.id into v_admin
  from auth.users u
  join pos.sellers s on lower(s.email) = lower(u.email)
  where s.role = 'admin'
    and s.active is true
    and s.deleted_at is null
  order by u.created_at
  limit 1;

  if v_admin is null then
    raise exception 'H56_SNAPSHOT_ACTIVE_ADMIN_REQUIRED';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_snapshot := pos.current_permission_snapshot(
    array['dashboard', 'config.permisos', 'h56.new_screen']
  );

  if v_snapshot ->> 'model_version' <> 'h56-screen-permissions-v1'
     or nullif(v_snapshot ->> 'permission_version', '') is null
     or v_snapshot ->> 'profile_status' <> 'active'
     or jsonb_typeof(v_snapshot -> 'profile') <> 'object'
     or jsonb_typeof(v_snapshot -> 'permissions') <> 'array'
     or jsonb_array_length(v_snapshot -> 'permissions') <> 3 then
    raise exception 'H56_PERMISSION_SNAPSHOT_SHAPE_FAILED';
  end if;

  if coalesce((
    select (p ->> 'allowed')::boolean
    from jsonb_array_elements(v_snapshot -> 'permissions') p
    where p ->> 'screen_key' = 'h56.new_screen'
  ), true) then
    raise exception 'H56_PERMISSION_SNAPSHOT_NEW_SCREEN_FAILED';
  end if;

  select
    p.oid,
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    array_to_string(p.proconfig, ',')
  into v_function_oid, v_owner, v_security_definer, v_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'pos'
    and p.oid = 'pos.current_permission_snapshot(text[])'::regprocedure;

  if v_owner is null
     or v_security_definer is distinct from true
     or v_search_path not like '%search_path=pos, auth, pg_temp%'
     or (
       select p.pronargs
       from pg_proc p
       where p.oid = 'pos.current_permission_snapshot(text[])'::regprocedure
     ) <> 1
     or pg_get_function_arguments(v_function_oid)
        <> 'p_screen_keys text[]'
     or position(
       'resolve_screen_permission' in pg_get_functiondef(
         'pos.current_permission_snapshot(text[])'::regprocedure
       )
     ) = 0
     or position(
       'auth.uid()' in pg_get_functiondef(
         'pos.current_permission_snapshot(text[])'::regprocedure
       )
     ) = 0 then
    raise exception 'H56_PERMISSION_SNAPSHOT_SECURITY_METADATA_FAILED';
  end if;

  if has_function_privilege(
       'public', v_function_oid, 'execute'
     )
     or has_function_privilege(
       'anon', v_function_oid, 'execute'
     )
     or not has_function_privilege(
       'authenticated', v_function_oid, 'execute'
     ) then
    raise exception 'H56_PERMISSION_SNAPSHOT_ACL_FAILED';
  end if;

  -- Llamada real bajo authenticated con permisos.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    execute 'set local role authenticated';
    v_snapshot := pos.current_permission_snapshot(
      array['dashboard', 'config.permisos']
    );
    execute format('set local role %I', v_migration_role);
  exception when others then
    execute format('set local role %I', v_migration_role);
    raise;
  end;
  if v_snapshot ->> 'profile_status' <> 'active'
     or not coalesce((
       select (p ->> 'allowed')::boolean
       from jsonb_array_elements(v_snapshot -> 'permissions') p
       where p ->> 'screen_key' = 'dashboard'
     ), false) then
    raise exception 'H56_AUTHENTICATED_WITH_PERMISSIONS_FAILED';
  end if;

  -- Authenticated sin perfil: llamada permitida, resultado default-deny.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-0000000056f3',
    true
  );
  begin
    execute 'set local role authenticated';
    v_snapshot := pos.current_permission_snapshot(
      array['dashboard', 'h56.unknown_screen']
    );
    execute format('set local role %I', v_migration_role);
  exception when others then
    execute format('set local role %I', v_migration_role);
    raise;
  end;
  if v_snapshot ->> 'profile_status' <> 'profile_missing'
     or exists (
       select 1
       from jsonb_array_elements(v_snapshot -> 'permissions') p
       where (p ->> 'allowed')::boolean
     ) then
    raise exception 'H56_AUTHENTICATED_WITHOUT_PERMISSIONS_FAILED';
  end if;

  -- Anon no puede ejecutar la RPC.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute 'set local role anon';
    perform pos.current_permission_snapshot(array['dashboard']);
    execute format('set local role %I', v_migration_role);
  exception when insufficient_privilege then
    execute format('set local role %I', v_migration_role);
    v_anon_rejected := true;
  end;
  execute format('set local role %I', v_migration_role);
  if not v_anon_rejected then
    raise exception 'H56_ANON_CALL_NOT_REJECTED';
  end if;

  raise notice
    'H56_SNAPSHOT_METADATA signature=pos.current_permission_snapshot(text[]) owner=% security_definer=% search_path=%',
    v_owner, v_security_definer, v_search_path;
  raise notice
    'H56_SNAPSHOT_PRIVILEGES public=% anon=% authenticated=% service_role=%',
    has_function_privilege(
      'public', v_function_oid, 'execute'
    ),
    has_function_privilege(
      'anon', v_function_oid, 'execute'
    ),
    has_function_privilege(
      'authenticated', v_function_oid, 'execute'
    ),
    has_function_privilege(
      'service_role', v_function_oid, 'execute'
    );
  raise notice
    'H56_SNAPSHOT_CALLS authenticated_allowed=ok authenticated_default_deny=ok unknown_screen=ok anon_rejected=ok';
end;
$$;

commit;
