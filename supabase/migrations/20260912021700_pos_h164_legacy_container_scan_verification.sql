-- H164: one composite legacy intake, exact bytes, no numeric leaf coercion or replay.
-- Synthetic fixtures only; every row and runtime change rolls back.
begin;
do $verify$
declare
 migration_owner name:=current_user; actor uuid:=gen_random_uuid();
 prefix text:='qa-h164-scan-'||actor::text; device text:=prefix||'-device';
 v_good_id text:=gen_random_uuid()::text; v_overflow_id text:=gen_random_uuid()::text;
 entries jsonb:='[]'; response jsonb; entry jsonb; matched pos.online_legacy_archives%rowtype;
 cache_raw text; mixed_raw text; overflow_raw text; invalid_raw text; unicode_raw text; empty_raw text:='[]';
 good_op jsonb; bad_op jsonb; archive_before text; operations_before text; runtime_before jsonb; review_count bigint;
begin
 if has_function_privilege('anon','pos.online_legacy_scan(jsonb,integer)','execute')
  or has_function_privilege('authenticated','pos.online_legacy_scan(jsonb,integer)','execute')
  or has_function_privilege('authenticated','pos.online_legacy_intents(jsonb,integer)','execute')
  or not has_function_privilege('authenticated','pos.archive_online_legacy(text,jsonb)','execute') then
  raise exception 'H164_SCANNER_ACL'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by actor_id,device_id,source_key,source_hash)::text,'[]')) into archive_before from pos.online_legacy_archives a;
 select md5(coalesce(jsonb_agg(to_jsonb(o) order by actor_id,device_id,operation_id,payload_hash)::text,'[]')) into operations_before from pos.online_legacy_operations o;
 select to_jsonb(r) into runtime_before from pos.online_runtime r where singleton;
 begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.headers','{}',true);
  update pos.online_runtime set enabled=false where singleton;
  insert into auth.users(id,email) values(actor,prefix||'@invalid.test');
  insert into pos.sellers(id,nombre,email,role,active) values(actor::text,prefix,prefix||'@invalid.test','admin',true);
  insert into pos.sync_devices(device_id,user_id,user_email,protocol_version,data_epoch,status,client_build)
   values(device,actor,prefix||'@invalid.test',3,1,'online','2026-09-12-h164-online');
  update pos.online_runtime set enabled=true where singleton;
  cache_raw:=jsonb_build_object('cached',jsonb_build_array(jsonb_build_object('id','1e999999-1234-4123-8123-123456789abc','sku','1e999999')))::text;
  good_op:=jsonb_build_object('type','loanOperation','id',v_good_id,'action','create','expectedVersion',0,'loan',jsonb_build_object('id',prefix||'-loan'));
  bad_op:=jsonb_build_object('type','loanOperation','id',v_overflow_id,'action','create','expectedVersion','999999999999999999999999999999999','loan','{}'::jsonb);
  -- A JSON-string wrapper preserves its valid intent and an unrelated damaged container.
  mixed_raw:=jsonb_build_array(to_jsonb(jsonb_build_object('wrapper',good_op)::text),'[invalid container')::text;
  overflow_raw:=bad_op::text;
  invalid_raw:='[{"type":"loanOperation","id":"synthetic-unparsed","expectedVersion":1e999999}]';
  unicode_raw:='[{"id":"'||chr(92)||'u0000"}]';
  for entry in select value from jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('sourceKey','localStorage:balam_pos_cache_scan_v1','kind','cache','original',cache_raw),
   jsonb_build_object('sourceKey','localStorage:balam_pos_mixed_scan_v1','kind','cache','original',mixed_raw),
   jsonb_build_object('sourceKey','localStorage:balam_loan_scan_queue','kind','operation','original',overflow_raw),
   jsonb_build_object('sourceKey','localStorage:balam_pos_bad_scan_v1','kind','cache','original',invalid_raw),
   jsonb_build_object('sourceKey','localStorage:balam_pos_unicode_scan_v1','kind','cache','original',unicode_raw),
   jsonb_build_object('sourceKey','localStorage:balam_sync_queue','kind','operation','original',empty_raw))) loop
   entries:=entries||jsonb_build_array(entry||jsonb_build_object('hash',encode(extensions.digest(convert_to(entry->>'original','UTF8'),'sha256'),'hex')));
  end loop;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',prefix||'@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',device,'x-balam-client-build','2026-09-12-h164-online')::text,true);
  set local role authenticated;
  response:=pos.archive_online_legacy(device,entries);
  review_count:=pos.online_legacy_review_count();
  execute format('set local role %I',migration_owner);
  if response->>'ok'<>'true' or response->>'replayed'<>'0' or jsonb_array_length(response->'acknowledged')<>6 then
   raise exception 'H164_SCANNER_ACK'; end if;
  for entry in select value from jsonb_array_elements(entries) loop
   select * into matched from pos.online_legacy_archives where actor_id=actor and device_id=device and source_key=entry->>'sourceKey';
   if not found or matched.original is distinct from entry->'original' or matched.source_hash is distinct from entry->>'hash'
    or matched.original_hash is distinct from md5((entry->'original')::text)
    or not exists(select 1 from jsonb_array_elements(response->'acknowledged') ack where ack->>'sourceKey'=matched.source_key and ack->>'hash'=matched.source_hash) then
    raise exception 'H164_SCANNER_ORIGINAL_OR_ACK_CHANGED'; end if;
  end loop;
  if (select classification from pos.online_legacy_archives where actor_id=actor and source_key='localStorage:balam_pos_cache_scan_v1')<>'retained_history'
   or (select classification from pos.online_legacy_archives where actor_id=actor and source_key='localStorage:balam_sync_queue')<>'retained_history' then
   raise exception 'H164_SCANNER_FALSE_LEAF_PENDING'; end if;
  if (select count(*) from pos.online_legacy_archives where actor_id=actor and classification='needs_review')<>4
   or (select count(*) from pos.online_legacy_operations where actor_id=actor)<>2
   or review_count<>5 then raise exception 'H164_SCANNER_REVIEW_HIDDEN'; end if;
  if not exists(select 1 from pos.online_legacy_archives where actor_id=actor and source_key='localStorage:balam_pos_mixed_scan_v1'
    and evidence->'h164ScanIssues'='["LEGACY_INVALID_JSON_CONTAINER"]'::jsonb)
   or not exists(select 1 from pos.online_legacy_archives where actor_id=actor and source_key='localStorage:balam_pos_bad_scan_v1'
    and evidence->'h164ScanIssues'='["LEGACY_JSON_NUMBER_OUT_OF_RANGE"]'::jsonb)
   or not exists(select 1 from pos.online_legacy_archives where actor_id=actor and source_key='localStorage:balam_pos_unicode_scan_v1'
    and evidence->'h164ScanIssues'='["LEGACY_JSON_UNSUPPORTED_UNICODE"]'::jsonb) then raise exception 'H164_SCANNER_ISSUE_CODE'; end if;
  if not exists(select 1 from pos.online_legacy_operations where actor_id=actor and operation_id=v_good_id and original=good_op and classification='needs_review')
   or not exists(select 1 from pos.online_legacy_operations where actor_id=actor and operation_id=v_overflow_id and original=bad_op
    and classification='needs_review' and evidence->>'h164ClassificationIssue'='22003') then raise exception 'H164_SCANNER_INTENT_LOST_OR_FALSE_CONFIRMATION'; end if;
  if exists(select 1 from pos.loan_documents where id=prefix||'-loan')
   or exists(select 1 from pos.capability_operation_audit where operation_id::text in(v_good_id,v_overflow_id))
   or exists(select 1 from pos.online_requests where actor_id=actor) then raise exception 'H164_SCANNER_REPLAYED'; end if;
  -- Restore the pre-existing authority/evidence by rolling back this fixture subtransaction.
  raise exception 'H164_SCANNER_FIXTURE_ROLLBACK' using errcode='ZX164';
 exception when sqlstate 'ZX164' then null;
 end;
 execute format('set local role %I',migration_owner);
 if archive_before is distinct from(select md5(coalesce(jsonb_agg(to_jsonb(a) order by actor_id,device_id,source_key,source_hash)::text,'[]')) from pos.online_legacy_archives a)
  or operations_before is distinct from(select md5(coalesce(jsonb_agg(to_jsonb(o) order by actor_id,device_id,operation_id,payload_hash)::text,'[]')) from pos.online_legacy_operations o)
  or runtime_before is distinct from(select to_jsonb(r) from pos.online_runtime r where singleton)
  or exists(select 1 from auth.users where id=actor) then raise exception 'H164_SCANNER_FIXTURE_LEAK'; end if;
end $verify$;
commit;
