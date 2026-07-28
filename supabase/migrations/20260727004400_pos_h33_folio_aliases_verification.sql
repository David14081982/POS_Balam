-- POS Balam — H-33: verificación autocontenida del alias del folio impreso.
--
-- Comprueba contra la base real que una venta reidentificada conserva su folio
-- impreso, que ese folio la localiza, y que ninguna venta existente cambió. No
-- deja rastro: la venta temporal se elimina al terminar.

do $$
declare
  v_seller pos.sellers%rowtype;
  v_email text := 'h33-alias-verify@invalid.local';
  v_op text := '3f2504e0-4f89-11d3-9a0c-0305e82c3311';
  v_impreso text := 'H33ALS-260727-0001-K7Q'; -- folio provisional "ya impreso"
  v_vigente text := 'H33ALS-260727-0022';
  v_result jsonb;
  v_found text;
  v_rechazado boolean := false;
  v_sin_alias bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'sales' and column_name = 'folio_aliases'
  ) then
    raise exception 'H-33: falta pos.sales.folio_aliases';
  end if;

  select count(*) into v_sin_alias from pos.sales where folio_aliases <> '[]'::jsonb;
  if v_sin_alias <> 0 then
    raise exception 'H-33: % venta(s) reales ya tenían alias antes de la verificación', v_sin_alias;
  end if;

  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_seller.id is null then
    raise exception 'H-33 requiere una semilla de vendedor para verificar permisos';
  end if;
  v_seller.id := 'h33-alias-verify-seller';
  v_seller.nombre := 'Vendedor temporal H33 alias';
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

  -- La venta se confirma con el folio ya reidentificado, como hace el cliente.
  v_result := pos.commit_sale(
    'h33-alias-commit', v_op,
    jsonb_build_object(
      'folio', v_vigente, 'operation_id', v_op,
      'fecha', '2026-07-27T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-33: no se confirmó la venta de la verificación de alias: %', v_result;
  end if;
  if (select folio_aliases from pos.sales where folio = v_vigente) <> '[]'::jsonb then
    raise exception 'H-33: una venta nueva no debe nacer con alias';
  end if;

  -- El cliente conserva el folio impreso con un UPDATE directo, igual que STORE.
  update pos.sales
     set folio_aliases = jsonb_build_array(v_impreso)
   where folio = v_vigente;

  select folio into v_found
    from pos.sales
   where folio_aliases @> jsonb_build_array(v_impreso);
  if v_found is distinct from v_vigente then
    raise exception 'H-33: el folio impreso % no localizó su venta (obtuvo %)', v_impreso, v_found;
  end if;

  -- El folio impreso no puede confundirse con el vigente de otra venta.
  if exists (select 1 from pos.sales where folio = v_impreso) then
    raise exception 'H-33: el alias no debe existir como folio vigente';
  end if;

  begin
    update pos.sales set folio_aliases = '"texto"'::jsonb where folio = v_vigente;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'H-33: la restricción del alias no rechazó un valor que no es arreglo';
  end if;

  raise notice 'H-33: el folio impreso % localiza la venta %; ninguna venta real tiene alias', v_impreso, v_vigente;

  delete from pos.sale_commits where commit_id = 'h33-alias-commit';
  delete from pos.sales where operation_id = v_op;
  delete from pos.sellers where id = 'h33-alias-verify-seller';

  select count(*) into v_sin_alias from pos.sales where folio_aliases <> '[]'::jsonb;
  if v_sin_alias <> 0 then
    raise exception 'H-33: quedaron % alias tras la limpieza', v_sin_alias;
  end if;
end;
$$;
