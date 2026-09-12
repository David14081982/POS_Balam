-- H164 follow-up: candidate inventory is not authorization to discard.
-- Preserve original bytes; classify only the captured, explicit discard set.
begin;
set local lock_timeout='10s';
do $scope$
declare f text; marker text; replacement text;
begin
 f:=pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure);
 marker:='where recovery_row.candidate_ids && coalesce(p_operation_ids,''{}''::text[])';
 replacement:='where recovery_row.state in(''captured'',''completed'') and recovery_row.discarded_ids && coalesce(p_operation_ids,''{}''::text[])';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_RECOVERY_SCOPE_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.classify_online_legacy(text,jsonb)'::regprocedure);
 marker:='r.device_id=p_device_id and (oid=any(r.candidate_ids) or p_op->>''operationId''=any(r.candidate_ids))';
 replacement:='r.device_id=p_device_id and r.state in(''captured'',''completed'') and (oid=any(r.discarded_ids) or p_op->>''operationId''=any(r.discarded_ids))';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_CLASSIFY_SCOPE_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.archive_online_legacy(text,jsonb)'::regprocedure);
 marker:='r.device_id=p_device_id and oid=any(r.candidate_ids)';
 replacement:='r.device_id=p_device_id and r.state in(''captured'',''completed'') and oid=any(r.discarded_ids)';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_ARCHIVE_SCOPE_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);
end $scope$;

-- A journal or damaged wrapper without a recognizable intent is still evidence
-- requiring a decision. Do not hide it because the intent extractor found none.
create or replace function pos.online_legacy_review_count() returns bigint
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare d text;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 d:=(coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-device-id';
 return (select count(*) from pos.online_legacy_operations where actor_id=auth.uid() and device_id=d and classification='needs_review')
  +(select count(*) from pos.online_legacy_archives a where a.actor_id=auth.uid() and a.device_id=d and a.classification='needs_review'
    and not exists(select 1 from pos.online_legacy_intents(a.original)));
end $$;

-- No intake occurred before this correction in the reviewed rollout. This
-- conservative repair also protects installations applying the patch later:
-- an unsupported prior classification returns to review; originals never change.
update pos.online_legacy_operations o set classification='needs_review',
 evidence=o.evidence||jsonb_build_object('h164_scope_recheck','candidate_is_not_discard')
 where o.classification='authorized_discard' and o.evidence ? 'recoveryId'
  and not exists(select 1 from pos.sync_device_recoveries r where r.id::text=o.evidence->>'recoveryId'
   and r.state in('captured','completed') and (o.operation_id=any(r.discarded_ids) or o.original->>'operationId'=any(r.discarded_ids)));
update pos.online_legacy_archives a set classification='needs_review',
 evidence=a.evidence||jsonb_build_object('h164_scope_recheck','candidate_is_not_discard')
 where a.classification='authorized_discard' and a.evidence ? 'recoveryId'
  and not exists(select 1 from pos.sync_device_recoveries r where r.id::text=a.evidence->>'recoveryId'
   and r.state in('captured','completed') and a.operation_id=any(r.discarded_ids));
notify pgrst,'reload schema';
commit;
