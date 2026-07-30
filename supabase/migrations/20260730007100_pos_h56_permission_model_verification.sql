-- H-56 Fase 2 — verificación ejecutable sin escribir tablas preexistentes.
-- Casos: override_allow, override_deny, unknown_screen, inactive_user,
-- orphan_user y last_permission_admin.

begin;

do $$
declare
  v_admin uuid;
  v_common uuid := '00000000-0000-0000-0000-0000000056b1';
  v_allowed boolean;
  v_source text;
  v_effect text;
  v_old_role text;
  v_rejected boolean;
  v_batch uuid;
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
    raise exception 'H56_ACTIVE_ADMIN_REQUIRED_FOR_VERIFICATION';
  end if;

  -- La función pura prueba la precedencia sin fabricar identidades ni perfiles.
  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission_precedence(
    true, null, 'vendedor', true, true
  ) r;
  if v_allowed is distinct from true or v_source <> 'role' then
    raise exception 'H56_INHERITED_ALLOW_FAILED';
  end if;

  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission_precedence(
    true, null, 'vendedor', false, true
  ) r;
  if v_allowed is distinct from false or v_source <> 'role' then
    raise exception 'H56_INHERITED_DENY_FAILED';
  end if;

  -- override_allow sobre rol denegado.
  select r.allowed, r.source, r.effect into v_allowed, v_source, v_effect
  from pos.resolve_screen_permission_precedence(
    true, 'allow', 'vendedor', false, true
  ) r;
  if v_allowed is distinct from true or v_source <> 'override'
     or v_effect <> 'allow' then
    raise exception 'H56_OVERRIDE_ALLOW_FAILED';
  end if;

  -- override_deny sobre rol permitido.
  select r.allowed, r.source, r.effect into v_allowed, v_source, v_effect
  from pos.resolve_screen_permission_precedence(
    true, 'deny', 'vendedor', true, true
  ) r;
  if v_allowed is distinct from false or v_source <> 'override'
     or v_effect <> 'deny' then
    raise exception 'H56_OVERRIDE_DENY_FAILED';
  end if;

  -- Sin rol, inactive_user y ausencia de configuración son default-deny.
  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission_precedence(
    true, null, null, null, false
  ) r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_NO_ROLE_FAILED';
  end if;

  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission_precedence(
    false, 'allow', 'admin', true, true
  ) r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_INACTIVE_USER_FAILED';
  end if;

  -- orphan_user, unknown_screen y pantalla nueva sin configurar.
  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission(v_common, 'dashboard') r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_ORPHAN_USER_FAILED';
  end if;

  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission(v_admin, 'unknown_screen') r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_UNKNOWN_SCREEN_FAILED';
  end if;

  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission(v_admin, 'h56.new_screen') r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_NEW_SCREEN_DEFAULT_FAILED';
  end if;

  -- Ningún authenticated tiene escritura directa.
  if has_table_privilege('authenticated', 'pos.permission_roles', 'insert')
     or has_table_privilege('authenticated', 'pos.role_screen_permissions', 'update')
     or has_table_privilege('authenticated', 'pos.user_screen_permission_overrides', 'delete') then
    raise exception 'H56_DIRECT_WRITE_PRIVILEGE_FAILED';
  end if;

  -- Un JWT sin perfil no puede usar RPC administrativas.
  perform set_config('request.jwt.claim.sub', v_common::text, true);
  v_rejected := false;
  begin
    perform pos.admin_apply_user_screen_permissions(
      v_admin, 'admin', '{"h56.verify.common":"allow"}'::jsonb
    );
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_COMMON_USER_MUTATION_FAILED';
  end if;

  -- El admin existente debe heredar las dos llaves protegidas.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if not pos.can_manage_screen_permissions(v_admin) then
    raise exception 'H56_ADMIN_BOOTSTRAP_FAILED';
  end if;

  -- Mutación administrativa y auditoría sólo sobre tablas nuevas.
  v_batch := pos.admin_apply_user_screen_permissions(
    v_admin, 'admin', '{"h56.verify.admin":"allow"}'::jsonb
  );
  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission(v_admin, 'h56.verify.admin') r;
  if v_allowed is distinct from true or v_source <> 'override' then
    raise exception 'H56_ADMIN_MUTATION_FAILED';
  end if;
  if not exists (
    select 1 from pos.permission_change_audit a
    where a.batch_id = v_batch
      and a.actor_user_id = v_admin
      and a.target_user_id = v_admin
  ) then
    raise exception 'H56_AUDIT_FAILED';
  end if;

  perform 1 from pos.admin_screen_permission(v_admin, 'dashboard');
  if (select count(*) from pos.current_screen_permissions(
       array['dashboard', 'h56.new_screen']
     )) <> 2 then
    raise exception 'H56_CURRENT_LIST_FAILED';
  end if;

  -- Usuario sin rol: se retira y restaura sólo la asignación NUEVA.
  select a.role_code into v_old_role
  from pos.user_permission_role_assignments a
  where a.user_id = v_admin;
  delete from pos.user_permission_role_assignments where user_id = v_admin;
  select r.allowed, r.source into v_allowed, v_source
  from pos.resolve_screen_permission(v_admin, 'dashboard') r;
  if v_allowed is distinct from false or v_source <> 'default' then
    raise exception 'H56_ACTUAL_NO_ROLE_FAILED';
  end if;
  insert into pos.user_permission_role_assignments (user_id, role_code)
  values (v_admin, v_old_role)
  on conflict (user_id) do update set role_code = excluded.role_code;

  -- last_permission_admin: el subbloque revierte todas sus escrituras nuevas.
  v_rejected := false;
  begin
    insert into pos.user_screen_permission_overrides (
      user_id, screen_key, effect
    )
    select u.id, k.screen_key, 'deny'
    from auth.users u
    cross join (values ('config.usuarios'), ('config.permisos')) k(screen_key)
    where u.id <> v_admin
      and pos.can_manage_screen_permissions(u.id)
    on conflict (user_id, screen_key) do update set effect = 'deny';

    perform pos.admin_apply_user_screen_permissions(
      v_admin, 'admin', '{"config.permisos":"deny"}'::jsonb
    );
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_LAST_PERMISSION_ADMIN_FAILED';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pos'
      and c.relname in (
        'permission_roles', 'user_permission_role_assignments',
        'role_screen_permissions', 'user_screen_permission_overrides',
        'permission_change_audit'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'H56_RLS_DISABLED';
  end if;
  if has_table_privilege('anon', 'pos.permission_roles', 'select')
     or has_function_privilege(
       'anon', 'pos.current_screen_permission(text)', 'execute'
     ) then
    raise exception 'H56_ANON_PRIVILEGE_FAILED';
  end if;

  -- Limpieza limitada al modelo nuevo.
  delete from pos.permission_change_audit where batch_id = v_batch;
  delete from pos.user_screen_permission_overrides
  where user_id = v_admin and screen_key = 'h56.verify.admin';
end;
$$;

commit;
