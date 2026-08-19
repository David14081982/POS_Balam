\set ON_ERROR_STOP on

create schema if not exists auth;
create schema if not exists pos;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as
  'select ''00000000-0000-0000-0000-000000000116''::uuid';

create table pos.system_manifest(
  singleton boolean primary key,
  schema_version bigint not null,
  sync_protocol_min integer not null,
  sync_protocol_current integer not null,
  data_epoch bigint not null,
  updated_at timestamptz not null default now()
);
insert into pos.system_manifest values(true,20260817014900,1,1,9,now());

create table pos.sync_devices(
  device_id text primary key,
  user_id uuid,
  user_email text,
  client_build text,
  protocol_version integer not null,
  schema_version bigint,
  data_epoch bigint not null,
  cursors jsonb not null default '{}',
  queue_pending integer not null default 0,
  queue_blocked integer not null default 0,
  status text not null,
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz,
  display_name text,
  device_type text not null default 'unknown',
  metadata jsonb not null default '{}'
);
create table pos.sync_activity(
  device_id text not null references pos.sync_devices(device_id),
  operation_id text not null,
  user_id uuid not null,
  operation_type text not null,
  domain text,
  reference text,
  summary text not null,
  status text not null,
  requires_action boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(device_id,operation_id)
);
create table pos.sync_quarantine_cases(
  device_id text not null references pos.sync_devices(device_id),
  operation_id text not null,
  remote_epoch bigint not null,
  operation_type text not null,
  domain text,
  reference text,
  summary text not null,
  status text not null,
  updated_at timestamptz not null default now(),
  primary key(device_id,operation_id,remote_epoch)
);
create table pos.sync_domain_versions(domain text primary key, version bigint not null default 0);
create table pos.selective_cleanup_events(
  cleanup_id text primary key, protocol_version integer,
  minimum_client_protocol integer, preset text, selection_normalized jsonb,
  plan_hash text, data_epoch bigint, purged_at timestamptz, identities jsonb
);

create or replace function pos.is_active_admin() returns boolean language sql stable as 'select true';
create or replace function pos.current_has_capability(text) returns boolean language sql stable as 'select true';
create or replace function pos.bump_sync_domain(p_domain text,p_device_id text default null)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into pos.sync_domain_versions(domain,version) values(p_domain,1)
  on conflict(domain) do update set version=pos.sync_domain_versions.version+1
  returning version into v;
  return v;
end $$;
create or replace function pos.point_zero_sha256(p_value jsonb)
returns text language sql immutable as 'select md5(p_value::text)';

create or replace function pos.test_data_cleanup_plan(
  p_preset text default 'operations', p_selection jsonb default '{}'::jsonb
) returns jsonb language sql stable as $$
  select jsonb_build_object('selection_normalized',p_selection,
    'blocked_reasons','[]'::jsonb,'data_epoch',9,'system_mode','preproduction')
$$;

create or replace function pos.report_sync_device(
  p_device_id text,p_client_build text,p_protocol_version integer,
  p_schema_version bigint,p_data_epoch bigint,p_cursors jsonb,
  p_queue_pending integer,p_queue_blocked integer,p_status text,
  p_last_synced_at timestamptz
) returns boolean language plpgsql as $$
begin
  insert into pos.sync_devices(device_id,client_build,protocol_version,
    schema_version,data_epoch,cursors,queue_pending,queue_blocked,status,
    last_seen_at,last_synced_at)
  values(p_device_id,p_client_build,p_protocol_version,p_schema_version,
    p_data_epoch,p_cursors,p_queue_pending,p_queue_blocked,p_status,now(),p_last_synced_at)
  on conflict(device_id) do update set
    client_build=excluded.client_build, protocol_version=excluded.protocol_version,
    schema_version=excluded.schema_version, data_epoch=excluded.data_epoch,
    cursors=excluded.cursors, queue_pending=excluded.queue_pending,
    queue_blocked=excluded.queue_blocked, status=excluded.status,
    last_seen_at=now(), last_synced_at=excluded.last_synced_at;
  return true;
end $$;

create or replace function pos.execute_test_data_cleanup(
  p_cleanup_id text,p_preset text,p_selection jsonb,p_plan_hash text,
  p_backup_id uuid,p_confirmation text,p_client_protocol integer,
  p_client_build text,p_device_id text
) returns jsonb language plpgsql as $$
declare v_epoch bigint;
begin
  update pos.system_manifest set data_epoch=data_epoch+1,
    schema_version=case when schema_version<20260817014900 then 20260817014900 else schema_version end,
    updated_at=now() where singleton returning data_epoch into v_epoch;
  insert into pos.selective_cleanup_events(cleanup_id,protocol_version,minimum_client_protocol,
    preset,selection_normalized,plan_hash,data_epoch,purged_at,identities)
  values(p_cleanup_id,2,2,p_preset,p_selection,p_plan_hash,v_epoch,now(),'{}');
  return jsonb_build_object('protocol_version',2,'minimum_client_protocol',2,
    'data_epoch',v_epoch);
end $$;

\ir supabase/migrations/20260818015300_pos_h116_cleanup_fleet_risk.sql
\ir supabase/migrations/20260818015400_pos_h116_cleanup_fleet_risk_verification.sql

select 'H116_FUNCTIONAL_OK' as result;
