-- H-69 - Verificacion remota autocontenida (R-DB-05, R-DB-10, ADR-004).
--
-- Comprueba el MECANISMO, no el sintoma (AP-09): que la RPC de ajuste exige
-- capacidad, que es idempotente, que detecta un payload distinto bajo la misma
-- operacion, que acredita el importe y deja documento; y que las tres funciones
-- redefinidas conservan la evidencia congelada que se les envia.
--
-- El CLI no imprime `raise notice`, asi que la evidencia va ASEVERADA: que esta
-- migracion no aborte ES la prueba. Todas las semillas se retiran al final.

begin;

do $$
declare
  v_admin constant uuid := '00000000-0000-0000-0000-000000006901';
  v_seller_user constant uuid := '00000000-0000-0000-0000-000000006902';
  v_target constant text := 'h69-adjust-target';
  v_op constant uuid := '00000000-0000-0000-0000-000000006903';
  v_op2 constant uuid := '00000000-0000-0000-0000-000000006904';
  v_exch constant text := 'h69-exchange-fixture';
  v_rows jsonb := '[{"seller_id":"h69-adjust-target","monto":123.45,"ventas":3}]'::jsonb;
  v_result jsonb;
  v_again jsonb;
  v_rejected boolean;
  v_acum numeric;
  v_doc integer;
  v_liq integer;
  v_touched integer;
  v_src text;
  v_ver integer;
  v_imp numeric;
begin
  if exists (select 1 from auth.users where id in (v_admin, v_seller_user))
     or exists (select 1 from pos.sellers
                where id in ('h69-adjust-admin', 'h69-adjust-user', v_target))
     or exists (select 1 from pos.exchanges where id = v_exch) then
    raise exception 'H69_FIXTURE_COLLISION';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin,
     'authenticated', 'authenticated', 'h69.adjust.admin@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_seller_user,
     'authenticated', 'authenticated', 'h69.adjust.user@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into pos.sellers(
    id, nombre, email, role, active, comision_acum, ventas_mes, ventas_num
  ) values
    ('h69-adjust-admin', 'Admin H69', 'h69.adjust.admin@invalid.local', 'admin', true, 0, 0, 0),
    ('h69-adjust-user', 'User H69', 'h69.adjust.user@invalid.local', 'vendedor', true, 0, 0, 0),
    (v_target, 'Target H69', null, 'vendedor', true, 10.00, 0, 0);
  insert into pos.user_permission_role_assignments(user_id, role_code, active)
  values (v_admin, 'admin', true), (v_seller_user, 'vendedor', true);

  -- 1) Sin la capacidad, la RPC rechaza. Se prueba en los DOS sentidos
  --    (R-DEL-11): bloqueada para el vendedor, libre para el administrador.
  perform set_config('request.jwt.claim.sub', v_seller_user::text, true);
  v_rejected := false;
  begin
    perform pos.apply_commission_adjustment_checked(v_op, v_rows, 'H-69');
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H69_ADJUST_UNAUTHORIZED_FAILED';
  end if;

  -- 2) El administrador aplica: acredita, deja documento y fila de historial.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := pos.apply_commission_adjustment_checked(v_op, v_rows, 'H-69');
  select comision_acum into v_acum from pos.sellers where id = v_target;
  if v_acum <> 133.45 then
    raise exception 'H69_ADJUST_NOT_CREDITED: %', v_acum;
  end if;
  if (v_result ->> 'total')::numeric <> 123.45
     or (v_result ->> 'sellers')::integer <> 1 then
    raise exception 'H69_ADJUST_RESULT_MISMATCH: %', v_result;
  end if;
  select count(*) into v_doc from pos.commission_adjustments where operation_id = v_op;
  if v_doc <> 1 then
    raise exception 'H69_ADJUST_DOCUMENT_MISSING';
  end if;
  select count(*) into v_liq
    from pos.liquidations where seller_id = v_target and tipo = 'ajuste';
  if v_liq <> 1 then
    raise exception 'H69_ADJUST_HISTORY_MISSING';
  end if;

  -- 3) Idempotencia: repetir la MISMA operacion no vuelve a acreditar.
  v_again := pos.apply_commission_adjustment_checked(v_op, v_rows, 'H-69');
  select comision_acum into v_acum from pos.sellers where id = v_target;
  if v_acum <> 133.45 then
    raise exception 'H69_ADJUST_NOT_IDEMPOTENT: %', v_acum;
  end if;
  if v_again ->> 'total' <> v_result ->> 'total' then
    raise exception 'H69_ADJUST_IDEMPOTENT_RESULT_MISMATCH';
  end if;

  -- 4) Misma operacion con OTRO payload es un conflicto, no un pago nuevo.
  v_rejected := false;
  begin
    perform pos.apply_commission_adjustment_checked(
      v_op, '[{"seller_id":"h69-adjust-target","monto":999,"ventas":1}]'::jsonb, 'H-69');
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H69_ADJUST_CONFLICT_UNDETECTED';
  end if;

  -- 5) Un payload que no es arreglo se rechaza.
  v_rejected := false;
  begin
    perform pos.apply_commission_adjustment_checked(v_op2, '{"no":"array"}'::jsonb, '');
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'H69_ADJUST_SHAPE_UNCHECKED';
  end if;

  -- 6) `pos.commit_sale_checked` rechaza un desglose que no es arreglo.
  --    Se comprueba el MECANISMO nuevo, no que la venta se guarde.
  v_result := pos.commit_sale_checked(
    'h69-commit-shape', 'h69-op-shape',
    jsonb_build_object('folio', 'H69-SHAPE', 'comisiones', '"no-es-arreglo"'::jsonb),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false);
  if coalesce(v_result ->> 'error', '') <> 'invalid_commission_snapshot' then
    raise exception 'H69_SALE_SNAPSHOT_UNCHECKED: %', v_result;
  end if;

  -- 7) `pos.commit_layaway_liquidation_checked` aplica la misma guarda.
  v_result := pos.commit_layaway_liquidation_checked(
    'h69-lay-shape', 'h69-op-lay', 'H69-LAY', '{}'::jsonb, '[]'::jsonb,
    jsonb_build_object('commission_rows', '"no-es-arreglo"'::jsonb));
  if coalesce(v_result ->> 'error', '') <> 'invalid_commission_snapshot' then
    raise exception 'H69_LAYAWAY_SNAPSHOT_UNCHECKED: %', v_result;
  end if;

  -- 8) `pos.record_exchange_commission_policy` congela importe, origen y version.
  insert into pos.exchanges(id, folio, origen_folio, fecha, comision_monto, comision_pct)
  values (v_exch, 'H69-EX', 'H69-VENTA', now(), 30, 3);
  v_touched := pos.record_exchange_commission_policy(jsonb_build_object(
    'id', v_exch, 'comision_base_importe', 1000, 'comision_source', 'general',
    'comision_policy_version', 1));
  select comision_base_importe, comision_source, comision_policy_version
    into v_imp, v_src, v_ver
    from pos.exchanges where id = v_exch;
  if v_touched <> 1 or v_imp <> 1000 or v_src <> 'general' or v_ver <> 1 then
    raise exception 'H69_EXCHANGE_POLICY_NOT_FROZEN: % % % %', v_touched, v_imp, v_src, v_ver;
  end if;

  -- 9) `pos.unaccent_lower_ok` normaliza acentos y mayusculas: si no lo hiciera,
  --    la busqueda de los perfiles nombrados por el dueno seria un falso verde.
  if pos.unaccent_lower_ok('MÓNICA Duarte') <> 'monica duarte'
     or pos.unaccent_lower_ok('Lupita RIVERA') <> 'lupita rivera' then
    raise exception 'H69_UNACCENT_BROKEN: %', pos.unaccent_lower_ok('MÓNICA Duarte');
  end if;

  -- 10) La frontera sigue viva: `authenticated` no puede escribir los acumulados
  --     directamente. Si alguien retirara el trigger, esto lo denunciaria.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'sellers_restrict_direct_commission_writes' and not tgisinternal
  ) then
    raise exception 'H69_COMMISSION_GUARD_REMOVED';
  end if;

  -- ── Limpieza de semillas ──────────────────────────────────────────────────
  delete from pos.exchanges where id = v_exch;
  delete from pos.liquidations where seller_id = v_target;
  delete from pos.commission_adjustments where operation_id in (v_op, v_op2);
  delete from pos.capability_operation_audit where operation_id in (v_op, v_op2);
  delete from pos.sale_commits where commit_id in ('h69-commit-shape', 'h69-lay-shape');
  delete from pos.sales where folio in ('H69-SHAPE', 'H69-LAY');
  delete from pos.user_permission_role_assignments where user_id in (v_admin, v_seller_user);
  delete from pos.sellers where id in ('h69-adjust-admin', 'h69-adjust-user', v_target);
  delete from auth.users where id in (v_admin, v_seller_user);
  perform set_config('request.jwt.claim.sub', '', true);

  if exists (select 1 from pos.sellers where id like 'h69-%')
     or exists (select 1 from pos.exchanges where id like 'h69-%')
     or exists (select 1 from auth.users where id in (v_admin, v_seller_user)) then
    raise exception 'H69_FIXTURE_LEAK';
  end if;
end;
$$;

commit;
