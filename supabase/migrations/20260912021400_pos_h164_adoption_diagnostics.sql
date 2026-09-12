-- H164: bounded adoption telemetry, never a grant of commercial authority.
-- Recognize only proven empty/technical legacy shapes; preserve every original.
begin;
set local lock_timeout='10s';

create function pos.online_adoption_report(p_device_id text,p_report jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare
 d pos.sync_devices%rowtype; h jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 v_now timestamptz:=clock_timestamp(); v_snapshot timestamptz; v_report jsonb;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then
  raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if nullif(p_device_id,'') is null or p_device_id is distinct from h->>'x-balam-device-id' then
  raise exception 'DEVICE_ID_REQUIRED' using errcode='22023'; end if;
 select * into d from pos.sync_devices where device_id=p_device_id for update;
 if not found then raise exception 'DEVICE_REGISTRATION_REQUIRED' using errcode='22023'; end if;
 if d.user_id is distinct from auth.uid() then raise exception 'ADOPTION_DEVICE_OWNER_REQUIRED' using errcode='42501'; end if;
 if d.status='revoked' then raise exception 'DEVICE_RETIRED' using errcode='42501'; end if;
 if jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>4096
  or not p_report ?& array['revision','state','stage','remainingLegacy','archivedCount']
  or exists(select 1 from jsonb_object_keys(p_report) k where k<>all(array['revision','state','stage','code','remainingLegacy','archivedCount','snapshotAt']))
  or p_report->'revision' is distinct from '1'::jsonb
  or coalesce(p_report->>'state','') not in('working','ready','failed')
  or coalesce(p_report->>'stage','') not in('presence','inventory','permissions','snapshot','complete')
  or jsonb_typeof(p_report->'remainingLegacy') is distinct from 'number'
  or jsonb_typeof(p_report->'archivedCount') is distinct from 'number'
  or coalesce(p_report->>'remainingLegacy','') !~ '^[0-9]{1,7}$'
  or coalesce(p_report->>'archivedCount','') !~ '^[0-9]{1,7}$' then
  raise exception 'INVALID_ADOPTION_REPORT' using errcode='22023'; end if;
 if p_report ? 'code' and (jsonb_typeof(p_report->'code') is distinct from 'string'
  or p_report->>'code' !~ '^[A-Z][A-Z0-9_]{0,63}$') then
  raise exception 'INVALID_ADOPTION_CODE' using errcode='22023'; end if;
 if p_report ? 'snapshotAt' then
  if jsonb_typeof(p_report->'snapshotAt') is distinct from 'string'
   or p_report->>'snapshotAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise exception 'INVALID_ADOPTION_SNAPSHOT_TIME' using errcode='22023'; end if;
  begin v_snapshot:=(p_report->>'snapshotAt')::timestamptz;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'INVALID_ADOPTION_SNAPSHOT_TIME' using errcode='22023'; end;
 end if;
 if p_report->>'state'='ready' and (p_report->>'stage'<>'complete' or (p_report->>'remainingLegacy')::integer<>0
  or d.client_build is distinct from '2026-09-12-h164-online'
  or h->>'x-balam-client-build' is distinct from '2026-09-12-h164-online'
  or v_snapshot is null or v_snapshot<v_now-interval '5 minutes' or v_snapshot>v_now+interval '5 seconds') then
  raise exception 'ADOPTION_READY_PRECONDITIONS' using errcode='22023'; end if;
 v_report:=p_report||jsonb_build_object('serverTime',v_now);
 update pos.sync_devices set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('online_adoption',v_report)
  where device_id=p_device_id;
 return jsonb_build_object('ok',true,'revision',1,'state',p_report->>'state','serverTime',v_now);
end $$;
revoke all on function pos.online_adoption_report(text,jsonb) from public,anon,authenticated;
grant execute on function pos.online_adoption_report(text,jsonb) to authenticated;
comment on function pos.online_adoption_report(text,jsonb) is
 'Client-reported adoption telemetry only. A recent echoed snapshot time is not independent proof of browser storage or permission to write commercially.';

create function pos.online_legacy_technical_kind(p_device_id text,p_source_key text,p_original jsonb) returns text
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare raw text; decoded jsonb;
begin
 if nullif(p_device_id,'') is null or jsonb_typeof(p_original) is distinct from 'string'
  or p_source_key not in('localStorage:balam_device_recovery_v1','localStorage:balam_sync_queue') then return null; end if;
 raw:=p_original#>>'{}';
 if octet_length(raw)>4096 then return null; end if;
 begin decoded:=raw::jsonb; exception when invalid_text_representation then return null; end;
 if p_source_key='localStorage:balam_sync_queue' and decoded='[]'::jsonb then return 'empty_legacy_queue'; end if;
 if p_source_key='localStorage:balam_device_recovery_v1' and jsonb_typeof(decoded)='object'
  and decoded ?& array['device_id','state']
  and not exists(select 1 from jsonb_object_keys(decoded) k where k<>all(array['device_id','state']))
  and jsonb_typeof(decoded->'device_id')='string' and decoded->>'device_id'=p_device_id
  and decoded->>'state'='ready' then return 'technical_recovery_ready'; end if;
 return null;
end $$;
revoke all on function pos.online_legacy_technical_kind(text,text,jsonb) from public,anon,authenticated;
comment on function pos.online_legacy_technical_kind(text,text,jsonb) is
 'Exact H163 storage contracts: an empty queue array, or same-device recovery ready with exactly two technical keys. Unknown, malformed and nonempty sources remain reviewable.';

-- Generate from the live definition. Preserve exact discard/receipt semantics.
do $intake$
declare f text; marker text; replacement text;
begin
 f:=pg_get_functiondef('pos.archive_online_legacy(text,jsonb)'::regprocedure);
 marker:='if ev is not null then cls:=''authorized_discard''; end if;';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1
  or position('r.state in(''captured'',''completed'') and oid=any(r.discarded_ids)' in f)=0 then
  raise exception 'H164_TECHNICAL_ARCHIVE_SOURCE_DRIFT'; end if;
 replacement:=marker||$body$
  if oid is null and cls='needs_review'
   and pos.online_legacy_technical_kind(p_device_id,e->>'sourceKey',e->'original') is not null then
   cls:='retained_history';
   ev:=coalesce(ev,'{}'::jsonb)||jsonb_build_object('h164TechnicalHistory',jsonb_build_object('revision',1,
    'reason',pos.online_legacy_technical_kind(p_device_id,e->>'sourceKey',e->'original'),
    'classifiedAt',clock_timestamp(),'previousClassification','needs_review'));
  end if;
$body$;
 execute replace(f,marker,replacement);
end $intake$;

-- Repair only structurally proven technical sources. Never touch operation rows,
-- originals, hashes, receipts, devices' retirement, or the real unconfirmed lot.
update pos.online_legacy_archives a set classification='retained_history',
 evidence=coalesce(a.evidence,'{}'::jsonb)||jsonb_build_object('h164TechnicalHistory',jsonb_build_object('revision',1,
  'reason',pos.online_legacy_technical_kind(a.device_id,a.source_key,a.original),
  'classifiedAt',clock_timestamp(),'previousClassification',a.classification))
where a.classification='needs_review' and a.operation_id is null
 and pos.online_legacy_technical_kind(a.device_id,a.source_key,a.original) is not null
 and not exists(select 1 from pos.online_legacy_intents(a.original));
notify pgrst,'reload schema';
commit;
