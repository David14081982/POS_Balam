begin;
do $$
declare
 v_user constant uuid := '00000000-0000-0000-0000-000000005691';
 v_new jsonb := '{"folio":"H56-COLLECT-NEW"}';
 v_old jsonb := '{"folio":"H56-COLLECT-OLD"}';
 v_payment jsonb := '[{"monto":100}]';
 v_denied boolean;
begin
 if exists(select 1 from auth.users where id=v_user)
 or exists(select 1 from pos.sellers where id='h56-collect-user')
 or exists(select 1 from pos.sales where folio in ('H56-COLLECT-NEW','H56-COLLECT-OLD'))
 then raise exception 'H56_COLLECT_FIXTURE_COLLISION'; end if;
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000',v_user,'authenticated',
  'authenticated','h56.collect@invalid.local','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());
 insert into pos.sellers(id,nombre,email,role,active)
 values('h56-collect-user','Collect Fixture','h56.collect@invalid.local','vendedor',true);
 insert into pos.user_permission_role_assignments(user_id,role_code,active)
 values(v_user,'vendedor',true);
 insert into pos.sales(folio,fecha,cliente,items,total,metodo,estado)
 values('H56-COLLECT-OLD',now(),'Fixture',0,100,'Apartado','Apartado');
 perform set_config('request.jwt.claim.sub',v_user::text,true);

 perform pos.require_sale_commit_capabilities(v_new,v_payment);
 raise notice 'H56_COLLECT_INITIAL_FAILED=not';
 perform pos.require_sale_commit_capabilities(v_old,v_payment);
 raise notice 'H56_COLLECT_LAYAWAY_FAILED=not';

 insert into pos.user_capability_overrides(user_id,capability_key,effect)
 values(v_user,'sales.collect','deny');
 v_denied:=false;
 begin perform pos.require_sale_commit_capabilities(v_old,v_payment);
 exception when sqlstate '42501' then v_denied:=true; end;
 if not v_denied then raise exception 'H56_COLLECT_DENY_FAILED'; end if;
 delete from pos.user_capability_overrides where user_id=v_user;
 insert into pos.user_capability_overrides(user_id,capability_key,effect)
 values(v_user,'sales.create','deny');
 perform pos.require_sale_commit_capabilities(v_old,v_payment);
 v_denied:=false;
 begin perform pos.require_sale_commit_capabilities(v_new,'[]'::jsonb);
 exception when sqlstate '42501' then v_denied:=true; end;
 if not v_denied then raise exception 'H56_COLLECT_CREATE_DENY_FAILED'; end if;

 delete from pos.user_capability_overrides where user_id=v_user;
 delete from pos.sales where folio='H56-COLLECT-OLD';
 delete from pos.user_permission_role_assignments where user_id=v_user;
 delete from pos.sellers where id='h56-collect-user';
 delete from auth.users where id=v_user;
 if exists(select 1 from auth.users where id=v_user)
 or exists(select 1 from pos.sales where folio='H56-COLLECT-OLD')
 then raise exception 'H56_COLLECT_CLEANUP_FAILED'; end if;
 raise notice 'H56_COLLECT initial=ok layaway=ok deny=ok fixtures_clean=ok';
end; $$;
commit;
