-- H-56 Fase 4: snapshot de edición con herencia y roles disponibles.

begin;

create or replace function pos.admin_user_permission_editor_snapshot(
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
  v_snapshot jsonb;
  v_role_code text;
  v_permissions jsonb;
  v_roles jsonb;
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;

  v_snapshot := pos.admin_user_permission_snapshot(
    p_target_user_id, p_screen_keys
  );
  v_role_code := v_snapshot ->> 'base_role';

  select coalesce(jsonb_agg(
    p || jsonb_build_object(
      'role_configured', rp.screen_key is not null,
      'role_allowed', coalesce(rp.allowed, false)
    )
    order by ordinality
  ), '[]'::jsonb)
  into v_permissions
  from jsonb_array_elements(v_snapshot -> 'permissions')
       with ordinality as item(p, ordinality)
  left join pos.role_screen_permissions rp
    on rp.role_code = v_role_code
   and rp.screen_key = p ->> 'screen_key';

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', r.code, 'name', r.name
  ) order by r.name, r.code), '[]'::jsonb)
  into v_roles
  from pos.permission_roles r
  where r.active;

  return jsonb_set(
    jsonb_set(v_snapshot, '{permissions}', v_permissions),
    '{roles}', v_roles
  );
end;
$$;

revoke all on function pos.admin_user_permission_editor_snapshot(uuid, text[])
  from public, anon;
grant execute on function pos.admin_user_permission_editor_snapshot(uuid, text[])
  to authenticated;

commit;
