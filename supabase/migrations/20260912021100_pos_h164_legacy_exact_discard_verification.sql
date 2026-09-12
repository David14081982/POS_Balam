-- One scoped recovery case: the candidate superset must never become a discard.
-- One unreadable journal case: preserved evidence cannot disappear from review.
begin;
do $verify$
declare
 migration_owner name:=current_user; actor uuid:='01640000-0000-4000-8000-000000000101';
 device text:='qa-h164-scope'; op jsonb; result jsonb; raw text; hash text;
begin
 begin
  if exists(select 1 from auth.users where id=actor or email='h164-scope@invalid.test')
   or exists(select 1 from pos.sync_devices where device_id=device) then raise exception 'H164_SCOPE_FIXTURE_COLLISION'; end if;
  insert into auth.users(id,email) values(actor,'h164-scope@invalid.test');
  insert into pos.sellers(id,nombre,email,role,active) values(actor::text,'H164 scope verification','h164-scope@invalid.test','vendedor',true);
  insert into pos.sync_devices(device_id,user_id,status,protocol_version,data_epoch)
   values(device,actor,'online',3,1);
  insert into pos.sync_device_recoveries(device_id,owner_id,expected_count,source_epoch,protocol_version,
   minimum_build,candidate_ids,state,authorization_reason)
   values(device,actor,1,1,3,'2026-09-12-h164',array['h164-real-unconfirmed','h164-authorized-test'],'pending','Verification fixture; rolled back');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email','h164-scope@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',device)::text,true);
  op:='{"type":"upsert","kind":"clients","id":"h164-real-unconfirmed","rows":[]}';
  result:=pos.classify_online_legacy(device,op);
  if result->>'status'<>'needs_review' then raise exception 'H164_PENDING_CANDIDATE_DISCARDED'; end if;
  update pos.sync_device_recoveries set state='captured',evidence='{"fixture":true}',discarded_ids=array['h164-authorized-test'] where device_id=device;
  result:=pos.classify_online_legacy(device,op);
  if result->>'status'<>'needs_review' then raise exception 'H164_UNCAPTURED_CANDIDATE_DISCARDED'; end if;
  result:=pos.classify_online_legacy(device,jsonb_set(op,'{id}','"h164-authorized-test"'));
  if result->>'status'<>'authorized_discard' then raise exception 'H164_EXACT_DISCARD_NOT_RECOGNIZED'; end if;
  raw:=op::text; hash:=encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex');
  set local role authenticated;
  result:=pos.archive_online_legacy(device,jsonb_build_array(jsonb_build_object('sourceKey','h164-candidate','operationId','h164-real-unconfirmed','hash',hash,'original',raw)));
  if result#>>'{entries,0,status}'<>'needs_review' or pos.online_legacy_review_count()<>1 then raise exception 'H164_CANDIDATE_ARCHIVE_HIDDEN'; end if;
  execute format('set local role %I',migration_owner);
  raw:='{"journalWithoutLegacyType":{"folio":"UNKNOWN","committed":false}}';
  hash:=encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex');
  set local role authenticated;
  result:=pos.archive_online_legacy(device,jsonb_build_array(jsonb_build_object('sourceKey','h164-unknown-journal','kind','operation','hash',hash,'original',raw)));
  if result#>>'{entries,0,status}'<>'needs_review' or pos.online_legacy_review_count()<>2 then raise exception 'H164_UNKNOWN_JOURNAL_HIDDEN'; end if;
  execute format('set local role %I',migration_owner);
  if position('recovery_row.state in(''captured'',''completed'') and recovery_row.discarded_ids' in pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure))=0 then raise exception 'H164_WRITE_GUARD_USES_CANDIDATES'; end if;
  raise exception using errcode='ZX164',message='H164_SCOPE_VERIFIED_ROLLBACK';
 exception when sqlstate 'ZX164' then null;
 end;
 if exists(select 1 from auth.users where id=actor) or exists(select 1 from pos.sync_devices where device_id=device)
  or exists(select 1 from pos.online_legacy_archives where actor_id=actor) then raise exception 'H164_SCOPE_FIXTURE_LEAK'; end if;
end $verify$;
commit;
