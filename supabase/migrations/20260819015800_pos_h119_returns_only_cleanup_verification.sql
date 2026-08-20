-- H-119 · verificación no destructiva de la definición instalada.

begin;

do $$
declare
  v_plan_definition text;
  v_execute_definition text;
  v_payload_definition text;
begin
  select pg_get_functiondef(
    'pos.test_data_cleanup_plan(text,jsonb)'::regprocedure
  ) into v_plan_definition;
  select pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure
  ) into v_execute_definition;
  select pg_get_functiondef(
    'pos.test_data_cleanup_payload(jsonb)'::regprocedure
  ) into v_payload_definition;

  if position('cleanup_no_matching_data' in v_plan_definition) = 0 then
    raise exception 'H119_NO_MATCHING_DATA_GUARD_MISSING';
  end if;
  if position($needle$select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids')) union$needle$
      in v_execute_definition) <> 0 then
    raise exception 'H119_RETURN_FOLIO_STILL_DELETES_SALE_MOVEMENT';
  end if;
  if position($needle$m.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))$needle$
      in v_execute_definition) = 0 then
    raise exception 'H119_RETURN_IDENTITY_DELETE_MISSING';
  end if;
  if position($needle$m.return_id is null and m.tipo='Devolución'$needle$
      in v_execute_definition) = 0 then
    raise exception 'H119_LEGACY_RETURN_MOVEMENT_DELETE_MISSING';
  end if;
  if position($needle$select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids')) union$needle$
      in v_payload_definition) <> 0
     or position($needle$m.return_id is null and m.tipo='Devolución'$needle$
      in v_payload_definition) = 0 then
    raise exception 'H119_BACKUP_MOVEMENT_SCOPE_INVALID';
  end if;
  if position($needle$select e.folio from pos.exchanges e where e.id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'))$needle$
      in v_execute_definition) = 0 then
    raise exception 'H119_EXCHANGE_MOVEMENT_DELETE_MISSING';
  end if;

  raise notice 'H119_DEFINITION_OK no_op=blocked return=exact+legacy sale_movement=preserved';
end;
$$;

rollback;
