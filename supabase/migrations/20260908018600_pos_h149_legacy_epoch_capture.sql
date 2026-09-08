-- H149: the directive epoch is the upper fence; old queue epochs remain auditable.
-- A device heartbeat reports the current manifest, not each queued operation's epoch.
begin;
do $guard$ begin if md5(pg_get_functiondef('pos.capture_sync_device_recovery(text,uuid,jsonb)'::regprocedure))<>'7388db23c7abf7d7caa672cfab508234' then raise exception 'H149 capture drift'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.capture_sync_device_recovery(p_device_id text, p_recovery_id uuid, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare r pos.sync_device_recoveries%rowtype; ids text[]; clean jsonb;
begin
 perform pos.get_sync_device_recovery(p_device_id);
 select * into strict r from pos.sync_device_recoveries where device_id=p_device_id for update;
 if r.id<>p_recovery_id then raise exception 'RECOVERY_ID_MISMATCH'; end if;
 if r.state='completed' then return pos.get_sync_device_recovery(p_device_id); end if;
 if coalesce(p_evidence->>'build','') < r.minimum_build
  or coalesce((p_evidence->>'protocol')::integer,0)<>r.protocol_version
  or coalesce((p_evidence->>'epoch')::bigint,0)<>r.source_epoch
  or coalesce(p_evidence->>'queue_hash','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_evidence->'operations') is distinct from 'array' then
  raise exception 'RECOVERY_EVIDENCE_INVALID';
 end if;
 select array_agg(x->>'id' order by x->>'id'),jsonb_agg(jsonb_build_object(
  'id',x->>'id','type',left(x->>'type',60),'epoch',(x->>'epoch')::bigint,
  'protocol',(x->>'protocol')::integer) order by x->>'id') into ids,clean
 from jsonb_array_elements(p_evidence->'operations') x;
 if cardinality(ids) is distinct from r.expected_count or not ids <@ r.candidate_ids
  or (select count(distinct x) from unnest(ids) x)<>r.expected_count
  or exists(select 1 from jsonb_array_elements(clean) x where
   coalesce((x->>'epoch')::bigint,0) not between 1 and r.source_epoch
   or coalesce((x->>'protocol')::integer,0) not between 1 and r.protocol_version) then
  raise exception 'RECOVERY_SCOPE_MISMATCH';
 end if;
 clean:=jsonb_build_object('build',p_evidence->>'build','protocol',r.protocol_version,
  'epoch',r.source_epoch,'queue_hash',p_evidence->>'queue_hash','operations',clean);
 if r.state='captured' then
  if r.evidence<>clean then raise exception 'RECOVERY_CAPTURE_MISMATCH'; end if;
 else
  update pos.sync_device_recoveries set state='captured',evidence=clean,discarded_ids=ids
   where device_id=p_device_id;
 end if;
 return pos.get_sync_device_recovery(p_device_id);
end $function$
;
notify pgrst,'reload schema';
commit;
