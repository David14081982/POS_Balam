-- POS BALAM · H-123 · verificación autocontenida. No ejecuta limpieza y
-- revierte todas sus semillas, también al aplicarse en producción.
begin;

do $$
declare
  v_plan_returns jsonb;
  v_plan_orphans jsonb;
  v_plan_changed jsonb;
  v_payload jsonb;
  v_plan_definition text;
  v_payload_definition text;
  v_execute_definition text;
  v_fleet_definition text;
begin
  v_plan_definition:=pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure);
  v_payload_definition:=pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure);
  v_execute_definition:=pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure);
  v_fleet_definition:=pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure);

  if position('v_orphan_return_evidence' in v_plan_definition)=0
     or position('orphan_return_commit_ids' in v_plan_definition)=0
     or position('evidencias_huerfanas_devolucion' in v_plan_definition)=0
     or position('not v_orphan_return_evidence' in v_plan_definition)=0 then
    raise exception 'H123_VERIFY_PLAN_CONTRACT_MISSING';
  end if;
  if position('orphan_return_commit_ids' in v_payload_definition)=0 then
    raise exception 'H123_VERIFY_BACKUP_SCOPE_MISSING';
  end if;
  if position('H123: evidencia técnica exacta' in v_execute_definition)=0
     or position('v_orphan_deleted' in v_execute_definition)=0
     or position('orphan_return_ids' in v_execute_definition)=0
     or position('values(p_cleanup_id,5,5,p_preset' in v_execute_definition)=0 then
    raise exception 'H123_VERIFY_EXECUTION_SCOPE_MISSING';
  end if;
  if position('orphan_return_evidence' in v_fleet_definition)=0
     or position('20260820016300' in v_fleet_definition)=0
     or position('''minimum_client_protocol'', 5' in v_fleet_definition)=0 then
    raise exception 'H123_VERIFY_FLEET_SCOPE_MISSING';
  end if;
  if pos.test_data_cleanup_affects_financials(
      '{"selection_normalized":{"orphan_return_evidence":true}}'::jsonb) then
    raise exception 'H123_ORPHAN_EVIDENCE_CLASSIFIED_AS_FINANCIAL';
  end if;

  insert into pos.returns(id,folio,cliente,vendedores,metodo,total,fecha,comisiones,prior_sale_state)
  values('H123-VERIFY-VALID-RETURN','H123-VERIFY-VALID-FOLIO','Fixture','[]','Efectivo',0,
    '2026-08-20 08:00:00-07','[]','Pagado');
  insert into pos.return_commits(commit_id,return_id,folio,payload_hash,created_at)
  values
    ('H123-VERIFY-VALID-COMMIT','H123-VERIFY-VALID-RETURN','H123-VERIFY-VALID-FOLIO',repeat('a',64),'2026-08-20 08:00:01-07'),
    ('H123-VERIFY-ORPHAN-A','H123-VERIFY-MISSING-A','H123-VERIFY-ORPHAN-FOLIO-A',repeat('b',64),'2026-08-20 08:01:00-07');

  v_plan_returns:=pos.test_data_cleanup_plan('custom','{"returns":true}'::jsonb);
  if not exists(select 1 from jsonb_array_elements(v_plan_returns->'blocked_reasons') reason
      where reason->>'code'='orphan_return_evidence') then
    raise exception 'H123_UNSELECTED_ORPHAN_DID_NOT_BLOCK';
  end if;

  v_plan_orphans:=pos.test_data_cleanup_plan('custom','{"orphan_return_evidence":true}'::jsonb);
  if coalesce((v_plan_orphans->'selection_normalized'->>'orphan_return_evidence')::boolean,false) is not true
     or not (v_plan_orphans->'documents'->'orphan_return_commit_ids' ? 'H123-VERIFY-ORPHAN-A')
     or (v_plan_orphans->'documents'->'orphan_return_commit_ids' ? 'H123-VERIFY-VALID-COMMIT')
     or jsonb_array_length(v_plan_orphans->'stock')<>0
     or exists(select 1 from jsonb_array_elements(v_plan_orphans->'blocked_reasons') reason
       where reason->>'code'='orphan_return_evidence') then
    raise exception 'H123_SELECTED_ORPHAN_SCOPE_INVALID:%',v_plan_orphans;
  end if;
  v_payload:=pos.test_data_cleanup_payload(v_plan_orphans);
  if not exists(select 1 from jsonb_array_elements(v_payload->'return_commits') row
      where row->>'commit_id'='H123-VERIFY-ORPHAN-A') then
    raise exception 'H123_BACKUP_OMITS_SELECTED_ORPHAN';
  end if;

  insert into pos.return_commits(commit_id,return_id,folio,payload_hash,created_at)
  values('H123-VERIFY-ORPHAN-B','H123-VERIFY-MISSING-B','H123-VERIFY-ORPHAN-FOLIO-B',repeat('c',64),'2026-08-20 08:02:00-07');
  v_plan_changed:=pos.test_data_cleanup_plan('custom','{"orphan_return_evidence":true}'::jsonb);
  if v_plan_changed->>'plan_hash'=v_plan_orphans->>'plan_hash'
     or not (v_plan_changed->'documents'->'orphan_return_commit_ids' ? 'H123-VERIFY-ORPHAN-B') then
    raise exception 'H123_NEW_ORPHAN_DID_NOT_CHANGE_SNAPSHOT';
  end if;

  if (select schema_version from pos.system_manifest where singleton)<20260820016300 then
    raise exception 'H123_VERIFY_MANIFEST_OUTDATED';
  end if;
  raise notice 'H123_ORPHAN_RETURN_OK preview=exact backup=sealed execution=guarded stock=untouched protocol=5';
end;
$$;

rollback;
