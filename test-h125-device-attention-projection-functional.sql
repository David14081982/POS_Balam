\set ON_ERROR_STOP on

-- H-125 exact reported projection fixture; everything rolls back.
begin;

do $$
declare
  v_admin uuid;
  v_email text;
  v_device text := 'h125-' || substr(md5(clock_timestamp()::text), 1, 10);
begin
  select u.id, u.email into v_admin, v_email
    from auth.users u
    join pos.sellers s on lower(s.email)=lower(u.email)
   where s.role='admin' and s.active is true and s.deleted_at is null
   order by u.created_at limit 1;
  if v_admin is null then raise exception 'H125_ADMIN_MISSING'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.email', v_email, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',v_admin::text,'email',v_email,'role','authenticated','aud','authenticated'
  )::text, true);

  insert into pos.sync_devices(device_id,user_id,user_email,protocol_version,
    schema_version,data_epoch,cursors,queue_pending,queue_blocked,status,last_seen_at)
  select v_device,v_admin,v_email,2,20260820016800,data_epoch,'{}',0,0,'online',now()
    from pos.system_manifest where singleton;
  insert into pos.sync_activity(device_id,operation_id,user_id,user_email,
    operation_type,domain,reference,summary,status,requires_action,admin_action,
    action_status)
  values(v_device,'h125-bg-260812-0006',v_admin,v_email,'exchange','exchanges',
    'BG-260812-0006','Cambio de mercancia - BG-260812-0006','blocked',true,
    'review','completed');

  begin
    perform pos.admin_request_sync_retry(v_device,'h125-bg-260812-0006');
    raise exception 'H125_HISTORICAL_RETRY_WAS_ACCEPTED';
  exception when raise_exception then
    if sqlerrm <> 'sync_activity_not_actionable' then raise; end if;
  end;

  perform pos.admin_mark_sync_activity_reviewed(v_device,'h125-bg-260812-0006');
  if exists(select 1 from pos.sync_activity where device_id=v_device
      and operation_id='h125-bg-260812-0006' and requires_action) then
    raise exception 'H125_REVIEW_DID_NOT_CLOSE_ATTENTION';
  end if;

  update pos.sync_devices set queue_pending=1, queue_blocked=1 where device_id=v_device;
  update pos.sync_activity set requires_action=true, admin_action=null,
    action_status=null where device_id=v_device and operation_id='h125-bg-260812-0006';
  perform pos.admin_request_sync_retry(v_device,'h125-bg-260812-0006');
  if not exists(select 1 from pos.sync_activity where device_id=v_device
      and operation_id='h125-bg-260812-0006' and action_status='requested') then
    raise exception 'H125_CURRENT_RETRY_NOT_REQUESTED';
  end if;
end;
$$;

rollback;
select 'H125_DEVICE_ATTENTION_FUNCTIONAL_OK' as result;

