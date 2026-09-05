-- Sesión sin identidad comercial. La guarda de protocolo toma FOR SHARE;
-- por eso se permite el bloqueo de lectura y siempre se termina en ROLLBACK.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $h138_permissions$
declare v_denied boolean; v_epoch bigint;
begin
  if auth.uid() is not null then raise exception 'H138_REQUIRES_NO_USER_SESSION'; end if;
  if has_function_privilege('anon','pos.save_products_checked(uuid,jsonb)','EXECUTE')
     or has_function_privilege('anon','pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)','EXECUTE')
     or has_function_privilege('authenticated','pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)','EXECUTE') then
    raise exception 'H138_RPC_ACL';
  end if;
  v_denied := false;
  begin
    perform pos.save_products_checked('13800000-0000-4000-8000-000000000081','[]');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'H138_SINGLE_PERMISSION_BYPASS'; end if;
  select data_epoch into v_epoch from pos.system_manifest where singleton;
  v_denied := false;
  begin
    perform pos.commit_reference_family_batch(
      '13800000-0000-4000-8000-000000000082','13800000-0000-4000-8000-000000000083',
      '[{"id":"13800000-0000-4000-8000-000000000084","record_model":"v2","reference_family_id":"13800000-0000-4000-8000-000000000083"}]',3,v_epoch);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'H138_FAMILY_PERMISSION_BYPASS'; end if;
end;
$h138_permissions$;
select 'H138 permissions OK' as result;
rollback;
