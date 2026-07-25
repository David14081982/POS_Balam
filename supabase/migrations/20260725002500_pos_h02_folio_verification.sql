-- POS Balam — H-02: verificación autocontenida de folios multi-terminal.

do $$
declare
  v_seller pos.sellers%rowtype;
  v_result jsonb;
  v_requested_folio text := 'H02-VERIFY-1043';
  v_reconciled_folio text := 'H02-VERIFY-1043-6DFZH5IK5UXYNZMLF5CSHAMDK';
  v_first_operation text := '550e8400-e29b-41d4-a716-446655440000';
  v_second_operation text := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  v_email text := 'h02-folio-verify@invalid.local';
begin
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_seller.id is null then
    raise exception 'H-02 requiere una semilla de vendedor para verificar permisos';
  end if;

  v_seller.id := 'h02-folio-verify-seller';
  v_seller.nombre := 'Vendedor temporal H02';
  v_seller.email := v_email;
  v_seller.role := 'vendedor';
  v_seller.active := true;
  v_seller.sync_version := 0;
  v_seller.sync_base_version := 0;
  v_seller.sync_device_id := null;
  v_seller.deleted_at := null;
  insert into pos.sellers values (v_seller.*);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text,
    true
  );

  v_result := pos.commit_sale(
    'h02-folio-first-commit',
    v_first_operation,
    jsonb_build_object(
      'folio', v_requested_folio, 'operation_id', v_first_operation,
      'fecha', '2026-07-25T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-02 no confirmó la primera venta: %', v_result;
  end if;

  v_result := pos.commit_sale(
    'h02-folio-second-commit',
    v_second_operation,
    jsonb_build_object(
      'folio', v_requested_folio, 'operation_id', v_second_operation,
      'fecha', '2026-07-25T16:01:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if v_result ->> 'error' <> 'folio_conflict'
     or exists (
       select 1 from pos.sales
        where operation_id = v_second_operation
     ) then
    raise exception 'H-02 no rechazó limpiamente el folio antiguo duplicado: %', v_result;
  end if;

  v_result := pos.commit_sale(
    'h02-folio-second-commit',
    v_second_operation,
    jsonb_build_object(
      'folio', v_reconciled_folio, 'operation_id', v_second_operation,
      'fecha', '2026-07-25T16:01:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or (select count(*) from pos.sales
          where operation_id in (v_first_operation, v_second_operation)) <> 2
     or not exists (
       select 1 from pos.sales
        where operation_id = v_second_operation
          and folio = v_reconciled_folio
     ) then
    raise exception 'H-02 no confirmó ambos folios tras reconciliar: %', v_result;
  end if;

  delete from pos.sale_commits
   where commit_id in ('h02-folio-first-commit', 'h02-folio-second-commit');
  delete from pos.sales
   where operation_id in (v_first_operation, v_second_operation);
  delete from pos.sellers where id = v_seller.id;
end;
$$;
