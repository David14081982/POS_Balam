-- H-79: verificación autocontenida de forma, ACL, restricciones y RPC.
begin;

do $$
declare v_rejected boolean;
begin
  if to_regclass('pos.sync_activity') is null then raise exception 'h79_activity_missing'; end if;
  if not exists(select 1 from pos.sync_domain_versions where domain='devices') then
    raise exception 'h79_devices_domain_missing';
  end if;
  if not exists(select 1 from pos.system_manifest where singleton
      and schema_version>=20260807012000 and domain_modes->>'devices'='active') then
    raise exception 'h79_manifest_missing';
  end if;
  if has_table_privilege('anon','pos.sync_activity','select')
     or has_table_privilege('anon','pos.sync_activity','insert') then
    raise exception 'h79_anon_activity_access';
  end if;
  if not has_table_privilege('authenticated','pos.sync_activity','select')
     or not has_table_privilege('authenticated','pos.sync_activity','insert') then
    raise exception 'h79_authenticated_activity_acl';
  end if;
  if not exists(select 1 from pg_policies where schemaname='pos'
      and tablename='sync_activity' and policyname='sync_activity_read') then
    raise exception 'h79_activity_rls_missing';
  end if;
  if not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='pos' and c.relname='sync_activity'
        and t.tgname='h79_sync_activity' and not t.tgisinternal) then
    raise exception 'h79_activity_trigger_missing';
  end if;
  if has_function_privilege('anon','pos.admin_update_sync_device(text,text,text)','execute')
     or has_function_privilege('anon','pos.admin_request_sync_retry(text,text)','execute')
     or has_function_privilege('anon','pos.consume_sync_commands(text)','execute') then
    raise exception 'h79_anon_rpc_access';
  end if;
  if not has_function_privilege('authenticated','pos.admin_update_sync_device(text,text,text)','execute')
     or not has_function_privilege('authenticated','pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamptz)','execute')
     or not has_function_privilege('authenticated','pos.admin_request_sync_retry(text,text)','execute')
     or not has_function_privilege('authenticated','pos.admin_mark_sync_activity_reviewed(text,text)','execute')
     or not has_function_privilege('authenticated','pos.consume_sync_commands(text)','execute')
     or not has_function_privilege('authenticated','pos.complete_sync_command(text,text,boolean)','execute') then
    raise exception 'h79_authenticated_rpc_missing';
  end if;

  v_rejected := false;
  begin perform pos.admin_update_sync_device('missing','Equipo','pc');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_admin_update_sync_device_guard'; end if;

  v_rejected := false;
  begin perform pos.report_sync_device('missing','test',1,1,1,'{}',0,0,'online',null);
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_report_sync_device_guard'; end if;

  v_rejected := false;
  begin perform pos.admin_request_sync_retry('missing','missing');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_admin_request_sync_retry_guard'; end if;

  v_rejected := false;
  begin perform pos.admin_mark_sync_activity_reviewed('missing','missing');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_admin_mark_sync_activity_reviewed_guard'; end if;

  v_rejected := false;
  begin perform * from pos.consume_sync_commands('missing');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_consume_sync_commands_guard'; end if;

  v_rejected := false;
  begin perform pos.complete_sync_command('missing','missing',true);
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'h79_complete_sync_command_guard'; end if;

  -- La función interna sólo invalida el dominio y no queda expuesta al cliente.
  if has_function_privilege('authenticated','pos.touch_sync_devices_domain()','execute') then
    raise exception 'h79_internal_trigger_exposed';
  end if;
end $$;

rollback;
