-- H-56 Fase 4: lectura administrativa versionada del catálogo.

begin;

create or replace function pos.admin_screen_permission_catalog_snapshot()
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

  select jsonb_build_object(
    'catalog_version', s.catalog_version,
    'updated_at', s.updated_at,
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'screen_key', c.screen_key,
          'parent_key', c.parent_key,
          'is_leaf', c.is_leaf,
          'active', c.active,
          'catalog_version', c.catalog_version
        )
        order by c.screen_key
      )
      from pos.screen_permission_catalog c
    ), '[]'::jsonb)
  )
  into v_result
  from pos.screen_permission_catalog_state s
  where s.singleton;

  return v_result;
end;
$$;

revoke all on function pos.admin_screen_permission_catalog_snapshot()
  from public, anon;
grant execute on function pos.admin_screen_permission_catalog_snapshot()
  to authenticated;

comment on function pos.admin_screen_permission_catalog_snapshot() is
  'H-56: catálogo completo y versión para sincronización administrativa optimista.';

commit;
