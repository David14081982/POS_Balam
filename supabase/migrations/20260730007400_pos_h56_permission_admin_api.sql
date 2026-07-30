-- POS Balam — H-56 Fase 4: API administrativa con concurrencia optimista.
-- Aditiva: sólo crea RPC; no cambia tablas ni objetos comerciales.

begin;

create table if not exists pos.screen_permission_catalog (
  screen_key text primary key,
  parent_key text,
  is_leaf boolean not null,
  active boolean not null default true,
  catalog_version bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screen_permission_catalog_key_format
    check (screen_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  constraint screen_permission_catalog_parent_format
    check (
      parent_key is null
      or parent_key ~ '^[a-z][a-z0-9_.-]{1,127}$'
    ),
  constraint screen_permission_catalog_not_self
    check (parent_key is distinct from screen_key),
  constraint screen_permission_catalog_parent_fk
    foreign key (parent_key)
    references pos.screen_permission_catalog(screen_key)
    deferrable initially deferred
);
create index if not exists screen_permission_catalog_parent_idx
  on pos.screen_permission_catalog (parent_key, active, is_leaf);

create table if not exists pos.screen_permission_catalog_state (
  singleton boolean primary key default true check (singleton),
  catalog_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table pos.screen_permission_catalog enable row level security;
alter table pos.screen_permission_catalog_state enable row level security;

insert into pos.screen_permission_catalog_state (singleton, catalog_version)
values (true, 1)
on conflict (singleton) do nothing;

insert into pos.screen_permission_catalog (
  screen_key, parent_key, is_leaf, active, catalog_version
)
select distinct p.screen_key, null, true, true, 1
from pos.role_screen_permissions p
on conflict (screen_key) do nothing;

alter table pos.user_permission_role_assignments
  add column if not exists active boolean not null default true;

-- Definición vigente de 007000, ampliada sólo con catálogo y asignación activa.
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
  if p_user_id is null or nullif(trim(p_screen_key), '') is null
     or not exists (
       select 1
       from pos.screen_permission_catalog c
       where c.screen_key = p_screen_key
         and c.active
         and c.is_leaf
     ) then
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
    where a.user_id = p_user_id
      and a.active;

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

create or replace function pos.user_screen_permissions_version(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  with identity_state as (
    select jsonb_build_object(
      'auth_exists', u.id is not null,
      'profile_active', coalesce(s.active and s.deleted_at is null, false),
      'profile_updated_at', s.updated_at
    ) as value
    from (select p_user_id as user_id) requested
    left join auth.users u on u.id = requested.user_id
    left join lateral (
      select p.active, p.deleted_at, p.updated_at
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
  ),
  assignment_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'role_code', a.role_code,
          'active', a.active,
          'updated_at', a.updated_at
        )
        order by a.role_code
      ),
      '[]'::jsonb
    ) as value
    from pos.user_permission_role_assignments a
    where a.user_id = p_user_id
  ),
  override_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', o.screen_key,
          'effect', o.effect,
          'updated_at', o.updated_at
        )
        order by o.screen_key
      ),
      '[]'::jsonb
    ) as value
    from pos.user_screen_permission_overrides o
    where o.user_id = p_user_id
  ),
  role_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', p.screen_key,
          'allowed', p.allowed,
          'updated_at', p.updated_at,
          'role_active', r.active,
          'role_updated_at', r.updated_at
        )
        order by p.screen_key
      ),
      '[]'::jsonb
    ) as value
    from pos.role_screen_permissions p
    join pos.permission_roles r on r.code = p.role_code
    where p.role_code = (
      select a.role_code
      from pos.user_permission_role_assignments a
      where a.user_id = p_user_id
    )
  ),
  catalog_state as (
    select jsonb_build_object(
      'catalog_version', s.catalog_version,
      'updated_at', s.updated_at
    ) as value
    from pos.screen_permission_catalog_state s
    where s.singleton
  )
  select md5(
    identity_state.value::text || '|' ||
    assignment_state.value::text || '|' ||
    override_state.value::text || '|' ||
    role_state.value::text || '|' ||
    catalog_state.value::text
  )
  from identity_state
  cross join assignment_state
  cross join override_state
  cross join role_state
  cross join catalog_state;
$$;

create or replace function pos.admin_sync_screen_permission_catalog(
  p_entries jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_current_version bigint;
  v_next_version bigint;
begin
  if not pos.can_manage_screen_permissions(v_actor) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'SCREEN_CATALOG_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_entries) e
    where nullif(e ->> 'screen_key', '') is null
       or e ->> 'screen_key' !~ '^[a-z][a-z0-9_.-]{1,127}$'
       or jsonb_typeof(e -> 'is_leaf') <> 'boolean'
  ) then
    raise exception 'SCREEN_CATALOG_ENTRY_INVALID' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct e ->> 'screen_key')
    from jsonb_array_elements(p_entries) e
  ) then
    raise exception 'SCREEN_KEYS_DUPLICATED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_entries) e
    where nullif(e ->> 'parent_key', '') is not null
      and not exists (
        select 1
        from jsonb_array_elements(p_entries) parent
        where parent ->> 'screen_key' = e ->> 'parent_key'
          and (parent ->> 'is_leaf')::boolean is false
      )
  ) then
    raise exception 'SCREEN_PARENT_UNKNOWN' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'pos.screen_permission_catalog', 56
  ));
  select s.catalog_version into v_current_version
  from pos.screen_permission_catalog_state s
  where s.singleton
  for update;
  if p_expected_version is distinct from v_current_version then
    raise exception 'SCREEN_CATALOG_VERSION_CONFLICT'
      using errcode = '40001';
  end if;
  v_next_version := v_current_version + 1;

  insert into pos.screen_permission_catalog (
    screen_key, parent_key, is_leaf, active, catalog_version, updated_at
  )
  select
    e ->> 'screen_key',
    nullif(e ->> 'parent_key', ''),
    (e ->> 'is_leaf')::boolean,
    true,
    v_next_version,
    now()
  from jsonb_array_elements(p_entries) e
  on conflict (screen_key) do update set
    parent_key = excluded.parent_key,
    is_leaf = excluded.is_leaf,
    active = true,
    catalog_version = excluded.catalog_version,
    updated_at = excluded.updated_at;

  update pos.screen_permission_catalog c
  set active = false,
      catalog_version = v_next_version,
      updated_at = now()
  where c.active
    and not exists (
      select 1
      from jsonb_array_elements(p_entries) e
      where e ->> 'screen_key' = c.screen_key
    );

  update pos.screen_permission_catalog_state
  set catalog_version = v_next_version,
      updated_at = now(),
      updated_by = v_actor
  where singleton;

  return jsonb_build_object(
    'catalog_version', v_next_version,
    'active_keys', (
      select count(*) from pos.screen_permission_catalog where active
    )
  );
end;
$$;

create or replace function pos.admin_permission_users(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  profile_status text,
  role_code text,
  has_overrides boolean,
  last_modified_at timestamptz,
  permission_version text
)
language plpgsql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;
  if coalesce(p_limit, 0) < 1 or coalesce(p_offset, -1) < 0 then
    raise exception 'PERMISSION_ADMIN_PAGE_INVALID'
      using errcode = '22023';
  end if;

  return query
    select
      u.id,
      u.email::text,
      coalesce(s.nombre, split_part(u.email, '@', 1), 'Usuario')::text,
      case
        when s.id is null or s.deleted_at is not null then 'profile_missing'
        when s.active is not true then 'user_inactive'
        else 'active'
      end::text,
      a.role_code,
      coalesce(o.has_overrides, false),
      greatest(a.updated_at, o.updated_at, audit.changed_at),
      pos.user_screen_permissions_version(u.id)
    from auth.users u
    left join lateral (
      select p.id, p.nombre, p.active, p.deleted_at
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
    left join pos.user_permission_role_assignments a on a.user_id = u.id
    left join lateral (
      select true as has_overrides, max(x.updated_at) as updated_at
      from pos.user_screen_permission_overrides x
      where x.user_id = u.id
      having count(*) > 0
    ) o on true
    left join lateral (
      select max(x.changed_at) as changed_at
      from pos.permission_change_audit x
      where x.target_user_id = u.id
    ) audit on true
    where nullif(trim(coalesce(p_search, '')), '') is null
       or coalesce(s.nombre, '') ilike '%' || trim(p_search) || '%'
       or coalesce(u.email, '') ilike '%' || trim(p_search) || '%'
    order by coalesce(s.nombre, u.email), u.id
    limit least(p_limit, 500)
    offset p_offset;
end;
$$;

create or replace function pos.admin_user_permission_snapshot(
  p_target_user_id uuid,
  p_screen_keys text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'TARGET_USER_NOT_FOUND'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_screen_keys, array[]::text[]))
     <> (
       select count(distinct k)
       from unnest(coalesce(p_screen_keys, array[]::text[])) k
     ) then
    raise exception 'SCREEN_KEYS_DUPLICATED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_screen_keys, array[]::text[])) k
    left join pos.screen_permission_catalog c on c.screen_key = k
    where c.screen_key is null
  ) then
    raise exception 'SCREEN_KEY_UNKNOWN' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_screen_keys, array[]::text[])) k
    join pos.screen_permission_catalog c on c.screen_key = k
    where not c.active or not c.is_leaf
  ) then
    raise exception 'SCREEN_KEY_INACTIVE' using errcode = '22023';
  end if;

  with requested as (
    select k.screen_key, k.sort_order
    from unnest(coalesce(p_screen_keys, array[]::text[]))
         with ordinality as k(screen_key, sort_order)
  ),
  identity_profile as (
    select
      u.id,
      u.email::text as email,
      coalesce(s.nombre, split_part(u.email, '@', 1), 'Usuario')::text
        as display_name,
      case
        when s.id is null or s.deleted_at is not null then 'profile_missing'
        when s.active is not true then 'user_inactive'
        else 'active'
      end::text as profile_status
    from auth.users u
    left join lateral (
      select p.id, p.nombre, p.active, p.deleted_at
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
    where u.id = p_target_user_id
  ),
  permission_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', k.screen_key,
          'allowed', r.allowed,
          'source', r.source,
          'role_code', r.role_code,
          'effect', r.effect
        )
        order by k.sort_order
      ),
      '[]'::jsonb
    ) as value
    from requested k
    cross join lateral pos.resolve_screen_permission(
      p_target_user_id, k.screen_key
    ) r
  ),
  overrides as (
    select coalesce(
      jsonb_object_agg(o.screen_key, o.effect order by o.screen_key),
      '{}'::jsonb
    ) as value
    from pos.user_screen_permission_overrides o
    where o.user_id = p_target_user_id
  ),
  metadata as (
    select
      a.role_code,
      greatest(a.updated_at, o.updated_at, audit.changed_at) as last_modified_at
    from (select p_target_user_id as user_id) target
    left join pos.user_permission_role_assignments a
      on a.user_id = target.user_id
    left join lateral (
      select max(x.updated_at) as updated_at
      from pos.user_screen_permission_overrides x
      where x.user_id = target.user_id
    ) o on true
    left join lateral (
      select max(x.changed_at) as changed_at
      from pos.permission_change_audit x
      where x.target_user_id = target.user_id
    ) audit on true
  )
  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', identity_profile.id,
      'email', identity_profile.email,
      'name', identity_profile.display_name,
      'status', identity_profile.profile_status
    ),
    'base_role', metadata.role_code,
    'overrides', overrides.value,
    'permissions', permission_rows.value,
    'permission_version',
      pos.user_screen_permissions_version(p_target_user_id),
    'last_modified_at', metadata.last_modified_at,
    'verified_at', statement_timestamp()
  )
  into v_result
  from identity_profile
  cross join permission_rows
  cross join overrides
  cross join metadata;

  return v_result;
end;
$$;

create or replace function pos.admin_apply_user_screen_permissions_checked(
  p_target_user_id uuid,
  p_role_code text,
  p_overrides jsonb,
  p_expected_version text,
  p_screen_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_current_version text;
  v_batch_id uuid;
  v_profile_active boolean;
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'TARGET_USER_NOT_FOUND'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '{}'::jsonb)) <> 'object' then
    raise exception 'OVERRIDE_PAYLOAD_INVALID' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_screen_keys, array[]::text[]))
     <> (
       select count(distinct k)
       from unnest(coalesce(p_screen_keys, array[]::text[])) k
     ) then
    raise exception 'SCREEN_KEYS_DUPLICATED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
    left join pos.screen_permission_catalog c on c.screen_key = e.key
    where c.screen_key is null
  ) then
    raise exception 'SCREEN_KEY_UNKNOWN' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
    join pos.screen_permission_catalog c on c.screen_key = e.key
    where not c.active or not c.is_leaf
  ) then
    raise exception 'SCREEN_KEY_INACTIVE' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
    where jsonb_typeof(e.value) <> 'null'
      and trim(both '"' from e.value::text) not in ('allow', 'deny')
  ) then
    raise exception 'OVERRIDE_EFFECT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_target_user_id::text, 56)
  );
  v_current_version :=
    pos.user_screen_permissions_version(p_target_user_id);
  if nullif(p_expected_version, '') is null
     or p_expected_version is distinct from v_current_version then
    raise exception 'PERMISSION_VERSION_CONFLICT'
      using errcode = '40001',
            detail = jsonb_build_object(
              'expected', p_expected_version,
              'current', v_current_version
            )::text;
  end if;

  select exists (
    select 1
    from auth.users u
    join pos.sellers s on lower(s.email) = lower(u.email)
    where u.id = p_target_user_id
      and s.active is true
      and s.deleted_at is null
  ) into v_profile_active;
  if not v_profile_active then
    raise exception 'TARGET_USER_INACTIVE'
      using errcode = '55000';
  end if;

  v_batch_id := pos.admin_apply_user_screen_permissions(
    p_target_user_id,
    p_role_code,
    coalesce(p_overrides, '{}'::jsonb)
  );

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'snapshot', pos.admin_user_permission_snapshot(
      p_target_user_id, p_screen_keys
    )
  );
end;
$$;

create or replace function pos.assert_permission_admin_survives_scope(
  p_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  if not exists (
    select 1
    from auth.users u
    where (p_user_ids is null or u.id = any(p_user_ids))
      and pos.can_manage_screen_permissions(u.id)
  ) then
    raise exception 'LAST_PERMISSION_ADMIN'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function pos.assert_permission_admin_survives()
returns void
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  perform pos.assert_permission_admin_survives_scope(null);
end;
$$;

create or replace function pos.enforce_permission_admin_survives()
returns trigger
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
begin
  perform pos.assert_permission_admin_survives();
  return null;
end;
$$;

drop trigger if exists permission_admin_survives_sellers on pos.sellers;
create constraint trigger permission_admin_survives_sellers
after update of active, deleted_at, role, email or delete on pos.sellers
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

drop trigger if exists permission_admin_survives_assignments
  on pos.user_permission_role_assignments;
create constraint trigger permission_admin_survives_assignments
after insert or update or delete on pos.user_permission_role_assignments
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

drop trigger if exists permission_admin_survives_roles on pos.permission_roles;
create constraint trigger permission_admin_survives_roles
after update of active or delete on pos.permission_roles
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

drop trigger if exists permission_admin_survives_role_permissions
  on pos.role_screen_permissions;
create constraint trigger permission_admin_survives_role_permissions
after insert or update or delete on pos.role_screen_permissions
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

drop trigger if exists permission_admin_survives_overrides
  on pos.user_screen_permission_overrides;
create constraint trigger permission_admin_survives_overrides
after insert or update or delete on pos.user_screen_permission_overrides
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

drop trigger if exists permission_admin_survives_catalog
  on pos.screen_permission_catalog;
create constraint trigger permission_admin_survives_catalog
after insert or update or delete on pos.screen_permission_catalog
deferrable initially deferred
for each row execute function pos.enforce_permission_admin_survives();

revoke all on pos.screen_permission_catalog
  from public, anon, authenticated;
revoke all on pos.screen_permission_catalog_state
  from public, anon, authenticated;
revoke select on pos.permission_roles
  from authenticated;
revoke select on pos.user_permission_role_assignments
  from authenticated;
revoke select on pos.role_screen_permissions
  from authenticated;
revoke select on pos.user_screen_permission_overrides
  from authenticated;
revoke select on pos.permission_change_audit
  from authenticated;
grant all on pos.screen_permission_catalog to service_role;
grant all on pos.screen_permission_catalog_state to service_role;

revoke all on function pos.user_screen_permissions_version(uuid)
  from public, anon, authenticated;
grant execute on function pos.user_screen_permissions_version(uuid)
  to service_role;
revoke all on function pos.enforce_permission_admin_survives()
  from public, anon, authenticated;
revoke all on function pos.assert_permission_admin_survives_scope(uuid[])
  from public, anon, authenticated;
grant execute on function pos.enforce_permission_admin_survives()
  to service_role;
grant execute on function pos.assert_permission_admin_survives_scope(uuid[])
  to service_role;

revoke all on function pos.admin_sync_screen_permission_catalog(jsonb, bigint)
  from public, anon;
revoke all on function pos.admin_permission_users(text, integer, integer)
  from public, anon;
revoke all on function pos.admin_user_permission_snapshot(uuid, text[])
  from public, anon;
revoke all on function pos.admin_apply_user_screen_permissions_checked(
  uuid, text, jsonb, text, text[]
) from public, anon;

grant execute on function pos.admin_sync_screen_permission_catalog(jsonb, bigint)
  to authenticated;
grant execute on function pos.admin_permission_users(text, integer, integer)
  to authenticated;
grant execute on function pos.admin_user_permission_snapshot(uuid, text[])
  to authenticated;
grant execute on function pos.admin_apply_user_screen_permissions_checked(
  uuid, text, jsonb, text, text[]
) to authenticated;

comment on function pos.admin_apply_user_screen_permissions_checked(
  uuid, text, jsonb, text, text[]
) is 'H-56: guardado administrativo atómico con versión optimista y auditoría por lote.';

commit;
