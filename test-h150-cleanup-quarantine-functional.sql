-- H150: isolated technical fixtures; no cleanup execution, no business writes.
begin;
do $$
declare
  prefix text := 'h150-'||substr(md5(clock_timestamp()::text),1,12);
  epoch bigint;
  plan jsonb := '{"selection_normalized":{"sales":true,"reclassifications":true},"blocked_reasons":[],"counts":{}}';
  result jsonb; again jsonb; candidate jsonb;
begin
  select data_epoch into strict epoch from pos.system_manifest where singleton;
  insert into pos.sync_devices(device_id,protocol_version,schema_version,data_epoch,
    queue_pending,queue_blocked,status,last_seen_at)
  values(prefix||'-A',3,20260830017500,epoch,0,0,'online',now()),
    (prefix||'-B',3,20260830017500,epoch,0,0,'offline',now()-interval '7 days');
  insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,
    user_id,operation_type,domain,summary,payload_hash,payload_summary,status)
  values(prefix||'-A',prefix||'-sale',epoch,'00000000-0000-4000-8000-000000000150',
    'sale','sales','Venta archivada',repeat('a',64),'{"folio":"H150-SALE"}','pending_review'),
    (prefix||'-A',prefix||'-delete',epoch,'00000000-0000-4000-8000-000000000150',
    'productDeleteScope','products','Baja archivada',repeat('b',64),'{}','pending_review'),
    (prefix||'-B',prefix||'-config',epoch,'00000000-0000-4000-8000-000000000150',
    'config','config','Configuración conservada',repeat('c',64),'{}','pending_review');
  result:=pos.test_data_cleanup_fleet_risk(plan);
  if exists(select 1 from jsonb_array_elements(result->'blocked_reasons') r
    where r->>'device_id' like prefix||'%') then raise exception 'H150_ARCHIVED_IS_NOT_ACTIVE_QUEUE'; end if;
  select c into candidate from jsonb_array_elements(result->'quarantine_discard') c where c->>'operation_id'=prefix||'-delete';
  if candidate is null or candidate->>'payload_hash'<>repeat('b',64)
    or (candidate->>'remote_epoch')::bigint<>epoch then raise exception 'H150_EXACT_SCOPE_AND_BACKUP_REQUIRED'; end if;
  if (select count(*) from jsonb_array_elements(result->'quarantine_discard') c where c->>'device_id' like prefix||'%')<>2
    or exists(select 1 from jsonb_array_elements(result->'quarantine_discard') c where c->>'operation_id'=prefix||'-config') then
    raise exception 'H150_UNSELECTED_ARCHIVE_MUST_SURVIVE'; end if;
  if (result->>'minimum_client_protocol')::integer<6 then raise exception 'H150_OLD_UI_MUST_NOT_DISCARD_UNSEEN'; end if;
  update pos.sync_devices set last_seen_at=now()+interval '1 minute' where device_id like prefix||'%';
  again:=pos.test_data_cleanup_fleet_risk(plan);
  if result->>'plan_hash'<>again->>'plan_hash' then raise exception 'H150_HEARTBEAT_CHANGED_SCOPE'; end if;
  update pos.sync_quarantine_cases set payload_hash=repeat('d',64) where operation_id=prefix||'-sale';
  again:=pos.test_data_cleanup_fleet_risk(plan);
  if result->>'plan_hash'=again->>'plan_hash' then raise exception 'H150_PAYLOAD_CHANGE_NOT_IN_HASH'; end if;
  update pos.sync_quarantine_cases set status='approved' where operation_id=prefix||'-sale';
  again:=pos.test_data_cleanup_fleet_risk(plan);
  if not exists(select 1 from jsonb_array_elements(again->'blocked_reasons') r where r->>'device_id'=prefix||'-A') then
    raise exception 'H150_REPLAY_IN_FLIGHT_MUST_BLOCK'; end if;
  update pos.sync_quarantine_cases set status='pending_review' where operation_id=prefix||'-sale';
  update pos.sync_devices set queue_pending=1 where device_id=prefix||'-B';
  again:=pos.test_data_cleanup_fleet_risk(plan);
  if not exists(select 1 from jsonb_array_elements(again->'blocked_reasons') r where r->>'device_id'=prefix||'-B') then
    raise exception 'H150_UNKNOWN_ACTIVE_QUEUE_MUST_BLOCK'; end if;
  update pos.sync_devices set queue_pending=0 where device_id=prefix||'-B';
  insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,user_id,operation_type,domain,summary,payload_hash)
  values(prefix||'-B',prefix||'-commission',epoch,'00000000-0000-4000-8000-000000000150','commissionSettle','liquidations','Liquidación archivada',repeat('e',64));
  again:=pos.test_data_cleanup_fleet_risk('{"selection_normalized":{"commissions":true},"blocked_reasons":[]}');
  if not exists(select 1 from jsonb_array_elements(again->'blocked_reasons') r where r->>'device_id'=prefix||'-B') then raise exception 'H150_UNKNOWN_COMMERCIAL_KEY_MUST_BLOCK'; end if;
  update pos.sync_quarantine_cases set payload_summary=jsonb_build_object('operationIds',jsonb_build_array(prefix||'-commission',prefix||'-commercial-key')) where operation_id=prefix||'-commission';
  again:=pos.test_data_cleanup_fleet_risk('{"selection_normalized":{"commissions":true},"blocked_reasons":[]}');
  if exists(select 1 from jsonb_array_elements(again->'blocked_reasons') r where r->>'device_id'=prefix||'-B') then raise exception 'H150_EXACT_COMMERCIAL_KEY_MUST_ALLOW'; end if;
  raise notice 'H150_FLEET_OK 10/10';
end $$;
rollback;
