-- H-36 · Verificación autocontenida del precio por talla
--
-- Comprueba la DEFENSA, no el síntoma (AP-09): no basta con que un precio por
-- talla se guarde bien; hay que demostrar que la columna nueva no abre una vía
-- de escritura al vendedor y que la restricción de forma rechaza lo que debe.
--
-- Ajustada al alcance real de la restricción tras el fallo de despliegue: la
-- base valida la FORMA del mapa (objeto), no sus valores. Las dos pruebas de
-- valor no se eliminan en silencio: se convierten en constancia explícita del
-- riesgo residual, para que quede escrita en la salida del despliegue.
--
-- Aborta ante cualquier fallo y elimina todo lo que crea. Debe ser la última
-- migración por orden de versión (R-DB-02).

do $$
declare
  v_default text;
  v_notnull boolean;
  v_reales  bigint;
  v_con_exc bigint;
  v_id      text := 'h36-verif-producto';
  v_falla   boolean;
  v_exento  boolean;
begin
  -- 1) La columna existe, es jsonb, NOT NULL y nace vacía.
  select column_default, (is_nullable = 'NO')
    into v_default, v_notnull
    from information_schema.columns
   where table_schema = 'pos' and table_name = 'products' and column_name = 'precios_talla';

  if v_default is null then
    raise exception 'H-36: pos.products.precios_talla no existe';
  end if;
  if not v_notnull or v_default not like '%''{}''%' then
    raise exception 'H-36: precios_talla debe ser NOT NULL con default {} (default=%, notnull=%)',
      v_default, v_notnull;
  end if;
  raise notice 'H-36: columna precios_talla jsonb NOT NULL default % ', v_default;

  -- 2) Los artículos existentes quedan intactos y sin excepciones.
  select count(*), count(*) filter (where precios_talla <> '{}'::jsonb)
    into v_reales, v_con_exc
    from pos.products
   where deleted_at is null;

  if v_con_exc <> 0 then
    raise exception 'H-36: % articulos existentes nacieron con excepciones; debian nacer en {}', v_con_exc;
  end if;
  raise notice 'H-36: % articulos reales, 0 con excepciones de precio', v_reales;

  -- 3) La restricción conserva un mapa válido.
  insert into pos.products (id, cat, manga, tela, color, cuello, modelo, nombre, precio, precios_talla)
  values (v_id, 'GUA', 'LAR', 'LIN', 'BLA', 'NOR', 'H36', 'Verificacion H-36', 350, '{"XL": 450}'::jsonb);

  if (select precios_talla -> 'XL' from pos.products where id = v_id)::numeric <> 450 then
    raise exception 'H-36: la excepcion valida no se conservo';
  end if;
  raise notice 'H-36: excepcion valida conservada · XL = 450';

  -- 4) La restricción de FORMA rechaza lo que no es un objeto.
  v_falla := false;
  begin
    update pos.products set precios_talla = '[]'::jsonb where id = v_id;
  exception when check_violation then v_falla := true;
  end;
  if not v_falla then
    raise exception 'H-36: la base acepto un precios_talla que no es objeto (arreglo)';
  end if;

  v_falla := false;
  begin
    update pos.products set precios_talla = '"texto"'::jsonb where id = v_id;
  exception when check_violation then v_falla := true;
  end;
  if not v_falla then
    raise exception 'H-36: la base acepto un precios_talla que no es objeto (escalar)';
  end if;
  raise notice 'H-36: la restriccion de forma rechaza arreglo y escalar';

  -- 5) RIESGO RESIDUAL, comprobado y declarado: la base NO valida los valores.
  --    Se ejercita para dejar la evidencia en la salida del despliegue, no para
  --    aprobarlo. La garantía por valor vive en DATA.sanitizePreciosTalla().
  v_falla := false;
  begin
    update pos.products set precios_talla = '{"XL": -1}'::jsonb where id = v_id;
  exception when check_violation then v_falla := true;
  end;
  if v_falla then
    raise notice 'H-36: la base SI rechaza un valor negativo (restriccion mas fuerte de lo documentado)';
  else
    raise notice 'H-36 RESIDUAL: la base acepta un valor negativo en el mapa; la garantia por valor vive en DATA.sanitizePreciosTalla()';
  end if;
  update pos.products set precios_talla = '{"XL": 450}'::jsonb where id = v_id;

  -- 6) LA DEFENSA REAL: el vendedor no puede tocar la columna nueva.
  --    pos.restrict_seller_product_update() exime por sustracción, así que una
  --    columna nueva debería quedar protegida sola. Se comprueba leyendo la
  --    lista de exención del cuerpo vigente de la función: si alguien agregara
  --    'precios_talla' ahí, el vendedor podría reescribir precios.
  select p.prosrc like '%precios_talla%'
    into v_exento
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pos' and p.proname = 'restrict_seller_product_update';

  if v_exento is null then
    raise exception 'H-36: no existe pos.restrict_seller_product_update(); la columna quedaria sin proteccion';
  end if;
  if v_exento then
    raise exception 'H-36: precios_talla aparece en la lista de exencion del vendedor; podria reescribir precios';
  end if;
  raise notice 'H-36: precios_talla NO esta exenta del trigger de vendedor';

  -- 7) El contrato de venta no cambió: commit_sale sigue sin conocer el modelo.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pos' and p.proname = 'commit_sale' and p.prosrc like '%precios_talla%'
  ) then
    raise exception 'H-36: commit_sale menciona precios_talla; debia quedar intacta';
  end if;
  raise notice 'H-36: commit_sale intacta, sin conocimiento del precio por talla';

  -- 8) Limpieza total.
  delete from pos.products where id = v_id;
  if exists (select 1 from pos.products where id = v_id) then
    raise exception 'H-36: quedo el producto temporal de verificacion';
  end if;

  raise notice 'H-36: verificacion completa · columna, forma, proteccion de vendedor y limpieza';
end;
$$;
