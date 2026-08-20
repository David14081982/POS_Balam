-- H-125: read-only verification of the exact reported production reference.
begin;

do $$
declare
  v_rows integer;
  v_actionable integer;
begin
  select count(*), count(*) filter(where
      a.requires_action
      and a.admin_action is distinct from 'review'
      and d.queue_pending > 0
      and d.queue_blocked > 0)
    into v_rows, v_actionable
  from pos.sync_activity a
  join pos.sync_devices d on d.device_id=a.device_id
  where a.reference='BG-260812-0006';

  if v_actionable > 0 then
    raise exception 'H125_REAL_BG_260812_0006_STILL_ACTIONABLE';
  end if;
  raise notice 'H125_REAL_BG_260812_0006_OK rows=% actionable=%',
    v_rows, v_actionable;
end;
$$;

rollback;

