-- POS Balam — H-33: verificación autocontenida del folio comercial diario.
--
-- Comprueba contra la base real: contrato de pos.folio_counters, funcionamiento
-- atómico de pos.reserve_folio_block(), aceptación de una venta con folio
-- {PREFIJO}-{AAMMDD}-{0001}, conservación de un folio histórico largo y rechazo
-- limpio de un folio duplicado entre dos terminales. No deja rastro: las filas
-- temporales se eliminan y el contador vuelve exactamente a su estado previo.

do $$
declare
  v_seller pos.sellers%rowtype;
  v_email text := 'h33-folio-verify@invalid.local';
  v_day date := date '2026-07-27';
  v_prior_exists boolean := false;
  v_prior_seq integer;
  v_a jsonb;
  v_b jsonb;
  v_c jsonb;
  v_result jsonb;
  v_folio text;
  v_hist_folio text := 'H33VER-9-8TD4Q6N7QPWZQAZVUYPYCQP0H'; -- formato largo anterior a H-33
  v_real_legacy record;
  v_op_hist text := '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  v_op_a text := '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
  v_op_b text := '3f2504e0-4f89-11d3-9a0c-0305e82c3303';
  v_sale jsonb;
begin
  -- 1) Contrato del contador diario ------------------------------------------
  if to_regclass('pos.folio_counters') is null then
    raise exception 'H-33: no existe pos.folio_counters';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.folio_counters'::regclass
       and contype = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (prefix, business_date)'
  ) then
    raise exception 'H-33: pos.folio_counters no tiene la llave (prefix, business_date)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'pos.folio_counters'::regclass) then
    raise exception 'H-33: pos.folio_counters quedó sin RLS';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'pos' and tablename = 'folio_counters' and cmd <> 'SELECT'
  ) then
    raise exception 'H-33: el contador admite escritura directa por policy';
  end if;
  if to_regprocedure('pos.reserve_folio_block(text,date,integer,integer)') is null then
    raise exception 'H-33: no existe pos.reserve_folio_block()';
  end if;

  -- Identidad operativa temporal (vendedor: el permiso mínimo que debe bastar).
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_seller.id is null then
    raise exception 'H-33 requiere una semilla de vendedor para verificar permisos';
  end if;
  v_seller.id := 'h33-folio-verify-seller';
  v_seller.nombre := 'Vendedor temporal H33';
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

  select last_seq into v_prior_seq
    from pos.folio_counters
   where prefix = 'BG' and business_date = v_day;
  v_prior_exists := found;

  -- Ventas reales anteriores a H-33: se guardan para comprobar que ninguna cambia.
  select count(*) as n, coalesce(min(folio), '') as primero, coalesce(max(folio), '') as ultimo
    into v_real_legacy
    from pos.sales
   where folio !~ '^[A-Z0-9]{1,6}-\d{6}-\d{4,}$';

  -- 2) Reserva atómica: dos terminales, rangos disjuntos ---------------------
  v_a := pos.reserve_folio_block('bg-', v_day, 10, 0);   -- prefijo sin normalizar
  v_b := pos.reserve_folio_block('BG', v_day, 10, 0);
  if coalesce((v_a ->> 'ok')::boolean, false) is not true
     or coalesce((v_b ->> 'ok')::boolean, false) is not true then
    raise exception 'H-33: la reserva no confirmó: % / %', v_a, v_b;
  end if;
  if (v_a ->> 'prefix') <> 'BG' then
    raise exception 'H-33: el prefijo no se normalizó: %', v_a;
  end if;
  if (v_b ->> 'from')::int <= (v_a ->> 'to')::int then
    raise exception 'H-33: dos terminales recibieron rangos solapados: % / %', v_a, v_b;
  end if;
  if not v_prior_exists and (v_a ->> 'from')::int <> 1 then
    raise exception 'H-33: el primer bloque del día no empieza en 1: %', v_a;
  end if;
  -- El piso declarado por una terminal nunca hace retroceder el contador.
  v_c := pos.reserve_folio_block('BG', v_day, 1, 3);
  if (v_c ->> 'from')::int <= (v_b ->> 'to')::int then
    raise exception 'H-33: un piso menor hizo retroceder el contador: %', v_c;
  end if;

  raise notice 'H-33: terminal A reservó %..%, terminal B reservó %..%',
    v_a ->> 'from', v_a ->> 'to', v_b ->> 'from', v_b ->> 'to';

  -- 3) Venta histórica con folio largo ---------------------------------------
  v_result := pos.commit_sale(
    'h33-folio-hist-commit', v_op_hist,
    jsonb_build_object(
      'folio', v_hist_folio, 'operation_id', v_op_hist,
      'fecha', '2026-07-20T16:00:00-07:00', 'cliente', 'Público en general',
      'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
      'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
      'iva_included', true, 'anticipo', 0, 'saldo', 0,
      'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'H-33: la nube rechazó un folio histórico largo: %', v_result;
  end if;

  -- 4) Venta nueva con el folio corto del bloque reservado -------------------
  v_folio := 'BG-' || to_char(v_day, 'YYMMDD') || '-' || lpad((v_a ->> 'from'), 4, '0');
  v_sale := jsonb_build_object(
    'folio', v_folio, 'operation_id', v_op_a,
    'fecha', '2026-07-27T16:00:00-07:00', 'cliente', 'Público en general',
    'vendedores', '[]'::jsonb, 'metodo', 'Apartado', 'estado', 'Apartado',
    'items', 0, 'subtotal', 0, 'iva', 0, 'total', 0, 'iva_pct', 16,
    'iva_included', true, 'anticipo', 0, 'saldo', 0,
    'pago_efectivo', 0, 'pago_otro', 0, 'descuento', 0
  );
  v_result := pos.commit_sale(
    'h33-folio-a-commit', v_op_a, v_sale,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or not exists (select 1 from pos.sales where operation_id = v_op_a and folio = v_folio) then
    raise exception 'H-33: no se confirmó la venta con folio corto %: %', v_folio, v_result;
  end if;
  if v_folio !~ '^[A-Z0-9]{1,6}-\d{6}-\d{4,}$' then
    raise exception 'H-33: el folio corto no cumple el formato: %', v_folio;
  end if;

  raise notice 'H-33: la nube aceptó la venta nueva con folio % (identidad %)', v_folio, v_op_a;

  -- 5) Segunda terminal con el MISMO folio provisional → rechazo limpio ------
  v_result := pos.commit_sale(
    'h33-folio-b-commit', v_op_b,
    jsonb_set(v_sale, '{operation_id}', to_jsonb(v_op_b)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if v_result ->> 'error' <> 'folio_conflict'
     or exists (select 1 from pos.sales where operation_id = v_op_b) then
    raise exception 'H-33: no se rechazó el folio duplicado de otra terminal: %', v_result;
  end if;

  -- La reconciliación toma OTRO número del contador y ambas ventas conviven.
  v_c := pos.reserve_folio_block('BG', v_day, 1, 0);
  v_result := pos.commit_sale(
    'h33-folio-b-commit', v_op_b,
    jsonb_set(
      jsonb_set(v_sale, '{operation_id}', to_jsonb(v_op_b)),
      '{folio}',
      to_jsonb('BG-' || to_char(v_day, 'YYMMDD') || '-' || lpad((v_c ->> 'from'), 4, '0'))
    ),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
     or (select count(*) from pos.sales where operation_id in (v_op_a, v_op_b)) <> 2 then
    raise exception 'H-33: la reconciliación corta no dejó dos ventas independientes: %', v_result;
  end if;

  raise notice 'H-33: la segunda terminal fue rechazada con folio_conflict y reconcilió a %',
    'BG-' || to_char(v_day, 'YYMMDD') || '-' || lpad((v_c ->> 'from'), 4, '0');

  -- 6) El folio histórico no cambió ------------------------------------------
  if not exists (
    select 1 from pos.sales where operation_id = v_op_hist and folio = v_hist_folio
  ) then
    raise exception 'H-33: se alteró el folio histórico largo';
  end if;

  -- Limpieza total: la base vuelve a su estado exacto previo.
  delete from pos.sale_commits
   where commit_id in ('h33-folio-hist-commit', 'h33-folio-a-commit', 'h33-folio-b-commit');
  delete from pos.sales where operation_id in (v_op_hist, v_op_a, v_op_b);
  delete from pos.sellers where id = 'h33-folio-verify-seller';

  -- 7) Ninguna venta real anterior a H-33 cambió de folio --------------------
  if not exists (
    select 1 from (
      select count(*) as n, coalesce(min(folio), '') as primero, coalesce(max(folio), '') as ultimo
        from pos.sales
       where folio !~ '^[A-Z0-9]{1,6}-\d{6}-\d{4,}$'
    ) actual
     where actual.n = v_real_legacy.n
       and actual.primero = v_real_legacy.primero
       and actual.ultimo = v_real_legacy.ultimo
  ) then
    raise exception 'H-33: cambió alguna venta histórica real (antes: % folios, % … %)',
      v_real_legacy.n, v_real_legacy.primero, v_real_legacy.ultimo;
  end if;
  raise notice 'H-33: % venta(s) con folio anterior a H-33 conservan su valor (% … %)',
    v_real_legacy.n, v_real_legacy.primero, v_real_legacy.ultimo;

  if v_prior_exists then
    update pos.folio_counters set last_seq = v_prior_seq
     where prefix = 'BG' and business_date = v_day;
  else
    delete from pos.folio_counters where prefix = 'BG' and business_date = v_day;
  end if;
end;
$$;
