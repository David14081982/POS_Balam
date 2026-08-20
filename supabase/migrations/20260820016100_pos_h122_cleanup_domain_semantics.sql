-- POS BALAM · H-122 · cada grupo limpia su documento y sólo recalcula las
-- proyecciones financieras cuando la selección realmente cambia su autoridad.
begin;

create or replace function pos.test_data_cleanup_affects_financials(p_plan jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, pos
as $$
  select coalesce((p_plan->'selection_normalized'->>'sales')::boolean,false)
      or coalesce((p_plan->'selection_normalized'->>'returns')::boolean,false)
      or coalesce((p_plan->'selection_normalized'->>'exchanges')::boolean,false)
      or coalesce((p_plan->'selection_normalized'->>'commissions')::boolean,false)
$$;

revoke all on function pos.test_data_cleanup_affects_financials(jsonb)
  from public, anon, authenticated;

do $patch$
declare
  v_definition text;
  v_next text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'pos.test_data_cleanup_plan(text,jsonb)'::regprocedure
  );
  v_next := v_definition;

  v_old := 'if not v_returns and exists(select 1 from pos.returns r where r.comisiones is null) then';
  v_new := 'if pos.test_data_cleanup_affects_financials(jsonb_build_object('
    || '''selection_normalized'',v_normalized)) and not v_returns'
    || ' and exists(select 1 from pos.returns r where r.comisiones is null) then';
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_PLAN_PATCH_MISMATCH:return_evidence';
  end if;
  v_next := replace(v_next, v_old, v_new);

  v_old := 'if not v_sales and exists(select 1 from pos.sales s where s.comisiones is null) then';
  v_new := 'if pos.test_data_cleanup_affects_financials(jsonb_build_object('
    || '''selection_normalized'',v_normalized)) and not v_sales'
    || ' and exists(select 1 from pos.sales s where s.comisiones is null) then';
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_PLAN_PATCH_MISMATCH:sale_evidence';
  end if;
  v_next := replace(v_next, v_old, v_new);

  v_old := 'if not v_sales and exists(select 1 from pos.sales s where s.estado=''Cancelado''';
  v_new := 'if pos.test_data_cleanup_affects_financials(jsonb_build_object('
    || '''selection_normalized'',v_normalized)) and not v_sales'
    || ' and exists(select 1 from pos.sales s where s.estado=''Cancelado''';
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_PLAN_PATCH_MISMATCH:cancelled_sale_evidence';
  end if;
  v_next := replace(v_next, v_old, v_new);

  v_old := 'if not v_commissions and exists(select 1 from pos.commission_adjustments a';
  v_new := 'if pos.test_data_cleanup_affects_financials(jsonb_build_object('
    || '''selection_normalized'',v_normalized)) and not v_commissions'
    || ' and exists(select 1 from pos.commission_adjustments a';
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_PLAN_PATCH_MISMATCH:adjustment_evidence';
  end if;
  v_next := replace(v_next, v_old, v_new);
  execute v_next;
end;
$patch$;

do $patch$
declare
  v_definition text;
  v_next text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  );
  v_next := v_definition;

  v_old := $old$  -- Autoridad H-69: saldo derivado de documentos CONGELADOS conservados.$old$;
  v_new := $new$  -- H-122: préstamos, reclasificaciones y clientes no cambian esta autoridad.
  if pos.test_data_cleanup_affects_financials(v_plan) then
  -- Autoridad H-69: saldo derivado de documentos CONGELADOS conservados.$new$;
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_EXECUTE_PATCH_MISMATCH:financial_start';
  end if;
  v_next := replace(v_next, v_old, v_new);

  v_old := $old$  with sale_volume as ($old$;
  v_new := $new$  end if;

  -- H-122: sólo borrar ventas cambia ventas_mes/ventas_num.
  if coalesce((v_plan->'selection_normalized'->>'sales')::boolean,false) then
  with sale_volume as ($new$;
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_EXECUTE_PATCH_MISMATCH:financial_split';
  end if;
  v_next := replace(v_next, v_old, v_new);

  v_old := $old$      from pos.sellers s2 left join sale_volume x on x.seller_id=s2.id) v where s.id=v.id;$old$;
  v_new := $new$      from pos.sellers s2 left join sale_volume x on x.seller_id=s2.id) v where s.id=v.id;
  end if;$new$;
  if length(v_next) - length(replace(v_next, v_old, '')) <> length(v_old) then
    raise exception 'H122_EXECUTE_PATCH_MISMATCH:sales_end';
  end if;
  v_next := replace(v_next, v_old, v_new);
  execute v_next;
end;
$patch$;

update pos.system_manifest
set schema_version = greatest(schema_version, 20260820016100), updated_at = now()
where singleton;

commit;
