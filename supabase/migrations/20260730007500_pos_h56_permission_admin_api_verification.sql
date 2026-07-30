-- H-56 Fase 4 — verificación transaccional con fixtures sintéticas.

begin;

do $$
declare
  v_actor uuid;
  v_target constant uuid := '00000000-0000-0000-0000-000000005641';
  v_inactive constant uuid := '00000000-0000-0000-0000-000000005642';
  v_unknown constant uuid := '00000000-0000-0000-0000-000000005643';
  v_version text;
  v_new_version text;
  v_catalog_version bigint;
  v_catalog_updated_at timestamptz;
  v_catalog_updated_by uuid;
  v_catalog_backup jsonb;
  v_result jsonb;
  v_batch uuid;
  v_rejected boolean;
  v_count integer;
  v_audit_before integer;
  v_audit_after integer;
  v_case text;
  v_error text;
  v_state_updated_at timestamptz;
  v_role name := current_user;
  v_oid oid;
  v_name text;
begin
  if exists (
    select 1 from auth.users
    where id in (v_target, v_inactive, v_unknown)
  ) then
    raise exception 'H56_SYNTHETIC_IDENTITY_COLLISION';
  end if;

  select u.id into v_actor
  from auth.users u
  where pos.can_manage_screen_permissions(u.id)
  order by u.created_at
  limit 1;
  if v_actor is null then
    raise exception 'H56_PERMISSION_ADMIN_REQUIRED';
  end if;

  select catalog_version, updated_at, updated_by
  into v_catalog_version, v_catalog_updated_at, v_catalog_updated_by
  from pos.screen_permission_catalog_state where singleton;
  select jsonb_agg(to_jsonb(c) order by c.screen_key)
  into v_catalog_backup
  from pos.screen_permission_catalog c;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_target,
     'authenticated', 'authenticated', 'h56.phase4.target@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_inactive,
     'authenticated', 'authenticated', 'h56.phase4.inactive@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

  insert into pos.sellers (
    id, nombre, email, role, active, updated_at
  ) values
    ('h56-phase4-target', 'Fixture Permisos H56',
     'h56.phase4.target@invalid.local', 'admin', true, now()),
    ('h56-phase4-inactive', 'Fixture Inactiva H56',
     'h56.phase4.inactive@invalid.local', 'admin', false, now());

  insert into pos.permission_roles (code, name, active)
  values ('h56verify', 'Fixture H56', true);
  insert into pos.user_permission_role_assignments (
    user_id, role_code, active
  ) values (v_target, 'h56verify', true), (v_inactive, 'h56verify', true);
  insert into pos.role_screen_permissions (role_code, screen_key, allowed)
  values
    ('h56verify', 'config.usuarios', true),
    ('h56verify', 'config.permisos', true),
    ('h56verify', 'h56.phase4.leaf', false);
  insert into pos.screen_permission_catalog (
    screen_key, parent_key, is_leaf, active, catalog_version
  ) values
    ('h56.phase4', null, false, true, v_catalog_version),
    ('h56.phase4.leaf', 'h56.phase4', true, true, v_catalog_version),
    ('h56.phase4.new', 'h56.phase4', true, true, v_catalog_version),
    ('h56.phase4.inactive', 'h56.phase4', true, false, v_catalog_version);

  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  v_rejected := false;
  begin
    perform pos.admin_sync_screen_permission_catalog(
      jsonb_build_array(
        jsonb_build_object(
          'screen_key', 'h56.phase4.duplicate', 'is_leaf', true
        ),
        jsonb_build_object(
          'screen_key', 'h56.phase4.duplicate', 'is_leaf', true
        )
      ),
      v_catalog_version
    );
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'H56_CATALOG_DUPLICATE_FAILED'; end if;

  v_result := pos.admin_sync_screen_permission_catalog(
    (
      select jsonb_agg(jsonb_build_object(
        'screen_key', c.screen_key,
        'parent_key', c.parent_key,
        'is_leaf', c.is_leaf
      ) order by c.screen_key)
      from pos.screen_permission_catalog c
    ),
    v_catalog_version
  );
  if (v_result ->> 'catalog_version')::bigint <> v_catalog_version + 1 then
    raise exception 'H56_CATALOG_SYNC_FAILED';
  end if;
  v_rejected := false;
  begin
    perform pos.admin_sync_screen_permission_catalog(
      '[]'::jsonb, v_catalog_version
    );
  exception when sqlstate '40001' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_CATALOG_STALE_VERSION_FAILED';
  end if;
  update pos.screen_permission_catalog
  set active = false
  where screen_key = 'h56.phase4.inactive';

  select count(*) into v_count
  from pos.admin_permission_users(null, 999, 0);
  if v_count > 500 then
    raise exception 'H56_PERMISSION_PAGE_LIMIT_FAILED';
  end if;
  if not exists (
    select 1 from pos.admin_permission_users('Fixture Permisos', 100, 0)
    where user_id = v_target
  ) or not exists (
    select 1 from pos.admin_permission_users(
      'h56.phase4.target@invalid.local', 100, 0
    ) where user_id = v_target
  ) or exists (
    select 1 from pos.admin_permission_users('h56-no-match', 100, 0)
  ) then
    raise exception 'H56_PERMISSION_SEARCH_FAILED';
  end if;

  v_result := pos.admin_user_permission_snapshot(
    v_target, array['config.permisos', 'h56.phase4.leaf']
  );
  if v_result #>> '{user,id}' <> v_target::text
     or v_result ->> 'base_role' <> 'h56verify'
     or jsonb_array_length(v_result -> 'permissions') <> 2 then
    raise exception 'H56_PERMISSION_ADMIN_SNAPSHOT_FAILED';
  end if;
  if (select allowed from pos.resolve_screen_permission(
        v_target, 'h56.phase4.new'
      )) is distinct from false then
    raise exception 'H56_NEW_SCREEN_DEFAULT_DENY_FAILED';
  end if;
  v_version := v_result ->> 'permission_version';

  v_result := pos.admin_apply_user_screen_permissions_checked(
    v_target, 'h56verify', '{"h56.phase4.leaf":"allow"}',
    v_version, array['config.permisos', 'h56.phase4.leaf']
  );
  v_batch := (v_result ->> 'batch_id')::uuid;
  if v_batch is null or not exists (
    select 1 from pos.permission_change_audit
    where batch_id = v_batch
      and actor_user_id = v_actor
      and target_user_id = v_target
      and old_value is null
      and new_value = '"allow"'::jsonb
  ) then
    raise exception 'H56_PERMISSION_ATOMICITY_FAILED';
  end if;

  v_rejected := false;
  begin
    perform pos.admin_apply_user_screen_permissions_checked(
      v_target, 'h56verify', '{"h56.phase4.leaf":"deny"}',
      v_version, array['h56.phase4.leaf']
    );
  exception when sqlstate '40001' then
    v_rejected := true;
  end;
  if not v_rejected or exists (
    select 1 from pos.permission_change_audit
    where target_user_id = v_target and batch_id <> v_batch
  ) then
    raise exception 'H56_PERMISSION_CONFLICT_FAILED';
  end if;

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.user_screen_permission_overrides
  set effect = 'deny', updated_at = clock_timestamp()
  where user_id = v_target and screen_key = 'h56.phase4.leaf';
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_OVERRIDE_FAILED';
  end if;

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.role_screen_permissions
  set allowed = not allowed, updated_at = clock_timestamp()
  where role_code = 'h56verify' and screen_key = 'h56.phase4.leaf';
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_ROLE_PERMISSION_FAILED';
  end if;

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.permission_roles
  set active = false, updated_at = clock_timestamp()
  where code = 'h56verify';
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_ROLE_ACTIVE_FAILED';
  end if;
  update pos.permission_roles set active = true where code = 'h56verify';

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.user_permission_role_assignments
  set active = false, updated_at = clock_timestamp()
  where user_id = v_target;
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_ASSIGNMENT_ACTIVE_FAILED';
  end if;
  update pos.user_permission_role_assignments
  set active = true where user_id = v_target;

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.sellers
  set active = false,
      sync_base_version = sync_version,
      updated_at = clock_timestamp()
  where id = 'h56-phase4-target';
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_USER_STATE_FAILED';
  end if;
  update pos.sellers
  set active = true, sync_base_version = sync_version
  where id = 'h56-phase4-target';

  v_version := pos.user_screen_permissions_version(v_target);
  update pos.screen_permission_catalog_state
  set catalog_version = catalog_version + 1, updated_at = clock_timestamp()
  where singleton;
  if v_version = pos.user_screen_permissions_version(v_target) then
    raise exception 'H56_TOKEN_CATALOG_FAILED';
  end if;

  -- Cada causa vuelve obsoleto el token y no produce cambios ni auditoría.
  foreach v_case in array array[
    'override', 'role_permission', 'role_active',
    'assignment_active', 'profile_active', 'catalog'
  ] loop
    v_version := pos.user_screen_permissions_version(v_target);
    select count(*) into v_audit_before
    from pos.permission_change_audit where target_user_id = v_target;
    if v_case = 'override' then
      update pos.user_screen_permission_overrides
      set effect = case effect when 'allow' then 'deny' else 'allow' end,
          updated_at = clock_timestamp()
      where user_id = v_target and screen_key = 'h56.phase4.leaf';
    elsif v_case = 'role_permission' then
      update pos.role_screen_permissions
      set allowed = not allowed, updated_at = clock_timestamp()
      where role_code = 'h56verify' and screen_key = 'h56.phase4.leaf';
    elsif v_case = 'role_active' then
      update pos.permission_roles
      set active = false, updated_at = clock_timestamp()
      where code = 'h56verify';
    elsif v_case = 'assignment_active' then
      update pos.user_permission_role_assignments
      set active = false, updated_at = clock_timestamp()
      where user_id = v_target;
    elsif v_case = 'profile_active' then
      update pos.sellers
      set active = false, sync_base_version = sync_version,
          updated_at = clock_timestamp()
      where id = 'h56-phase4-target';
    else
      select updated_at into v_state_updated_at
      from pos.screen_permission_catalog_state where singleton;
      update pos.screen_permission_catalog_state
      set catalog_version = catalog_version + 1,
          updated_at = clock_timestamp()
      where singleton;
    end if;

    v_rejected := false;
    v_error := null;
    begin
      perform pos.admin_apply_user_screen_permissions_checked(
        v_target, 'h56verify', '{}'::jsonb, v_version,
        array['h56.phase4.leaf']
      );
    exception when sqlstate '40001' then
      v_rejected := true;
      v_error := sqlerrm;
    end;
    select count(*) into v_audit_after
    from pos.permission_change_audit where target_user_id = v_target;
    if not v_rejected
       or v_error <> 'PERMISSION_VERSION_CONFLICT'
       or v_audit_after <> v_audit_before then
      raise exception 'H56_CONFLICT_CAUSE_FAILED: %', v_case;
    end if;

    if v_case = 'override' then
      update pos.user_screen_permission_overrides
      set effect = case effect when 'allow' then 'deny' else 'allow' end
      where user_id = v_target and screen_key = 'h56.phase4.leaf';
    elsif v_case = 'role_permission' then
      update pos.role_screen_permissions
      set allowed = not allowed
      where role_code = 'h56verify' and screen_key = 'h56.phase4.leaf';
    elsif v_case = 'role_active' then
      update pos.permission_roles set active = true where code = 'h56verify';
    elsif v_case = 'assignment_active' then
      update pos.user_permission_role_assignments
      set active = true where user_id = v_target;
    elsif v_case = 'profile_active' then
      update pos.sellers
      set active = true, sync_base_version = sync_version
      where id = 'h56-phase4-target';
    else
      update pos.screen_permission_catalog_state
      set catalog_version = catalog_version - 1,
          updated_at = v_state_updated_at
      where singleton;
    end if;
  end loop;

  -- Null elimina el override, registra el delta y devuelve herencia.
  v_version := pos.user_screen_permissions_version(v_target);
  v_result := pos.admin_apply_user_screen_permissions_checked(
    v_target, 'h56verify', '{"h56.phase4.leaf":null}'::jsonb,
    v_version, array['h56.phase4.leaf']
  );
  if exists (
    select 1 from pos.user_screen_permission_overrides
    where user_id = v_target and screen_key = 'h56.phase4.leaf'
  ) or not exists (
    select 1 from pos.permission_change_audit
    where batch_id = (v_result ->> 'batch_id')::uuid
      and old_value is not null and new_value is null
  ) then
    raise exception 'H56_OVERRIDE_INHERIT_FAILED';
  end if;

  v_rejected := false;
  begin
    perform pos.admin_user_permission_snapshot(
      v_unknown, array['config.permisos']
    );
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_PERMISSION_TARGET_NOT_FOUND_FAILED';
  end if;

  v_rejected := false;
  begin
    perform pos.admin_apply_user_screen_permissions_checked(
      v_inactive, 'h56verify', '{}',
      pos.user_screen_permissions_version(v_inactive),
      array['config.permisos']
    );
  exception when sqlstate '55000' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'H56_PERMISSION_INACTIVE_FAILED'; end if;

  foreach v_name in array array[
    'SCREEN_KEY_UNKNOWN', 'SCREEN_KEY_INACTIVE', 'SCREEN_KEYS_DUPLICATED',
    'SCREEN_KEY_NOT_LEAF', 'SCREEN_KEY_FORMAT_INVALID',
    'OVERRIDE_EFFECT_INVALID'
  ] loop
    v_rejected := false;
    begin
      if v_name = 'SCREEN_KEY_UNKNOWN' then
        perform pos.admin_apply_user_screen_permissions_checked(
          v_target, 'h56verify', '{"h56.missing":"allow"}',
          pos.user_screen_permissions_version(v_target), array['h56.missing']
        );
      elsif v_name = 'SCREEN_KEY_INACTIVE' then
        perform pos.admin_apply_user_screen_permissions_checked(
          v_target, 'h56verify', '{"h56.phase4.inactive":"allow"}',
          pos.user_screen_permissions_version(v_target),
          array['h56.phase4.inactive']
        );
      elsif v_name = 'SCREEN_KEYS_DUPLICATED' then
        perform pos.admin_user_permission_snapshot(
          v_target, array['h56.phase4.leaf', 'h56.phase4.leaf']
        );
      elsif v_name = 'SCREEN_KEY_NOT_LEAF' then
        perform pos.admin_apply_user_screen_permissions_checked(
          v_target, 'h56verify', '{"h56.phase4":"allow"}',
          pos.user_screen_permissions_version(v_target),
          array['h56.phase4']
        );
      elsif v_name = 'SCREEN_KEY_FORMAT_INVALID' then
        perform pos.admin_sync_screen_permission_catalog(
          '[{"screen_key":"INVALID KEY","is_leaf":true}]'::jsonb,
          (select catalog_version
           from pos.screen_permission_catalog_state where singleton)
        );
      else
        perform pos.admin_apply_user_screen_permissions_checked(
          v_target, 'h56verify', '{"h56.phase4.leaf":"maybe"}',
          pos.user_screen_permissions_version(v_target),
          array['h56.phase4.leaf']
        );
      end if;
    exception when sqlstate '22023' then v_rejected := true;
    end;
    if not v_rejected then
      raise exception 'H56_CATALOG_VALIDATION_FAILED: %', v_name;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', v_unknown::text, true);
  v_rejected := false;
  begin
    perform pos.admin_permission_users(null, 10, 0);
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_PERMISSION_UNAUTHORIZED_FAILED';
  end if;

  -- Prueba la misma aserción usada por los triggers, limitada a fixtures.
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  foreach v_case in array array[
    'profile_role', 'base_role', 'assignment_active', 'role_active',
    'role_permission', 'override_deny', 'profile_active', 'profile_delete',
    'catalog_key'
  ] loop
    v_rejected := false;
    begin
      if v_case = 'profile_role' then
        update pos.sellers set role = 'vendedor'
        where id = 'h56-phase4-target';
      elsif v_case = 'base_role' then
        update pos.user_permission_role_assignments
        set role_code = 'vendedor' where user_id = v_target;
      elsif v_case = 'assignment_active' then
        update pos.user_permission_role_assignments
        set active = false where user_id = v_target;
      elsif v_case = 'role_active' then
        update pos.permission_roles set active = false
        where code = 'h56verify';
      elsif v_case = 'role_permission' then
        update pos.role_screen_permissions set allowed = false
        where role_code = 'h56verify'
          and screen_key = 'config.permisos';
      elsif v_case = 'override_deny' then
        insert into pos.user_screen_permission_overrides (
          user_id, screen_key, effect
        ) values (v_target, 'config.permisos', 'deny')
        on conflict (user_id, screen_key) do update set effect = 'deny';
      elsif v_case = 'profile_active' then
        update pos.sellers
        set active = false, sync_base_version = sync_version
        where id = 'h56-phase4-target';
      elsif v_case = 'profile_delete' then
        delete from pos.sellers where id = 'h56-phase4-target';
      else
        update pos.screen_permission_catalog set active = false
        where screen_key = 'config.permisos';
      end if;
      perform pos.assert_permission_admin_survives_scope(array[v_target]);
    exception when sqlstate '42501' then v_rejected := true;
    end;
    if not v_rejected then
      raise exception 'H56_LAST_PERMISSION_ADMIN_FAILED: %', v_case;
    end if;
  end loop;

  update pos.sellers
  set active = true, sync_base_version = sync_version
  where id = 'h56-phase4-inactive';
  update pos.sellers
  set active = false, sync_base_version = sync_version
  where id = 'h56-phase4-target';
  perform pos.assert_permission_admin_survives_scope(
    array[v_target, v_inactive]
  );
  update pos.sellers
  set active = true, sync_base_version = sync_version
  where id = 'h56-phase4-target';
  update pos.sellers
  set active = false, sync_base_version = sync_version
  where id = 'h56-phase4-inactive';

  select count(*) into v_count
  from pg_trigger t
  where t.tgname like 'permission_admin_survives_%'
    and t.tgdeferrable and t.tginitdeferred;
  if v_count <> 6 then
    raise exception 'H56_PERMISSION_TRIGGER_DEFERRAL_FAILED';
  end if;

  if has_table_privilege('authenticated', 'auth.users', 'select')
     or has_table_privilege(
       'authenticated', 'pos.screen_permission_catalog', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.screen_permission_catalog_state', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.user_permission_role_assignments', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.permission_roles', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.role_screen_permissions', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.user_screen_permission_overrides', 'select'
     )
     or has_table_privilege(
       'authenticated', 'pos.permission_change_audit', 'select'
     ) then
    raise exception 'H56_PERMISSION_DIRECT_READ_FAILED';
  end if;

  foreach v_name in array array[
    'pos.admin_sync_screen_permission_catalog(jsonb,bigint)',
    'pos.admin_permission_users(text,integer,integer)',
    'pos.admin_user_permission_snapshot(uuid,text[])',
    'pos.admin_apply_user_screen_permissions_checked(uuid,text,jsonb,text,text[])'
  ] loop
    v_oid := v_name::regprocedure;
    if not (select prosecdef from pg_proc where oid = v_oid)
       or (select array_to_string(proconfig, ',') from pg_proc where oid = v_oid)
          not like '%search_path=pos, auth, pg_temp%'
       or has_function_privilege('public', v_oid, 'execute')
       or has_function_privilege('anon', v_oid, 'execute')
       or not has_function_privilege('authenticated', v_oid, 'execute')
       or has_function_privilege('service_role', v_oid, 'execute')
       or pg_get_userbyid((select proowner from pg_proc where oid = v_oid))
          <> 'postgres' then
      raise exception 'H56_PERMISSION_ADMIN_API_ACL_FAILED: %', v_name;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  v_rejected := false;
  begin
    execute 'set local role anon';
    perform pos.admin_permission_users(null, 10, 0);
    execute format('set local role %I', v_role);
  exception when insufficient_privilege then
    execute format('set local role %I', v_role);
    v_rejected := true;
  end;
  execute format('set local role %I', v_role);
  if not v_rejected then raise exception 'H56_PERMISSION_ADMIN_ANON_FAILED'; end if;

  -- Limpieza completa de fixtures antes del commit.
  delete from pos.permission_change_audit
  where target_user_id in (v_target, v_inactive);
  delete from pos.user_screen_permission_overrides
  where user_id in (v_target, v_inactive);
  delete from pos.user_permission_role_assignments
  where user_id in (v_target, v_inactive);
  delete from pos.role_screen_permissions where role_code = 'h56verify';
  delete from pos.permission_roles where code = 'h56verify';
  delete from pos.screen_permission_catalog
  where screen_key like 'h56.phase4%';
  if v_catalog_backup is not null then
    update pos.screen_permission_catalog c
    set parent_key = b.parent_key,
        is_leaf = b.is_leaf,
        active = b.active,
        catalog_version = b.catalog_version,
        created_at = b.created_at,
        updated_at = b.updated_at
    from jsonb_to_recordset(v_catalog_backup) as b(
      screen_key text,
      parent_key text,
      is_leaf boolean,
      active boolean,
      catalog_version bigint,
      created_at timestamptz,
      updated_at timestamptz
    )
    where c.screen_key = b.screen_key;
  end if;
  update pos.screen_permission_catalog_state
  set catalog_version = v_catalog_version,
      updated_at = v_catalog_updated_at,
      updated_by = v_catalog_updated_by
  where singleton;
  if (select jsonb_agg(to_jsonb(c) order by c.screen_key)
      from pos.screen_permission_catalog c) is distinct from v_catalog_backup
     or (select catalog_version from pos.screen_permission_catalog_state
         where singleton) <> v_catalog_version then
    raise exception 'H56_CATALOG_RESTORE_FAILED';
  end if;
  delete from pos.sellers
  where id in ('h56-phase4-target', 'h56-phase4-inactive');
  delete from auth.users where id in (v_target, v_inactive);
  if exists (
    select 1 from auth.users where id in (v_target, v_inactive)
  ) or exists (
    select 1 from pos.sellers
    where id in ('h56-phase4-target', 'h56-phase4-inactive')
  ) or exists (
    select 1 from pos.permission_roles where code = 'h56verify'
  ) or exists (
    select 1 from pos.permission_change_audit
    where target_user_id in (v_target, v_inactive)
  ) then
    raise exception 'H56_SYNTHETIC_FIXTURE_CLEANUP_FAILED';
  end if;

  raise notice
    'H56_PERMISSION_ADMIN_API list=ok search=ok snapshot=ok tokens=ok conflict=ok audit=ok fixtures_clean=ok';
end;
$$;

commit;
