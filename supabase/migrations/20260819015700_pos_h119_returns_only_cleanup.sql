-- POS BALAM · H-119
-- 1) una limpieza exclusiva de devoluciones conserva el movimiento de la venta
--    y retira también el movimiento legacy identificado por tipo + folio;
-- 2) una selección sin documentos no puede ejecutar una limpieza vacía.

begin;

do $patch$
declare
  v_definition text;
  v_next text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  ) into v_definition;

  v_old := $old$    select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids')) union$old$;
  v_new := '';

  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H119_EXECUTE_SHAPE_MISMATCH:movements';
  end if;
  v_next := replace(v_definition, v_old, v_new);
  if v_next = v_definition then
    raise exception 'H119_EXECUTE_NOT_REPLACED';
  end if;

  v_old := $old$    or m.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))$old$;
  v_new := $new$    or m.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))
    or (m.return_id is null and m.tipo='Devolución' and m.ref in(
      select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))))$new$;
  if (length(v_next) - length(replace(v_next, v_old, ''))) <> length(v_old) then
    raise exception 'H119_EXECUTE_SHAPE_MISMATCH:legacy_return_movement';
  end if;
  v_next := replace(v_next, v_old, v_new);
  execute v_next;

  select pg_get_functiondef(
    'pos.test_data_cleanup_payload(jsonb)'::regprocedure
  ) into v_definition;

  v_old := $old$      select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids')) union$old$;
  v_new := '';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H119_PAYLOAD_SHAPE_MISMATCH:movements';
  end if;
  v_next := replace(v_definition, v_old, v_new);

  v_old := $old$      or m.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))$old$;
  v_new := $new$      or m.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))
      or (m.return_id is null and m.tipo='Devolución' and m.ref in(
        select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))))$new$;
  if (length(v_next) - length(replace(v_next, v_old, ''))) <> length(v_old) then
    raise exception 'H119_PAYLOAD_SHAPE_MISMATCH:legacy_return_movement';
  end if;
  v_next := replace(v_next, v_old, v_new);
  execute v_next;

  select pg_get_functiondef(
    'pos.test_data_cleanup_plan(text,jsonb)'::regprocedure
  ) into v_definition;

  v_old := $old$    'clientes',jsonb_array_length(v_documents->'customer_ids'));$old$;
  v_new := $new$    'clientes',jsonb_array_length(v_documents->'customer_ids'));
  if (v_sales or v_returns or v_exchanges or v_loans or v_commissions
      or v_reclassifications or v_customers)
     and (select coalesce(sum(value::bigint),0) from jsonb_each_text(v_counts))=0 then
    -- Es la causa accionable de esta selección. Se conserva el diagnóstico
    -- técnico restante, pero no se antepone una guarda de otro dominio.
    v_reasons:=jsonb_build_array('cleanup_no_matching_data')||v_reasons;
  end if;$new$;

  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H119_PLAN_SHAPE_MISMATCH:no_matching_data';
  end if;
  v_next := replace(v_definition, v_old, v_new);
  if v_next = v_definition then
    raise exception 'H119_PLAN_NOT_REPLACED';
  end if;
  execute v_next;
end;
$patch$;

commit;
