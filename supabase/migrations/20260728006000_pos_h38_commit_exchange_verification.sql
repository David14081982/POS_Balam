-- H-38 (C5) · Verificación autocontenida de pos.commit_exchange()
--
-- Comprueba la DEFENSA, no el síntoma (AP-09): que el dinero se calcule en el
-- servidor, que el cambio NUNCA devuelva efectivo, que el plazo y el saldo
-- bloqueen de verdad, que el reintento no duplique y que la evidencia
-- financiera de la venta origen no se toque.
--
-- Se ejecuta contra la vía real: `request.jwt.claims` con el correo de un perfil
-- temporal, igual que las verificaciones de H-04. Aborta ante cualquier fallo y
-- elimina todo lo que crea.

do $$
declare
  v_email    text := 'h38.verif@balam.local';
  v_seller   text := 'h38-verif-seller';
  v_prod     text := 'h38-verif-prod';
  v_folio    text := 'H38-VERIF-0001';
  v_camb     text := 'h38-verif-cambio';
  v_camb2    text := 'h38-verif-cambio-2';
  v_res      jsonb;
  v_head     jsonb;
  v_items    jsonb;
  v_pago     jsonb;
  v_stock_m  integer;
  v_stock_g  integer;
  v_total    numeric;
  v_pagos    bigint;
begin
  -- ── Contención de las autoridades de valoración ───────────────────────────
  if has_function_privilege('authenticated', 'pos.line_recognized_value(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'pos.list_price(text,text)', 'execute') then
    raise exception 'H-38: las autoridades de valoracion quedaron ejecutables por authenticated';
  end if;
  if not has_function_privilege('authenticated', 'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'H-38: authenticated no puede ejecutar commit_exchange; es la via de produccion';
  end if;
  raise notice 'H-38: valoracion interna · commit_exchange ejecutable por authenticated';

  -- ── Semillas ──────────────────────────────────────────────────────────────
  insert into pos.sellers (id, nombre, email, role, active)
  values (v_seller, 'Verificacion H-38', v_email, 'admin', true);

  insert into pos.products (id, cat, manga, tela, color, cuello, modelo, nombre,
                            precio, stock, precios_talla)
  values (v_prod, 'GUA', 'LAR', 'LIN', 'BLA', 'NOR', 'H38', 'Verificacion H-38',
          350, '[{"talla":"M","escala":"L","stock":5},{"talla":"G","escala":"L","stock":5}]'::jsonb,
          '{"G": 450}'::jsonb);

  -- Como apartado: exime del trigger de reserva de H-01 y no toca inventario.
  insert into pos.sales (folio, fecha, cliente, items, total, metodo, estado)
  values (v_folio, now(), 'Verificacion H-38', 1, 350, 'Efectivo', 'Apartado');
  insert into pos.sale_items (folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original)
  values (v_folio, v_prod, 'H38-SKU', 'Verificacion H-38', 'M', 1, 350, 350, 350);

  perform set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text, true);

  -- ── 1) Camino feliz: M ($350) → G ($450). Cobra 100. ──────────────────────
  v_head := jsonb_build_object('id', v_camb, 'folio', 'CB-H38-0001',
    'origen_folio', v_folio, 'fecha', '2026-07-28 12:00', 'usuario', v_email);
  v_items := jsonb_build_array(
    jsonb_build_object('lado', 'devuelto',  'product_id', v_prod, 'sku', 'H38-SKU',
      'nombre', 'Verificacion H-38', 'talla', 'M', 'qty', 1),
    jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H38-SKU',
      'nombre', 'Verificacion H-38', 'talla', 'G', 'qty', 1));
  v_pago := jsonb_build_object('id', 'h38-pago-1', 'fecha', '2026-07-28 12:00',
    'metodo', 'Efectivo', 'monto', 100, 'efectivo', 100);

  -- Sin pago, con diferencia, debe rechazar.
  v_res := pos.commit_exchange('h38-c1', v_head, v_items, '[]'::jsonb, null);
  if coalesce(v_res ->> 'error', '') <> 'payment_required' then
    raise exception 'H-38: acepto un cambio con diferencia y sin cobro: %', v_res;
  end if;

  -- Con un monto que no cuadra, debe rechazar.
  v_res := pos.commit_exchange('h38-c1', v_head, v_items, '[]'::jsonb,
    jsonb_build_object('id', 'x', 'monto', 999, 'metodo', 'Efectivo'));
  if coalesce(v_res ->> 'error', '') <> 'payment_mismatch' then
    raise exception 'H-38: acepto un cobro que no cuadra con la diferencia: %', v_res;
  end if;

  -- LA DEFENSA: un cobro rechazado no puede dejar el documento escrito a medias.
  if exists (select 1 from pos.exchanges where id = v_camb)
     or exists (select 1 from pos.exchange_items where exchange_id = v_camb) then
    raise exception 'H-38: un cobro rechazado dejo escritura parcial del documento';
  end if;
  raise notice 'H-38: cobro invalido rechazado sin escribir una sola fila';

  v_res := pos.commit_exchange('h38-c1', v_head, v_items, '[]'::jsonb, v_pago);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-38: el camino feliz fallo: %', v_res;
  end if;
  if (v_res -> 'exchange' ->> 'valor_reconocido')::numeric <> 350
     or (v_res -> 'exchange' ->> 'valor_entregado')::numeric <> 450
     or (v_res -> 'exchange' ->> 'diferencia')::numeric <> 100
     or (v_res -> 'exchange' ->> 'valor_no_aprovechado')::numeric <> 0
     or (v_res -> 'exchange' ->> 'base_comision')::numeric <> 100 then
    raise exception 'H-38: liquidacion economica incorrecta: %', v_res -> 'exchange';
  end if;
  raise notice 'H-38: valoracion en el servidor · reconocido 350, entregado 450, diferencia 100';

  -- El precio de la talla entregada salio de H-36, no del precio general.
  if (select precio from pos.exchange_items where exchange_id = v_camb and lado = 'entregado') <> 450 then
    raise exception 'H-38: el precio vigente de la talla entregada no se aplico';
  end if;

  -- Inventario en dos sentidos.
  select (e.value ->> 'stock')::integer into v_stock_m
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id = v_prod and e.value ->> 'talla' = 'M';
  select (e.value ->> 'stock')::integer into v_stock_g
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id = v_prod and e.value ->> 'talla' = 'G';
  if v_stock_m <> 6 or v_stock_g <> 4 then
    raise exception 'H-38: inventario incorrecto (M=%, G=%); esperado 6 y 4', v_stock_m, v_stock_g;
  end if;
  raise notice 'H-38: inventario en dos sentidos · M 5→6, G 5→4';

  -- Cobro en el ledger unico, con el folio PROPIO del cambio.
  if not exists (select 1 from pos.sale_payments
                  where id = 'h38-pago-1' and folio = 'CB-H38-0001'
                    and tipo = 'cambio' and monto = 100) then
    raise exception 'H-38: el cobro no quedo en el ledger con el folio del cambio';
  end if;
  if exists (select 1 from pos.sale_payments where folio = v_folio) then
    raise exception 'H-38: el cobro contamino los pagos de la venta origen';
  end if;
  raise notice 'H-38: cobro registrado con tipo=cambio y folio propio · venta origen sin contaminar';

  -- ── 2) Idempotencia ───────────────────────────────────────────────────────
  v_res := pos.commit_exchange('h38-c1', v_head, v_items, '[]'::jsonb, v_pago);
  if coalesce(v_res ->> 'idempotent', 'false') <> 'true' then
    raise exception 'H-38: el reintento identico no fue idempotente: %', v_res;
  end if;
  if (select count(*) from pos.exchange_items where exchange_id = v_camb) <> 2
     or (select count(*) from pos.sale_payments where folio = 'CB-H38-0001') <> 1 then
    raise exception 'H-38: el reintento duplico efectos';
  end if;

  v_res := pos.commit_exchange('h38-c1', v_head || jsonb_build_object('notas', 'otro'),
    v_items, '[]'::jsonb, v_pago);
  if coalesce(v_res ->> 'error', '') <> 'commit_mismatch' then
    raise exception 'H-38: la misma clave con otro contenido no fue rechazada: %', v_res;
  end if;
  raise notice 'H-38: reintento idempotente y commit_mismatch correctos';

  -- ── 3) Saldo: la pieza M ya se consumio ───────────────────────────────────
  v_res := pos.commit_exchange('h38-c2',
    jsonb_build_object('id', v_camb2, 'folio', 'CB-H38-0002', 'origen_folio', v_folio,
      'fecha', '2026-07-28 12:30'),
    v_items, '[]'::jsonb, v_pago);
  if coalesce(v_res ->> 'error', '') <> 'invalid_exchange_quantity' then
    raise exception 'H-38: permitio consumir dos veces la misma pieza: %', v_res;
  end if;
  raise notice 'H-38: el saldo impide consumir dos veces la misma unidad';

  -- ── 4) Sobrante: G ($450) → M ($350). No sale efectivo. ───────────────────
  v_res := pos.commit_exchange('h38-c3',
    jsonb_build_object('id', v_camb2, 'folio', 'CB-H38-0002', 'origen_folio', v_folio,
      'fecha', '2026-07-28 12:40'),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto',  'product_id', v_prod, 'sku', 'H38-SKU',
        'nombre', 'Verificacion H-38', 'talla', 'G', 'qty', 1),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H38-SKU',
        'nombre', 'Verificacion H-38', 'talla', 'M', 'qty', 1)),
    '[]'::jsonb, null);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-38: el cambio con sobrante fallo: %', v_res;
  end if;
  if (v_res -> 'exchange' ->> 'diferencia')::numeric <> 0
     or (v_res -> 'exchange' ->> 'valor_no_aprovechado')::numeric <> 100
     or (v_res -> 'exchange' ->> 'base_comision')::numeric <> 0 then
    raise exception 'H-38: el sobrante no se registro segun el contrato: %', v_res -> 'exchange';
  end if;
  if (select count(*) from pos.sale_payments where folio = 'CB-H38-0002') <> 0 then
    raise exception 'H-38: se emitio un pago en un cambio con sobrante; nunca sale efectivo';
  end if;
  raise notice 'H-38: sobrante 100 registrado como valor no aprovechado · cero efectivo devuelto';

  -- ── 5) La venta origen conserva intacta su evidencia financiera ───────────
  select total into v_total from pos.sales where folio = v_folio;
  select count(*) into v_pagos from pos.sale_payments where folio = v_folio;
  if v_total <> 350 or v_pagos <> 0 then
    raise exception 'H-38: la venta origen fue alterada (total=%, pagos=%)', v_total, v_pagos;
  end if;
  raise notice 'H-38: venta origen intacta · total 350, 0 pagos propios';

  -- ── 6) Plazo de posventa vencido ──────────────────────────────────────────
  update pos.sales set return_limit_days = 1, return_expires_at = current_date - 1
   where folio = v_folio;
  v_res := pos.commit_exchange('h38-c4',
    jsonb_build_object('id', 'h38-verif-cambio-3', 'folio', 'CB-H38-0003',
      'origen_folio', v_folio, 'fecha', to_char(current_date, 'YYYY-MM-DD') || ' 12:00'),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto',  'product_id', v_prod, 'sku', 'H38-SKU',
        'nombre', 'Verificacion H-38', 'talla', 'M', 'qty', 1),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H38-SKU',
        'nombre', 'Verificacion H-38', 'talla', 'G', 'qty', 1)),
    '[]'::jsonb, v_pago);
  if coalesce(v_res ->> 'error', '') <> 'exchange_window_closed' then
    raise exception 'H-38: acepto un cambio fuera de plazo: %', v_res;
  end if;
  raise notice 'H-38: el plazo de posventa bloquea el cambio (H-34)';

  -- ── 7) commit_sale y commit_return intactas ───────────────────────────────
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'pos' and p.proname in ('commit_sale', 'commit_return')
                and p.prosrc like '%commit_exchange%') then
    raise exception 'H-38: commit_sale o commit_return fueron modificadas';
  end if;

  -- ── 8) Limpieza total ─────────────────────────────────────────────────────
  delete from pos.sale_payments  where folio in ('CB-H38-0001', 'CB-H38-0002');
  delete from pos.exchange_commits where commit_id in ('h38-c1', 'h38-c3');
  delete from pos.exchanges      where origen_folio = v_folio;
  delete from pos.movements      where ref in ('CB-H38-0001', 'CB-H38-0002');
  delete from pos.sale_items     where folio = v_folio;
  delete from pos.sales          where folio = v_folio;
  delete from pos.products       where id = v_prod;
  delete from pos.sellers        where id = v_seller;

  if exists (select 1 from pos.exchanges where origen_folio = v_folio)
     or exists (select 1 from pos.sales where folio = v_folio)
     or exists (select 1 from pos.products where id = v_prod)
     or exists (select 1 from pos.sellers where id = v_seller)
     or exists (select 1 from pos.sale_payments where folio like 'CB-H38%') then
    raise exception 'H-38: quedaron filas temporales de verificacion';
  end if;

  raise notice 'H-38: verificacion completa · valoracion, plazo, saldo, inventario, cobro, idempotencia y limpieza';
end;
$$;
