-- H-56 Fase 5: verificación remota del modelo de capacidades.

begin;

do $$
declare
  v_user constant uuid := '00000000-0000-0000-0000-000000005651';
  v_allowed boolean;
  v_source text;
  v_role text;
  v_effect text;
begin
  if exists (select 1 from auth.users where id = v_user) then
    raise exception 'H56_CAPABILITY_FIXTURE_COLLISION';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user,
    'authenticated', 'authenticated', 'h56.capability@invalid.local',
    '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
  insert into pos.sellers(id, nombre, email, role, active)
  values ('h56-capability', 'Fixture Capacidad', 'h56.capability@invalid.local',
          'vendedor', true);
  insert into pos.user_permission_role_assignments(user_id, role_code, active)
  values (v_user, 'vendedor', true);

  select * into v_allowed, v_source, v_role, v_effect
  from pos.resolve_operational_capability(v_user, 'sales.create');
  if not v_allowed or v_source <> 'role' or v_role <> 'vendedor' then
    raise exception 'H56_CAPABILITY_MATRIX_FAILED';
  end if;

  select allowed into v_allowed
  from pos.resolve_operational_capability(v_user, 'settings.manage');
  if v_allowed then raise exception 'H56_CAPABILITY_DEFAULT_DENY_FAILED'; end if;

  insert into pos.user_capability_overrides(user_id, capability_key, effect)
  values (v_user, 'sales.create', 'deny');
  select allowed, source, effect into v_allowed, v_source, v_effect
  from pos.resolve_operational_capability(v_user, 'sales.create');
  if v_allowed or v_source <> 'override' or v_effect <> 'deny' then
    raise exception 'H56_CAPABILITY_OVERRIDE_FAILED';
  end if;

  if has_function_privilege('public', 'pos.current_has_capability(text)', 'execute')
     or has_function_privilege('anon', 'pos.current_has_capability(text)', 'execute')
     or not has_function_privilege('authenticated', 'pos.current_has_capability(text)', 'execute')
     or has_table_privilege('authenticated', 'pos.operational_capabilities', 'select')
     or has_table_privilege('authenticated', 'pos.user_capability_overrides', 'select') then
    raise exception 'H56_CAPABILITY_ANON_FAILED';
  end if;

  delete from pos.user_capability_overrides where user_id = v_user;
  delete from pos.user_permission_role_assignments where user_id = v_user;
  delete from pos.sellers where id = 'h56-capability';
  delete from auth.users where id = v_user;

  if exists (select 1 from auth.users where id = v_user)
     or exists (select 1 from pos.sellers where id = 'h56-capability') then
    raise exception 'H56_CAPABILITY_FIXTURE_CLEANUP_FAILED';
  end if;
  raise notice 'H56_CAPABILITIES matrix=ok override=ok acl=ok fixtures_clean=ok';
end;
$$;

commit;
