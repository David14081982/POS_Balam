-- POS BALAM · H-120 · Estado de venta coherente al limpiar Devoluciones.
--
-- Migración aditiva y hacia adelante. No reinterpreta históricos: NULL significa
-- que el estado anterior no puede demostrarse y el preview falla cerrado.

begin;

alter table pos.returns add column if not exists prior_sale_state text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='pos.returns'::regclass
      and conname='returns_prior_sale_state_valid'
  ) then
    alter table pos.returns add constraint returns_prior_sale_state_valid
      check(prior_sale_state is null or prior_sale_state in('Pagado','Entregado','Enviado'));
  end if;
end;
$$;

comment on column pos.returns.prior_sale_state is
  'H-120: estado exacto de la venta antes de su primera devolución; NULL = histórico no demostrable.';

-- La RPC conserva el snapshot opcional sólo después del commit autoritativo.
-- Clientes anteriores siguen funcionando y dejan NULL; nunca se les inventa un estado.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef(
    'pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  if position('prior_sale_state=case' in v_definition)=0 then
    v_old:=$old$perform pos.h94_assert_v2_document_items(p_items);$old$;
    v_new:=$new$perform pos.h94_assert_v2_document_items(p_items);
  if p_return ? 'prior_sale_state' and p_return->'prior_sale_state'<>'null'::jsonb
     and p_return->>'prior_sale_state' not in('Pagado','Entregado','Enviado') then
    return jsonb_build_object('ok',false,'error','invalid_prior_sale_state');
  end if;$new$;
    if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
      raise exception 'H120_RETURN_PATCH_MISMATCH:validation';
    end if;
    v_next:=replace(v_definition,v_old,v_new);

    v_old:=$old$update pos.returns set comisiones=case when p_return ? 'comisiones' then p_return->'comisiones' else comisiones end where id=p_return->>'id';$old$;
    v_new:=$new$update pos.returns set
      comisiones=case when p_return ? 'comisiones' then p_return->'comisiones' else comisiones end,
      prior_sale_state=case when p_return ? 'prior_sale_state'
        then nullif(p_return->>'prior_sale_state','') else prior_sale_state end
    where id=p_return->>'id';$new$;
    if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
      raise exception 'H120_RETURN_PATCH_MISMATCH:persistence';
    end if;
    v_next:=replace(v_next,v_old,v_new);
    if position('prior_sale_state=case' in v_next)=0 then
      raise exception 'H120_RETURN_PATCH_NOT_APPLIED';
    end if;
    execute v_next;
  end if;
end;
$patch$;

-- El plan distingue tres cosas:
-- 1) devoluciones completas y borrables;
-- 2) estado exacto que debe recuperar una venta conservada;
-- 3) commits huérfanos que son evidencia, no documentos borrables.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef('pos.test_data_cleanup_plan(text,jsonb)'::regprocedure);
  if position('sale_state_restorations' in v_definition)=0 then
    v_old:=$old$) into v_documents;$old$;
    v_new:=$new$) into v_documents;

  v_documents:=v_documents||jsonb_build_object(
    'sale_state_restorations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'folio',x.folio,'prior_state',x.prior_state,
        'evidence_count',x.evidence_count,'distinct_states',x.distinct_states)
        order by x.folio)
      from (
        select r.folio,min(r.prior_sale_state) as prior_state,
          count(*) filter(where r.prior_sale_state is not null) as evidence_count,
          count(distinct r.prior_sale_state) filter(where r.prior_sale_state is not null) as distinct_states
        from pos.returns r
        where v_returns and not v_sales
          and r.id in(select jsonb_array_elements_text(v_documents->'return_ids'))
        group by r.folio
      ) x
    ),'[]'::jsonb),
    'orphan_return_commits',coalesce((
      select jsonb_agg(jsonb_build_object(
        'commit_id',c.commit_id,'return_id',c.return_id,'folio',c.folio,
        'created_at',c.created_at) order by c.created_at,c.commit_id)
      from pos.return_commits c left join pos.returns r on r.id=c.return_id
      where v_returns and r.id is null
    ),'[]'::jsonb)
  );$new$;
    if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
      raise exception 'H120_PLAN_PATCH_MISMATCH:documents';
    end if;
    v_next:=replace(v_definition,v_old,v_new);

    v_old:=$old$  v_core:=jsonb_build_object('protocol_version',2,'minimum_client_protocol',2,$old$;
    v_new:=$new$  if v_returns and not v_sales and exists(
    select 1 from jsonb_to_recordset(v_documents->'sale_state_restorations')
      as x(folio text,prior_state text,evidence_count integer,distinct_states integer)
    where x.evidence_count=0 or x.distinct_states<>1
       or x.prior_state not in('Pagado','Entregado','Enviado')
  ) then
    v_reasons:=jsonb_build_array(jsonb_build_object(
      'code','return_state_evidence_missing',
      'folios',(select coalesce(jsonb_agg(x.folio order by x.folio),'[]'::jsonb)
        from jsonb_to_recordset(v_documents->'sale_state_restorations')
          as x(folio text,prior_state text,evidence_count integer,distinct_states integer)
        where x.evidence_count=0 or x.distinct_states<>1
           or x.prior_state not in('Pagado','Entregado','Enviado'))
    ))||v_reasons;
  end if;
  if v_returns and jsonb_array_length(v_documents->'orphan_return_commits')>0 then
    v_reasons:=jsonb_build_array(jsonb_build_object(
      'code','orphan_return_evidence',
      'documents',v_documents->'orphan_return_commits'
    ))||v_reasons;
  end if;
  v_core:=jsonb_build_object('protocol_version',4,'minimum_client_protocol',4,$new$;
    if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
      raise exception 'H120_PLAN_PATCH_MISMATCH:guards';
    end if;
    v_next:=replace(v_next,v_old,v_new);
    if position('orphan_return_evidence' in v_next)=0
       or position('return_state_evidence_missing' in v_next)=0 then
      raise exception 'H120_PLAN_PATCH_NOT_APPLIED';
    end if;
    execute v_next;
  end if;
end;
$patch$;

-- El respaldo incluye la venta conservada porque la ejecución restaurará su
-- estado. Sus renglones, pagos, commit y movimiento no se borran ni se alteran.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef('pos.test_data_cleanup_payload(jsonb)'::regprocedure);
  if position($needle$p_plan->'documents'->'sale_state_restorations'$needle$ in v_definition)=0 then
    v_old:=$old$from pos.sales s where s.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))$old$;
    v_new:=$new$from pos.sales s where s.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))
      or s.folio in(select x->>'folio' from jsonb_array_elements(p_plan->'documents'->'sale_state_restorations') x)$new$;
    if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
      raise exception 'H120_PAYLOAD_PATCH_MISMATCH:sales';
    end if;
    v_next:=replace(v_definition,v_old,v_new);
    execute v_next;
  end if;
end;
$patch$;

-- Restauración y borrado comparten transacción/lock/plan hash. El resultado y
-- el evento llevan el mismo estado para que cada terminal aplique la proyección.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef(
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure);
  if position('H120: restore retained sale state' in v_definition)=0 then
    v_old:=$old$  delete from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));$old$;
    v_new:=$new$  -- H120: restore retained sale state from exact forward evidence.
  update pos.sales s set estado=x.prior_state
  from jsonb_to_recordset(v_plan->'documents'->'sale_state_restorations')
    as x(folio text,prior_state text,evidence_count integer,distinct_states integer)
  where s.folio=x.folio
    and s.folio not in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));$new$;
    if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
      raise exception 'H120_EXECUTE_PATCH_MISMATCH:restore';
    end if;
    v_next:=replace(v_definition,v_old,v_new);

    v_old:=$old$'protocol_version',3,'minimum_client_protocol',3,$old$;
    v_new:=$new$'protocol_version',4,'minimum_client_protocol',4,$new$;
    if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
      raise exception 'H120_EXECUTE_PATCH_MISMATCH:protocol';
    end if;
    v_next:=replace(v_next,v_old,v_new);

    v_old:=$old$'identities',v_plan->'documents','stock',v_plan->'stock');$old$;
    v_new:=$new$'identities',v_plan->'documents','stock',v_plan->'stock',
    'sale_states',v_plan->'documents'->'sale_state_restorations');$new$;
    if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
      raise exception 'H120_EXECUTE_PATCH_MISMATCH:result';
    end if;
    v_next:=replace(v_next,v_old,v_new);

    v_old:=$old$values(p_cleanup_id,3,3,p_preset,$old$;
    v_new:=$new$values(p_cleanup_id,4,4,p_preset,$new$;
    if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
      raise exception 'H120_EXECUTE_PATCH_MISMATCH:event';
    end if;
    v_next:=replace(v_next,v_old,v_new);
    execute v_next;
  end if;
end;
$patch$;

-- H-118 sigue clasificando la flota; protocolo 4 hace que el cliente anterior
-- ignore el evento nuevo y quede cercado por la época hasta rebootstrap.
do $patch$
declare v_definition text;v_next text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure);
  v_next:=v_definition;
  v_old:=$old$coalesce(v_device.schema_version, 0) < 20260818015300$old$;
  v_new:=$new$coalesce(v_device.schema_version, 0) < 20260819015900$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H120_FLEET_PATCH_MISMATCH:schema';
  end if;
  v_next:=replace(v_next,v_old,v_new);
  v_old:=$old$'protocol_version', 3,
      'minimum_client_protocol', 3,$old$;
  v_new:=$new$'protocol_version', 4,
      'minimum_client_protocol', 4,$new$;
  if (length(v_next)-length(replace(v_next,v_old,'')))<>length(v_old) then
    raise exception 'H120_FLEET_PATCH_MISMATCH:protocol';
  end if;
  v_next:=replace(v_next,v_old,v_new);
  execute v_next;
end;
$patch$;

create or replace function pos.preview_test_data_cleanup(
  p_preset text default 'operations',p_selection jsonb default '{}'::jsonb,
  p_client_protocol integer default 4
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pos
as $$
declare v_plan jsonb;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  v_plan:=pos.test_data_cleanup_fleet_risk(pos.test_data_cleanup_plan(p_preset,p_selection));
  if coalesce(p_client_protocol,0)<(v_plan->>'minimum_client_protocol')::integer then
    return jsonb_set(jsonb_set(v_plan,'{executable}','false'::jsonb),'{blocked_reasons}',
      (v_plan->'blocked_reasons')||jsonb_build_array('minimum_client_protocol'));
  end if;
  return v_plan;
end;
$$;

update pos.system_manifest set
  schema_version=greatest(schema_version,20260819015900),updated_at=now()
where singleton;

commit;
