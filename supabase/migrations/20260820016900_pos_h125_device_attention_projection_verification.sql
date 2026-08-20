-- H125_DEVICE_ATTENTION_OK: structural verifier; it changes no data.
begin;

do $$
declare
  v_retry text;
  v_review text;
  v_consume text;
begin
  select pg_get_functiondef('pos.admin_request_sync_retry(text,text)'::regprocedure)
    into v_retry;
  select pg_get_functiondef('pos.admin_mark_sync_activity_reviewed(text,text)'::regprocedure)
    into v_review;
  select pg_get_functiondef('pos.consume_sync_commands(text)'::regprocedure)
    into v_consume;

  if position('queue_pending > 0' in v_retry)=0
     or position('queue_blocked > 0' in v_retry)=0
     or position('admin_action is distinct from ''review''' in lower(v_retry))=0 then
    raise exception 'H125_RETRY_GUARD_MISSING';
  end if;
  if position('requires_action=false' in
      regexp_replace(lower(v_review), '\s+', '', 'g'))=0 then
    raise exception 'H125_REVIEW_CLOSE_MISSING';
  end if;
  if position('queue_pending > 0' in v_consume)=0
     or position('queue_blocked > 0' in v_consume)=0 then
    raise exception 'H125_DELIVERY_GUARD_MISSING';
  end if;
  if not exists(select 1 from pos.system_manifest where singleton
      and schema_version>=20260820016800) then
    raise exception 'H125_MANIFEST_MISSING';
  end if;
end;
$$;

rollback;
