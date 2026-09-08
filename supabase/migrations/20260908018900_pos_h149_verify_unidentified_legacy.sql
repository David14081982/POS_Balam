begin;
do $verification$
declare uid uuid:=gen_random_uuid(); ident text:='qa-h149-origin-'||uid::text;
 email text:=uid::text||'@h149.invalid'; op text:=gen_random_uuid()::text;
 epoch bigint; protocol integer; denied boolean; detail text;
begin
 begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active,comision_pct) values(ident,'QA H149',email,'admin',true,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(uid,'admin',true);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  select data_epoch,sync_protocol_current into epoch,protocol from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id,user_id,protocol_version,data_epoch,queue_pending)
   values(ident,uid,protocol,epoch,1),(ident||'-other',uid,protocol,epoch,0);
  insert into pos.sync_device_recoveries(device_id,owner_id,expected_count,source_epoch,protocol_version,
    minimum_build,candidate_ids,authorization_reason)
   values(ident,uid,1,epoch,protocol,'2026-09-08-h149',array[op],'H149 isolated identity verification authorization');
  perform set_config('request.headers','{}',true);
  perform set_config('pos.h149_rpc','',true);
  denied:=false;
  begin perform pos.commit_sale_checked(gen_random_uuid()::text,gen_random_uuid()::text,'{}','[]','[]','[]','[]',true,null,'[]');
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='RECOVERY_DEVICE_ID_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_UNREPORTED_REPLAY_ALLOWED'; end if;
  insert into pos.sync_activity(operation_id,device_id,user_id,operation_type,domain,status,summary)
   values(op,ident||'-other',uid,'sale','sales','pending','QA other device origin');
  -- A different ID is used: a discarded ID is rejected irrespective of origin.
  op:=gen_random_uuid()::text;
  insert into pos.sync_activity(operation_id,device_id,user_id,operation_type,domain,status,summary)
   values(op,ident||'-other',uid,'sale','sales','pending','QA known other device origin');
  perform pos.assert_device_recovery_write(null,array[op]);
  perform set_config('pos.h149_rpc','on',true);
  insert into pos.clients(id,nombre) values(ident,'Other identified legacy RPC projection');
  if not exists(select 1 from pos.clients where id=ident) then raise exception 'H149_OTHER_RPC_BLOCKED'; end if;
  perform set_config('pos.h149_rpc','',true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident||'-other')::text,true);
  perform pos.assert_device_recovery_write(null,array[gen_random_uuid()::text]);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident)::text,true);
  denied:=false;
  begin perform pos.assert_device_recovery_write(null,array[gen_random_uuid()::text]);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='DEVICE_RECOVERY_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_IDENTIFIED_TARGET_ALLOWED'; end if;
  raise sqlstate 'P0149' using message='rollback identity fixtures';
 exception when sqlstate 'P0149' then null;
 end;
 if exists(select 1 from auth.users where id=uid) or exists(select 1 from pos.clients where id=ident) then
  raise exception 'H149_IDENTITY_FIXTURE_ROLLBACK_FAILED'; end if;
 raise notice 'H149 PASS unreported finance denied, other legacy origin allowed, identified target denied, rollback';
end $verification$;
commit;
