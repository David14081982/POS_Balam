-- H-154: behavior and role checks in a rollback-only subtransaction.
begin;
do $verification$
declare uid uuid:=gen_random_uuid(); ident text:='qa-h154-'||uid::text;
 email text:=uid::text||'@h154.invalid'; m pos.system_manifest; cursors jsonb;
 denied boolean; detail text; row_version bigint; result boolean; role_case text;
begin
 select * into m from pos.system_manifest where singleton;
 select jsonb_object_agg(domain,version) into cursors from pos.sync_domain_versions;
 if has_function_privilege('authenticated','pos.assert_device_recovery_write(text,text[])','execute')
    or has_function_privilege('anon','pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz)','execute') then
   raise exception 'H154_PRIVILEGE_EXPANSION';
 end if;
 begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active,comision_pct) values(ident,'QA H154',email,'admin',true,0);
  insert into pos.sellers(id,nombre,email,role,active,comision_pct) values
    (ident||'-vendor','QA H154 vendor',uid::text||'-vendor@h154.invalid','vendedor',true,0),
    (ident||'-inactive','QA H154 inactive',uid::text||'-inactive@h154.invalid','admin',false,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(uid,'admin',true);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  insert into pos.sync_devices(device_id,user_id,protocol_version,schema_version,data_epoch,queue_pending,status,last_seen_at)
   values(ident,uid,3,m.schema_version,m.data_epoch,7,'online','2000-01-01');
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident)::text,true);
  insert into pos.clients(id,nombre,sync_device_id) values(ident,'QA H154',ident) returning sync_version into row_version;
  perform set_config('role','authenticated',true);
  perform pos.admin_set_sync_device_retired(ident,true,'H154 isolated verification');
  result:=pos.report_sync_device(ident,'2026-09-10-h154',3,m.schema_version,m.data_epoch,cursors,7,0,'online',now());
  if result then raise exception 'H154_FALSE_RETIREMENT_ACK'; end if;
  denied:=false;
  begin update pos.sync_devices set status='online' where device_id=ident;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H154_DIRECT_REACTIVATION_ALLOWED: pos.protect_sync_device_retirement'; end if;
  if not exists(select 1 from pos.sync_devices where device_id=ident and status='revoked' and queue_pending=7 and last_seen_at>'2000-01-02') then
   raise exception 'H154_RETIRED_PRESENCE_OR_QUEUE_LOST'; end if;
  denied:=false;
  begin perform pos.soft_delete_entity('clients',ident,row_version,ident);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='DEVICE_RETIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H154_RETIRED_BUSINESS_WRITE_ALLOWED'; end if;
  perform pos.admin_set_sync_device_retired(ident,false,'H154 reactivate');
  denied:=false;
  begin perform pos.soft_delete_entity('clients',ident,row_version,ident);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='REBOOTSTRAP_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H154_REACTIVATION_WITHOUT_SYNC'; end if;
  perform pos.report_sync_device(ident,'2026-09-10-h154',3,m.schema_version,m.data_epoch,'{}',0,0,'online',now());
  if not exists(select 1 from pos.sync_devices where device_id=ident and status='must_rebootstrap') then raise exception 'H154_MISSING_CURSORS_ACCEPTED'; end if;
  perform set_config('role','postgres',true);
  select jsonb_object_agg(domain,version) into cursors from pos.sync_domain_versions;
  perform set_config('role','authenticated',true);
  perform pos.report_sync_device(ident,'2026-09-10-h154',3,m.schema_version,m.data_epoch,cursors,0,0,'online',now());
  perform pos.soft_delete_entity('clients',ident,row_version,ident);
  if not exists(select 1 from pos.clients where id=ident and deleted_at is not null) then raise exception 'H154_REACTIVATED_WRITE_REJECTED'; end if;
  perform set_config('role','postgres',true);
  -- All non-admin profiles must fail before a retirement changes anything.
  update pos.system_manifest set minimum_client_build='2026-09-10-h154' where singleton;
  foreach role_case in array array['2026-09-10-h99','2026-09-09-h999','legacy'] loop
   perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident,'x-balam-client-build',role_case)::text,true);
   denied:=false;
   begin perform pos.assert_device_recovery_write(ident,array[ident||'-new-operation']);
   exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
    if detail='SYNC_PROTOCOL_OUTDATED' then denied:=true; else raise; end if; end;
   if not denied then raise exception 'H154_MINIMUM_BUILD_BYPASSED: %',role_case; end if;
  end loop;
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident,'x-balam-client-build','2026-09-10-h154')::text,true);
  perform pos.assert_device_recovery_write(ident,array[ident||'-new-operation']);
  update pos.system_manifest set minimum_client_build=m.minimum_client_build where singleton;
  update pos.user_permission_role_assignments set active=false where user_id=uid;
  foreach role_case in array array['no_profile','vendor','inactive_admin'] loop
   perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',uid::text||
      case when role_case='vendor' then '-vendor' when role_case='inactive_admin' then '-inactive' else '-none' end
      ||'@h154.invalid','role','authenticated')::text,true);
   perform set_config('role','authenticated',true);
   denied:=false;
   begin perform pos.admin_set_sync_device_retired(ident,true,'must deny');
   exception when insufficient_privilege then denied:=true; end;
   if not denied then raise exception 'H154_NON_ADMIN_RETIREMENT: %',role_case; end if;
   perform set_config('role','postgres',true);
  end loop;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('role','anon',true);
  denied:=false;
  begin perform pos.admin_set_sync_device_retired(ident,true,'must deny');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H154_ANON_RETIREMENT'; end if;
  perform set_config('role','postgres',true);
  perform set_config('role','service_role',true);
  if not exists(select 1 from pos.sync_devices where device_id=ident) then raise exception 'H154_SERVICE_OBSERVATION'; end if;
  perform set_config('role','postgres',true);
  raise sqlstate 'P0154' using message='rollback H154 fixtures';
 exception when sqlstate 'P0154' then null;
 end;
 if exists(select 1 from pos.sync_devices where device_id=ident)
    or exists(select 1 from auth.users where id=uid) then raise exception 'H154_FIXTURE_ROLLBACK_FAILED'; end if;
 raise notice 'H154 PASS durable retirement, live presence, real invoker write fence, reactivation proof, roles and rollback';
end $verification$;
commit;
