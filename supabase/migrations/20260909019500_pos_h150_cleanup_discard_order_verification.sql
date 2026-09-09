-- H150: real behavior and access checks; technical fixtures roll back internally.
begin;
do $order$ begin
 if md5(pg_get_functiondef('pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure))<>'24f041bd3105cc8e7e6ca79259256ac8' then raise exception 'H150 cleanup definition mismatch'; end if;
 if has_function_privilege('anon','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') or not has_function_privilege('authenticated','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') then raise exception 'H150 cleanup ACL drift'; end if;
end $order$;
do $verification$
declare uid uuid:=gen_random_uuid(); prefix text:='qa-h150-'||uid::text;
 epoch bigint; plan jsonb; result jsonb; backup_id uuid; denied boolean; q_count bigint; detail text;
begin
 if has_function_privilege('anon','pos.test_data_cleanup_fleet_risk(jsonb)','execute')
  or has_function_privilege('authenticated','pos.test_data_cleanup_payload(jsonb)','execute')
  or has_function_privilege('authenticated','pos.assert_device_recovery_write(text,text[])','execute')
  or has_table_privilege('authenticated','pos.sync_quarantine_cases','update')
  or has_function_privilege('anon','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') then
  raise exception 'H150_EXCESS_PRIVILEGE'; end if;
 select count(*) into q_count from pos.sync_quarantine_cases;
 begin
  select data_epoch into epoch from pos.system_manifest;
  insert into pos.sync_devices(device_id,user_id,protocol_version,schema_version,data_epoch,queue_pending,queue_blocked,status)
   values(prefix,uid,3,20260830017500,epoch,0,0,'online');
  insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,user_id,operation_type,domain,summary,payload_hash)
   values(prefix,prefix||'-op',epoch,uid,'productDeleteScope','products','QA archived request',repeat('a',64));
  plan:=pos.test_data_cleanup_fleet_risk('{"selection_normalized":{"reclassifications":true},"blocked_reasons":[],"counts":{},"documents":{},"stock":[]}');
  if exists(select 1 from jsonb_array_elements(plan->'blocked_reasons') r where r->>'device_id'=prefix)
    or not exists(select 1 from jsonb_array_elements(plan->'quarantine_discard') r where r->>'operation_id'=prefix||'-op')
    or (plan->>'minimum_client_protocol')::integer<>6 then raise exception 'H150_ARCHIVE_SCOPE_FAILED'; end if;
  result:=pos.test_data_cleanup_payload(plan);
  if result->'quarantined_operations'<>plan->'quarantine_discard' then raise exception 'H150_BACKUP_OMITS_ARCHIVE'; end if;
  -- Do not execute cleanup on real business data. Emulate only its technical receipt.
  insert into pos.test_data_cleanup_backups(created_by,protocol_version,data_epoch,preset,selection_normalized,plan_hash,payload_hash,payload)
   values(uid,6,epoch,'custom','{}','fixture','fixture','{}') returning test_data_cleanup_backups.backup_id into backup_id;
  insert into pos.test_data_cleanup_operations(cleanup_id,backup_id,status,actor_user_id,protocol_version,data_epoch_before,preset,selection_normalized,plan_hash)
   values(prefix,backup_id,'completed',uid,6,epoch,'custom','{}','fixture');
  update pos.sync_quarantine_cases set status='rejected',discarded_by_cleanup=prefix where device_id=prefix;
  denied:=false;
  begin perform pos.assert_device_recovery_write(prefix,array[prefix||'-op']); exception when raise_exception then get stacked diagnostics detail=pg_exception_detail; denied:=detail='TEST_PENDING_DISCARDED'; end;
  if not denied then raise exception 'H150_DISCARD_REPLAY_ACCEPTED'; end if;
  perform pos.assert_device_recovery_write(prefix,array[prefix||'-new']);
  denied:=false;
  begin perform pos.commit_exchange_checked(prefix||'-different-key',jsonb_build_object('id',prefix||'-op'),'[]');
   exception when raise_exception then get stacked diagnostics detail=pg_exception_detail; denied:=detail='TEST_PENDING_DISCARDED'; end;
  if not denied then raise exception 'H150_EXCHANGE_COMMERCIAL_KEY_BYPASS'; end if;
  denied:=false;
  begin perform pos.commit_exchange(prefix||'-different-key',jsonb_build_object('id',prefix||'-op'),'[]');
   exception when raise_exception then get stacked diagnostics detail=pg_exception_detail; denied:=detail='TEST_PENDING_DISCARDED'; end;
  if not denied then raise exception 'H150_EXCHANGE_LEGACY_BYPASS'; end if;
  update pos.sync_quarantine_cases set payload_summary=jsonb_build_object('operationIds',jsonb_build_array(prefix||'-commercial-key')) where device_id=prefix;
  denied:=false;
  begin perform pos.assert_device_recovery_write(prefix,array[prefix||'-commercial-key']);
   exception when raise_exception then get stacked diagnostics detail=pg_exception_detail; denied:=detail='TEST_PENDING_DISCARDED'; end;
  if not denied then raise exception 'H150_COMMERCIAL_KEY_BYPASS'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  perform pos.report_sync_quarantine(prefix,prefix||'-op',epoch+1,epoch,'productDeleteScope','products',null,'QA old archive',repeat('a',64),'{}');
  if (select count(*) from pos.sync_quarantine_cases where device_id=prefix)<>1 then raise exception 'H150_REREPORT_REOPENED'; end if;
  -- A non-admin cannot approve even a discarded case.
  denied:=false;
  begin perform pos.admin_decide_sync_quarantine(prefix,prefix||'-op',epoch,'approve',null); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'H150_APPROVAL_ROLE_BYPASS'; end if;
  -- Native scope enforcement, not just a string assertion.
  if not exists(select 1 from pg_constraint where conrelid='pos.sync_quarantine_cases'::regclass
    and confrelid='pos.test_data_cleanup_operations'::regclass and contype='f') then raise exception 'H150_RECEIPT_FK_MISSING'; end if;
  raise exception 'H150_FIXTURE_ROLLBACK';
 exception when raise_exception then if sqlerrm<>'H150_FIXTURE_ROLLBACK' then raise; end if; end;
 if (select count(*) from pos.sync_quarantine_cases)<>q_count
   or exists(select 1 from pos.sync_devices where device_id=prefix)
   or exists(select 1 from pos.test_data_cleanup_operations where cleanup_id=prefix) then raise exception 'H150_FIXTURE_LEAK'; end if;
 raise notice 'H150_ORDER_REMOTE_VERIFICATION_OK';
end $verification$;
commit;
