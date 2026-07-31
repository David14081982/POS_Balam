-- H-62 · Verificación autocontenida del choque de folio de préstamos
--
-- Comprueba el MECANISMO, no el síntoma (`AP-09` · `FF-10`): si se retirase el
-- bloque que convierte la violación de unicidad en `folio_conflict`, la primera
-- comprobación abortaría con excepción en lugar de fallar silenciosamente.
--
-- Comprueba además las defensas que NO debían cambiar al redefinir la función
-- viva (`AP-05`): versión esperada, bloqueo de edición después del primer efecto
-- y denegación por capacidad. Una redefinición que las perdiera pasaría
-- cualquier prueba del folio y rompería el resto del contrato.
--
-- Elimina sus propias semillas y aborta si alguna sobrevive (`R-DB-05`).
begin;
do $$
declare
 v_actor constant uuid:='00000000-0000-0000-0000-0000000062a1';
 v_op_a  constant uuid:='00000000-0000-0000-0000-0000000062a2';
 v_op_b  constant uuid:='00000000-0000-0000-0000-0000000062a3';
 v_op_c  constant uuid:='00000000-0000-0000-0000-0000000062a4';
 v_op_d  constant uuid:='00000000-0000-0000-0000-0000000062a5';
 v_op_e  constant uuid:='00000000-0000-0000-0000-0000000062a6';
 v_op_f  constant uuid:='00000000-0000-0000-0000-0000000062a7';
 v_op_g  constant uuid:='00000000-0000-0000-0000-0000000062a8';
 v_folio constant text:='PR-H62-001';
 v_doc_a jsonb:=jsonb_build_object('id','h62-loan-a','folio',v_folio,
   'estado','pendiente','devoluciones','[]'::jsonb,
   'lineas',jsonb_build_array(jsonb_build_object('key','SKU|M','qty',2,'devueltas',0)));
 v_doc_b jsonb:=jsonb_build_object('id','h62-loan-b','folio',v_folio,
   'estado','pendiente','devoluciones','[]'::jsonb,
   'lineas',jsonb_build_array(jsonb_build_object('key','SKU|L','qty',1,'devueltas',0)));
 v_result jsonb; v_denied boolean;
begin
 if exists(select 1 from auth.users where id=v_actor)
 or exists(select 1 from pos.loan_documents where id in('h62-loan-a','h62-loan-b','h62-loan-c'))
 or exists(select 1 from pos.loan_documents where folio like 'PR-H62-%')
 then raise exception 'H62_LOAN_FIXTURE_COLLISION'; end if;

 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000',v_actor,'authenticated',
  'authenticated','h62.loan@invalid.local','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
 insert into pos.sellers(id,nombre,email,role,active)
 values('h62-loan-admin','Loan Folio Fixture','h62.loan@invalid.local','admin',true);
 insert into pos.user_permission_role_assignments(user_id,role_code,active)
 values(v_actor,'admin',true);
 perform set_config('request.jwt.claim.sub',v_actor::text,true);

 -- 1) La primera terminal entrega y ocupa el folio.
 v_result:=pos.commit_loan_operation(v_op_a,'deliver',v_doc_a,0);
 if (v_result->>'_loanVersion')::bigint<>1 then
  raise exception 'H62_DELIVER_FAILED'; end if;

 -- 2) La segunda terminal genera el MISMO folio. Debe recibir una respuesta
 --    estructurada, no una excepción: si esto abortase, el cliente volvería a
 --    quedar con la operación bloqueada para siempre, que es el defecto.
 v_result:=pos.commit_loan_operation(v_op_b,'deliver',v_doc_b,0);
 if v_result is null or coalesce((v_result->>'ok')::boolean,true)
 or v_result->>'error'<>'folio_conflict' then
  raise exception 'H62_FOLIO_CONFLICT_NOT_STRUCTURED: %',coalesce(v_result::text,'null');
 end if;
 if exists(select 1 from pos.loan_documents where id='h62-loan-b') then
  raise exception 'H62_CONFLICT_WROTE_DOCUMENT'; end if;
 -- 3) El choque NO envenena la idempotencia: no deja rastro auditado, de modo
 --    que el MISMO identificador de operación puede reintentarse corregido.
 if exists(select 1 from pos.capability_operation_audit where operation_id=v_op_b) then
  raise exception 'H62_CONFLICT_POISONED_AUDIT'; end if;

 -- 4) Reintento con el folio reidentificado, misma operación.
 v_result:=pos.commit_loan_operation(v_op_b,'deliver',
   jsonb_set(v_doc_b,'{folio}',to_jsonb(v_folio||'-T7Q')),0);
 if (v_result->>'_loanVersion')::bigint<>1
 or v_result->>'folio'<>v_folio||'-T7Q' then
  raise exception 'H62_REKEY_FAILED: %',coalesce(v_result::text,'null'); end if;

 -- 5) El documento de la primera terminal quedó intacto.
 if (select version from pos.loan_documents where id='h62-loan-a')<>1
 or (select folio from pos.loan_documents where id='h62-loan-a')<>v_folio then
  raise exception 'H62_FIRST_DOCUMENT_ALTERED'; end if;

 -- 6) Defensas que NO debían cambiar. Versión esperada.
 v_denied:=false;
 begin
  perform pos.commit_loan_operation(v_op_c,'edit',
    jsonb_set(v_doc_a,'{nota}','"desde una versión vieja"'),5);
 exception when sqlstate '40001' then v_denied:=true; end;
 if not v_denied then raise exception 'H62_VERSION_GUARD_LOST'; end if;

 -- 7) Después del primer efecto la edición queda cerrada.
 v_result:=pos.commit_loan_operation(v_op_c,'return',
   jsonb_set(v_doc_a,'{lineas,0,devueltas}','1'),1);
 if (v_result->>'_loanVersion')::bigint<>2 then
  raise exception 'H62_RETURN_FAILED'; end if;
 v_denied:=false;
 begin
  perform pos.commit_loan_operation(v_op_d,'edit',
    jsonb_set(v_doc_a,'{nota}','"tarde"'),2);
 exception when sqlstate '23514' then v_denied:=true; end;
 if not v_denied then raise exception 'H62_EVENT_GUARD_LOST'; end if;

 -- 8) Adopción de un préstamo histórico YA CERRADO: la migración de los
 --    documentos que vivían sólo en una terminal debe conservar su estado y sus
 --    devoluciones, y quedar protegida contra edición posterior.
 v_result:=pos.commit_loan_operation(v_op_f,'deliver',
   jsonb_build_object('id','h62-loan-c','folio','PR-H62-009','estado','devuelto',
     'fecha','2025-01-01 09:30','fechaDevolucion','2025-01-05 12:00',
     'devoluciones',jsonb_build_array(jsonb_build_object('fecha','2025-01-05 12:00','qty',2)),
     'lineas',jsonb_build_array(jsonb_build_object('key','SKU|M','qty',2,'devueltas',2))),0);
 if (v_result->>'_loanVersion')::bigint<>1 then
  raise exception 'H62_ADOPT_CLOSED_FAILED: %',coalesce(v_result::text,'null'); end if;
 if (select state from pos.loan_documents where id='h62-loan-c')<>'devuelto'
 or (select document->>'fecha' from pos.loan_documents where id='h62-loan-c')<>'2025-01-01 09:30'
 then raise exception 'H62_ADOPT_LOST_EVIDENCE'; end if;
 if not (select has_events from pos.loan_documents where id='h62-loan-c') then
  raise exception 'H62_ADOPT_UNPROTECTED'; end if;
 v_denied:=false;
 begin
  perform pos.commit_loan_operation(v_op_g,'edit',
    jsonb_build_object('id','h62-loan-c','folio','PR-H62-009','estado','devuelto',
      'lineas',jsonb_build_array(jsonb_build_object('key','SKU|M','qty',2,'devueltas',2))),1);
 exception when sqlstate '23514' then v_denied:=true; end;
 if not v_denied then raise exception 'H62_ADOPTED_DOCUMENT_EDITABLE'; end if;

 -- 9) La denegación por capacidad sigue viva.
 insert into pos.user_capability_overrides(user_id,capability_key,effect)
 values(v_actor,'inventory.loan.shortage','deny');
 v_denied:=false;
 begin
  perform pos.commit_loan_operation(v_op_e,'shortage',
    jsonb_set(jsonb_set(v_doc_a,'{estado}','"no_devuelto"'),'{lineas,0,devueltas}','1'),2);
 exception when sqlstate '42501' then v_denied:=true; end;
 if not v_denied then raise exception 'H62_CAPABILITY_GUARD_LOST'; end if;
 if (select version from pos.loan_documents where id='h62-loan-a')<>2 then
  raise exception 'H62_DENIED_OPERATION_WROTE'; end if;

 -- Limpieza de semillas.
 delete from pos.user_capability_overrides where user_id=v_actor;
 delete from pos.capability_operation_audit where subject_key in('h62-loan-a','h62-loan-b','h62-loan-c');
 delete from pos.loan_documents where id in('h62-loan-a','h62-loan-b','h62-loan-c');
 delete from pos.user_permission_role_assignments where user_id=v_actor;
 delete from pos.sellers where id='h62-loan-admin';
 delete from auth.users where id=v_actor;
 if exists(select 1 from pos.loan_documents where folio like 'PR-H62-%')
 or exists(select 1 from pos.capability_operation_audit
   where subject_key in('h62-loan-a','h62-loan-b','h62-loan-c'))
 or exists(select 1 from auth.users where id=v_actor)
 then raise exception 'H62_CLEANUP_FAILED'; end if;

 raise notice 'H62_LOAN folio_conflict=structured audit_clean=ok rekey=ok version_guard=ok event_guard=ok capability_guard=ok fixtures_clean=ok';
end; $$;
commit;
