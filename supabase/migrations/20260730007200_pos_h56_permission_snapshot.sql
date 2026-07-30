-- POS Balam — H-56 Fase 3: snapshot versionado para AUTH.
-- Aditiva: no cambia tablas, policies ni RPC existentes.

begin;

create or replace function pos.current_permission_snapshot(p_screen_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  with requested as (
    select k.screen_key, k.sort_order
    from unnest(coalesce(p_screen_keys, array[]::text[]))
         with ordinality as k(screen_key, sort_order)
  ),
  resolved as (
    select
      k.screen_key,
      k.sort_order,
      r.allowed,
      r.source,
      r.role_code,
      r.effect
    from requested k
    cross join lateral pos.resolve_screen_permission(
      auth.uid(), k.screen_key
    ) r
  ),
  permission_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', screen_key,
          'allowed', allowed,
          'source', source,
          'role_code', role_code,
          'effect', effect
        )
        order by sort_order
      ),
      '[]'::jsonb
    ) as value
    from resolved
  ),
  metadata as (
    select
      a.role_code,
      a.updated_at as assignment_updated_at,
      (
        select max(o.updated_at)
        from pos.user_screen_permission_overrides o
        where o.user_id = auth.uid()
      ) as override_updated_at,
      (
        select max(p.updated_at)
        from pos.role_screen_permissions p
        where p.role_code = a.role_code
      ) as role_updated_at
    from (select auth.uid() as user_id) u
    left join pos.user_permission_role_assignments a
      on a.user_id = u.user_id
  ),
  identity_profile as (
    select
      case
        when u.id is null or s.id is null or s.deleted_at is not null
          then 'profile_missing'
        when s.active is not true then 'user_inactive'
        else 'active'
      end as profile_status,
      case
        when s.id is null or s.deleted_at is not null then null
        else jsonb_build_object(
          'id', u.id,
          'seller_id', s.id,
          'nombre', s.nombre,
          'iniciales', s.iniciales,
          'email', u.email,
          'role', s.role,
          'avatar_url', s.avatar_url,
          'active', s.active
        )
      end as profile
    from (select auth.uid() as user_id) current_identity
    left join auth.users u on u.id = current_identity.user_id
    left join pos.sellers s on lower(s.email) = lower(u.email)
    order by (s.deleted_at is null) desc, s.updated_at desc
    limit 1
  )
  select jsonb_build_object(
    'model_version', 'h56-screen-permissions-v1',
    'permission_version', md5(
      permission_rows.value::text || '|' ||
      coalesce(metadata.role_code, '') || '|' ||
      coalesce(metadata.assignment_updated_at::text, '') || '|' ||
      coalesce(metadata.override_updated_at::text, '') || '|' ||
      coalesce(metadata.role_updated_at::text, '')
    ),
    'verified_at', statement_timestamp(),
    'profile_status', identity_profile.profile_status,
    'profile', identity_profile.profile,
    'base_role', metadata.role_code,
    'permissions', permission_rows.value
  )
  from permission_rows
  cross join metadata
  cross join identity_profile;
$$;

revoke all on function pos.current_permission_snapshot(text[]) from public, anon;
grant execute on function pos.current_permission_snapshot(text[]) to authenticated;

comment on function pos.current_permission_snapshot(text[]) is
  'H-56: snapshot atómico, versionado y default-deny para la caché de AUTH.';

commit;
