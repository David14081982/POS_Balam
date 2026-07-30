begin;
do $$
declare
 v_actor constant uuid:='00000000-0000-0000-0000-0000000056a1';
 v_op uuid:='00000000-0000-0000-0000-0000000056a2';
 v_doc jsonb:='{"id":"h56-loan","folio":"PR-H56-001","estado":"pendiente","lineas":[{"key":"x","qty":1,"devueltas":0}],"devoluciones":[]}';
 v_result jsonb; v_denied boolean;
begin
 if exists(select 1 from auth.users where id=v_actor)
 or exists(select 1 from pos.loan_documents where id='h56-loan')
 then raise exception 'H56_LOAN_FIXTURE_COLLISION'; end if;
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000',v_actor,'authenticated',
  'authenticated','h56.loan@invalid.local','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
 insert into pos.sellers(id,nombre,email,role,active)
 values('h56-loan-admin','Loan Fixture','h56.loan@invalid.local','admin',true);
 insert into pos.user_permission_role_assignments(user_id,role_code,active)
 values(v_actor,'admin',true);
 perform set_config('request.jwt.claim.sub',v_actor::text,true);
 v_result:=pos.commit_loan_operation(v_op,'deliver',v_doc,0);
 if (v_result->>'_loanVersion')::bigint<>1 then
  raise exception 'H56_LOAN_TRANSITION_FAILED'; end if;
 v_op:='00000000-0000-0000-0000-0000000056a3';
 v_doc:=jsonb_set(v_doc,'{nota}','"editado"');
 v_result:=pos.commit_loan_operation(v_op,'edit',v_doc,1);
 if (v_result->>'_loanVersion')::bigint<>2 then
  raise exception 'H56_LOAN_TRANSITION_FAILED'; end if;
 insert into pos.user_capability_overrides(user_id,capability_key,effect)
 values(v_actor,'inventory.loan.close','deny');
 v_denied:=false;
 begin
  perform pos.commit_loan_operation(
   '00000000-0000-0000-0000-0000000056a4','return',
   jsonb_set(v_doc,'{estado}','"devuelto"'),2);
 exception when sqlstate '42501' then v_denied:=true; end;
 if not v_denied then raise exception 'H56_LOAN_DENY_FAILED'; end if;
 if (select version from pos.loan_documents where id='h56-loan')<>2 then
  raise exception 'H56_LOAN_TRANSITION_FAILED'; end if;
 delete from pos.user_capability_overrides where user_id=v_actor;
 v_result:=pos.commit_loan_operation(
  '00000000-0000-0000-0000-0000000056a5','shortage',
  jsonb_set(v_doc,'{estado}','"no_devuelto"'),2);
 v_result:=pos.commit_loan_operation(
  '00000000-0000-0000-0000-0000000056a6','reopen',
  jsonb_set(v_doc,'{estado}','"pendiente"'),3);
 if (v_result->>'_loanVersion')::bigint<>4 then
  raise exception 'H56_LOAN_TRANSITION_FAILED'; end if;
 delete from pos.capability_operation_audit where subject_key='h56-loan';
 delete from pos.loan_documents where id='h56-loan';
 delete from pos.user_permission_role_assignments where user_id=v_actor;
 delete from pos.sellers where id='h56-loan-admin';
 delete from auth.users where id=v_actor;
 if exists(select 1 from pos.loan_documents where id='h56-loan')
 or exists(select 1 from pos.capability_operation_audit where subject_key='h56-loan')
 then raise exception 'H56_LOAN_CLEANUP_FAILED'; end if;
 raise notice 'H56_LOAN transitions=ok deny=ok audit=ok fixtures_clean=ok';
end; $$;
commit;
