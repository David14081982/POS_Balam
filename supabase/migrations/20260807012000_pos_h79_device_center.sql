-- H-79: centro de equipos, actividad resumida y órdenes administrativas seguras.
begin;

alter table pos.sync_devices
  add column if not exists display_name text,
  add column if not exists device_type text not null default 'unknown',
  add column if not exists queue_blocked integer not null default 0,
  add column if not exists last_synced_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table pos.sync_devices drop constraint if exists sync_devices_device_type_check;
alter table pos.sync_devices add constraint sync_devices_device_type_check
  check (device_type in ('unknown','pc','laptop','tablet','other'));
alter table pos.sync_devices drop constraint if exists sync_devices_queue_blocked_check;
alter table pos.sync_devices add constraint sync_devices_queue_blocked_check
  check (queue_blocked >= 0 and queue_blocked <= queue_pending);

create table if not exists pos.sync_activity (
  device_id text not null references pos.sync_devices(device_id) on delete cascade,
  operation_id text not null,
  user_id uuid not null,
  user_email text,
  operation_type text not null,
  domain text,
  reference text,
  summary text not null,
  status text not null check (status in
    ('pending','retrying','synced','blocked','quarantined')),
  requires_action boolean not null default false,
  diagnostic jsonb,
  admin_action text check (admin_action is null or admin_action in ('retry','review')),
  action_status text check (action_status is null or action_status in
    ('requested','delivered','completed','failed')),
  action_by uuid,
  action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(device_id, operation_id)
);

create index if not exists sync_activity_updated_idx
  on pos.sync_activity(updated_at desc);
create index if not exists sync_activity_attention_idx
  on pos.sync_activity(requires_action, updated_at desc)
  where requires_action;

alter table pos.sync_activity enable row level security;
revoke all on pos.sync_activity from public, anon, authenticated;
grant select, insert, update on pos.sync_activity to authenticated;

drop policy if exists sync_activity_read on pos.sync_activity;
create policy sync_activity_read on pos.sync_activity for select to authenticated
  using (pos.is_active_admin() or user_id = auth.uid());
drop policy if exists sync_activity_insert on pos.sync_activity;
create policy sync_activity_insert on pos.sync_activity for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists sync_activity_update on pos.sync_activity;
create policy sync_activity_update on pos.sync_activity for update to authenticated
  using (pos.is_active_admin() or user_id = auth.uid())
  with check (pos.is_active_admin() or user_id = auth.uid());

insert into pos.sync_domain_versions(domain)
values ('devices') on conflict(domain) do nothing;

update pos.system_manifest set
  schema_version = greatest(schema_version, 20260807012000),
  domain_modes = domain_modes || '{"devices":"active"}'::jsonb,
  updated_at = now()
where singleton;

create or replace function pos.touch_sync_devices_domain()
returns trigger language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.bump_sync_domain('devices', null);
  return null;
end;
$$;
revoke all on function pos.touch_sync_devices_domain() from public, anon, authenticated;

drop trigger if exists h79_sync_activity on pos.sync_activity;
create trigger h79_sync_activity after insert or update or delete on pos.sync_activity
  for each statement execute function pos.touch_sync_devices_domain();

create or replace function pos.admin_update_sync_device(
  p_device_id text,
  p_display_name text,
  p_device_type text
) returns pos.sync_devices
language plpgsql security definer
set search_path = pos, pg_temp
as $$
declare v_row pos.sync_devices;
begin
  if not pos.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if nullif(btrim(p_display_name),'') is null then raise exception 'device_name_required'; end if;
  if p_device_type not in ('pc','laptop','tablet','other') then raise exception 'invalid_device_type'; end if;
  update pos.sync_devices set
    display_name = left(btrim(p_display_name), 80),
    device_type = p_device_type,
    metadata = metadata || jsonb_build_object('named_at', now(), 'named_by', auth.uid())
  where device_id = p_device_id
  returning * into v_row;
  if not found then raise exception 'device_not_found'; end if;
  perform pos.bump_sync_domain('devices', p_device_id);
  return v_row;
end;
$$;

create or replace function pos.report_sync_device(
  p_device_id text,
  p_client_build text,
  p_protocol_version integer,
  p_schema_version bigint,
  p_data_epoch bigint,
  p_cursors jsonb,
  p_queue_pending integer,
  p_queue_blocked integer,
  p_status text,
  p_last_synced_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_queue_pending < 0 or p_queue_blocked < 0 or p_queue_blocked > p_queue_pending then
    raise exception 'invalid_queue_counts';
  end if;
  if p_status not in ('online','offline','behind','pending','quarantined','must_rebootstrap','revoked') then
    raise exception 'invalid_device_status';
  end if;
  insert into pos.sync_devices(device_id,user_id,user_email,client_build,
    protocol_version,schema_version,data_epoch,cursors,queue_pending,queue_blocked,
    status,last_seen_at,last_synced_at)
  values(p_device_id,auth.uid(),auth.jwt()->>'email',p_client_build,
    p_protocol_version,p_schema_version,p_data_epoch,coalesce(p_cursors,'{}'::jsonb),
    p_queue_pending,p_queue_blocked,p_status,now(),p_last_synced_at)
  on conflict(device_id) do update set
    user_id=excluded.user_id, user_email=excluded.user_email,
    client_build=excluded.client_build, protocol_version=excluded.protocol_version,
    schema_version=excluded.schema_version, data_epoch=excluded.data_epoch,
    cursors=excluded.cursors, queue_pending=excluded.queue_pending,
    queue_blocked=excluded.queue_blocked, status=excluded.status,
    last_seen_at=now(), last_synced_at=excluded.last_synced_at;
  return true;
end;
$$;

create or replace function pos.admin_request_sync_retry(
  p_device_id text,
  p_operation_id text
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if not pos.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  update pos.sync_activity set
    admin_action='retry', action_status='requested', action_by=auth.uid(),
    action_at=now(), updated_at=now()
  where device_id=p_device_id and operation_id=p_operation_id
    and requires_action and status in ('blocked','quarantined');
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
  if not pos.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  update pos.sync_activity set
    admin_action='review', action_status='completed', action_by=auth.uid(),
    action_at=now(), updated_at=now()
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
    select 1 from pos.sync_devices d where d.device_id=p_device_id and d.user_id=auth.uid()
  ) then raise exception 'device_owner_required' using errcode='42501'; end if;
  return query
  with selected as (
    select a.device_id, a.operation_id
    from pos.sync_activity a
    where a.device_id=p_device_id and a.admin_action='retry'
      and a.action_status='requested'
    for update skip locked
  ), delivered as (
    update pos.sync_activity a set action_status='delivered', updated_at=now()
    from selected s
    where a.device_id=s.device_id and a.operation_id=s.operation_id
    returning a.operation_id
  )
  select d.operation_id, 'retry'::text from delivered d;
end;
$$;

create or replace function pos.complete_sync_command(
  p_device_id text,
  p_operation_id text,
  p_ok boolean
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from pos.sync_devices d where d.device_id=p_device_id and d.user_id=auth.uid()
  ) then raise exception 'device_owner_required' using errcode='42501'; end if;
  update pos.sync_activity set action_status=case when p_ok then 'completed' else 'failed' end,
    updated_at=now()
  where device_id=p_device_id and operation_id=p_operation_id
    and admin_action='retry' and action_status='delivered';
  return found;
end;
$$;

revoke all on function pos.admin_update_sync_device(text,text,text),
  pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz),
  pos.admin_request_sync_retry(text,text),
  pos.admin_mark_sync_activity_reviewed(text,text),
  pos.consume_sync_commands(text), pos.complete_sync_command(text,text,boolean)
  from public, anon;
grant execute on function pos.admin_update_sync_device(text,text,text),
  pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz),
  pos.admin_request_sync_retry(text,text),
  pos.admin_mark_sync_activity_reviewed(text,text),
  pos.consume_sync_commands(text), pos.complete_sync_command(text,text,boolean)
  to authenticated;

commit;
