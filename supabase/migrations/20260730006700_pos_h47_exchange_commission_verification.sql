-- H-47 (C7) · Verificación de la comisión del excedente
--
-- Comprueba la DEFENSA, no el síntoma (`AP-09`): que las columnas existan con su
-- valor por omisión, que el CHECK del criterio rechace un valor inventado, que
-- `commit_exchange` acredite de verdad el acumulado del vendedor, que NO toque
-- ventas ni pedidos, y que un reenvío de la cola no acredite dos veces.
--
-- Lo último es lo que más importa: la cola es durable y reintenta. Si un reenvío
-- sumara otra vez, el negocio pagaría la misma comisión dos veces sin que nadie
-- lo notara.
--
-- Aborta ante cualquier fallo y elimina todo lo que crea.

do $$
declare
  v_email  text := 'h47.verif@balam.local';
  v_seller text := 'h47-verif-seller';
  v_prod   text := 'h47-verif-prod';
  v_folio  text := 'H47-VERIF-0001';
  v_oper   text := 'h47-verif-oper';
  v_camb   text := 'h47-verif-cambio';
  v_res    jsonb;
  v_row    record;
  v_acum   numeric;
  v_mes    numeric;
  v_num    integer;
  v_efectos jsonb;
begin
  -- 1) Columnas con su valor por omisión, para que lo ya registrado quede en 0.
  if (select count(*) from information_schema.columns
       where table_schema = 'pos' and table_name = 'exchanges'
         and column_name in ('comision_monto', 'comision_base', 'comision_pct', 'comision_revertida')) <> 4 then
    raise exception 'H-47: faltan columnas de comision en pos.exchanges';
  end if;
  if (select column_default from information_schema.columns
       where table_schema = 'pos' and table_name = 'exchanges' and column_name = 'comision_monto') is null then
    raise exception 'H-47: comision_monto sin valor por omision: los cambios ya registrados quedarian nulos';
  end if;
  raise notice 'H-47: cuatro columnas presentes y comision_monto con valor por omision';

  -- 2) El criterio sólo admite lo que el negocio reconoce.
  begin
    insert into pos.exchanges (id, folio, origen_folio, fecha, comision_base)
    values ('h47-bad', 'CB-H47-BAD', v_folio, now(), 'inventado');
    raise exception 'H-47: el CHECK admitio un criterio de comision inexistente';
  exception when check_violation then
    raise notice 'H-47: el CHECK rechaza un criterio de comision inventado';
  end;

  -- Semillas: vendedor con acumulado previo, para distinguir suma de sustitución.
  insert into pos.sellers (id, nombre, email, role, active, comision_acum, ventas_mes, ventas_num)
  values (v_seller, 'Verificacion H-47', v_email, 'admin', true, 100, 5000, 7);
  insert into pos.products (id, cat, manga, tela, color, cuello, modelo, nombre, precio, stock)
  values (v_prod, 'GUA', 'LAR', 'LIN', 'BLA', 'NOR', 'H47', 'Verificacion H-47', 350,
          '[{"talla":"M","escala":"L","stock":5},{"talla":"G","escala":"L","stock":5}]'::jsonb);
  -- Una venta COBRADA exige reserva de inventario confirmada (H-01,
  -- `20260725001800`). Se siembra la reserva antes de la venta, porque el
  -- disparador la exige en el propio insert.
  --
  -- La verificacion de H-42 evito esto usando estado 'Apartado', que el
  -- disparador exime. Aqui se siembra el estado REAL del negocio: nadie cambia
  -- mercancia de un apartado que todavia no salio de la tienda (`R-DEL-12`).
  insert into pos.stock_reservations (operation_id, folio, lines, actor_email)
  values (v_oper, v_folio,
          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'talla', 'M', 'qty', 1)),
          v_email);
  insert into pos.sales (folio, fecha, cliente, items, total, metodo, estado, operation_id)
  values (v_folio, now(), 'Verificacion H-47', 1, 350, 'Efectivo', 'Pagado', v_oper);
  insert into pos.sale_items (folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original)
  values (v_folio, v_prod, 'H47-SKU', 'Verificacion H-47', 'M', 1, 350, 350, 350);

  perform set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text, true);

  v_efectos := jsonb_build_array(jsonb_build_object(
    'id', v_seller, 'base_version', 0,
    'comision_acum_delta', 8.62, 'after_comision_acum', 108.62));

  -- 3) El cambio acredita la comisión y congela su evidencia.
  v_res := pos.commit_exchange('h47-c1',
    jsonb_build_object('id', v_camb, 'folio', 'CB-H47-0001', 'origen_folio', v_folio,
      'fecha', '2026-07-30 12:00', 'usuario', v_email, 'vendedor_id', v_seller,
      'revisado_por', 'Ana Revisora',
      'comision_monto', 8.62, 'comision_base', 'neto', 'comision_pct', 10),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'M', 'qty', 1,
        'motivo', 'Talla', 'condicion', 'Sin uso'),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'G', 'qty', 1)),
    '[]'::jsonb, null, v_efectos);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-47: el cambio con comision fallo: %', v_res;
  end if;

  select comision_monto, comision_base, comision_pct into v_row
    from pos.exchanges where id = v_camb;
  if v_row.comision_monto <> 8.62 or v_row.comision_base is distinct from 'neto'
     or v_row.comision_pct <> 10 then
    raise exception 'H-47: la cabecera no congelo la comision (%, %, %)',
      v_row.comision_monto, v_row.comision_base, v_row.comision_pct;
  end if;
  raise notice 'H-47: monto, criterio y porcentaje congelados en la cabecera';

  select comision_acum, ventas_mes, ventas_num into v_acum, v_mes, v_num
    from pos.sellers where id = v_seller;
  if v_acum <> 108.62 then
    raise exception 'H-47: la comision no se acredito (acumulado=%)', v_acum;
  end if;
  raise notice 'H-47: comision acreditada al vendedor del cambio';

  -- 4) Un cambio NO es un pedido: ventas y conteo intactos.
  if v_mes <> 5000 or v_num <> 7 then
    raise exception 'H-47: el cambio movio ventas o pedidos (mes=%, num=%)', v_mes, v_num;
  end if;
  raise notice 'H-47: ventas del mes y conteo de pedidos intactos';

  -- 5) Reenvío de la cola: el MISMO commit_id no acredita dos veces.
  v_res := pos.commit_exchange('h47-c1',
    jsonb_build_object('id', v_camb, 'folio', 'CB-H47-0001', 'origen_folio', v_folio,
      'fecha', '2026-07-30 12:00', 'usuario', v_email, 'vendedor_id', v_seller,
      'revisado_por', 'Ana Revisora',
      'comision_monto', 8.62, 'comision_base', 'neto', 'comision_pct', 10),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'M', 'qty', 1,
        'motivo', 'Talla', 'condicion', 'Sin uso'),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'G', 'qty', 1)),
    '[]'::jsonb, null, v_efectos);
  if coalesce(v_res ->> 'idempotent', 'false') <> 'true' then
    raise exception 'H-47: el reenvio no se reconocio como idempotente: %', v_res;
  end if;
  select comision_acum into v_acum from pos.sellers where id = v_seller;
  if v_acum <> 108.62 then
    raise exception 'H-47: el reenvio pago la comision dos veces (acumulado=%)', v_acum;
  end if;
  raise notice 'H-47: un reenvio de la cola no paga la comision dos veces';

  -- 6) Compatibilidad: un cambio SIN efectos sigue funcionando igual que antes.
  v_res := pos.commit_exchange('h47-c2',
    jsonb_build_object('id', 'h47-verif-cambio-2', 'folio', 'CB-H47-0002', 'origen_folio', v_folio,
      'fecha', '2026-07-30 12:30', 'usuario', v_email),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'G', 'qty', 1, 'motivo', 'Talla'),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H47-SKU',
        'nombre', 'Verificacion H-47', 'talla', 'M', 'qty', 1)),
    '[]'::jsonb, null);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-47: un cambio sin comision dejo de funcionar: %', v_res;
  end if;
  if (select comision_monto from pos.exchanges where id = 'h47-verif-cambio-2') <> 0 then
    raise exception 'H-47: un cambio sin comision no quedo en cero';
  end if;
  raise notice 'H-47: un cambio sin comision sigue funcionando y queda en cero';

  -- Limpieza: no deja rastro.
  delete from pos.exchange_commits where exchange_id in (v_camb, 'h47-verif-cambio-2');
  delete from pos.exchange_items where exchange_id in (v_camb, 'h47-verif-cambio-2');
  delete from pos.exchanges where id in (v_camb, 'h47-verif-cambio-2', 'h47-bad');
  delete from pos.movements where ref in ('CB-H47-0001', 'CB-H47-0002');
  delete from pos.sale_payments where folio in ('CB-H47-0001', 'CB-H47-0002');
  -- `line_consumption` y `line_supply` son VISTAS derivadas de exchange_items y
  -- sale_items: se vacian solas al borrar las tablas de las que salen.
  delete from pos.sale_items where folio = v_folio;
  delete from pos.sales where folio = v_folio;
  delete from pos.stock_reservations where operation_id = v_oper;
  delete from pos.products where id = v_prod;
  delete from pos.sellers where id = v_seller;
  raise notice 'H-47: verificacion completa, sin filas residuales';
end $$;
