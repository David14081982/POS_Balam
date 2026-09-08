-- Real SQL behavior; every fixture is rolled back by the inner subtransaction.
begin;
do $verification$
declare uid uuid:=gen_random_uuid(); ident text:='qa-h149-'||uid::text;
 email text:=uid::text||'@h149.invalid'; rid uuid; op text:=gen_random_uuid()::text;
 result jsonb; evidence jsonb; cursors jsonb; epoch bigint; protocol integer;
 denied boolean; detail text; before_hash text; after_hash text; n integer:=0;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) into before_hash from pos.products p;
 if has_function_privilege('anon','pos.get_sync_device_recovery(text)','execute')
  or has_function_privilege('authenticated','pos.assert_device_recovery_write(text,text[])','execute')
  or has_table_privilege('authenticated','pos.sync_device_recoveries','insert,update,delete')
  or has_column_privilege('authenticated','pos.sync_device_recoveries','write_token','select')
  or has_column_privilege('anon','pos.sync_device_recoveries','device_id','select') then
  raise exception 'H149_EXCESS_PRIVILEGE';
 end if;
 n:=n+1;
 begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into pos.sellers(id,nombre,email,role,active,comision_pct)
   values(ident,'QA H149',email,'admin',true,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(uid,'admin',true);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  select data_epoch,sync_protocol_current into epoch,protocol from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id,user_id,client_build,protocol_version,data_epoch,queue_pending)
   values(ident,uid,'2026-09-07-h142',protocol,epoch,1);
  insert into pos.sync_activity(operation_id,device_id,user_id,operation_type,domain,status,summary)
   values(op,ident,uid,'sale','sales','pending','QA H149 authorized pending');
  rid:=pos.prepare_sync_device_recovery(ident,1,epoch,protocol,'2026-09-08-h149','Authorized isolated H149 verification fixture');
  result:=pos.get_sync_device_recovery(ident);
  if result->>'state'<>'pending' or result->>'write_token' is not null then raise exception 'H149_PENDING_TOKEN'; end if;
  n:=n+1;
  denied:=false;
  begin perform pos.prepare_sync_device_recovery(ident,1,epoch,protocol,'2026-09-08-h149','Authorized isolated H149 verification fixture');
  exception when raise_exception then if SQLERRM='RECOVERY_ALREADY_PREPARED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_REARM_ALLOWED'; end if; n:=n+1;
  -- Empty headers model the actual legacy RPC contract. Bad payload is deliberate:
  -- the fence must win before business validation, stock reservation or an ACK.
  perform set_config('request.headers','{}',true);
  denied:=false;
  begin perform pos.commit_sale_checked(op,op,'{}','[]','[]','[]','[]',true,null,'[]');
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='TEST_PENDING_DISCARDED' then denied:=true; else raise; end if; end;
  if not denied or exists(select 1 from pos.sale_commits where operation_id=op) then raise exception 'H149_LEGACY_REPLAY_ALLOWED'; end if; n:=n+1;
  denied:=false;
  begin perform pos.reserve_sale_stock(op,ident,'[]');
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='TEST_PENDING_DISCARDED' then denied:=true; else raise; end if; end;
  if not denied or exists(select 1 from pos.stock_reservations where operation_id=op) then raise exception 'H149_STOCK_REPLAY_ALLOWED'; end if; n:=n+1;
  denied:=false;
  begin perform pos.commit_config(gen_random_uuid()::text,0,ident,'[]','[]',protocol,epoch);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='DEVICE_RECOVERY_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_CONFIG_REPLAY_ALLOWED'; end if; n:=n+1;
  perform set_config('pos.h149_rpc','',true);
  denied:=false;
  begin insert into pos.clients(id,nombre,sync_device_id) values(ident,'Legacy forbidden',ident);
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='DEVICE_RECOVERY_REQUIRED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_DIRECT_WRITE_ALLOWED'; end if; n:=n+1;
  -- A different device of the same account remains writable.
  perform pos.assert_device_recovery_write(ident||'-other',array[gen_random_uuid()::text]); n:=n+1;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  denied:=false;
  begin perform pos.get_sync_device_recovery(ident); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H149_UNPROFILED_ACCESS'; end if; n:=n+1;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  update pos.sellers set active=false where id=ident;
  denied:=false;
  begin perform pos.get_sync_device_recovery(ident); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H149_INACTIVE_ACCESS'; end if; n:=n+1;
  update pos.sellers set active=true,role='vendedor' where id=ident;
  result:=pos.get_sync_device_recovery(ident);
  if result->>'state'<>'pending' then raise exception 'H149_OWNER_SELLER_READ'; end if; n:=n+1;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  update pos.sellers set role='admin' where id=ident;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
  evidence:=jsonb_build_object('build','2026-09-08-h149','protocol',protocol,'epoch',epoch,
   'queue_hash',repeat('a',64),'operations',jsonb_build_array(jsonb_build_object('id',op,'type','sale','epoch',epoch,'protocol',protocol)),
   'secret','must never persist');
  result:=pos.capture_sync_device_recovery(ident,rid,evidence);
  if result->>'state'<>'captured' or (result->'evidence')?'secret' then raise exception 'H149_EVIDENCE_CAPTURE'; end if; n:=n+1;
  result:=pos.capture_sync_device_recovery(ident,rid,evidence);
  if result->>'state'<>'captured' then raise exception 'H149_CAPTURE_RETRY'; end if; n:=n+1;
  denied:=false;
  begin perform pos.complete_sync_device_recovery(ident,rid,'{}',epoch,protocol,0);
  exception when raise_exception then if SQLERRM='RECOVERY_NOT_CONVERGED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_FALSE_CONVERGENCE'; end if; n:=n+1;
  select jsonb_object_agg(domain,version) into cursors from pos.sync_domain_versions;
  result:=pos.complete_sync_device_recovery(ident,rid,cursors,epoch,protocol,0);
  if result->>'state'<>'completed' or result->>'write_token' is null then raise exception 'H149_COMPLETION'; end if; n:=n+1;
  if pos.complete_sync_device_recovery(ident,rid,cursors,epoch,protocol,0)<>result then raise exception 'H149_COMPLETION_RETRY'; end if; n:=n+1;
  denied:=false;
  begin perform pos.commit_sale_checked(op,op,'{}','[]','[]','[]','[]',true,null,'[]');
  exception when raise_exception then get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
   if detail='TEST_PENDING_DISCARDED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'H149_CONSUMED_REPLAY_ALLOWED'; end if; n:=n+1;
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',ident,'x-balam-recovery-token',result->>'write_token')::text,true);
  insert into pos.clients(id,nombre,sync_device_id) values(ident,'Fresh confirmed operation',ident);
  if not exists(select 1 from pos.clients where id=ident) then raise exception 'H149_NEW_OPERATION_FAILED'; end if; n:=n+1;
  perform set_config('request.headers','{}',true);
  perform set_config('role','authenticated',true);
  denied:=false;
  begin perform write_token from pos.sync_device_recoveries; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H149_TOKEN_COLUMN_EXPOSED'; end if;
  perform set_config('role','postgres',true); n:=n+1;
  perform set_config('role','anon',true);
  denied:=false;
  begin perform pos.get_sync_device_recovery(ident); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H149_ANON_ACCESS'; end if;
  perform set_config('role','postgres',true); n:=n+1;
  raise sqlstate 'P0149' using message='rollback H149 fixtures';
 exception when sqlstate 'P0149' then null;
 end;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) into after_hash from pos.products p;
 if before_hash is distinct from after_hash or exists(select 1 from auth.users where id=uid)
  or exists(select 1 from pos.clients where id=ident) or exists(select 1 from pos.sync_devices where device_id=ident) then
  raise exception 'H149_FIXTURE_ROLLBACK_FAILED';
 end if;
 raise notice 'H149 PASS % checks + fixture rollback',n;
end $verification$;
commit;
