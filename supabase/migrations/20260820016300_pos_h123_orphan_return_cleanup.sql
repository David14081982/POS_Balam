-- POS BALAM · H-123 · Las evidencias huérfanas de devolución tienen una
-- operación terminal explícita, exacta y técnica. Nunca inventan efectos.
begin;

-- R-DB-03: extender el plan desplegado mediante parches mínimos sobre su
-- definición vigente. El plan, su hash y la ejecución comparten identidades.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(
    pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure),
    E'\r\n',E'\n');
  v_next:=v_definition;

  v_old:='v_returns boolean;';
  v_new:='v_returns boolean;'||E'\n  '||'v_orphan_return_evidence boolean;';
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:declaration';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'returns',true,'exchanges',true$old$;
  v_new:=$new$'returns',true,'orphan_return_evidence',false,'exchanges',true$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:preset';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'returns',coalesce((p_selection->>'returns')::boolean,false),
    'exchanges'$old$;
  v_new:=$new$'returns',coalesce((p_selection->>'returns')::boolean,false),
    'orphan_return_evidence',coalesce((p_selection->>'orphan_return_evidence')::boolean,false),
    'exchanges'$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:custom_selection';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$v_returns := (v_requested->>'returns')::boolean;$old$;
  v_new:=$new$v_returns := (v_requested->>'returns')::boolean;
  v_orphan_return_evidence := (v_requested->>'orphan_return_evidence')::boolean;$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:assignment';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'sales',v_sales,'returns',v_returns,'exchanges',v_exchanges$old$;
  v_new:=$new$'sales',v_sales,'returns',v_returns,
    'orphan_return_evidence',v_orphan_return_evidence,'exchanges',v_exchanges$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:normalized';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$      where v_returns and r.id is null
    ),'[]'::jsonb)
  );$old$;
  v_new:=$new$      where (v_returns or v_orphan_return_evidence) and r.id is null
    ),'[]'::jsonb),
    'orphan_return_commit_ids',coalesce((
      select jsonb_agg(c.commit_id order by c.commit_id)
      from pos.return_commits c left join pos.returns r on r.id=c.return_id
      where v_orphan_return_evidence and r.id is null
    ),'[]'::jsonb),
    'orphan_return_ids',coalesce((
      select jsonb_agg(c.return_id order by c.commit_id)
      from pos.return_commits c left join pos.returns r on r.id=c.return_id
      where v_orphan_return_evidence and r.id is null
    ),'[]'::jsonb)
  );$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:documents';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$if not (v_sales or v_returns or v_exchanges or v_loans or v_commissions or v_reclassifications or v_customers) then$old$;
  v_new:=$new$if not (v_sales or v_returns or v_orphan_return_evidence or v_exchanges or v_loans or v_commissions or v_reclassifications or v_customers) then$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:empty_selection';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$if v_returns and jsonb_array_length(v_documents->'orphan_return_commits')>0 then$old$;
  v_new:=$new$if v_returns and not v_orphan_return_evidence
     and jsonb_array_length(v_documents->'orphan_return_commits')>0 then$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:orphan_guard';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'devoluciones',jsonb_array_length(v_documents->'return_ids'),
    'cambios'$old$;
  v_new:=$new$'devoluciones',jsonb_array_length(v_documents->'return_ids'),
    'evidencias_huerfanas_devolucion',jsonb_array_length(v_documents->'orphan_return_commit_ids'),
    'cambios'$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:counts';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$if (v_sales or v_returns or v_exchanges or v_loans or v_commissions
      or v_reclassifications or v_customers)$old$;
  v_new:=$new$if (v_sales or v_returns or v_orphan_return_evidence or v_exchanges or v_loans or v_commissions
      or v_reclassifications or v_customers)$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:no_matching';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$v_core:=jsonb_build_object('protocol_version',4,'minimum_client_protocol',4,$old$;
  v_new:=$new$v_core:=jsonb_build_object('protocol_version',5,'minimum_client_protocol',5,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_PLAN_PATCH_MISMATCH:protocol';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  if position('orphan_return_commit_ids' in v_next)=0
     or position('v_orphan_return_evidence' in v_next)=0 then
    raise exception 'H123_PLAN_PATCH_NOT_APPLIED';
  end if;
  execute v_next;
end;
$patch$;

-- El respaldo conserva la fila técnica exacta, incluso sin documento comercial.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(
    pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure),
    E'\r\n',E'\n');
  v_old:=$old$where c.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))$old$;
  v_new:=$new$where c.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))
      or c.commit_id in(select jsonb_array_elements_text(p_plan->'documents'->'orphan_return_commit_ids'))$new$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H123_PAYLOAD_PATCH_MISMATCH:return_commits';
  end if;
  v_next:=replace(v_definition,v_old,v_new);
  execute v_next;
end;
$patch$;

-- La ejecución toma los mismos locks de idempotencia que commit_return,
-- vuelve a demostrar que cada commit sigue huérfano y exige cardinalidad exacta.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure),
    E'\r\n',E'\n');
  v_next:=v_definition;

  v_old:=$old$v_stock record;v_idx integer;v_now timestamptz:=statement_timestamp();$old$;
  v_new:=$new$v_stock record;v_orphan record;v_orphan_deleted integer;
  v_idx integer;v_now timestamptz:=statement_timestamp();$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_EXECUTE_PATCH_MISMATCH:declaration';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$select 'return',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'return_ids') x$old$;
  v_new:=$new$select 'return',x,p_cleanup_id from (
      select jsonb_array_elements_text(v_plan->'documents'->'return_ids') x
      union
      select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_ids') x
    ) selected_returns$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_EXECUTE_PATCH_MISMATCH:tombstones';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$  -- H120: restore retained sale state from exact forward evidence.$old$;
  v_new:=$new$  -- H123: evidencia técnica exacta; no toca stock, dinero ni documentos.
  for v_orphan in
    select c.commit_id from pos.return_commits c
    where c.commit_id in(select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids'))
    order by c.commit_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_orphan.commit_id));
  end loop;
  if exists(
    select 1
    from jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids') x(commit_id)
    left join pos.return_commits c on c.commit_id=x.commit_id
    left join pos.returns r on r.id=c.return_id
    where c.commit_id is null or r.id is not null
  ) then
    raise exception 'cleanup_preview_changed';
  end if;
  delete from pos.return_commits c
  where c.commit_id in(select jsonb_array_elements_text(v_plan->'documents'->'orphan_return_commit_ids'))
    and not exists(select 1 from pos.returns r where r.id=c.return_id);
  get diagnostics v_orphan_deleted = row_count;
  if v_orphan_deleted<>jsonb_array_length(v_plan->'documents'->'orphan_return_commit_ids') then
    raise exception 'cleanup_preview_changed';
  end if;

  -- H120: restore retained sale state from exact forward evidence.$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_EXECUTE_PATCH_MISMATCH:orphan_delete';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'protocol_version',4,'minimum_client_protocol',4,$old$;
  v_new:=$new$'protocol_version',5,'minimum_client_protocol',5,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_EXECUTE_PATCH_MISMATCH:result_protocol';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$values(p_cleanup_id,4,4,p_preset,$old$;
  v_new:=$new$values(p_cleanup_id,5,5,p_preset,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_EXECUTE_PATCH_MISMATCH:event_protocol';
  end if;
  v_next:=replace(v_next,v_old,v_new);
  execute v_next;
end;
$patch$;

-- El riesgo de flota trata este dominio técnico como efecto de Devoluciones.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(
    pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure),
    E'\r\n',E'\n');
  v_next:=v_definition;
  v_old:=$old$or coalesce((v_selection->>'returns')::boolean, false) then 'returns' end,$old$;
  v_new:=$new$or coalesce((v_selection->>'returns')::boolean, false)
           or coalesce((v_selection->>'orphan_return_evidence')::boolean, false) then 'returns' end,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_FLEET_PATCH_MISMATCH:domain';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:='coalesce(v_device.schema_version, 0) < 20260819015900';
  v_new:='coalesce(v_device.schema_version, 0) < 20260820016300';
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_FLEET_PATCH_MISMATCH:schema';
  end if;
  v_next:=replace(v_next,v_old,v_new);

  v_old:=$old$'protocol_version', 4,
      'minimum_client_protocol', 4,$old$;
  v_new:=$new$'protocol_version', 5,
      'minimum_client_protocol', 5,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H123_FLEET_PATCH_MISMATCH:protocol';
  end if;
  v_next:=replace(v_next,v_old,v_new);
  execute v_next;
end;
$patch$;

-- El default acompaña al nuevo contrato; el cliente siempre lo envía explícito.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=replace(
    pg_get_functiondef('pos.preview_test_data_cleanup(text,jsonb,integer)'::regprocedure),
    E'\r\n',E'\n');
  v_old:='p_client_protocol integer DEFAULT 4';
  v_new:='p_client_protocol integer DEFAULT 5';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H123_PREVIEW_PATCH_MISMATCH:default_protocol';
  end if;
  v_next:=replace(v_definition,v_old,v_new);
  execute v_next;
end;
$patch$;

update pos.system_manifest
set schema_version=greatest(schema_version,20260820016300),updated_at=now()
where singleton;

commit;
