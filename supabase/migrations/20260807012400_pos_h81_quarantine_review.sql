-- H-81: expediente resumido y decisiones auditadas de cuarentena.
begin;

create table if not exists pos.sync_quarantine_cases (
  device_id text not null references pos.sync_devices(device_id) on delete cascade,
  operation_id text not null,
  remote_epoch bigint not null,
  local_epoch bigint,
  user_id uuid not null,
  user_email text,
  operation_type text not null,
  domain text,
  reference text,
  summary text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload_summary)='object'
      and octet_length(payload_summary::text) <= 32768),
  status text not null default 'pending_review' check (status in
    ('pending_review','approved','delivered','rejected','resolved','failed')),
  decision_note text,
  decision_by uuid,
  decision_at timestamptz,
  execution_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(device_id, operation_id, remote_epoch)
);

create index if not exists sync_quarantine_cases_status_idx
  on pos.sync_quarantine_cases(status, updated_at desc);

alter table pos.sync_quarantine_cases enable row level security;
revoke all on pos.sync_quarantine_cases from public, anon, authenticated;
grant select on pos.sync_quarantine_cases to authenticated;

drop policy if exists sync_quarantine_cases_read on pos.sync_quarantine_cases;
create policy sync_quarantine_cases_read on pos.sync_quarantine_cases
for select to authenticated
using (pos.is_active_admin() or user_id=auth.uid());

create or replace function pos.report_sync_quarantine(
  p_device_id text, p_operation_id text, p_remote_epoch bigint,
  p_local_epoch bigint, p_operation_type text, p_domain text,
  p_reference text, p_summary text, p_payload_hash text,
  p_payload_summary jsonb
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from pos.sync_devices d
      where d.device_id=p_device_id and d.user_id=auth.uid()) then
    raise exception 'device_owner_required' using errcode='42501';
  end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 160
     or p_remote_epoch is null or p_remote_epoch < 1
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_payload_summary,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_payload_summary,'{}'::jsonb)::text) > 32768 then
    raise exception 'invalid_quarantine_case';
  end if;

  insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,
    local_epoch,user_id,user_email,operation_type,domain,reference,summary,
    payload_hash,payload_summary)
  values(p_device_id,p_operation_id,p_remote_epoch,p_local_epoch,auth.uid(),
    auth.jwt()->>'email',left(coalesce(p_operation_type,'unknown'),80),
    left(p_domain,80),left(p_reference,120),left(coalesce(p_summary,'Operación en cuarentena'),240),
    p_payload_hash,p_payload_summary)
  on conflict(device_id,operation_id,remote_epoch) do update set
    local_epoch=excluded.local_epoch, user_email=excluded.user_email,
    operation_type=excluded.operation_type, domain=excluded.domain,
    reference=excluded.reference, summary=excluded.summary,
    payload_hash=excluded.payload_hash, payload_summary=excluded.payload_summary,
    status='pending_review', decision_note=null, decision_by=null,
    decision_at=null, execution_message=null, updated_at=now()
  where pos.sync_quarantine_cases.status in ('pending_review','failed');
  return true;
end;
$$;

create or replace function pos.admin_decide_sync_quarantine(
  p_device_id text, p_operation_id text, p_remote_epoch bigint,
  p_decision text, p_note text default null
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if not pos.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  update pos.sync_quarantine_cases set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    decision_note=nullif(left(btrim(coalesce(p_note,'')),500),''),
    decision_by=auth.uid(), decision_at=now(), updated_at=now(),
    execution_message=null
  where device_id=p_device_id and operation_id=p_operation_id
    and remote_epoch=p_remote_epoch and status in ('pending_review','failed');
  if not found then raise exception 'quarantine_case_not_actionable'; end if;
  return true;
end;
$$;

create or replace function pos.consume_sync_quarantine_decisions(p_device_id text)
returns table(operation_id text, remote_epoch bigint, decision text)
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null or not exists(select 1 from pos.sync_devices d
      where d.device_id=p_device_id and d.user_id=auth.uid()) then
    raise exception 'device_owner_required' using errcode='42501';
  end if;
  return query
  with selected as (
    select q.device_id,q.operation_id,q.remote_epoch
    from pos.sync_quarantine_cases q
    where q.device_id=p_device_id and q.status='approved'
    for update skip locked
  ), delivered as (
    update pos.sync_quarantine_cases q set status='delivered',updated_at=now()
    from selected s where q.device_id=s.device_id
      and q.operation_id=s.operation_id and q.remote_epoch=s.remote_epoch
    returning q.operation_id,q.remote_epoch
  )
  select d.operation_id,d.remote_epoch,'approve'::text from delivered d;
end;
$$;

create or replace function pos.complete_sync_quarantine(
  p_device_id text, p_operation_id text, p_remote_epoch bigint,
  p_ok boolean, p_message text default null
) returns boolean
language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  if auth.uid() is null or not exists(select 1 from pos.sync_devices d
      where d.device_id=p_device_id and d.user_id=auth.uid()) then
    raise exception 'device_owner_required' using errcode='42501';
  end if;
  update pos.sync_quarantine_cases set
    status=case when p_ok then 'resolved' else 'failed' end,
    execution_message=nullif(left(coalesce(p_message,''),500),''),
    resolved_at=case when p_ok then now() else null end, updated_at=now()
  where device_id=p_device_id and operation_id=p_operation_id
    and remote_epoch=p_remote_epoch and status='delivered';
  return found;
end;
$$;

create or replace function pos.h81_touch_quarantine_devices()
returns trigger language plpgsql security definer
set search_path = pos, pg_temp
as $$ begin perform pos.bump_sync_domain('devices',null); return null; end $$;

revoke all on function pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb),
  pos.admin_decide_sync_quarantine(text,text,bigint,text,text),
  pos.consume_sync_quarantine_decisions(text),
  pos.complete_sync_quarantine(text,text,bigint,boolean,text),
  pos.h81_touch_quarantine_devices() from public, anon;
revoke all on function pos.h81_touch_quarantine_devices() from authenticated;
grant execute on function pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb),
  pos.admin_decide_sync_quarantine(text,text,bigint,text,text),
  pos.consume_sync_quarantine_decisions(text),
  pos.complete_sync_quarantine(text,text,bigint,boolean,text) to authenticated;

drop trigger if exists h81_sync_quarantine on pos.sync_quarantine_cases;
create trigger h81_sync_quarantine after insert or update or delete
on pos.sync_quarantine_cases for each statement
execute function pos.h81_touch_quarantine_devices();

update pos.system_manifest set schema_version=greatest(schema_version,20260807012400),
  updated_at=now() where singleton;

commit;
