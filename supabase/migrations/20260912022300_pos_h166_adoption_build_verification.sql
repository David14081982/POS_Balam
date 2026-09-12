-- H166: inherited role/owner/freshness/negative matrix exercised with H166.
-- Generated from 215; originals and fixtures roll back.
-- H164: one adoption lifecycle and one technical/real legacy intake scenario.
-- Auth matrix and invalid reports are bounded negative cases; fixtures roll back.
begin;
do $verify$
declare
 migration_owner name:=current_user; seller uuid:=gen_random_uuid(); admin uuid:=gen_random_uuid();
 inactive uuid:=gen_random_uuid(); unprofiled uuid:=gen_random_uuid();
 prefix text:='qa-h164-adoption-'||seller::text; d text:=prefix||'-seller'; ad text:=prefix||'-admin'; rd text:=prefix||'-retired';
 report jsonb; result jsonb; invalid jsonb; before_device jsonb; before_metadata jsonb;
 initial_runtime jsonb; initial_operations text; raw_ready text; raw_operation text; v_operation_id text:=gen_random_uuid()::text;
 expected integer:=0;
begin
 if has_function_privilege('anon','pos.online_adoption_report(text,jsonb)','execute')
  or not has_function_privilege('authenticated','pos.online_adoption_report(text,jsonb)','execute')
  or has_function_privilege('authenticated','pos.online_legacy_technical_kind(text,text,jsonb)','execute')
  or has_function_privilege('anon','pos.online_legacy_technical_kind(text,text,jsonb)','execute') then
  raise exception 'H164_ADOPTION_ACL'; end if;
 if exists(select 1 from pos.online_legacy_archives a where a.classification='needs_review' and a.operation_id is null
  and pos.online_legacy_technical_kind(a.device_id,a.source_key,a.original) is not null
  and not exists(select 1 from pos.online_legacy_intents(a.original))) then
  raise exception 'H164_TECHNICAL_HISTORY_BACKFILL_MISSING'; end if;
 if exists(select 1 from pos.online_legacy_archives a where a.evidence ? 'h164TechnicalHistory'
  and (a.original_hash is distinct from md5(a.original::text)
   or a.source_hash is distinct from encode(extensions.digest(convert_to(a.original#>>'{}','UTF8'),'sha256'),'hex')
   or a.classification<>'retained_history')) then raise exception 'H164_TECHNICAL_ORIGINAL_CHANGED'; end if;
 select to_jsonb(r) into initial_runtime from pos.online_runtime r where singleton;
 select md5(coalesce(jsonb_agg(to_jsonb(o) order by actor_id,device_id,operation_id,payload_hash)::text,'[]')) into initial_operations from pos.online_legacy_operations o;
 begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.headers','{}',true);
  -- Uncommitted seeding state; no other session observes it. Re-enable before RPCs.
  update pos.online_runtime set enabled=false where singleton;
  insert into auth.users(id,email) values(seller,prefix||'-seller@invalid.test'),(admin,prefix||'-admin@invalid.test'),
   (inactive,prefix||'-inactive@invalid.test'),(unprofiled,prefix||'-none@invalid.test');
  insert into pos.sellers(id,nombre,email,role,active) values
   (seller::text,prefix,prefix||'-seller@invalid.test','vendedor',true),
   (admin::text,prefix,prefix||'-admin@invalid.test','admin',true),
   (inactive::text,prefix,prefix||'-inactive@invalid.test','admin',false);
  insert into pos.clients(id,nombre) values(prefix,prefix);
  insert into pos.permission_roles(code,name,active) values(prefix,prefix,true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(admin,prefix,true);
  insert into pos.operational_capabilities(capability_key,description) values('customers.update','customers.update') on conflict do nothing;
  insert into pos.role_capability_permissions(role_code,capability_key,allowed) values(prefix,'customers.update',true);
  insert into pos.sync_devices(device_id,user_id,status,protocol_version,data_epoch,client_build,metadata) values
   (d,seller,'online',3,1,'2026-09-12-h166-online','{"preserved":true}'),
   (ad,admin,'online',3,1,'2026-09-12-h166-online','{"preserved":true}'),
   (rd,seller,'revoked',3,1,'2026-09-12-h166-online','{"preserved":true}');
  update pos.online_runtime set enabled=true where singleton;
  select to_jsonb(x)-'metadata' into before_device from pos.sync_devices x where device_id=d;
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'email',prefix||'-seller@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',d,'x-balam-client-build','2026-09-12-h166-online')::text,true);
  report:='{"revision":1,"state":"working","stage":"inventory","remainingLegacy":2,"archivedCount":0}';
  set local role authenticated;
  result:=pos.online_adoption_report(d,report);
  if result->>'ok'<>'true' or result->>'revision'<>'1' or result->>'state'<>'working' then raise exception 'H164_ADOPTION_WORKING'; end if;
  report:=report||'{"state":"failed","code":"SQL_42501"}'::jsonb;
  result:=pos.online_adoption_report(d,report);
  if result->>'state'<>'failed' then raise exception 'H164_ADOPTION_FAILED_STAGE'; end if;
  execute format('set local role %I',migration_owner);
  select metadata into before_metadata from pos.sync_devices where device_id=d;
  if before_metadata#>>'{online_adoption,stage}'<>'inventory' or before_metadata#>>'{online_adoption,code}'<>'SQL_42501'
   or before_metadata->>'preserved'<>'true' or (select to_jsonb(x)-'metadata' from pos.sync_devices x where device_id=d) is distinct from before_device then
   raise exception 'H164_ADOPTION_CHANGED_DEVICE_AUTHORITY'; end if;
  report:=jsonb_build_object('revision',1,'state','ready','stage','complete','remainingLegacy',0,'archivedCount',2,'snapshotAt',clock_timestamp());
  -- Each malformed class is tried once, and no rejection may replace the last diagnostic.
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
   report||'{"remainingLegacy":1}'::jsonb,
   report-'snapshotAt',
   report||jsonb_build_object('snapshotAt',clock_timestamp()-interval '10 minutes'),
   report||'{"stage":"snapshot"}'::jsonb,
   report||'{"code":"free form secret"}'::jsonb,
   report||'{"commercialPayload":{}}'::jsonb)) loop
   set local role authenticated;
   begin perform pos.online_adoption_report(d,invalid); raise exception 'H164_INVALID_ADOPTION_ACCEPTED';
   exception when invalid_parameter_value then expected:=expected+1; end;
   execute format('set local role %I',migration_owner);
  end loop;
  if expected<>6 or (select metadata from pos.sync_devices where device_id=d) is distinct from before_metadata then raise exception 'H164_ADOPTION_REJECTION_WROTE'; end if;
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',d,'x-balam-client-build','legacy-build')::text,true);
  set local role authenticated;
  begin perform pos.online_adoption_report(d,report); raise exception 'H164_OLD_BUILD_READY'; exception when invalid_parameter_value then null; end;
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ad,'x-balam-client-build','2026-09-12-h166-online')::text,true);
  begin perform pos.online_adoption_report(ad,report); raise exception 'H164_OTHER_DEVICE_REPORT'; exception when insufficient_privilege then null; end;
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',rd,'x-balam-client-build','2026-09-12-h166-online')::text,true);
  begin perform pos.online_adoption_report(rd,report); raise exception 'H164_RETIRED_DEVICE_REPORT'; exception when insufficient_privilege then null; end;
  -- An active administrator may report only its own installation.
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'email',prefix||'-admin@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ad,'x-balam-client-build','2026-09-12-h166-online')::text,true);
  result:=pos.online_adoption_report(ad,report);
  if result->>'ok'<>'true' or result->>'state'<>'ready' then raise exception 'H164_ADOPTION_READY'; end if;
  -- A ready report never grants a commercial write route.
  if not pos.current_has_capability('customers.update') then raise exception 'H164_ADOPTION_FENCE_FIXTURE_PERMISSION'; end if;
  begin update pos.clients set nombre='Forbidden' where id=prefix; raise exception 'H164_ADOPTION_GRANTED_COMMERCIAL_WRITE';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',inactive::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',inactive,'email',prefix||'-inactive@invalid.test','role','authenticated')::text,true);
  begin perform pos.online_adoption_report(ad,report); raise exception 'H164_INACTIVE_ADOPTION'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',unprofiled::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',unprofiled,'email',prefix||'-none@invalid.test','role','authenticated')::text,true);
  begin perform pos.online_adoption_report(ad,report); raise exception 'H164_UNPROFILED_ADOPTION'; exception when insufficient_privilege then null; end;
  execute format('set local role %I',migration_owner);
  set local role anon;
  begin perform pos.online_adoption_report(ad,report); raise exception 'H164_ANON_ADOPTION'; exception when insufficient_privilege then null; end;
  execute format('set local role %I',migration_owner);
  set local role service_role;
  begin perform pos.online_adoption_report(ad,report); raise exception 'H164_SERVICE_ADOPTION_EXPOSED'; exception when insufficient_privilege then null; end;
  execute format('set local role %I',migration_owner);
  -- Intake preserves two technical originals and one real unconfirmed descriptor.
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'email',prefix||'-seller@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',d,'x-balam-client-build','2026-09-12-h166-online')::text,true);
  raw_ready:=jsonb_build_object('device_id',d,'state','ready')::text;
  raw_operation:=jsonb_build_array(jsonb_build_object('id',v_operation_id,'type','upsert','kind','products','rows',jsonb_build_array(jsonb_build_object('id',prefix,'stock_quantity',1))))::text;
  if pos.online_legacy_technical_kind(d,'localStorage:balam_device_recovery_v1',to_jsonb(raw_ready))<>'technical_recovery_ready'
   or pos.online_legacy_technical_kind(d,'localStorage:balam_sync_queue',to_jsonb(' [] '::text))<>'empty_legacy_queue'
   or pos.online_legacy_technical_kind(d,'localStorage:balam_sync_queue',to_jsonb(raw_operation)) is not null
   or pos.online_legacy_technical_kind(d,'localStorage:balam_sync_queue',to_jsonb('{"queue":[]}'::text)) is not null
   or pos.online_legacy_technical_kind(d,'localStorage:balam_sync_queue',to_jsonb('[broken'::text)) is not null
   or pos.online_legacy_technical_kind(d,'localStorage:balam_device_recovery_v1',to_jsonb((raw_ready::jsonb||'{"operation":{}}'::jsonb)::text)) is not null then
   raise exception 'H164_TECHNICAL_SHAPE_CONFUSION'; end if;
  report:=jsonb_build_array(
   jsonb_build_object('sourceKey','localStorage:balam_device_recovery_v1','original',raw_ready,'kind','operation','hash',encode(extensions.digest(convert_to(raw_ready,'UTF8'),'sha256'),'hex')),
   jsonb_build_object('sourceKey','localStorage:balam_sync_queue','original','[]','kind','operation','hash',encode(extensions.digest(convert_to('[]','UTF8'),'sha256'),'hex')),
   jsonb_build_object('sourceKey','localStorage:balam_sync_queue','original',raw_operation,'kind','operation','hash',encode(extensions.digest(convert_to(raw_operation,'UTF8'),'sha256'),'hex')));
  set local role authenticated;
  result:=pos.archive_online_legacy(d,report);
  if result#>>'{entries,0,status}'<>'retained_history' or result#>>'{entries,1,status}'<>'retained_history'
   or result#>>'{entries,2,status}'<>'needs_review' or result->>'replayed'<>'0' or pos.online_legacy_review_count()<>1 then
   raise exception 'H164_TECHNICAL_INTAKE_CLASSIFICATION'; end if;
  execute format('set local role %I',migration_owner);
  if (select original from pos.online_legacy_archives where device_id=d and source_key='localStorage:balam_device_recovery_v1') is distinct from to_jsonb(raw_ready)
   or not exists(select 1 from pos.online_legacy_operations where device_id=d and operation_id=v_operation_id and classification='needs_review')
   or (select status from pos.sync_devices where device_id=rd)<>'revoked'
   or exists(select 1 from pos.products where id=prefix) then raise exception 'H164_INTAKE_OR_DEVICE_CHANGED'; end if;
  raise exception using errcode='ZA164',message='H164_ADOPTION_VERIFIED_ROLLBACK';
 exception when sqlstate 'ZA164' then null;
 end;
 if exists(select 1 from auth.users where id in(seller,admin,inactive,unprofiled))
  or exists(select 1 from pos.sync_devices where device_id in(d,ad,rd))
  or exists(select 1 from pos.online_legacy_archives where actor_id=seller)
  or (select to_jsonb(r) from pos.online_runtime r where singleton) is distinct from initial_runtime
  or (select md5(coalesce(jsonb_agg(to_jsonb(o) order by actor_id,device_id,operation_id,payload_hash)::text,'[]')) from pos.online_legacy_operations o) is distinct from initial_operations then
  raise exception 'H164_ADOPTION_FIXTURE_LEAK'; end if;
end $verify$;
commit;
