-- H-81: verificación autocontenida de esquema, defensas y estados.
begin;

do $$
declare v_rejected boolean;
begin
  if to_regclass('pos.sync_quarantine_cases') is null then raise exception 'h81_table_missing'; end if;
  if has_table_privilege('anon','pos.sync_quarantine_cases','select')
     or has_table_privilege('anon','pos.sync_quarantine_cases','insert') then
    raise exception 'h81_anon_table_access';
  end if;
  if not has_table_privilege('authenticated','pos.sync_quarantine_cases','select')
     or has_table_privilege('authenticated','pos.sync_quarantine_cases','insert') then
    raise exception 'h81_direct_write_access';
  end if;
  if has_function_privilege('anon','pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb)','execute')
     or has_function_privilege('anon','pos.admin_decide_sync_quarantine(text,text,bigint,text,text)','execute') then
    raise exception 'h81_anon_rpc_access';
  end if;
  if not has_function_privilege('authenticated','pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb)','execute')
     or not has_function_privilege('authenticated','pos.admin_decide_sync_quarantine(text,text,bigint,text,text)','execute')
     or not has_function_privilege('authenticated','pos.consume_sync_quarantine_decisions(text)','execute')
     or not has_function_privilege('authenticated','pos.complete_sync_quarantine(text,text,bigint,boolean,text)','execute') then
    raise exception 'h81_authenticated_rpc_missing';
  end if;
  if has_function_privilege('authenticated','pos.h81_touch_quarantine_devices()','execute') then
    raise exception 'h81_internal_trigger_exposed';
  end if;
  if not exists(select 1 from pg_policies where schemaname='pos'
      and tablename='sync_quarantine_cases' and policyname='sync_quarantine_cases_read') then
    raise exception 'h81_rls_missing';
  end if;

  v_rejected:=false;
  begin perform pos.report_sync_quarantine('missing','op',1,1,'sale','sales',null,
    'test',repeat('0',64),'{}'); exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'h81_report_auth_guard'; end if;

  v_rejected:=false;
  begin perform pos.admin_decide_sync_quarantine('missing','op',1,'approve',null);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'h81_admin_decision_guard'; end if;

  v_rejected:=false;
  begin perform * from pos.consume_sync_quarantine_decisions('missing');
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'h81_consume_owner_guard'; end if;

  v_rejected:=false;
  begin perform pos.complete_sync_quarantine('missing','op',1,true,null);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'h81_complete_owner_guard'; end if;
end $$;

rollback;
