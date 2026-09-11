-- H-159: real authority and negative-access verification, without business writes.
begin;
set transaction read only;
do $verification$
declare
  v_admin uuid; v_email text; v_preview jsonb; v_queue bigint; v_blocked bigint;
  v_unsynchronized bigint; v_clients bigint; v_epoch bigint;
  v_payload_before text; v_preserved_before text;
begin
  if has_function_privilege('anon','pos.point_zero_preview()','execute') then
    raise exception 'H159_PREVIEW_ANON_ACCESS';
  end if;
  if not has_function_privilege('authenticated','pos.point_zero_preview()','execute') then
    raise exception 'H159_PREVIEW_AUTHENTICATED_GRANT_MISSING';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='pos' and p.proname='point_zero_preview' and p.prosecdef
      and 'search_path=pg_catalog, pos'=any(p.proconfig)) then
    raise exception 'H159_PREVIEW_SECURITY_CONFIGURATION';
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.email','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform pos.point_zero_preview();
    raise exception 'H159_PREVIEW_MISSING_IDENTITY_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','15900000-0000-4000-8000-000000000099','email','h159-no-profile@example.test',
    'role','authenticated','aud','authenticated')::text,true);
  begin
    perform pos.point_zero_preview();
    raise exception 'H159_PREVIEW_MISSING_PROFILE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  select u.id,u.email into v_admin,v_email from auth.users u
    join pos.sellers s on lower(s.email)=lower(u.email)
    where s.role='admin' and s.active is true and s.deleted_at is null
    order by u.created_at limit 1;
  if v_admin is null then raise exception 'H159_VERIFICATION_ADMIN_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_admin,'email',v_email,'role','authenticated','aud','authenticated')::text,true);
  v_payload_before:=pos.point_zero_sha256(pos.point_zero_payload());
  v_preserved_before:=pos.point_zero_preserved_hash();
  v_preview:=pos.point_zero_preview();
  select data_epoch into strict v_epoch from pos.system_manifest where singleton;
  select coalesce(sum(queue_pending),0),coalesce(sum(queue_blocked),0)
    into v_queue,v_blocked from pos.sync_devices where status<>'revoked';
  select count(*) into v_unsynchronized from pos.sync_devices d
    where d.status<>'revoked' and (d.data_epoch<>v_epoch or d.queue_pending<>0
      or d.queue_blocked<>0 or d.status<>'online' or d.last_seen_at<now()-interval '2 minutes');
  select count(*) into v_clients from pos.clients where generic is not true and deleted_at is null;
  if (v_preview->>'queue_pending')::bigint<>v_queue
    or (v_preview->>'active_locks')::bigint<>v_blocked
    or (v_preview->>'unsynchronized_devices')::bigint<>v_unsynchronized
    or jsonb_array_length(v_preview->'blocked_devices')<>v_unsynchronized
    or (v_preview->'counts'->>'clientes')::bigint<>v_clients
    or (v_preview->>'sync_complete')::boolean is distinct from
      (v_queue=0 and v_blocked=0 and v_unsynchronized=0) then
    raise exception 'H159_PREVIEW_AUTHORITY_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(v_preview->'blocked_devices') d
    where d->>'status'='revoked' or jsonb_array_length(d->'reasons')=0) then
    raise exception 'H159_PREVIEW_INVALID_DEVICE_BLOCKER';
  end if;
  if v_payload_before<>pos.point_zero_sha256(pos.point_zero_payload())
    or v_preserved_before<>pos.point_zero_preserved_hash() then
    raise exception 'H159_READ_ONLY_VERIFICATION_CHANGED_DATA';
  end if;
  raise notice 'H159_PREVIEW authority=ok retired=excluded clients=active-only guards=preserved access=denied-without-admin business_writes=0';
end;
$verification$;
rollback;
