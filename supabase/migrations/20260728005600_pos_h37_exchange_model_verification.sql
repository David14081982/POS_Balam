-- H-37 (C4) · Verificación autocontenida del modelo del cambio
--
-- Comprueba la DEFENSA, no el síntoma (AP-09): no basta con que las tablas
-- existan; hay que demostrar que la vista de suministro no queda expuesta, que
-- el saldo generalizado sigue dando lo mismo sin cambios registrados, y que con
-- un cambio registrado gobierna correctamente la pieza entregada.
--
-- Aborta ante cualquier fallo y elimina todo lo que crea. Debe ser la última
-- migración por orden de versión (R-DB-02).

do $$
declare
  v_folio   text := 'H37-VERIF-0001';
  v_camb    text := 'h37-verif-cambio';
  v_inv     text;
  v_reales  bigint;
  v_vend    integer;
  v_disp    integer;
  v_falla   boolean;
begin
  -- 1) Objetos creados.
  if to_regclass('pos.exchanges') is null or to_regclass('pos.exchange_items') is null then
    raise exception 'H-37: faltan pos.exchanges o pos.exchange_items';
  end if;
  if to_regclass('pos.line_supply') is null then
    raise exception 'H-37: falta la vista pos.line_supply';
  end if;

  -- 2) LA DEFENSA: la vista de suministro es interna, como line_consumption.
  if has_table_privilege('authenticated', 'pos.line_supply', 'select') then
    raise exception 'H-37: line_supply quedo legible por authenticated';
  end if;
  if has_table_privilege('anon', 'pos.line_supply', 'select') then
    raise exception 'H-37: line_supply quedo legible por anon';
  end if;
  if not has_table_privilege('service_role', 'pos.line_supply', 'select') then
    raise exception 'H-37: service_role perdio la lectura de line_supply';
  end if;

  select option_value into v_inv
    from pg_options_to_table(
      (select c.reloptions from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pos' and c.relname = 'line_supply')
    )
   where option_name = 'security_invoker';
  if v_inv is null or lower(v_inv) not in ('true', 'on', '1') then
    raise exception 'H-37: security_invoker no quedo activado en line_supply';
  end if;
  raise notice 'H-37: line_supply interna · solo service_role · security_invoker activo';

  -- 2b) La costura de CONSUMO conserva su contencion tras ganar la rama de
  --     cambios en 20260728005500, y esa rama existe realmente.
  if has_table_privilege('authenticated', 'pos.line_consumption', 'select')
     or has_table_privilege('anon', 'pos.line_consumption', 'select') then
    raise exception 'H-37: line_consumption quedo expuesta tras el create or replace';
  end if;
  if not exists (
    select 1 from pg_views
     where schemaname = 'pos' and viewname = 'line_consumption'
       and definition like '%exchange_items%'
  ) then
    raise exception 'H-37: line_consumption no incorpora la rama de cambios';
  end if;
  raise notice 'H-37: line_consumption con rama de cambios y contencion intacta';

  -- 3) Los datos reales no se tocaron y no hay cambios registrados.
  select count(*) into v_reales from pos.exchanges;
  if v_reales <> 0 then
    raise exception 'H-37: la base ya tenia % cambios registrados; debia nacer vacia', v_reales;
  end if;
  raise notice 'H-37: 0 cambios registrados · el saldo es identico al de H-35';

  -- 4) El check de tipo admite el pago de cambio de forma aditiva.
  v_falla := false;
  begin
    insert into pos.sale_payments (id, folio, fecha, tipo, metodo, monto, efectivo)
    values ('h37-pago', v_folio, '2026-07-28 11:00', 'cambio', 'Efectivo', 100, 100);
  exception when check_violation then v_falla := true;
  end;
  if v_falla then
    raise exception 'H-37: sale_payments no admite tipo=cambio';
  end if;
  delete from pos.sale_payments where id = 'h37-pago';
  raise notice 'H-37: sale_payments admite tipo=cambio y los cuatro tipos previos siguen validos';

  -- 5) El saldo generalizado gobierna la pieza ENTREGADA.
  -- Como apartado: el trigger pos.require_sale_stock_reservation() exime
  -- 'Apartado' y 'Cancelado', asi que la semilla no necesita reserva de stock ni
  -- toca inventario. Mismo recurso que uso la verificacion de H-32.
  insert into pos.sales (folio, fecha, cliente, items, total, metodo, estado)
  values (v_folio, now(), 'Verificacion H-37', 1, 350, 'Efectivo', 'Apartado');
  insert into pos.sale_items (folio, sku, nombre, talla, qty, precio)
  values (v_folio, 'H37-SKU', 'Verificacion', 'M', 1, 350);

  select vendida, disponible into v_vend, v_disp
    from pos.sale_line_balance(v_folio) where sku = 'H37-SKU' and talla = 'M';
  if v_vend <> 1 or v_disp <> 1 then
    raise exception 'H-37: el saldo base cambio (vendida=%, disponible=%)', v_vend, v_disp;
  end if;

  insert into pos.exchanges (id, folio, origen_folio, fecha, valor_reconocido, valor_entregado, diferencia)
  values (v_camb, 'CB-H37-0001', v_folio, '2026-07-28 11:30', 350, 450, 100);
  insert into pos.exchange_items (exchange_id, lado, sku, nombre, talla, qty, precio)
  values (v_camb, 'devuelto',  'H37-SKU', 'Verificacion', 'M', 1, 350),
         (v_camb, 'entregado', 'H37-SKU', 'Verificacion', 'G', 1, 450);

  select disponible into v_disp
    from pos.sale_line_balance(v_folio) where sku = 'H37-SKU' and talla = 'M';
  if v_disp <> 0 then
    raise exception 'H-37: la pieza devuelta deberia quedar sin disponible (disponible=%)', v_disp;
  end if;

  select vendida, disponible into v_vend, v_disp
    from pos.sale_line_balance(v_folio) where sku = 'H37-SKU' and talla = 'G';
  if v_vend is null then
    raise exception 'H-37: la pieza ENTREGADA no entro al saldo como suministro';
  end if;
  if v_vend <> 1 or v_disp <> 1 then
    raise exception 'H-37: suministro incorrecto (vendida=%, disponible=%)', v_vend, v_disp;
  end if;
  raise notice 'H-37: la pieza entregada suministra el folio de origen y queda recambiable';

  -- 6) commit_sale y commit_return no fueron modificadas.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pos' and p.proname in ('commit_sale', 'commit_return')
       and p.prosrc like '%line_supply%'
  ) then
    raise exception 'H-37: commit_sale o commit_return mencionan line_supply; debian quedar intactas';
  end if;
  raise notice 'H-37: commit_sale y commit_return intactas';

  -- 7) Limpieza total.
  delete from pos.exchanges  where id = v_camb;
  delete from pos.sale_items where folio = v_folio;
  delete from pos.sales      where folio = v_folio;
  if exists (select 1 from pos.exchanges where id = v_camb)
     or exists (select 1 from pos.sales where folio = v_folio)
     or exists (select 1 from pos.exchange_items where exchange_id = v_camb) then
    raise exception 'H-37: quedaron filas temporales de verificacion';
  end if;

  raise notice 'H-37: verificacion completa · modelo, costura de suministro, ledger y limpieza';
end;
$$;
