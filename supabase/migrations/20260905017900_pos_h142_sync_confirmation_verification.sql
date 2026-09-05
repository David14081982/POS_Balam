-- H-142: exercise the real function in a subtransaction rolled back deliberately.
-- No device, telemetry/domain clock or existing business row survives the probe.
begin;
do $verify$
declare
  v_user uuid; v_device text := 'h142-verification-' || gen_random_uuid()::text;
  v_stamp timestamptz := '2026-09-05T12:00:00Z';
  v_actual timestamptz; v_denied boolean := false;
begin
  select user_id into v_user from pos.sync_devices where user_id is not null limit 1;
  if v_user is null then raise exception 'H142_VERIFICATION_USER_REQUIRED'; end if;
  begin
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'email','h142-verification@example.invalid')::text,true);
    perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',0,0,'online',v_stamp);
    perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',1,0,'pending',null);
    select last_synced_at into v_actual from pos.sync_devices where device_id=v_device;
    if v_actual is distinct from v_stamp then raise exception 'H142_NULL_ERASED_CONFIRMATION'; end if;
    perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',0,0,'online',v_stamp+interval '1 minute');
    select last_synced_at into v_actual from pos.sync_devices where device_id=v_device;
    if v_actual is distinct from v_stamp+interval '1 minute' then raise exception 'H142_CONFIRMATION_DID_NOT_ADVANCE'; end if;
    update pos.sync_devices set status='revoked' where device_id=v_device;
    perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',0,0,'online',v_stamp);
    if not exists(select 1 from pos.sync_devices where device_id=v_device and status='revoked') then
      raise exception 'H142_RETIRED_DEVICE_REACTIVATED';
    end if;
    begin
      perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',0,1,'online',null);
    exception when others then
      if sqlerrm='invalid_queue_counts' then v_denied:=true; else raise; end if;
    end;
    if not v_denied then raise exception 'H142_INVALID_QUEUE_ACCEPTED'; end if;
    v_denied:=false;
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    begin
      perform pos.report_sync_device(v_device,'h142-verification',3,20260830017500,6,'{}',0,0,'online',null);
    exception when sqlstate '42501' then v_denied:=true;
    end;
    if not v_denied then raise exception 'H142_ANONYMOUS_REPORT_ACCEPTED'; end if;
    raise exception 'H142_PROBE_COMPLETE' using errcode='P1420';
  exception when sqlstate 'P1420' then null;
  end;
  if exists(select 1 from pos.sync_devices where device_id=v_device) then raise exception 'H142_FIXTURE_SURVIVED'; end if;
end;
$verify$;
commit;
