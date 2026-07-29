-- H-42 (C6) · Verificación de la atribución al vendedor y la revisión
--
-- Comprueba la DEFENSA, no el síntoma (AP-09): que las tres columnas existan
-- nullable, que `commit_exchange` las transporte de verdad hasta la fila, y que
-- un cambio que no las envía siga funcionando igual que antes —la migración es
-- aditiva y no puede romper lo ya registrado—.
--
-- Aborta ante cualquier fallo y elimina todo lo que crea.

do $$
declare
  v_email  text := 'h42.verif@balam.local';
  v_seller text := 'h42-verif-seller';
  v_prod   text := 'h42-verif-prod';
  v_folio  text := 'H42-VERIF-0001';
  v_camb   text := 'h42-verif-cambio';
  v_camb2  text := 'h42-verif-cambio-2';
  v_res    jsonb;
  v_row    record;
  v_cond   text;
begin
  -- 1) Columnas aditivas y nullable.
  if (select count(*) from information_schema.columns
       where table_schema = 'pos' and table_name = 'exchanges'
         and column_name in ('vendedor_id', 'revisado_por')
         and is_nullable = 'YES') <> 2 then
    raise exception 'H-42: faltan vendedor_id / revisado_por nullable en pos.exchanges';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'pos' and table_name = 'exchange_items'
                    and column_name = 'condicion' and is_nullable = 'YES') then
    raise exception 'H-42: falta condicion nullable en pos.exchange_items';
  end if;
  raise notice 'H-42: tres columnas aditivas y nullable';

  -- Semillas
  insert into pos.sellers (id, nombre, email, role, active)
  values (v_seller, 'Verificacion H-42', v_email, 'admin', true);
  insert into pos.products (id, cat, manga, tela, color, cuello, modelo, nombre, precio, stock)
  values (v_prod, 'GUA', 'LAR', 'LIN', 'BLA', 'NOR', 'H42', 'Verificacion H-42', 350,
          '[{"talla":"M","escala":"L","stock":5},{"talla":"G","escala":"L","stock":5}]'::jsonb);
  insert into pos.sales (folio, fecha, cliente, items, total, metodo, estado)
  values (v_folio, now(), 'Verificacion H-42', 2, 700, 'Efectivo', 'Apartado');
  insert into pos.sale_items (folio, product_id, sku, nombre, talla, qty, precio, precio_base, precio_original)
  values (v_folio, v_prod, 'H42-SKU', 'Verificacion H-42', 'M', 2, 350, 350, 350);

  perform set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', v_email)::text, true);

  -- 2) Un cambio CON los datos nuevos los conserva hasta la fila.
  v_res := pos.commit_exchange('h42-c1',
    jsonb_build_object('id', v_camb, 'folio', 'CB-H42-0001', 'origen_folio', v_folio,
      'fecha', '2026-07-29 12:00', 'usuario', v_email,
      'vendedor_id', v_seller, 'revisado_por', 'Ana Revisora'),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto', 'product_id', v_prod, 'sku', 'H42-SKU',
        'nombre', 'Verificacion H-42', 'talla', 'M', 'qty', 1,
        'motivo', 'Talla', 'condicion', 'Excelente, sin uso'),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H42-SKU',
        'nombre', 'Verificacion H-42', 'talla', 'G', 'qty', 1)),
    '[]'::jsonb, null);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-42: el cambio con vendedor y revision fallo: %', v_res;
  end if;

  select vendedor_id, revisado_por into v_row from pos.exchanges where id = v_camb;
  if v_row.vendedor_id is distinct from v_seller
     or v_row.revisado_por is distinct from 'Ana Revisora' then
    raise exception 'H-42: la cabecera no conservo vendedor/revisor (%, %)',
      v_row.vendedor_id, v_row.revisado_por;
  end if;

  select condicion into v_cond from pos.exchange_items
   where exchange_id = v_camb and lado = 'devuelto';
  if v_cond is distinct from 'Excelente, sin uso' then
    raise exception 'H-42: el renglon devuelto no conservo la condicion (%)', v_cond;
  end if;

  -- La condicion NO se inventa para lo entregado: esa prenda no se revisa.
  select condicion into v_cond from pos.exchange_items
   where exchange_id = v_camb and lado = 'entregado';
  if v_cond is not null then
    raise exception 'H-42: se asigno condicion a una prenda entregada (%)', v_cond;
  end if;
  raise notice 'H-42: vendedor, revisor y condicion conservados · lo entregado sin condicion';

  -- 3) Compatibilidad: un cambio que NO envia los campos sigue funcionando.
  v_res := pos.commit_exchange('h42-c2',
    jsonb_build_object('id', v_camb2, 'folio', 'CB-H42-0002', 'origen_folio', v_folio,
      'fecha', '2026-07-29 12:30'),
    jsonb_build_array(
      jsonb_build_object('lado', 'devuelto', 'product_id', v_prod, 'sku', 'H42-SKU',
        'nombre', 'Verificacion H-42', 'talla', 'M', 'qty', 1),
      jsonb_build_object('lado', 'entregado', 'product_id', v_prod, 'sku', 'H42-SKU',
        'nombre', 'Verificacion H-42', 'talla', 'G', 'qty', 1)),
    '[]'::jsonb, null);
  if coalesce(v_res ->> 'ok', 'false') <> 'true' then
    raise exception 'H-42: un cambio sin los campos nuevos dejo de funcionar: %', v_res;
  end if;
  select vendedor_id into v_row from pos.exchanges where id = v_camb2;
  if v_row.vendedor_id is not null then
    raise exception 'H-42: se invento un vendedor donde no se envio ninguno';
  end if;
  raise notice 'H-42: un cambio sin los campos nuevos conserva el comportamiento previo';

  -- 4) Limpieza total.
  delete from pos.exchange_commits where commit_id in ('h42-c1', 'h42-c2');
  delete from pos.exchanges  where origen_folio = v_folio;
  delete from pos.sale_items where folio = v_folio;
  delete from pos.sales      where folio = v_folio;
  delete from pos.products   where id = v_prod;
  delete from pos.sellers    where id = v_seller;
  if exists (select 1 from pos.exchanges where origen_folio = v_folio)
     or exists (select 1 from pos.sales where folio = v_folio)
     or exists (select 1 from pos.sellers where id = v_seller) then
    raise exception 'H-42: quedaron filas temporales de verificacion';
  end if;

  raise notice 'H-42: verificacion completa · columnas, transporte, compatibilidad y limpieza';
end;
$$;
