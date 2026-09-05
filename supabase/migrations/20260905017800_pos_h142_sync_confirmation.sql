-- H-142: preserve last confirmed sync on diagnostic-only heartbeats.
-- Generated from the live definition; signature, ACL and retirement guard unchanged.
begin;
CREATE OR REPLACE FUNCTION pos.report_sync_device(p_device_id text, p_client_build text, p_protocol_version integer, p_schema_version bigint, p_data_epoch bigint, p_cursors jsonb, p_queue_pending integer, p_queue_blocked integer, p_status text, p_last_synced_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_queue_pending < 0 or p_queue_blocked < 0 or p_queue_blocked > p_queue_pending then
    raise exception 'invalid_queue_counts';
  end if;
  if p_status not in ('online','offline','behind','pending','quarantined','must_rebootstrap','revoked') then
    raise exception 'invalid_device_status';
  end if;
  insert into pos.sync_devices(device_id,user_id,user_email,client_build,
    protocol_version,schema_version,data_epoch,cursors,queue_pending,queue_blocked,
    status,last_seen_at,last_synced_at)
  values(p_device_id,auth.uid(),auth.jwt()->>'email',p_client_build,
    p_protocol_version,p_schema_version,p_data_epoch,coalesce(p_cursors,'{}'::jsonb),
    p_queue_pending,p_queue_blocked,p_status,now(),p_last_synced_at)
  on conflict(device_id) do update set
    user_id=excluded.user_id, user_email=excluded.user_email,
    client_build=excluded.client_build, protocol_version=excluded.protocol_version,
    schema_version=excluded.schema_version, data_epoch=excluded.data_epoch,
    cursors=excluded.cursors, queue_pending=excluded.queue_pending,
    queue_blocked=excluded.queue_blocked, status=excluded.status,
    last_seen_at=now(), last_synced_at=coalesce(excluded.last_synced_at,pos.sync_devices.last_synced_at)
  where pos.sync_devices.status<>'revoked';
  return true;
end;
$function$;

commit;
