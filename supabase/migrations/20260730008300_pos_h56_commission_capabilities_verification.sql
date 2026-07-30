-- H-56 Fase 5 grupo 1: verificación remota autocontenida.

begin;

do $$
declare
  v_admin constant uuid := '00000000-0000-0000-0000-000000005661';
  v_seller_user constant uuid := '00000000-0000-0000-0000-000000005662';
  v_target constant text := 'h56-commission-target';
  v_settle constant uuid := '00000000-0000-0000-0000-000000005663';
  v_close constant uuid := '00000000-0000-0000-0000-000000005664';
  v_result jsonb;
  v_rejected boolean;
  v_audit integer;
begin
  if exists (
    select 1 from auth.users where id in (v_admin, v_seller_user)
  ) or exists (
    select 1 from pos.sellers
    where id in ('h56-commission-admin', 'h56-commission-user', v_target)
  ) then
    raise exception 'H56_COMMISSION_FIXTURE_COLLISION';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin,
     'authenticated', 'authenticated', 'h56.commission.admin@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_seller_user,
     'authenticated', 'authenticated', 'h56.commission.user@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into pos.sellers(
    id, nombre, email, role, active, comision_acum, ventas_mes, ventas_num
  ) values
    ('h56-commission-admin', 'Admin Fixture',
     'h56.commission.admin@invalid.local', 'admin', true, 0, 0, 0),
    ('h56-commission-user', 'User Fixture',
     'h56.commission.user@invalid.local', 'vendedor', true, 0, 0, 0),
    (v_target, 'Target Fixture', null, 'vendedor', true, 125.50, 1000, 2);
  insert into pos.user_permission_role_assignments(user_id, role_code, active)
  values (v_admin, 'admin', true), (v_seller_user, 'vendedor', true);

  perform set_config('request.jwt.claim.sub', v_seller_user::text, true);
  v_rejected := false;
  begin
    perform pos.settle_commission_checked(v_settle, v_target);
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H56_COMMISSION_UNAUTHORIZED_FAILED';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := pos.settle_commission_checked(v_settle, v_target);
  if (v_result ->> 'amount')::numeric <> 125.50
     or (select comision_acum from pos.sellers where id = v_target) <> 0
     or (select count(*) from pos.liquidations
         where id = 'liq-' || v_settle::text) <> 1 then
    raise exception 'H56_COMMISSION_ATOMICITY_FAILED';
  end if;
  if pos.settle_commission_checked(v_settle, v_target) <> v_result
     or (select count(*) from pos.liquidations
         where id = 'liq-' || v_settle::text) <> 1 then
    raise exception 'H56_COMMISSION_IDEMPOTENCY_FAILED';
  end if;

  update pos.sellers
  set comision_acum = 75, ventas_mes = 500, ventas_num = 1
  where id = v_target;
  v_result := pos.close_commission_period_internal(v_close, array[v_target]);
  if (v_result ->> 'total')::numeric <> 75
     or (select comision_acum + ventas_mes + ventas_num
         from pos.sellers where id = v_target) <> 0
     or (select count(*) from pos.liquidations
         where id = 'cut-' || v_close::text || '-' || v_target) <> 1 then
    raise exception 'H56_COMMISSION_CLOSE_FAILED';
  end if;

  select count(*) into v_audit
  from pos.capability_operation_audit
  where operation_id in (v_settle, v_close)
    and actor_user_id = v_admin;
  if v_audit <> 2 then raise exception 'H56_COMMISSION_AUDIT_FAILED'; end if;

  if has_function_privilege('public',
       'pos.settle_commission_checked(uuid,text)', 'execute')
     or has_function_privilege('anon',
       'pos.settle_commission_checked(uuid,text)', 'execute')
     or not has_function_privilege('authenticated',
       'pos.settle_commission_checked(uuid,text)', 'execute')
     or has_table_privilege('authenticated', 'pos.liquidations', 'insert')
     or has_table_privilege('authenticated', 'pos.liquidations', 'update')
     or has_table_privilege('authenticated', 'pos.liquidations', 'delete') then
    raise exception 'H56_COMMISSION_ACL_FAILED';
  end if;

  delete from pos.capability_operation_audit
  where operation_id in (v_settle, v_close);
  delete from pos.liquidations
  where id in ('liq-' || v_settle::text, 'cut-' || v_close::text || '-' || v_target);
  delete from pos.user_permission_role_assignments
  where user_id in (v_admin, v_seller_user);
  delete from pos.sellers
  where id in ('h56-commission-admin', 'h56-commission-user', v_target);
  delete from auth.users where id in (v_admin, v_seller_user);

  if exists (
    select 1 from pos.capability_operation_audit
    where operation_id in (v_settle, v_close)
  ) or exists (
    select 1 from auth.users where id in (v_admin, v_seller_user)
  ) then
    raise exception 'H56_COMMISSION_FIXTURE_CLEANUP_FAILED';
  end if;
  raise notice 'H56_COMMISSIONS auth=ok atomic=ok idempotent=ok acl=ok fixtures_clean=ok';
end;
$$;

commit;
