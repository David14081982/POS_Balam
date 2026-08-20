-- POS BALAM · H-120 · verificación estructural sin datos comerciales.
do $$
declare v_plan text;v_execute text;v_payload text;v_commit text;v_fleet text;
begin
  if not exists(select 1 from information_schema.columns
    where table_schema='pos' and table_name='returns' and column_name='prior_sale_state') then
    raise exception 'H120_VERIFY_COLUMN_MISSING';
  end if;
  v_commit:=pg_get_functiondef(
    'pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  v_plan:=pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure);
  v_execute:=pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure);
  v_payload:=pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure);
  v_fleet:=pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure);
  if position('invalid_prior_sale_state' in v_commit)=0
     or position('prior_sale_state=case' in v_commit)=0 then
    raise exception 'H120_VERIFY_RETURN_COMMIT_MISSING';
  end if;
  if position('sale_state_restorations' in v_plan)=0
     or position('return_state_evidence_missing' in v_plan)=0
     or position('orphan_return_evidence' in v_plan)=0 then
    raise exception 'H120_VERIFY_PLAN_MISSING';
  end if;
  if position('sale_state_restorations' in v_payload)=0 then
    raise exception 'H120_VERIFY_BACKUP_MISSING';
  end if;
  if position('H120: restore retained sale state' in v_execute)=0
     or position('''sale_states''' in v_execute)=0
     or position('values(p_cleanup_id,4,4,p_preset' in v_execute)=0 then
    raise exception 'H120_VERIFY_EXECUTE_MISSING';
  end if;
  if position('''minimum_client_protocol'', 4' in v_fleet)=0
     or position('20260819015900' in v_fleet)=0 then
    raise exception 'H120_VERIFY_FLEET_MISSING';
  end if;
  if (select schema_version from pos.system_manifest where singleton)<20260819015900 then
    raise exception 'H120_VERIFY_MANIFEST_OUTDATED';
  end if;
  raise notice 'H120_DEFINITION_OK snapshot=forward guard=closed restore=transactional orphan=evidence protocol=4';
end;
$$;
