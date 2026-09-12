-- H-160: verify real payload authority and access without business writes.
begin;
set transaction read only;
do $verification$
declare
  v_payload jsonb; v_preview jsonb; v_preserved text; v_internal text;
  v_admin uuid; v_email text; v_error text; v_signature text;
begin
  foreach v_signature in array array[
    'pos.point_zero_payload()',
    'pos.execute_point_zero(text,text,uuid,text,text,text)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute') then
      raise exception 'H160_ANON_EXECUTE: %',v_signature;
    end if;
    if not exists(select 1 from pg_proc p where p.oid=v_signature::regprocedure
      and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
      and 'search_path=pg_catalog, pos'=any(p.proconfig)) then
      raise exception 'H160_FUNCTION_SECURITY: %',v_signature;
    end if;
  end loop;
  if has_function_privilege('authenticated','pos.point_zero_payload()','execute')
    or not has_function_privilege('authenticated','pos.execute_point_zero(text,text,uuid,text,text,text)','execute')
    or has_function_privilege('authenticated','pos.h133_internal_enabled()','execute') then
    raise exception 'H160_AUTHENTICATED_GRANTS';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='pos.barcode_aliases'::regclass
    and tgname='h133_alias_immutable' and tgenabled='O'
    and tgfoid='pos.h133_alias_immutable()'::regprocedure) then
    raise exception 'H160_ALIAS_GUARD_MISSING';
  end if;
  if (select count(*) from pg_constraint where contype='f' and confrelid='pos.products'::regclass
    and conrelid in ('pos.barcode_aliases'::regclass,'pos.inventory_v1_v2_map'::regclass)
    and confdeltype='r' and convalidated)<>2 then
    raise exception 'H160_INVENTORY_RESTRICT_FK_MISSING';
  end if;
  v_preserved:=pos.point_zero_preserved_hash();
  v_internal:=coalesce(current_setting('pos.h133_internal',true),'');
  v_payload:=pos.point_zero_payload();
  if (select count(*) from jsonb_object_keys(v_payload))<>23
    or v_payload->'barcode_aliases' is distinct from
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.alias_code),'[]'::jsonb) from pos.barcode_aliases x)
    or v_payload->'inventory_v1_v2_map' is distinct from
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.source_v1_product_id,x.size_scale,x.raw_size_value),'[]'::jsonb) from pos.inventory_v1_v2_map x) then
    raise exception 'H160_BACKUP_PAYLOAD_INCOMPLETE';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.email','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform pos.execute_point_zero('h160-verification',null,null,'PUNTO CERO');
    raise exception 'H160_MISSING_IDENTITY_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','16000000-0000-4000-8000-000000000099','email','h160-no-profile@example.test',
    'role','authenticated','aud','authenticated')::text,true);
  begin
    perform pos.execute_point_zero('h160-verification',null,null,'PUNTO CERO');
    raise exception 'H160_MISSING_PROFILE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  select u.id,u.email into v_admin,v_email from auth.users u
    join pos.sellers s on lower(s.email)=lower(u.email)
    where s.role='admin' and s.active is true and s.deleted_at is null
    order by u.created_at limit 1;
  if v_admin is null then raise exception 'H160_VERIFICATION_ADMIN_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_admin,'email',v_email,'role','authenticated','aud','authenticated')::text,true);
  v_preview:=pos.point_zero_preview();
  if v_preview->>'snapshot_hash'<>pos.point_zero_sha256(v_payload) then
    raise exception 'H160_PREVIEW_PAYLOAD_HASH_MISMATCH';
  end if;
  begin
    perform pos.execute_point_zero('h160-verification',null,null,'INVALID');
    raise exception 'H160_CONFIRMATION_ACCEPTED';
  exception when raise_exception then
    get stacked diagnostics v_error=message_text;
    if v_error<>'point_zero_confirmation_required' then raise; end if;
  end;
  if pos.point_zero_preserved_hash()<>v_preserved
    or pos.point_zero_payload()<>v_payload
    or coalesce(current_setting('pos.h133_internal',true),'')<>v_internal then
    raise exception 'H160_READ_ONLY_VERIFICATION_CHANGED_STATE';
  end if;
  raise notice 'H160 payload=23-families FK=RESTRICT alias_guard=enabled grants=preserved unauthenticated=denied confirmation=required business_writes=0';
end $verification$;
rollback;
