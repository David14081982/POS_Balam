-- H164: execute the real PostgreSQL authority once per distinct guarantee.
-- Every fixture and state change lives in a subtransaction rolled back below.
begin;
do $verify$
declare
 migration_owner name:=current_user;
 actor uuid:='01640000-0000-4000-8000-000000000001';
 request_a uuid:='01640000-0000-4000-8000-000000000011';
 request_b uuid:='01640000-0000-4000-8000-000000000012';
 request_c uuid:='01640000-0000-4000-8000-000000000013';
 cancelled uuid:='01640000-0000-4000-8000-000000000014';
 command jsonb; response jsonb; repeated jsonb; quote_base jsonb; legacy_raw text; legacy_hash text; v bigint; f regprocedure;
begin
 -- New relations must have nominal revokes, RLS, and server-only evidence.
 foreach f in array array[
  'pos.online_request_context()'::regprocedure,'pos.assert_online_device()'::regprocedure,
  'pos.guard_online_commercial_write()'::regprocedure,'pos.online_check_rows(text,jsonb)'::regprocedure,
  'pos.online_save_entities(text,jsonb)'::regprocedure,'pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure,
  'pos.online_account_profile_command(jsonb)'::regprocedure,
  'pos.online_legacy_intents(jsonb,integer)'::regprocedure,'pos.classify_online_legacy(text,jsonb)'::regprocedure,
  'pos.prepare_online_account(uuid,uuid,jsonb,text)'::regprocedure,
  'pos.advance_online_account(uuid,uuid,text,uuid,jsonb)'::regprocedure,
  'pos.activate_online_only()'::regprocedure
 ] loop
  if has_function_privilege('authenticated',f,'execute') or has_function_privilege('anon',f,'execute') then
   raise exception 'H164_INTERNAL_FUNCTION_EXPOSED: %',f; end if;
 end loop;
 if has_table_privilege('authenticated','pos.online_requests','select')
  or has_table_privilege('anon','pos.online_requests','select')
  or has_table_privilege('authenticated','pos.online_legacy_archives','insert')
  or has_table_privilege('authenticated','pos.online_account_requests','select') then
  raise exception 'H164_RECEIPT_AUTHORITY_EXPOSED'; end if;
 if (select prosecdef from pg_proc where oid='pos.online_snapshot()'::regprocedure) then raise exception 'H164_SNAPSHOT_BYPASSES_RLS'; end if;
 begin
  if exists(select 1 from auth.users where id=actor or email='h164-sql-verify@invalid.test')
    or exists(select 1 from pos.clients where id in('h164-client','h164-rolled-back'))
    or exists(select 1 from pos.promotions where id='h164-promotion') then raise exception 'H164_FIXTURE_COLLISION'; end if;
  insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes)
   values(true,207,2,2,1,'{}') on conflict(singleton) do nothing;
  perform set_config('request.headers','{"x-balam-device-id":"qa-h164-sql","x-balam-client-build":"2026-09-11-h164"}',true);
  insert into auth.users(id,email) values(actor,'h164-sql-verify@invalid.test'),
   ('01640000-0000-4000-8000-000000000002','h164-no-profile@invalid.test'),
   ('01640000-0000-4000-8000-000000000003','h164-seller@invalid.test'),
   ('01640000-0000-4000-8000-000000000004','h164-inactive@invalid.test');
  insert into pos.sellers(id,nombre,email,role,active,comision_acum,ventas_mes,ventas_num)
   values(actor::text,'H164 verification','h164-sql-verify@invalid.test','admin',true,31,400,2);
  insert into pos.sellers(id,nombre,email,role,active) values
   ('01640000-0000-4000-8000-000000000003','H164 seller','h164-seller@invalid.test','vendedor',true),
   ('01640000-0000-4000-8000-000000000004','H164 inactive','h164-inactive@invalid.test','admin',false);
  insert into pos.permission_roles(code,name,active) values('h164_verify','H164 verification',true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(actor,'h164_verify',true);
  insert into pos.operational_capabilities(capability_key,description)
   select k,k from unnest(array['customers.create','customers.update','customers.delete','promotions.manage','sellers.manage','settings.manage','permissions.manage','inventory.adjust','inventory.delete']) k
   on conflict(capability_key) do nothing;
  insert into pos.role_capability_permissions(role_code,capability_key,allowed)
   select 'h164_verify',capability_key,true from pos.operational_capabilities;
  insert into pos.screen_permission_catalog(screen_key,parent_key,is_leaf,active,catalog_version)
   values('config.usuarios',null,true,true,1),('config.permisos',null,true,true,1) on conflict(screen_key) do nothing;
  insert into pos.role_screen_permissions(role_code,screen_key,allowed)
   values('h164_verify','config.usuarios',true),('h164_verify','config.permisos',true);
  insert into pos.config_commits(operation_id,payload_hash,committed_version,device_id)
   values('01640000-0000-4000-8000-000000000050',md5('[]'||E'\n'||'[]'),1,'qa-h164-sql');
  insert into pos.returns(id,folio,fecha,total,comisiones)
   values('h164-private-return','h164-private-origin','2026-01-02 10:00',5,jsonb_build_array(jsonb_build_object('sellerId',actor::text,'base',5)));
  insert into pos.liquidations(id,seller_id,tipo,fecha,monto)
   values('h164-private-cut',actor::text,'corte','2026-01-01 00:00',0);
  insert into pos.sync_devices(device_id,protocol_version,data_epoch,status,queue_pending,queue_blocked,last_seen_at)
   values('qa-h164-stale',1,0,'must_rebootstrap',99,1,now()-interval '1 day');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email','h164-sql-verify@invalid.test','role','authenticated')::text,true);
  response:=pos.online_presence('qa-h164-sql','2026-09-11-h164');
  if response->>'ok'<>'true' or pos.online_connectivity()->>'ok'<>'true' then raise exception 'H164_CONNECTIVITY'; end if;
  perform pos.activate_online_only();
  if to_regprocedure('pos.commit_legacy_return(text,jsonb,jsonb,jsonb,jsonb)') is not null
   or to_regprocedure('pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamp with time zone)') is not null
   or has_function_privilege('authenticated','pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
   or has_table_privilege('authenticated','pos.sales','truncate') then raise exception 'H164_LEGACY_WRITE_ROUTE_REMAINS'; end if;
  set local role authenticated;
  quote_base:=pos.online_quote_context();
  if pos.online_request_result(request_a)->>'found'<>'false' then raise exception 'H164_NEW_REQUEST_EXISTS'; end if;
  command:=jsonb_build_object('type','upsert','kind','clients','rows',jsonb_build_array(jsonb_build_object(
    'id','h164-client','nombre','Original','sync_base_version',0)));
  begin
   perform pos.execute_online_command('01640000-0000-4000-8000-000000000026',command||jsonb_build_object('expectedActorId','01640000-0000-4000-8000-000000000003'));
   raise exception 'H164_SESSION_CHANGED_WROTE';
  exception when insufficient_privilege then null; end;
  if pos.online_request_result('01640000-0000-4000-8000-000000000026')->>'found'<>'false' then raise exception 'H164_WRONG_ACTOR_RECEIPT'; end if;
  response:=pos.execute_online_command(request_a,command || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'true' then raise exception 'H164_CLIENT_CREATE: %',response; end if;
  -- Same request after the caller lost its answer: exact receipt, no second write.
  repeated:=pos.resolve_online_request(request_a);
  if repeated is distinct from response then raise exception 'H164_LOST_RESPONSE_RECEIPT'; end if;
  if pos.online_request_result(request_a)->'receipt' is distinct from response then raise exception 'H164_READ_ONLY_RECEIPT'; end if;
  repeated:=pos.execute_online_command(request_a,command || jsonb_build_object('expectedActorId',auth.uid()));
  if repeated is distinct from response then raise exception 'H164_IDEMPOTENT_RESULT'; end if;
  command:=jsonb_set(command,'{rows,0,nombre}','"Current"');
  command:=jsonb_set(command,'{rows,0,sync_base_version}','1');
  response:=pos.execute_online_command(request_b,command || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'true' then raise exception 'H164_CLIENT_EDIT: %',response; end if;
  command:=jsonb_set(command,'{rows,0,nombre}','"Obsolete"');
  response:=pos.execute_online_command(request_c,command || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or response#>>'{error,code}'<>'40001' then raise exception 'H164_CLIENT_CAS: %',response; end if;
  if (select nombre from pos.clients where id='h164-client')<>'Current' then raise exception 'H164_STALE_CLIENT_WROTE'; end if;
  -- Cancellation settles absence and fences a later arrival with the same UUID.
  response:=pos.resolve_online_request(cancelled);
  if response->>'notExecuted'<>'true' then raise exception 'H164_ABSENT_NOT_TERMINAL'; end if;
  repeated:=pos.execute_online_command(cancelled,jsonb_build_object('type','upsert','kind','clients','rows',jsonb_build_array(jsonb_build_object('id','h164-late','nombre','Late','sync_base_version',0))) || jsonb_build_object('expectedActorId',auth.uid()));
  if repeated is distinct from response or exists(select 1 from pos.clients where id='h164-late') then raise exception 'H164_LATE_REQUEST_COMMITTED'; end if;
  -- A failing second child rolls back the first; rejection is independently durable.
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000015',jsonb_build_object('type','batch','commands',jsonb_build_array(
   jsonb_build_object('type','upsert','kind','clients','rows',jsonb_build_array(jsonb_build_object('id','h164-rolled-back','nombre','Must rollback','sync_base_version',0))),
   jsonb_build_object('type','UNKNOWN'))) || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or exists(select 1 from pos.clients where id='h164-rolled-back') then raise exception 'H164_PARTIAL_BATCH'; end if;
  -- H156 also affects promotions; SQL must reject before the shared trigger.
  command:=jsonb_build_object('type','upsert','kind','promotions','rows',jsonb_build_array(jsonb_build_object('id','h164-promotion','nombre','Promotion','tipo','pct','valor',5,'sync_base_version',0)));
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000016',command || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'true' then raise exception 'H164_PROMOTION_CREATE: %',response; end if;
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000017',jsonb_set(command,'{rows,0,nombre}','"Stale"') || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or (select nombre from pos.promotions where id='h164-promotion')<>'Promotion' then raise exception 'H164_PROMOTION_CAS'; end if;
  -- A quote captured before another till changed promotions cannot be charged.
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000021',jsonb_build_object('type','sale','quoteContext',quote_base,'header',jsonb_build_object('folio','h164-obsolete-quote')) || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or response#>>'{error,message}'<>'COMMERCIAL_QUOTE_CHANGED'
   or exists(select 1 from pos.sales where folio='h164-obsolete-quote') then raise exception 'H164_STALE_QUOTE_CHARGED'; end if;
  -- Profile edits cannot overwrite server-owned commission/sales aggregates.
  select sync_version into v from pos.sellers where id=actor::text;
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000018',jsonb_build_object('type','profileUpdate','kind','sellers','rows',jsonb_build_array(jsonb_build_object(
   'id',actor::text,'nombre','Profile verified','sync_base_version',v,'comision_acum',99999,'ventas_mes',99999))) || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'true' or (select comision_acum<>31 or ventas_mes<>400 from pos.sellers where id=actor::text) then raise exception 'H164_PROFILE_MONEY: %',response; end if;
  begin
   update pos.clients set nombre='Direct' where id='h164-client';
   raise exception 'H164_DIRECT_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
  response:=pos.online_snapshot();
  if response->>'contractVersion'<>'1' or not response ?& array['products','sales','saleItems','returnItems','exchangeItems','payments','loans']
   or not exists(select 1 from jsonb_array_elements(response->'clients') x where x->>'id'='h164-client' and x->>'nombre'='Current') then
   raise exception 'H164_SNAPSHOT_AUTHORITY'; end if;
  response:=pos.point_zero_preview();
  if response->>'sync_complete'<>'true' or response->>'queue_pending'<>'0' or response->>'unsynchronized_devices'<>'0'
   or jsonb_array_length(response->'blocked_devices')<>0 then raise exception 'H164_POINT_ZERO_PHANTOM_BLOCK'; end if;
  execute format('set local role %I',migration_owner);
  response:=pos.test_data_cleanup_fleet_risk('{"selection_normalized":{},"blocked_reasons":["cleanup_not_synchronized"]}');
  if response->>'executable'<>'true' or response->>'queue_pending'<>'0' then raise exception 'H164_CLEANUP_PHANTOM_BLOCK'; end if;
  set local role authenticated;
  legacy_raw:='[{"type":"config","id":"01640000-0000-4000-8000-000000000050","lookup":[],"settings":[]},{"type":"upsert","id":"01640000-0000-4000-8000-000000000051","kind":"clients","rows":[]}]';
  execute format('set local role %I',migration_owner);
  legacy_hash:=encode(extensions.digest(convert_to(legacy_raw,'UTF8'),'sha256'),'hex');
  set local role authenticated;
  response:=pos.archive_online_legacy('qa-h164-sql',jsonb_build_array(jsonb_build_object('sourceKey','balam_legacy_verify','hash',legacy_hash,'kind','cache','original',legacy_raw)));
  if response->>'ok'<>'true' or response#>>'{entries,0,hash}'<>legacy_hash or response->>'replayed'<>'0' then raise exception 'H164_LEGACY_ARCHIVE'; end if;
  if pos.online_legacy_review_count()<>1 then raise exception 'H164_LEGACY_REVIEW_AUTHORITY'; end if;
  response:=pos.online_account_result('01640000-0000-4000-8000-000000000019');
  if response->>'state'<>'cancelled' then raise exception 'H164_ACCOUNT_ABSENCE_NOT_FENCED'; end if;
  execute format('set local role %I',migration_owner);
  response:=pos.prepare_online_account('01640000-0000-4000-8000-000000000019',actor,'{"action":"create","email":"h164-account@invalid.test"}','h164');
  if response->>'state'<>'cancelled' then raise exception 'H164_ACCOUNT_LATE_PREPARE'; end if;
  response:=pos.prepare_online_account('01640000-0000-4000-8000-000000000020',actor,'{"action":"create","email":"h164-account@invalid.test"}','h164');
  response:=pos.advance_online_account('01640000-0000-4000-8000-000000000020',actor,'auth_confirmed','01640000-0000-4000-8000-000000000099','{"ok":true}');
  if response->>'state'<>'auth_confirmed' then raise exception 'H164_ACCOUNT_RECEIPT_TRANSITION'; end if;
  -- Auth holds a frozen profile intent. Only that exact request may finish it;
  -- unrelated profile edits stay isolated while account confirmation is open.
  select sync_version into v from pos.sellers where id=actor::text;
  command:=jsonb_build_object('expectedActorId',actor,'type','profileUpdate','kind','sellers','accountRequestId','01640000-0000-4000-8000-000000000023',
   'rows',jsonb_build_array(jsonb_build_object('id',actor::text,'color','#164164','sync_base_version',v)));
  response:=pos.prepare_online_account('01640000-0000-4000-8000-000000000023',actor,
   jsonb_build_object('action','update','id',actor::text,'email','h164-sql-verify@invalid.test','profileCommand',command),'h164-profile');
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000024',command-'accountRequestId' || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or response#>>'{error,message}'<>'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' then raise exception 'H164_ACCOUNT_TARGET_UNPROTECTED'; end if;
  perform pos.advance_online_account('01640000-0000-4000-8000-000000000023',actor,'auth_confirmed',actor,'{"ok":true}');
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000025',command || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'true' or (select color from pos.sellers where id=actor::text)<>'#164164' then raise exception 'H164_ACCOUNT_PROFILE_CONFIRMATION: %',response; end if;
  -- Existing invoker reads work for a seller; no profile or inactive admin fail.
  quote_base:=pos.online_quote_context();
  perform set_config('request.jwt.claim.sub','01640000-0000-4000-8000-000000000003',true);
  perform set_config('request.jwt.claims','{"sub":"01640000-0000-4000-8000-000000000003","email":"h164-seller@invalid.test","role":"authenticated"}',true);
  set local role authenticated;
  response:=pos.online_snapshot();
  if response->>'contractVersion'<>'1' then raise exception 'H164_SELLER_SNAPSHOT'; end if;
  if response->'commercialQuote' is distinct from quote_base
   or jsonb_array_length(response->'returns')<>0 or jsonb_array_length(response->'liquidations')<>0
   or response#>>'{commissionContext,periodStart}'<>'2026-01-01'
   or not exists(select 1 from jsonb_array_elements(response#>'{commissionContext,sellerBases}') b where b->>'sellerId'=actor::text and (b->>'baseRaw')::numeric=-5)
   then raise exception 'H164_SELLER_COMMISSION_AGGREGATE'; end if;
  select sync_version into v from pos.sellers where id=actor::text;
  response:=pos.execute_online_command('01640000-0000-4000-8000-000000000090',jsonb_build_object('type','profileUpdate','kind','sellers','rows',jsonb_build_array(jsonb_build_object(
   'id',actor::text,'nombre','Unauthorized profile','sync_base_version',v))) || jsonb_build_object('expectedActorId',auth.uid()));
  if response->>'ok'<>'false' or response#>>'{error,code}'<>'42501'
   or (select nombre from pos.sellers where id=actor::text)<>'Profile verified' then raise exception 'H164_SELLER_CAPABILITY_BYPASS: %',response; end if;
  perform set_config('request.jwt.claim.sub','01640000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"01640000-0000-4000-8000-000000000002","email":"h164-no-profile@invalid.test","role":"authenticated"}',true);
  begin perform pos.online_snapshot(); raise exception 'H164_NO_PROFILE_READ_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform pos.execute_online_command(request_a,command || jsonb_build_object('expectedActorId',auth.uid())); raise exception 'H164_NO_PROFILE_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','01640000-0000-4000-8000-000000000004',true);
  perform set_config('request.jwt.claims','{"sub":"01640000-0000-4000-8000-000000000004","email":"h164-inactive@invalid.test","role":"authenticated"}',true);
  begin perform pos.online_snapshot(); raise exception 'H164_INACTIVE_READ_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform pos.execute_online_command(request_a,command || jsonb_build_object('expectedActorId',auth.uid())); raise exception 'H164_INACTIVE_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
  execute format('set local role %I',migration_owner);
  -- Anonymous and inactive identities never acquire commercial authority.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin
   perform pos.execute_online_command(request_a,command || jsonb_build_object('expectedActorId',auth.uid()));
   raise exception 'H164_ANON_GATEWAY_ALLOWED';
  exception when insufficient_privilege then null; end;
  execute format('set local role %I',migration_owner);
  -- Resolve the regprocedure as the migration owner: anon intentionally lacks
  -- schema USAGE, which is independently proved by the rejected call above.
  if has_function_privilege('anon','pos.online_snapshot()','execute') then raise exception 'H164_ANON_READ_ALLOWED'; end if;
  set local role service_role;
  response:=pos.activate_online_only();
  if response->>'ok'<>'true' then raise exception 'H164_SERVICE_ACTIVATION'; end if;
  execute format('set local role %I',migration_owner);
  raise exception using errcode='ZX164',message='H164_VERIFIED_ROLLBACK';
 exception when sqlstate 'ZX164' then null;
 end;
 if exists(select 1 from auth.users where id=actor) or exists(select 1 from pos.clients where id='h164-client')
  or exists(select 1 from pos.online_requests where actor_id=actor) then raise exception 'H164_FIXTURE_LEAK'; end if;
end $verify$;
commit;
