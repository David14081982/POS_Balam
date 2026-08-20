-- POS BALAM · H-122 · verificación transaccional y autocontenida.
begin;

do $$
declare
  v_plan text;
  v_execute text;
begin
  v_plan := pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure);
  v_execute := pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  );

  if position('pos.test_data_cleanup_affects_financials' in v_plan) = 0 then
    raise exception 'H122_VERIFY_EVIDENCE_SCOPE_MISSING';
  end if;
  if position('pos.test_data_cleanup_affects_financials(v_plan)' in v_execute) = 0
     or position('H-122: préstamos, reclasificaciones y clientes no cambian esta autoridad' in v_execute) = 0
     or position('H-122: sólo borrar ventas cambia ventas_mes/ventas_num' in v_execute) = 0 then
    raise exception 'H122_VERIFY_EXECUTION_SCOPE_MISSING';
  end if;

  -- Autoridad pura y autocontenida: A/B en ambos sentidos, sin datos reales.
  if pos.test_data_cleanup_affects_financials('{"selection_normalized":{"loans":true}}'::jsonb)
     or pos.test_data_cleanup_affects_financials('{"selection_normalized":{"reclassifications":true}}'::jsonb)
     or pos.test_data_cleanup_affects_financials('{"selection_normalized":{"customers":true}}'::jsonb)
     or not pos.test_data_cleanup_affects_financials('{"selection_normalized":{"sales":true}}'::jsonb)
     or not pos.test_data_cleanup_affects_financials('{"selection_normalized":{"returns":true}}'::jsonb)
     or not pos.test_data_cleanup_affects_financials('{"selection_normalized":{"exchanges":true}}'::jsonb)
     or not pos.test_data_cleanup_affects_financials('{"selection_normalized":{"commissions":true}}'::jsonb) then
    raise exception 'H122_FINANCIAL_AUTHORITY_MATRIX_FAILED';
  end if;
  if (select schema_version from pos.system_manifest where singleton) < 20260820016100 then
    raise exception 'H122_VERIFY_MANIFEST_OUTDATED';
  end if;
  raise notice 'H122_DOMAIN_SEMANTICS_OK unrelated=isolated financial_guard=preserved';
end;
$$;

rollback;
