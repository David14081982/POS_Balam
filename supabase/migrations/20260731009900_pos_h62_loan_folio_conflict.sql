-- H-62 · El folio de préstamo choca entre terminales y bloquea la cola
--
-- `pos.loan_documents.folio` es UNIQUE y el consecutivo `PR-{AAMMDD}-{NNN}` se
-- deriva de los préstamos que conoce cada terminal. Dos terminales sin conexión
-- el mismo día generan el mismo folio; la segunda entrega chocaba contra la
-- restricción y salía como excepción `23505`, que el cliente clasifica como
-- `blocked_data` NO reintentable: ese préstamo quedaba atorado en la campana
-- para siempre y nunca llegaba a la nube.
--
-- Ventas ya resolvió exactamente este problema (H-33): `commit_sale()` devuelve
-- `folio_conflict` de forma ESTRUCTURADA, el cliente pide otro número, conserva
-- el folio ya impreso como alias y reintenta. Esta migración le da a los
-- préstamos el mismo contrato; no inventa un segundo modelo.
--
-- Cambio único respecto de `20260730009500`: el `insert` de la rama `deliver`
-- queda envuelto en un bloque que convierte la violación de unicidad en la
-- respuesta estructurada. Se devuelve ANTES de escribir en
-- `pos.capability_operation_audit`, de modo que el mismo `p_operation_id` puede
-- reintentarse con el folio corregido sin chocar contra la idempotencia. El
-- resto del cuerpo es idéntico byte a byte al desplegado (`R-DB-03` · `AP-05`).
--
-- Aditiva y no destructiva: no toca datos, no cambia permisos, no altera
-- ninguna otra transición. Reversión: reinstalar el cuerpo de `20260730009500`.
begin;
create or replace function pos.commit_loan_operation(
 p_operation_id uuid,p_action text,p_loan jsonb,p_expected_version bigint default 0
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_id text:=p_loan->>'id'; v_folio text:=p_loan->>'folio';
 v_new_state text:=p_loan->>'estado'; v_old pos.loan_documents%rowtype;
 v_cap text:='inventory.loan.'||p_action; v_hash text;
 v_result jsonb; v_has_events boolean;
begin
 if p_action not in('deliver','return','shortage','edit','delete','reopen')
 or p_operation_id is null or nullif(trim(v_id),'') is null then
  raise exception 'INVALID_LOAN_OPERATION' using errcode='22023';
 end if;
 perform pos.require_current_capability(v_cap);
 perform pg_advisory_xact_lock(hashtext(v_id));
 v_hash:=md5(jsonb_build_array(p_action,p_loan,p_expected_version)::text);
 select result into v_result from pos.capability_operation_audit
  where operation_id=p_operation_id and capability_key=v_cap and payload_hash=v_hash;
 if found then return v_result; end if;
 if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id)
 then raise exception 'LOAN_OPERATION_CONFLICT' using errcode='40001'; end if;
 select * into v_old from pos.loan_documents where id=v_id for update;

 if p_action='deliver' then
  -- H-62: la entrega admite los TRES estados del contrato, no sólo `pendiente`.
  -- La migración de los préstamos que vivían sólo en una terminal debe poder
  -- adoptar documentos ya cerrados —devueltos o dados por no devueltos—
  -- conservando su estado, sus devoluciones y sus fechas originales. Un
  -- documento adoptado con devoluciones nace con `has_events`, de modo que las
  -- guardas de edición y baja lo protegen igual que si hubiera nacido aquí.
  if found or v_new_state not in('pendiente','devuelto','no_devuelto')
  or nullif(trim(v_folio),'') is null
  or jsonb_typeof(p_loan->'lineas')<>'array'
  or jsonb_array_length(p_loan->'lineas')=0 then
   raise exception 'INVALID_LOAN_DELIVERY' using errcode='22023'; end if;
  v_has_events:=v_new_state<>'pendiente'
   or coalesce(jsonb_array_length(nullif(p_loan->'devoluciones','null'::jsonb)),0)>0;
  -- Choque de folio entre terminales. Se captura la violación de unicidad en
  -- lugar de comprobar antes con un `select`, porque así queda cubierta también
  -- la carrera entre dos entregas simultáneas: el candado de arriba serializa
  -- por `id`, no por folio.
  begin
   insert into pos.loan_documents(id,folio,state,document,has_events)
   values(v_id,v_folio,v_new_state,p_loan,v_has_events);
  exception when unique_violation then
   return jsonb_build_object('ok',false,'error','folio_conflict');
  end;
 else
  if not found or v_old.deleted_at is not null
  then raise exception 'LOAN_NOT_FOUND' using errcode='P0002'; end if;
  if v_old.version<>coalesce(p_expected_version,0)
  then raise exception 'LOAN_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_action in('edit','delete') and
    (v_old.has_events or v_old.state<>'pendiente') then
   raise exception 'LOAN_ALREADY_HAS_EFFECTS' using errcode='23514'; end if;
  if p_action='return' then
   if v_old.state='devuelto' or v_new_state not in('pendiente','devuelto')
   then raise exception 'INVALID_LOAN_RETURN' using errcode='23514'; end if;
   if v_old.state='no_devuelto' then
    perform pos.require_current_capability('inventory.loan.reopen');
   end if;
   if v_new_state='devuelto' then
    perform pos.require_current_capability('inventory.loan.close');
   end if;
   v_has_events:=true;
  elsif p_action='shortage' then
   if v_old.state<>'pendiente' or v_new_state<>'no_devuelto'
   then raise exception 'INVALID_LOAN_SHORTAGE' using errcode='23514'; end if;
   perform pos.require_current_capability('inventory.loan.close');
   v_has_events:=true;
  elsif p_action='reopen' then
   if v_old.state<>'no_devuelto' or v_new_state<>'pendiente'
   then raise exception 'INVALID_LOAN_REOPEN' using errcode='23514'; end if;
   v_has_events:=true;
  elsif p_action='delete' then
   update pos.loan_documents set deleted_at=now(),version=version+1,updated_at=now()
    where id=v_id returning jsonb_build_object('id',id,'version',version,
      'deleted_at',deleted_at) into v_result;
  end if;
  if p_action<>'delete' then
   update pos.loan_documents set document=p_loan,state=v_new_state,
    has_events=coalesce(v_has_events,has_events),version=version+1,updated_at=now()
   where id=v_id returning document||jsonb_build_object('_loanVersion',version)
    into v_result;
  end if;
 end if;
 if p_action='deliver' then
  select document||jsonb_build_object('_loanVersion',version) into v_result
  from pos.loan_documents where id=v_id;
 end if;
 insert into pos.capability_operation_audit(operation_id,capability_key,
  actor_user_id,subject_key,payload_hash,result)
 values(p_operation_id,v_cap,v_actor,v_id,v_hash,v_result);
 return v_result;
end; $$;
revoke all on function pos.commit_loan_operation(uuid,text,jsonb,bigint)
 from public,anon;
grant execute on function pos.commit_loan_operation(uuid,text,jsonb,bigint)
 to authenticated;
commit;
