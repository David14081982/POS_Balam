-- H-56 Fase 5 grupo 4: configuración general y administración de permisos.
begin;

create or replace function pos.can_manage_screen_permissions(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pos, auth, pg_temp
as $$
  select exists (
    select 1 from auth.users u
    join pos.sellers s on lower(s.email)=lower(u.email)
    where u.id=p_user_id and s.role='admin' and s.active
      and s.deleted_at is null
  )
  and coalesce((select allowed from pos.resolve_screen_permission(
    p_user_id,'config.usuarios')),false)
  and coalesce((select allowed from pos.resolve_screen_permission(
    p_user_id,'config.permisos')),false)
  and coalesce((select allowed from pos.resolve_operational_capability(
    p_user_id,'permissions.manage')),false);
$$;

drop policy if exists active_admin_all on pos.settings;
drop policy if exists settings_admin_select on pos.settings;
drop policy if exists settings_capability_write on pos.settings;
create policy settings_admin_select on pos.settings
  for select to authenticated using (pos.is_active_admin());
create policy settings_capability_write on pos.settings
  for all to authenticated
  using (pos.current_has_capability('settings.manage'))
  with check (pos.current_has_capability('settings.manage'));

drop policy if exists active_admin_all on pos.lookup;
drop policy if exists lookup_admin_select on pos.lookup;
drop policy if exists lookup_capability_write on pos.lookup;
create policy lookup_admin_select on pos.lookup
  for select to authenticated using (pos.is_active_admin());
create policy lookup_capability_write on pos.lookup
  for all to authenticated
  using (pos.current_has_capability('settings.manage'))
  with check (pos.current_has_capability('settings.manage'));

commit;
