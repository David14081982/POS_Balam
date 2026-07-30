begin;
do $$
declare
  v_admin constant uuid := '00000000-0000-0000-0000-000000005681';
begin
  if exists(select 1 from auth.users where id=v_admin)
     or exists(select 1 from pos.sellers where id='h56-settings-admin') then
    raise exception 'H56_SETTINGS_FIXTURE_COLLISION';
  end if;
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
    email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('00000000-0000-0000-0000-000000000000',v_admin,'authenticated',
    'authenticated','h56.settings.admin@invalid.local','',now(),
    '{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active)
  values('h56-settings-admin','Admin Fixture',
    'h56.settings.admin@invalid.local','admin',true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active)
  values(v_admin,'admin',true);
  if not pos.can_manage_screen_permissions(v_admin) then
    raise exception 'H56_PERMISSIONS_COMPATIBILITY_FAILED';
  end if;
  insert into pos.user_capability_overrides(user_id,capability_key,effect)
  values(v_admin,'permissions.manage','deny');
  if pos.can_manage_screen_permissions(v_admin) then
    raise exception 'H56_PERMISSIONS_CAPABILITY_FAILED';
  end if;
  if not exists(select 1 from pg_policies where schemaname='pos'
      and tablename='settings' and policyname='settings_capability_write')
     or not exists(select 1 from pg_policies where schemaname='pos'
      and tablename='lookup' and policyname='lookup_capability_write') then
    raise exception 'H56_SETTINGS_POLICY_FAILED';
  end if;
  delete from pos.user_capability_overrides where user_id=v_admin;
  delete from pos.user_permission_role_assignments where user_id=v_admin;
  delete from pos.sellers where id='h56-settings-admin';
  delete from auth.users where id=v_admin;
  raise notice 'H56_SETTINGS permissions=ok settings=ok fixtures_clean=ok';
end;
$$;
commit;
