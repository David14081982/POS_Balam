-- H-77: configuración como un solo commit optimista e idempotente.
begin;

create table if not exists pos.config_sync_state (
  singleton boolean primary key default true check(singleton),
  version bigint not null default 0 check(version >= 0),
  updated_at timestamptz not null default now()
);
insert into pos.config_sync_state(singleton) values(true) on conflict do nothing;

create table if not exists pos.config_commits (
  operation_id text primary key,
  payload_hash text not null,
  committed_version bigint not null,
  device_id text,
  committed_at timestamptz not null default now()
);

alter table pos.config_sync_state enable row level security;
alter table pos.config_commits enable row level security;
revoke all on pos.config_sync_state, pos.config_commits from public, anon, authenticated;
grant select on pos.config_sync_state to authenticated;
create policy config_state_admin_read on pos.config_sync_state for select to authenticated
  using(pos.is_active_admin());

-- La configuración deja de aceptar snapshots directos: clientes anteriores
-- conservan lectura, pero no pueden evadir expected_version.
revoke insert, update, delete on pos.lookup, pos.settings from authenticated;

create or replace function pos.commit_config(
  p_operation_id text,
  p_expected_version bigint,
  p_device_id text,
  p_lookup jsonb,
  p_settings jsonb,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_manifest pos.system_manifest%rowtype;
  v_version bigint;
  v_hash text;
  v_prior pos.config_commits%rowtype;
begin
  if not pos.is_active_admin()
     or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='settings_manage_required';
  end if;
  if p_operation_id is null or p_operation_id='' then
    raise exception using errcode='22023', message='operation_id_required';
  end if;
  if jsonb_typeof(p_lookup) <> 'array' or jsonb_array_length(p_lookup)=0
     or jsonb_typeof(p_settings) <> 'array' then
    raise exception using errcode='22023', message='invalid_config_snapshot';
  end if;

  select * into v_manifest from pos.system_manifest where singleton for share;
  if p_protocol_version < v_manifest.sync_protocol_min
     or p_protocol_version > v_manifest.sync_protocol_current then
    raise exception using errcode='P0001', message='sync_protocol_outdated';
  end if;
  if p_data_epoch <> v_manifest.data_epoch then
    raise exception using errcode='P0001', message='rebootstrap_required';
  end if;

  v_hash := md5(p_lookup::text || E'\n' || p_settings::text);
  select * into v_prior from pos.config_commits where operation_id=p_operation_id;
  if found then
    if v_prior.payload_hash <> v_hash then
      raise exception using errcode='P0001', message='config_commit_mismatch';
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,
      'version',v_prior.committed_version,'data_epoch',v_manifest.data_epoch);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pos.config',0));
  select version into v_version from pos.config_sync_state where singleton for update;
  if coalesce(p_expected_version,0) <> v_version then
    return jsonb_build_object('ok',false,'error','config_version_conflict',
      'version',v_version,'data_epoch',v_manifest.data_epoch);
  end if;

  insert into pos.lookup(kind,code,label,active,meta,sort_order,updated_at)
  select x.kind,x.code,x.label,coalesce(x.active,true),coalesce(x.meta,'{}'::jsonb),
    coalesce(x.sort_order,0),now()
  from jsonb_to_recordset(p_lookup) as x(
    kind text, code text, label text, active boolean, meta jsonb, sort_order integer)
  on conflict(kind,code) do update set label=excluded.label, active=excluded.active,
    meta=excluded.meta, sort_order=excluded.sort_order, updated_at=now();

  delete from pos.lookup l where not exists(
    select 1 from jsonb_to_recordset(p_lookup) as x(kind text,code text)
    where x.kind=l.kind and x.code=l.code
  );

  insert into pos.settings(key,value,updated_at)
  select x.key,x.value,now()
  from jsonb_to_recordset(p_settings) as x(key text,value jsonb)
  on conflict(key) do update set value=excluded.value,updated_at=now();

  update pos.config_sync_state set version=version+1,updated_at=now()
  where singleton returning version into v_version;
  insert into pos.config_commits(operation_id,payload_hash,committed_version,device_id)
  values(p_operation_id,v_hash,v_version,p_device_id);
  return jsonb_build_object('ok',true,'idempotent',false,'version',v_version,
    'data_epoch',v_manifest.data_epoch);
end;
$$;

revoke all on function pos.commit_config(text,bigint,text,jsonb,jsonb,integer,bigint)
  from public, anon;
grant execute on function pos.commit_config(text,bigint,text,jsonb,jsonb,integer,bigint)
  to authenticated;

commit;
