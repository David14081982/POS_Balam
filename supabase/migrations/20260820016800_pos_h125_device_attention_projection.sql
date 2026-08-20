-- H-125: sync_activity is history; the declared local queue authorizes retry.
begin;

create or replace function pos.admin_request_sync_retry(
  p_device_id text,
  p_operation_id text
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if not pos.is_active_admin() then
    raise exception 'admin_required' using errcode='42501';
  end if;
  update pos.sync_activity a set
    admin_action='retry', action_status='requested', action_by=auth.uid(),
    action_at=now(), updated_at=now()
  from pos.sync_devices d
  where a.device_id=p_device_id and a.operation_id=p_operation_id
    and d.device_id=a.device_id
    and d.queue_pending > 0 and d.queue_blocked > 0
    and a.requires_action and a.status in ('blocked','quarantined')
    and a.admin_action is distinct from 'review';
  if not found then raise exception 'sync_activity_not_actionable'; end if;
  perform pos.bump_sync_domain('devices', p_device_id);
  return true;
end;
$$;

create or replace function pos.admin_mark_sync_activity_reviewed(
  p_device_id text,
  p_operation_id text
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if not pos.is_active_admin() then
    raise exception 'admin_required' using errcode='42501';
  end if;
  update pos.sync_activity set
    requires_action=false, admin_action='review', action_status='completed',
    action_by=auth.uid(), action_at=now(), updated_at=now()
  where device_id=p_device_id and operation_id=p_operation_id;
  if not found then raise exception 'sync_activity_not_found'; end if;
  perform pos.bump_sync_domain('devices', p_device_id);
  return true;
end;
$$;

create or replace function pos.consume_sync_commands(p_device_id text)
returns table(operation_id text, action text)
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from pos.sync_devices d
    where d.device_id=p_device_id and d.user_id=auth.uid()
  ) then raise exception 'device_owner_required' using errcode='42501'; end if;
  return query
  with selected as (
    select a.device_id, a.operation_id
    from pos.sync_activity a
    join pos.sync_devices d on d.device_id=a.device_id
    where a.device_id=p_device_id and a.admin_action='retry'
      and a.action_status='requested' and a.requires_action
      and d.queue_pending > 0 and d.queue_blocked > 0
    for update of a skip locked
  ), delivered as (
    update pos.sync_activity a set action_status='delivered', updated_at=now()
    from selected s
    where a.device_id=s.device_id and a.operation_id=s.operation_id
    returning a.operation_id
  )
  select d.operation_id, 'retry'::text from delivered d;
end;
$$;

revoke all on function pos.admin_request_sync_retry(text,text),
  pos.admin_mark_sync_activity_reviewed(text,text),
  pos.consume_sync_commands(text) from public, anon;
grant execute on function pos.admin_request_sync_retry(text,text),
  pos.admin_mark_sync_activity_reviewed(text,text),
  pos.consume_sync_commands(text) to authenticated;

update pos.system_manifest set
  schema_version=greatest(schema_version,20260820016800), updated_at=now()
where singleton;

commit;

