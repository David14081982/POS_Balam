-- H-80: una proyección operativa idéntica no se invalida a sí misma.
begin;

create or replace function pos.h80_sync_activity_material_change()
returns trigger language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and
    row(new.user_id, new.user_email, new.operation_type, new.domain,
        new.reference, new.summary, new.status, new.requires_action,
        new.diagnostic, new.admin_action, new.action_status, new.action_by,
        new.action_at, new.completed_at)
    is not distinct from
    row(old.user_id, old.user_email, old.operation_type, old.domain,
        old.reference, old.summary, old.status, old.requires_action,
        old.diagnostic, old.admin_action, old.action_status, old.action_by,
        old.action_at, old.completed_at) then
    return null;
  end if;

  -- INSERT y DELETE, o un UPDATE material, siguen refrescando la flota.
  if tg_op in ('INSERT','DELETE') or tg_op = 'UPDATE' then
    perform pos.bump_sync_domain('devices', null);
  end if;
  return null;
end;
$$;

revoke all on function pos.h80_sync_activity_material_change()
  from public, anon, authenticated;

drop trigger if exists h79_sync_activity on pos.sync_activity;
drop trigger if exists h80_sync_activity on pos.sync_activity;
create trigger h80_sync_activity
after insert or update or delete on pos.sync_activity
for each row execute function pos.h80_sync_activity_material_change();

update pos.system_manifest set
  schema_version = greatest(schema_version, 20260807012200),
  updated_at = now()
where singleton;

commit;
