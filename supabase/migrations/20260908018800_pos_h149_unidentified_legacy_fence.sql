-- H149: no unreported legacy financial request can bypass the exact-device fence.
begin;
do $guard$ begin if md5(pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure))<>'a3ca63d4169c46700ccb893b28292c41' then raise exception 'H149 guard drift'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.assert_device_recovery_write(p_device_id text, p_operation_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare r pos.sync_device_recoveries%rowtype;
 h jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 d text := coalesce(nullif(p_device_id,''),h->>'x-balam-device-id');
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('pos.h149.recovery-fence',0));
 -- Legacy finance has no device argument. Resolve a uniquely reported origin,
 -- or the enclosing checked RPC. Missing identity can never bypass a directive.
 if d is null and coalesce(current_setting('pos.h149_rpc',true),'')='on' then
  d:=nullif(current_setting('pos.h149_device',true),'');
 end if;
 if d is null and cardinality(p_operation_ids)>0 then
  select min(device_id) into d from pos.sync_activity
   where operation_id=any(p_operation_ids) and user_id=auth.uid()
   having count(distinct device_id)=1;
 end if;
 if d is null and exists(select 1 from pos.sync_device_recoveries where owner_id=auth.uid()) then
  raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
   detail='RECOVERY_DEVICE_ID_REQUIRED';
 end if;
 perform set_config('pos.h149_device',coalesce(d,''),true);
 for r in select * from pos.sync_device_recoveries
  where device_id=d or candidate_ids && coalesce(p_operation_ids,'{}'::text[])
  order by device_id for share
 loop
  if r.candidate_ids && coalesce(p_operation_ids,'{}'::text[]) then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='TEST_PENDING_DISCARDED';
  end if;
  if r.state<>'completed' or h->>'x-balam-recovery-token' is distinct from r.write_token::text then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='DEVICE_RECOVERY_REQUIRED';
  end if;
 end loop;
end $function$
;
commit;
