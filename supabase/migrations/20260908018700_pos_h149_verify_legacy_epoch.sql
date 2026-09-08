begin;
do $verification$
declare uid uuid:=gen_random_uuid(); ident text:='qa-h149-epoch-'||uid::text;
 email text:=uid::text||'@h149.invalid'; op text:=gen_random_uuid()::text;
 rid uuid; epoch bigint; protocol integer; evidence jsonb; result jsonb; denied boolean;
begin
 begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active,comision_pct) values(ident,'QA H149',email,'admin',true,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(uid,'admin',true);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  select data_epoch,sync_protocol_current into epoch,protocol from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id,user_id,protocol_version,data_epoch,queue_pending) values(ident,uid,protocol,epoch,1);
  insert into pos.sync_device_recoveries(device_id,owner_id,expected_count,source_epoch,protocol_version,
    minimum_build,candidate_ids,authorization_reason)
   values(ident,uid,1,epoch,protocol,'2026-09-08-h149',array[op],'H149 isolated verification authorization') returning id into rid;
  evidence:=jsonb_build_object('build','2026-09-08-h149','protocol',protocol,'epoch',epoch,
   'queue_hash',repeat('b',64),'operations',jsonb_build_array(jsonb_build_object('id',op,'type','sale',
    'epoch',epoch+1,'protocol',protocol)));
  denied:=false;
  begin perform pos.capture_sync_device_recovery(ident,rid,evidence);
  exception when raise_exception then if SQLERRM='RECOVERY_SCOPE_MISMATCH' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_FUTURE_EPOCH_ACCEPTED'; end if;
  evidence:=jsonb_set(evidence,'{operations,0,epoch}',to_jsonb(greatest(1,epoch-1)));
  result:=pos.capture_sync_device_recovery(ident,rid,evidence);
  if result->>'state'<>'captured' or (result#>>'{evidence,operations,0,epoch}')::bigint<>greatest(1,epoch-1) then
   raise exception 'H149_LEGACY_EPOCH_NOT_CAPTURED';
  end if;
  raise sqlstate 'P0149' using message='rollback epoch fixtures';
 exception when sqlstate 'P0149' then null;
 end;
 if exists(select 1 from auth.users where id=uid) or exists(select 1 from pos.sync_device_recoveries where device_id=ident) then
  raise exception 'H149_EPOCH_FIXTURE_ROLLBACK_FAILED'; end if;
 raise notice 'H149 PASS older queued epoch retained, future epoch denied, rollback';
end $verification$;
commit;
