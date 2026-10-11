-- H186: PostgREST runs STABLE RPCs in READ ONLY transactions. Admission for a
-- quote therefore reads device state without the write gateway's FOR SHARE.
-- The financial calculator, its STABLE snapshot and the write guard stay intact.
begin;
set local lock_timeout='10s';

create function pos.h186_assert_quote_device() returns text
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare
 h jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 d text:=nullif(h->>'x-balam-device-id','');
 v_device pos.sync_devices%rowtype;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then
  raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED';
 end if;
 if d is null then raise exception using errcode='22023',message='DEVICE_ID_REQUIRED'; end if;
 select * into v_device from pos.sync_devices where device_id=d;
 if not found then raise exception using errcode='22023',message='DEVICE_REGISTRATION_REQUIRED'; end if;
 if v_device.status='revoked' then raise exception using errcode='42501',message='DEVICE_RETIRED'; end if;
 return d;
end $$;
revoke all on function pos.h186_assert_quote_device() from public,anon,authenticated,service_role;

do $h186_quote_readonly$
declare
 old_quote pg_proc%rowtype;
 old_guard pg_proc%rowtype;
 new_quote pg_proc%rowtype;
 quote_definition text;
 guard_definition text;
 anchor constant text:='perform pos.assert_online_device();';
 replacement constant text:='perform pos.h186_assert_quote_device();';
 prior_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 prior_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 select * into strict old_quote from pg_proc where oid='pos.quote_sale(jsonb,jsonb,boolean)'::regprocedure;
 select * into strict old_guard from pg_proc where oid='pos.assert_online_device()'::regprocedure;
 guard_definition:=pg_get_functiondef(old_guard.oid);
 if md5(btrim(replace(old_quote.prosrc,E'\r\n',E'\n'),E' \t\r\n'))<>'044ff1e45ca76db0f4d9c287af531319'
  or old_quote.provolatile<>'s' or not old_quote.prosecdef
  or length(old_quote.prosrc)-length(replace(old_quote.prosrc,anchor,''))<>length(anchor) then
  raise exception 'H186_QUOTE_READONLY_SOURCE_DRIFT';
 end if;
 -- The new admission guard must be byte-for-byte the old validation body with
 -- only its single row-lock clause removed; no authorization condition drifts.
 if length(old_guard.prosrc)-length(replace(old_guard.prosrc,' for share;',''))<>length(' for share;')
  or (select prosrc from pg_proc where oid='pos.h186_assert_quote_device()'::regprocedure)
    is distinct from replace(old_guard.prosrc,' for share;',';') then
  raise exception 'H186_QUOTE_DEVICE_VALIDATION_DRIFT';
 end if;
 quote_definition:=replace(pg_get_functiondef(old_quote.oid),anchor,replacement);
 execute quote_definition;
 select * into strict new_quote from pg_proc where oid=old_quote.oid;
 if new_quote.prosrc is distinct from replace(old_quote.prosrc,anchor,replacement)
  or new_quote.provolatile is distinct from old_quote.provolatile
  or new_quote.prosecdef is distinct from old_quote.prosecdef
  or new_quote.proconfig is distinct from old_quote.proconfig
  or new_quote.proacl is distinct from old_quote.proacl
  or new_quote.proowner is distinct from old_quote.proowner
  or pg_get_functiondef(old_guard.oid) is distinct from guard_definition then
  raise exception 'H186_QUOTE_READONLY_CONTRACT_CHANGED';
 end if;
 if (select provolatile<>'s' or not prosecdef or proconfig is distinct from
   array['search_path=pg_catalog, pos, auth']::text[] from pg_proc
   where oid='pos.h186_assert_quote_device()'::regprocedure)
  or has_function_privilege('anon','pos.h186_assert_quote_device()','execute')
  or has_function_privilege('authenticated','pos.h186_assert_quote_device()','execute')
  or has_function_privilege('service_role','pos.h186_assert_quote_device()','execute')
  or has_function_privilege('anon','pos.quote_sale(jsonb,jsonb,boolean)','execute')
  or not has_function_privilege('authenticated','pos.quote_sale(jsonb,jsonb,boolean)','execute')
  or not has_function_privilege('service_role','pos.quote_sale(jsonb,jsonb,boolean)','execute') then
  raise exception 'H186_QUOTE_READONLY_PRIVILEGE_DRIFT';
 end if;
 -- Self-contained behavior checks create no Auth, device or commercial seeds.
 -- Both entry points must reject missing identity with their original errors.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform pos.h186_assert_quote_device();
  raise exception 'H186_QUOTE_DEVICE_MISSING_AUTH_ACCEPTED';
 exception when insufficient_privilege then
  if sqlerrm<>'ACTIVE_PROFILE_REQUIRED' then raise; end if;
 end;
 begin
  perform pos.quote_sale('[]'::jsonb,'[]'::jsonb,false);
  raise exception 'H186_QUOTE_MISSING_AUTH_ACCEPTED';
 exception when insufficient_privilege then
  if sqlerrm not like 'CAPABILITY_REQUIRED:%' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',prior_sub,true);
 perform set_config('request.jwt.claims',prior_claims,true);
end $h186_quote_readonly$;

notify pgrst,'reload schema';
commit;
