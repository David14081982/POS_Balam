-- H-80: verificación conductual; las semillas y versiones se revierten.
begin;

do $$
declare
  v_device text := '__h80_verification__';
  v_operation text := '__h80_operation__';
  v_before bigint;
  v_after bigint;
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='pos' and c.relname='sync_activity'
      and t.tgname='h80_sync_activity' and not t.tgisinternal
  ) then raise exception 'h80_trigger_missing'; end if;

  if has_function_privilege('authenticated',
      'pos.h80_sync_activity_material_change()','execute') then
    raise exception 'h80_trigger_function_exposed';
  end if;

  insert into pos.sync_devices(device_id, protocol_version, data_epoch, status)
  values(v_device, 1, 1, 'online');
  select version into v_before from pos.sync_domain_versions where domain='devices';

  insert into pos.sync_activity(device_id, operation_id, user_id,
    operation_type, summary, status)
  values(v_device, v_operation, '00000000-0000-0000-0000-000000000080',
    'verification', 'H-80', 'pending');
  select version into v_after from pos.sync_domain_versions where domain='devices';
  if v_after <= v_before then raise exception 'h80_insert_did_not_invalidate'; end if;

  v_before := v_after;
  update pos.sync_activity set updated_at=clock_timestamp()
  where device_id=v_device and operation_id=v_operation;
  select version into v_after from pos.sync_domain_versions where domain='devices';
  if v_after <> v_before then raise exception 'h80_timestamp_invalidated_devices'; end if;

  update pos.sync_activity set status='blocked', requires_action=true
  where device_id=v_device and operation_id=v_operation;
  select version into v_after from pos.sync_domain_versions where domain='devices';
  if v_after <= v_before then raise exception 'h80_material_change_not_invalidated'; end if;

  v_before := v_after;
  delete from pos.sync_activity where device_id=v_device and operation_id=v_operation;
  select version into v_after from pos.sync_domain_versions where domain='devices';
  if v_after <= v_before then raise exception 'h80_delete_did_not_invalidate'; end if;
end $$;

rollback;
