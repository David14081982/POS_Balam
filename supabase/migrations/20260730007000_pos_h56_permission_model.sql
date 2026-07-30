-- POS Balam — H-56 Fase 2: permisos de pantalla por identidad Auth.
-- Modelo aditivo. No conecta todavía AUTH.canAccess() ni cambia el dominio.

begin;

create table if not exists pos.permission_roles (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint permission_roles_code_format
    check (code ~ '^[a-z][a-z0-9_-]{1,63}$')
);

create table if not exists pos.user_permission_role_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null references pos.permission_roles(code) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists pos.role_screen_permissions (
  role_code text not null references pos.permission_roles(code) on delete cascade,
  screen_key text not null,
  allowed boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (role_code, screen_key),
  constraint role_screen_permissions_key_format
    check (screen_key ~ '^[a-z][a-z0-9_.-]{1,127}$')
);

create table if not exists pos.user_screen_permission_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  screen_key text not null,
  effect text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, screen_key),
  constraint user_screen_permission_effect
    check (effect in ('allow', 'deny')),
  constraint user_screen_permission_key_format
    check (screen_key ~ '^[a-z][a-z0-9_.-]{1,127}$')
);

create table if not exists pos.permission_change_audit (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  actor_user_id uuid,
  target_user_id uuid,
  role_code text,
  screen_key text,
  change_kind text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  constraint permission_change_audit_kind
    check (change_kind in ('user_role', 'user_override', 'role_permission'))
);

create index if not exists role_screen_permissions_screen_idx
  on pos.role_screen_permissions (screen_key, role_code);
create index if not exists user_screen_permission_overrides_screen_idx
  on pos.user_screen_permission_overrides (screen_key, user_id);
create index if not exists permission_change_audit_actor_time_idx
  on pos.permission_change_audit (actor_user_id, changed_at desc);
create index if not exists permission_change_audit_target_time_idx
  on pos.permission_change_audit (target_user_id, changed_at desc);
create index if not exists permission_change_audit_batch_idx
  on pos.permission_change_audit (batch_id);

insert into pos.permission_roles (code, name, active)
values
  ('admin', 'Administrador', true),
  ('vendedor', 'Vendedor', true)
on conflict (code) do update set
  name = excluded.name,
  active = true;

with screen_keys(screen_key) as (
  values
    ('dashboard'), ('pos'), ('inventario'), ('clientes'), ('apartados'),
    ('prestamos'), ('devoluciones'), ('descuentos'), ('vendedores'),
    ('reportes'), ('config.negocio'), ('config.producto'), ('config.ventas'),
    ('config.beneficios'), ('config.devoluciones'), ('config.vendedores'),
    ('config.clientes'), ('config.inventario'), ('config.impresion'),
    ('config.usuarios'), ('config.permisos'), ('config.demo')
)
insert into pos.role_screen_permissions (role_code, screen_key, allowed)
select r.code, k.screen_key,
       case when r.code = 'admin' then true else k.screen_key = 'pos' end
from pos.permission_roles r
cross join screen_keys k
where r.code in ('admin', 'vendedor')
on conflict (role_code, screen_key) do nothing;

-- Sólo las cuentas Auth reciben rol base. El correo enlaza con el perfil
-- vigente, pero la identidad persistida de permisos siempre es auth.users.id.
insert into pos.user_permission_role_assignments (user_id, role_code)
select u.id, s.role
from auth.users u
join pos.sellers s on lower(s.email) = lower(u.email)
join pos.permission_roles r on r.code = s.role and r.active
where s.deleted_at is null
on conflict (user_id) do nothing;

create or replace function pos.resolve_screen_permission_precedence(
  p_profile_active boolean,
  p_override_effect text,
  p_role_code text,
  p_role_allowed boolean,
  p_role_configured boolean
)
returns table (
  allowed boolean,
  source text,
  role_code text,
  effect text
)
language sql
immutable
security invoker
set search_path = pos, pg_temp
as $$
  select
    case
      when not coalesce(p_profile_active, false) then false
      when p_override_effect = 'allow' then true
      when p_override_effect = 'deny' then false
      when coalesce(p_role_configured, false) then coalesce(p_role_allowed, false)
      else false
    end,
    case
      when not coalesce(p_profile_active, false) then 'default'
      when p_override_effect in ('allow', 'deny') then 'override'
      when coalesce(p_role_configured, false) then 'role'
      else 'default'
    end,
    p_role_code,
    case
      when coalesce(p_profile_active, false)
       and p_override_effect in ('allow', 'deny')
      then p_override_effect
      else null
    end;
$$;

create or replace function pos.resolve_screen_permission(
  p_user_id uuid,
  p_screen_key text
)
returns table (
  allowed boolean,
  source text,
  role_code text,
  effect text
)
language plpgsql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_email text;
  v_role text;
  v_effect text;
  v_allowed boolean;
  v_profile_active boolean := false;
  v_role_configured boolean := false;
begin
  if p_user_id is null or nullif(trim(p_screen_key), '') is null then
    return query
      select *
      from pos.resolve_screen_permission_precedence(
        false, null, null, null, false
      );
    return;
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = p_user_id;

  v_profile_active := v_email is not null and exists (
    select 1
    from pos.sellers s
    where lower(s.email) = lower(v_email)
      and s.active is true
      and s.deleted_at is null
  );

  if v_profile_active then
    select o.effect into v_effect
    from pos.user_screen_permission_overrides o
    where o.user_id = p_user_id
      and o.screen_key = p_screen_key;

    select a.role_code into v_role
    from pos.user_permission_role_assignments a
    join pos.permission_roles r on r.code = a.role_code and r.active
    where a.user_id = p_user_id;

    if v_role is not null then
      select p.allowed into v_allowed
      from pos.role_screen_permissions p
      where p.role_code = v_role
        and p.screen_key = p_screen_key;
      v_role_configured := found;
    end if;
  end if;

  return query
    select *
    from pos.resolve_screen_permission_precedence(
      v_profile_active, v_effect, v_role, v_allowed, v_role_configured
    );
end;
$$;

create or replace function pos.current_screen_permission(p_screen_key text)
returns table (
  screen_key text,
  allowed boolean,
  source text,
  role_code text,
  effect text
)
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  select p_screen_key, r.allowed, r.source, r.role_code, r.effect
  from pos.resolve_screen_permission(auth.uid(), p_screen_key) r;
$$;

create or replace function pos.current_screen_permissions(p_screen_keys text[])
returns table (
  screen_key text,
  allowed boolean,
  source text,
  role_code text,
  effect text
)
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  select k.screen_key, r.allowed, r.source, r.role_code, r.effect
  from unnest(coalesce(p_screen_keys, array[]::text[]))
       with ordinality as k(screen_key, sort_order)
  cross join lateral pos.resolve_screen_permission(auth.uid(), k.screen_key) r
  order by k.sort_order;
$$;

create or replace function pos.can_manage_screen_permissions(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    join pos.sellers s on lower(s.email) = lower(u.email)
    where u.id = p_user_id
      and s.role = 'admin'
      and s.active is true
      and s.deleted_at is null
  )
  and coalesce((
    select r.allowed
    from pos.resolve_screen_permission(p_user_id, 'config.usuarios') r
  ), false)
  and coalesce((
    select r.allowed
    from pos.resolve_screen_permission(p_user_id, 'config.permisos') r
  ), false);
$$;

create or replace function pos.admin_screen_permission(
  p_user_id uuid,
  p_screen_key text
)
returns table (
  screen_key text,
  allowed boolean,
  source text,
  role_code text,
  effect text
)
language plpgsql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'No autorizado para consultar permisos'
      using errcode = '42501';
  end if;
  return query
    select p_screen_key, r.allowed, r.source, r.role_code, r.effect
    from pos.resolve_screen_permission(p_user_id, p_screen_key) r;
end;
$$;

create or replace function pos.assert_permission_admin_survives()
returns void
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  if not exists (
    select 1
    from auth.users u
    where pos.can_manage_screen_permissions(u.id)
  ) then
    raise exception 'Debe existir al menos un administrador activo con acceso a usuarios y permisos'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function pos.admin_apply_user_screen_permissions(
  p_target_user_id uuid,
  p_role_code text,
  p_overrides jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch uuid := extensions.gen_random_uuid();
  v_old_role text;
  v_key text;
  v_value jsonb;
  v_effect text;
  v_old_effect text;
begin
  if not pos.can_manage_screen_permissions(v_actor) then
    raise exception 'No autorizado para modificar permisos'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'La identidad Auth objetivo no existe'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '{}'::jsonb)) <> 'object' then
    raise exception 'Los overrides deben ser un objeto JSON'
      using errcode = '22023';
  end if;

  select a.role_code into v_old_role
  from pos.user_permission_role_assignments a
  where a.user_id = p_target_user_id;

  if p_role_code is null then
    delete from pos.user_permission_role_assignments
    where user_id = p_target_user_id;
  else
    if not exists (
      select 1 from pos.permission_roles r
      where r.code = p_role_code and r.active
    ) then
      raise exception 'Rol base inexistente o inactivo: %', p_role_code
        using errcode = '22023';
    end if;
    insert into pos.user_permission_role_assignments (
      user_id, role_code, updated_at, updated_by
    ) values (
      p_target_user_id, p_role_code, now(), v_actor
    )
    on conflict (user_id) do update set
      role_code = excluded.role_code,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end if;

  if v_old_role is distinct from p_role_code then
    insert into pos.permission_change_audit (
      batch_id, actor_user_id, target_user_id, change_kind,
      old_value, new_value
    ) values (
      v_batch, v_actor, p_target_user_id, 'user_role',
      to_jsonb(v_old_role), to_jsonb(p_role_code)
    );
  end if;

  for v_key, v_value in
    select e.key, e.value from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
  loop
    if nullif(trim(v_key), '') is null then
      raise exception 'La clave de pantalla no puede estar vacía'
        using errcode = '22023';
    end if;

    select o.effect into v_old_effect
    from pos.user_screen_permission_overrides o
    where o.user_id = p_target_user_id and o.screen_key = v_key;

    if jsonb_typeof(v_value) = 'null' then
      v_effect := null;
      delete from pos.user_screen_permission_overrides
      where user_id = p_target_user_id and screen_key = v_key;
    else
      v_effect := trim(both '"' from v_value::text);
      if v_effect not in ('allow', 'deny') then
        raise exception 'Override inválido para %: %', v_key, v_effect
          using errcode = '22023';
      end if;
      insert into pos.user_screen_permission_overrides (
        user_id, screen_key, effect, updated_at, updated_by
      ) values (
        p_target_user_id, v_key, v_effect, now(), v_actor
      )
      on conflict (user_id, screen_key) do update set
        effect = excluded.effect,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
    end if;

    if v_old_effect is distinct from v_effect then
      insert into pos.permission_change_audit (
        batch_id, actor_user_id, target_user_id, screen_key,
        change_kind, old_value, new_value
      ) values (
        v_batch, v_actor, p_target_user_id, v_key,
        'user_override', to_jsonb(v_old_effect), to_jsonb(v_effect)
      );
    end if;
  end loop;

  perform pos.assert_permission_admin_survives();
  return v_batch;
end;
$$;

create or replace function pos.admin_apply_role_screen_permissions(
  p_target_role_code text,
  p_permissions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch uuid := extensions.gen_random_uuid();
  v_key text;
  v_value jsonb;
  v_allowed boolean;
  v_old_allowed boolean;
begin
  if not pos.can_manage_screen_permissions(v_actor) then
    raise exception 'No autorizado para modificar permisos'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from pos.permission_roles r
    where r.code = p_target_role_code and r.active
  ) then
    raise exception 'Rol base inexistente o inactivo: %', p_target_role_code
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_permissions, '{}'::jsonb)) <> 'object' then
    raise exception 'Los permisos deben ser un objeto JSON'
      using errcode = '22023';
  end if;

  for v_key, v_value in
    select e.key, e.value from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) e
  loop
    select p.allowed into v_old_allowed
    from pos.role_screen_permissions p
    where p.role_code = p_target_role_code and p.screen_key = v_key;

    if jsonb_typeof(v_value) = 'null' then
      v_allowed := null;
      delete from pos.role_screen_permissions
      where role_code = p_target_role_code and screen_key = v_key;
    elsif jsonb_typeof(v_value) = 'boolean' then
      v_allowed := v_value::text::boolean;
      insert into pos.role_screen_permissions (
        role_code, screen_key, allowed, updated_at, updated_by
      ) values (
        p_target_role_code, v_key, v_allowed, now(), v_actor
      )
      on conflict (role_code, screen_key) do update set
        allowed = excluded.allowed,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
    else
      raise exception 'Permiso de rol inválido para %', v_key
        using errcode = '22023';
    end if;

    if v_old_allowed is distinct from v_allowed then
      insert into pos.permission_change_audit (
        batch_id, actor_user_id, role_code, screen_key,
        change_kind, old_value, new_value
      ) values (
        v_batch, v_actor, p_target_role_code, v_key,
        'role_permission', to_jsonb(v_old_allowed), to_jsonb(v_allowed)
      );
    end if;
  end loop;

  perform pos.assert_permission_admin_survives();
  return v_batch;
end;
$$;

alter table pos.permission_roles enable row level security;
alter table pos.user_permission_role_assignments enable row level security;
alter table pos.role_screen_permissions enable row level security;
alter table pos.user_screen_permission_overrides enable row level security;
alter table pos.permission_change_audit enable row level security;

drop policy if exists permission_admin_select on pos.permission_roles;
create policy permission_admin_select on pos.permission_roles
  for select to authenticated
  using (pos.can_manage_screen_permissions(auth.uid()));
drop policy if exists permission_admin_select on pos.user_permission_role_assignments;
create policy permission_admin_select on pos.user_permission_role_assignments
  for select to authenticated
  using (pos.can_manage_screen_permissions(auth.uid()));
drop policy if exists permission_admin_select on pos.role_screen_permissions;
create policy permission_admin_select on pos.role_screen_permissions
  for select to authenticated
  using (pos.can_manage_screen_permissions(auth.uid()));
drop policy if exists permission_admin_select on pos.user_screen_permission_overrides;
create policy permission_admin_select on pos.user_screen_permission_overrides
  for select to authenticated
  using (pos.can_manage_screen_permissions(auth.uid()));
drop policy if exists permission_admin_select on pos.permission_change_audit;
create policy permission_admin_select on pos.permission_change_audit
  for select to authenticated
  using (pos.can_manage_screen_permissions(auth.uid()));

revoke all on pos.permission_roles from public, anon, authenticated;
revoke all on pos.user_permission_role_assignments from public, anon, authenticated;
revoke all on pos.role_screen_permissions from public, anon, authenticated;
revoke all on pos.user_screen_permission_overrides from public, anon, authenticated;
revoke all on pos.permission_change_audit from public, anon, authenticated;
grant select on pos.permission_roles to authenticated;
grant select on pos.user_permission_role_assignments to authenticated;
grant select on pos.role_screen_permissions to authenticated;
grant select on pos.user_screen_permission_overrides to authenticated;
grant select on pos.permission_change_audit to authenticated;
grant all on pos.permission_roles to service_role;
grant all on pos.user_permission_role_assignments to service_role;
grant all on pos.role_screen_permissions to service_role;
grant all on pos.user_screen_permission_overrides to service_role;
grant all on pos.permission_change_audit to service_role;
grant usage, select on sequence pos.permission_change_audit_id_seq to service_role;

revoke all on function pos.resolve_screen_permission(uuid, text) from public, anon, authenticated;
revoke all on function pos.resolve_screen_permission_precedence(boolean, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function pos.assert_permission_admin_survives() from public, anon, authenticated;
grant execute on function pos.resolve_screen_permission(uuid, text) to service_role;
grant execute on function pos.resolve_screen_permission_precedence(boolean, text, text, boolean, boolean) to service_role;
grant execute on function pos.assert_permission_admin_survives() to service_role;

revoke all on function pos.current_screen_permission(text) from public, anon;
revoke all on function pos.current_screen_permissions(text[]) from public, anon;
revoke all on function pos.can_manage_screen_permissions(uuid) from public, anon;
revoke all on function pos.admin_screen_permission(uuid, text) from public, anon;
revoke all on function pos.admin_apply_user_screen_permissions(uuid, text, jsonb) from public, anon;
revoke all on function pos.admin_apply_role_screen_permissions(text, jsonb) from public, anon;
grant execute on function pos.current_screen_permission(text) to authenticated;
grant execute on function pos.current_screen_permissions(text[]) to authenticated;
grant execute on function pos.can_manage_screen_permissions(uuid) to authenticated;
grant execute on function pos.admin_screen_permission(uuid, text) to authenticated;
grant execute on function pos.admin_apply_user_screen_permissions(uuid, text, jsonb) to authenticated;
grant execute on function pos.admin_apply_role_screen_permissions(text, jsonb) to authenticated;

comment on function pos.resolve_screen_permission(uuid, text) is
  'H-56: override individual -> rol base -> denegación por defecto.';
comment on table pos.permission_change_audit is
  'Auditoría inmutable de cambios de permisos; IDs se conservan como snapshots.';

commit;
