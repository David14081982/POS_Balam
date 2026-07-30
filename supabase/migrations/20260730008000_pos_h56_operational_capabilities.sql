-- H-56 Fase 5: capacidades operativas separadas de la visibilidad.

begin;

create table if not exists pos.operational_capabilities (
  capability_key text primary key,
  description text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint operational_capabilities_key_format
    check (capability_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

create table if not exists pos.role_capability_permissions (
  role_code text not null references pos.permission_roles(code) on delete cascade,
  capability_key text not null references pos.operational_capabilities(capability_key) on delete cascade,
  allowed boolean not null,
  updated_at timestamptz not null default now(),
  primary key (role_code, capability_key)
);

create table if not exists pos.user_capability_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability_key text not null references pos.operational_capabilities(capability_key) on delete cascade,
  effect text not null check (effect in ('allow', 'deny')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, capability_key)
);

create table if not exists pos.capability_operation_audit (
  operation_id uuid primary key,
  capability_key text not null references pos.operational_capabilities(capability_key),
  actor_user_id uuid not null references auth.users(id),
  subject_key text,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists role_capability_permissions_key_idx
  on pos.role_capability_permissions(capability_key, role_code);
create index if not exists user_capability_overrides_user_idx
  on pos.user_capability_overrides(user_id, capability_key);
create index if not exists capability_operation_audit_actor_idx
  on pos.capability_operation_audit(actor_user_id, created_at desc);

insert into pos.operational_capabilities(capability_key, description)
values
  ('sales.create', 'Crear y confirmar ventas'),
  ('sales.collect', 'Registrar cobros y abonos'),
  ('sales.cancel', 'Cancelar ventas o apartados'),
  ('sales.refund', 'Registrar devoluciones y reembolsos'),
  ('sales.exchange', 'Registrar cambios de mercancía'),
  ('inventory.adjust', 'Ajustar existencias'),
  ('inventory.delete', 'Eliminar productos'),
  ('inventory.loan', 'Administrar préstamos de mercancía'),
  ('customers.create', 'Crear clientes'),
  ('customers.update', 'Actualizar clientes'),
  ('customers.delete', 'Eliminar clientes'),
  ('promotions.manage', 'Administrar promociones'),
  ('sellers.manage', 'Administrar vendedores y usuarios'),
  ('commissions.settle', 'Liquidar comisión individual'),
  ('commissions.close_period', 'Cerrar periodo de comisiones'),
  ('settings.manage', 'Administrar configuración'),
  ('permissions.manage', 'Administrar permisos')
on conflict (capability_key) do update
set description = excluded.description, active = true, updated_at = now();

insert into pos.role_capability_permissions(role_code, capability_key, allowed)
select r.code, c.capability_key, true
from pos.permission_roles r
cross join pos.operational_capabilities c
where r.code = 'admin'
on conflict (role_code, capability_key) do nothing;

insert into pos.role_capability_permissions(role_code, capability_key, allowed)
select 'vendedor', capability_key, true
from unnest(array[
  'sales.create', 'sales.collect', 'sales.refund', 'sales.exchange',
  'customers.create', 'customers.update'
]) capability_key
where exists (select 1 from pos.permission_roles r where r.code = 'vendedor')
on conflict (role_code, capability_key) do nothing;

create or replace function pos.resolve_operational_capability(
  p_user_id uuid,
  p_capability_key text
)
returns table (
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
  with identity_state as (
    select
      u.id,
      a.role_code,
      coalesce(s.active and s.deleted_at is null, false) as profile_active,
      coalesce(a.active, false) as assignment_active,
      coalesce(r.active, false) as role_active
    from auth.users u
    left join lateral (
      select p.active, p.deleted_at
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
    left join pos.user_permission_role_assignments a on a.user_id = u.id
    left join pos.permission_roles r on r.code = a.role_code
    where u.id = p_user_id
  ),
  capability as (
    select c.capability_key
    from pos.operational_capabilities c
    where c.capability_key = p_capability_key and c.active
  ),
  resolution as (
    select
      i.role_code,
      o.effect,
      rp.allowed as role_allowed,
      o.effect is not null as has_override,
      rp.capability_key is not null as has_role_permission
    from identity_state i
    cross join capability c
    left join pos.user_capability_overrides o
      on o.user_id = p_user_id and o.capability_key = c.capability_key
    left join pos.role_capability_permissions rp
      on rp.role_code = i.role_code
     and rp.capability_key = c.capability_key
    where i.profile_active and i.assignment_active and i.role_active
  )
  select
    case
      when x.has_override then x.effect = 'allow'
      when x.has_role_permission then x.role_allowed
      else false
    end,
    case
      when x.has_override then 'override'
      when x.has_role_permission then 'role'
      else 'default'
    end,
    x.role_code,
    x.effect
  from resolution x
  union all
  select false, 'default', null::text, null::text
  where not exists (select 1 from resolution);
$$;

create or replace function pos.current_has_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  select r.allowed
  from pos.resolve_operational_capability(auth.uid(), p_capability_key) r;
$$;

create or replace function pos.require_current_capability(p_capability_key text)
returns void
language plpgsql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  if not coalesce(pos.current_has_capability(p_capability_key), false) then
    raise exception 'CAPABILITY_REQUIRED:%', p_capability_key
      using errcode = '42501';
  end if;
end;
$$;

alter table pos.operational_capabilities enable row level security;
alter table pos.role_capability_permissions enable row level security;
alter table pos.user_capability_overrides enable row level security;
alter table pos.capability_operation_audit enable row level security;

revoke all on pos.operational_capabilities from public, anon, authenticated;
revoke all on pos.role_capability_permissions from public, anon, authenticated;
revoke all on pos.user_capability_overrides from public, anon, authenticated;
revoke all on pos.capability_operation_audit from public, anon, authenticated;

revoke all on function pos.resolve_operational_capability(uuid, text)
  from public, anon, authenticated;
revoke all on function pos.current_has_capability(text) from public, anon;
revoke all on function pos.require_current_capability(text) from public, anon;
grant execute on function pos.current_has_capability(text) to authenticated;
grant execute on function pos.require_current_capability(text) to authenticated;

commit;
