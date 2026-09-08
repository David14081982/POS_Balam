begin;
do $verification$
declare uid uuid:=gen_random_uuid(); ident text:='qa-h149-delete-'||uid::text;
 email text:=uid::text||'@h149.invalid'; result jsonb; base bigint; denied boolean; detail text;
begin
 if (select prosecdef from pg_proc where oid='pos.soft_delete_entity(text,text,bigint,text)'::regprocedure)
  or has_function_privilege('authenticated','pos.assert_device_recovery_write(text,text[])','execute') then
  raise exception 'H149_DELETE_PRIVILEGE_EXPANSION'; end if;
 begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active,comision_pct) values(ident,'QA H149',email,'admin',true,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(uid,'admin',true);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  insert into pos.sync_devices(device_id,user_id,protocol_version,data_epoch,queue_pending) values(ident,uid,3,7,1);
  insert into pos.sync_device_recoveries(device_id,owner_id,expected_count,source_epoch,protocol_version,
    minimum_build,candidate_ids,authorization_reason)
   values(ident,uid,1,7,3,'2026-09-08-h149',array[gen_random_uuid()::text],'H149 isolated delete verification authorization');
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident||'-other')::text,true);
  insert into pos.clients(id,nombre,sync_device_id) values(ident,'QA delete guard',ident||'-other') returning sync_version into base;
  perform set_config('request.headers','{}',true);
  perform set_config('pos.h149_rpc','',true);
  perform set_config('role','authenticated',true);
  denied:=false;
  begin perform pos.soft_delete_entity('clients',ident,base,ident);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='DEVICE_RECOVERY_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_TARGET_DELETE_ALLOWED'; end if;
  result:=pos.soft_delete_entity('clients',ident,base,ident||'-other');
  if result->>'deleted_at' is null then raise exception 'H149_OTHER_DELETE_BLOCKED'; end if;
  perform set_config('role','postgres',true);
  raise sqlstate 'P0149' using message='rollback delete fixtures';
 exception when sqlstate 'P0149' then null;
 end;
 if exists(select 1 from auth.users where id=uid) or exists(select 1 from pos.clients where id=ident) then
  raise exception 'H149_DELETE_FIXTURE_ROLLBACK_FAILED'; end if;
 raise notice 'H149 PASS authenticated invoker delete, targeted denial, original RLS and private helper, rollback';
end $verification$;
commit;
