-- H-77: protocolo durable de invalidación, compatibilidad y terminales.
begin;

create table if not exists pos.system_manifest (
  singleton boolean primary key default true check (singleton),
  schema_version bigint not null,
  sync_protocol_min integer not null check (sync_protocol_min > 0),
  sync_protocol_current integer not null check (sync_protocol_current >= sync_protocol_min),
  minimum_client_build text,
  data_epoch bigint not null default 1 check (data_epoch > 0),
  domain_modes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into pos.system_manifest(singleton, schema_version, sync_protocol_min,
  sync_protocol_current, data_epoch, domain_modes)
values (true, 20260806011500, 1, 1, 1,
  '{"config":"shadow","products":"shadow","clients":"shadow","sellers":"shadow","promotions":"shadow","sales":"shadow","payments":"shadow","returns":"shadow","exchanges":"shadow","loans":"shadow","liquidations":"shadow","movements":"shadow","permissions":"shadow","purges":"shadow"}'::jsonb)
on conflict(singleton) do update set
  schema_version = greatest(pos.system_manifest.schema_version, excluded.schema_version),
  sync_protocol_current = greatest(pos.system_manifest.sync_protocol_current, excluded.sync_protocol_current),
  updated_at = now();

create table if not exists pos.sync_domain_versions (
  domain text primary key,
  version bigint not null default 0 check (version >= 0),
  source_device_id text,
  updated_at timestamptz not null default now()
);

insert into pos.sync_domain_versions(domain)
select unnest(array['config','products','clients','sellers','promotions','sales',
  'payments','returns','exchanges','loans','liquidations','movements',
  'permissions','purges'])
on conflict(domain) do nothing;

create table if not exists pos.sync_devices (
  device_id text primary key,
  user_id uuid,
  user_email text,
  client_build text,
  protocol_version integer not null,
  schema_version bigint,
  data_epoch bigint not null,
  cursors jsonb not null default '{}'::jsonb,
  queue_pending integer not null default 0 check (queue_pending >= 0),
  status text not null default 'online' check (status in
    ('online','offline','behind','pending','quarantined','must_rebootstrap','revoked')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table pos.system_manifest enable row level security;
alter table pos.sync_domain_versions enable row level security;
alter table pos.sync_devices enable row level security;

revoke all on pos.system_manifest, pos.sync_domain_versions, pos.sync_devices
  from public, anon, authenticated;
grant select on pos.system_manifest, pos.sync_domain_versions to authenticated;
grant select, insert, update on pos.sync_devices to authenticated;

drop policy if exists sync_manifest_read on pos.system_manifest;
create policy sync_manifest_read on pos.system_manifest for select to authenticated
  using (pos.is_active_admin() or pos.is_active_seller());
drop policy if exists sync_versions_read on pos.sync_domain_versions;
create policy sync_versions_read on pos.sync_domain_versions for select to authenticated
  using (pos.is_active_admin() or pos.is_active_seller());
drop policy if exists sync_devices_read on pos.sync_devices;
create policy sync_devices_read on pos.sync_devices for select to authenticated
  using (pos.is_active_admin() or user_id = auth.uid());
drop policy if exists sync_devices_insert on pos.sync_devices;
create policy sync_devices_insert on pos.sync_devices for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists sync_devices_update on pos.sync_devices;
create policy sync_devices_update on pos.sync_devices for update to authenticated
  using (pos.is_active_admin() or pos.is_active_seller())
  with check (user_id = auth.uid());

create or replace function pos.bump_sync_domain(p_domain text, p_device_id text default null)
returns bigint language plpgsql security definer
set search_path = pos, pg_temp
as $$
declare v_version bigint;
begin
  insert into pos.sync_domain_versions(domain, version, source_device_id, updated_at)
  values (p_domain, 1, p_device_id, now())
  on conflict(domain) do update set
    version = pos.sync_domain_versions.version + 1,
    source_device_id = excluded.source_device_id,
    updated_at = now()
  returning version into v_version;
  return v_version;
end;
$$;
revoke all on function pos.bump_sync_domain(text,text) from public, anon, authenticated;

create or replace function pos.touch_sync_domain()
returns trigger language plpgsql security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.bump_sync_domain(tg_argv[0], null);
  return null;
end;
$$;
revoke all on function pos.touch_sync_domain() from public, anon, authenticated;

do $$
declare r record; v_trigger text;
begin
  for r in select * from (values
    ('settings','config'), ('lookup','config'),
    ('products','products'), ('clients','clients'), ('sellers','sellers'),
    ('promotions','promotions'), ('sales','sales'), ('sale_items','sales'),
    ('sale_payments','payments'), ('returns','returns'), ('return_items','returns'),
    ('exchanges','exchanges'), ('exchange_items','exchanges'),
    ('loan_documents','loans'), ('liquidations','liquidations'),
    ('movements','movements'), ('permission_roles','permissions'),
    ('user_permission_role_assignments','permissions'),
    ('role_screen_permissions','permissions'),
    ('user_screen_permission_overrides','permissions'),
    ('role_capability_permissions','permissions'),
    ('user_capability_overrides','permissions'),
    ('test_data_purges','purges'), ('purged_documents','purges')
  ) as x(table_name, domain_name)
  loop
    if to_regclass('pos.' || r.table_name) is not null then
      v_trigger := 'h77_sync_' || r.table_name;
      execute format('drop trigger if exists %I on pos.%I', v_trigger, r.table_name);
      execute format('create trigger %I after insert or update or delete on pos.%I '
        || 'for each statement execute function pos.touch_sync_domain(%L)',
        v_trigger, r.table_name, r.domain_name);
    end if;
  end loop;
end $$;

-- Realtime es sólo el timbre. En instalaciones locales sin la publicación, no
-- se crea una paralela; Supabase la aporta en el proyecto enlazado.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='pos'
         and tablename='sync_domain_versions'
     ) then
    alter publication supabase_realtime add table pos.sync_domain_versions;
  end if;
end $$;

commit;
