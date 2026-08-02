-- POS Balam - H-68: borrado de datos de prueba con autoridad transaccional.
--
-- El boton «Borrar datos de prueba (conserva inventario)» dejaba de ser una
-- secuencia de borrados independientes desde el navegador. Esta frontera hace
-- TODO dentro de una sola transaccion: revierte el efecto de cada documento
-- sobre las existencias, vacia lo operativo, pone en cero los acumulados del
-- vendedor, comprueba que la configuracion quedo identica y sella una EPOCA.
--
-- La epoca es lo que hace que la limpieza viaje a las terminales apagadas: al
-- encender, cada equipo la lee ANTES de drenar su cola y se limpia solo. Las
-- lapidas de `pos.purged_documents` son la ultima defensa: un documento
-- borrado no puede volver a insertarse aunque una cola vieja lo intente.
--
-- Lo que esta limpieza NO toca, por contrato: pos.products (salvo restaurar
-- existencias), pos.promotions, pos.lookup, pos.settings, pos.sellers en todo
-- lo que es configuracion, y el modelo de permisos completo.

begin;

-- ── 1) Epoca de limpieza ────────────────────────────────────────────────────
create table if not exists pos.test_data_purges (
  purge_id    text primary key,
  epoch       bigint not null unique,
  purged_at   timestamptz not null default now(),
  actor_email text,
  report      jsonb not null default '{}'::jsonb
);

alter table pos.test_data_purges enable row level security;
drop policy if exists active_admin_select on pos.test_data_purges;
create policy active_admin_select on pos.test_data_purges
  for select to authenticated using (pos.is_active_admin());
revoke all on pos.test_data_purges from public, anon, authenticated;
grant select on pos.test_data_purges to authenticated;
grant all on pos.test_data_purges to service_role;

-- ── 2) Lapidas de documentos borrados ───────────────────────────────────────
-- La identidad es la TECNICA (operation_id / id), nunca el folio: al vaciar
-- pos.folio_counters los folios vuelven a empezar y una venta nueva puede
-- llamarse igual que una borrada. Bloquear por folio la rechazaria (`ADR-001`).
create table if not exists pos.purged_documents (
  kind      text not null check (kind in ('sale', 'return', 'exchange', 'loan')),
  identity  text not null,
  purge_id  text not null,
  purged_at timestamptz not null default now(),
  primary key (kind, identity)
);
create index if not exists purged_documents_purge_idx
  on pos.purged_documents (purge_id);

alter table pos.purged_documents enable row level security;
drop policy if exists active_admin_select on pos.purged_documents;
create policy active_admin_select on pos.purged_documents
  for select to authenticated using (pos.is_active_admin());
revoke all on pos.purged_documents from public, anon, authenticated;
grant select on pos.purged_documents to authenticated;
grant all on pos.purged_documents to service_role;

-- ── 3) Estado de la epoca, legible por cualquier terminal ───────────────────
-- Un vendedor tambien tiene que poder aplicar la limpieza en SU equipo, asi que
-- esta lectura no exige admin. Devuelve solo identidad y momento: ninguna cifra
-- del negocio sale por aqui.
create or replace function pos.test_data_purge_state()
returns jsonb
language sql
stable
security definer
set search_path = pos, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'purge_id', p.purge_id, 'epoch', p.epoch, 'purged_at', p.purged_at
    )
    from pos.test_data_purges p
    order by p.epoch desc
    limit 1
  ), '{}'::jsonb);
$$;

revoke all on function pos.test_data_purge_state() from public, anon;
grant execute on function pos.test_data_purge_state() to authenticated;

-- ── 4) Huella de configuracion ──────────────────────────────────────────────
-- Todo lo que la limpieza debe dejar IDENTICO. Se toma antes y despues dentro
-- de la misma transaccion: si difiere, la limpieza se deshace entera.
-- Se excluyen a proposito:
--   • products.stock          → se restaura (tiene su propia comprobacion)
--   • sellers acumulados      → se ponen en cero (idem)
--   • columnas sync_*/updated_at → metadatos de replicacion, no configuracion
--   • settings '_resetMark'   → es la marca que escribe esta misma limpieza
create or replace function pos.config_fingerprint()
returns text
language sql
stable
security definer
set search_path = pos, pg_temp
as $$
  select md5(concat_ws('|',
    -- Catalogos y ajustes de la tienda
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.lookup x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.settings x
              where x.key <> '_resetMark') q),
    -- Descuentos y beneficios configurados
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select (to_jsonb(x) - 'sync_version' - 'sync_base_version'
                     - 'sync_device_id' - 'updated_at')::text as r
               from pos.promotions x) q),
    -- Vendedores: identidad, acceso, comision, meta y nivel
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select (to_jsonb(x) - 'ventas_mes' - 'ventas_num' - 'comision_acum'
                     - 'sync_version' - 'sync_base_version' - 'sync_device_id'
                     - 'updated_at')::text as r
               from pos.sellers x) q),
    -- Productos sin existencias, mas la IDENTIDAD de sus tallas
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select (to_jsonb(x) - 'stock' - 'sync_version' - 'sync_base_version'
                     - 'sync_device_id' - 'updated_at')::text
                    || coalesce((
                         select string_agg(concat_ws('/', e.value ->> 'talla',
                                                     e.value ->> 'escala'),
                                           ',' order by e.ordinality)
                           from jsonb_array_elements(x.stock)
                             with ordinality as e(value, ordinality)
                       ), '') as r
               from pos.products x) q),
    -- Permisos y capacidades (H-56): nada de esto puede moverse
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.permission_roles x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.role_screen_permissions x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r
               from pos.user_screen_permission_overrides x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r
               from pos.role_capability_permissions x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.user_capability_overrides x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.operational_capabilities x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r
               from pos.user_permission_role_assignments x) q),
    (select coalesce(md5(string_agg(r, '#' order by r)), '')
       from (select to_jsonb(x)::text as r from pos.screen_permission_catalog x) q)
  ));
$$;

revoke all on function pos.config_fingerprint() from public, anon;
grant execute on function pos.config_fingerprint() to authenticated;

-- ── 5) Piezas totales del inventario ────────────────────────────────────────
create or replace function pos.total_stock_pieces()
returns bigint
language sql
stable
security definer
set search_path = pos, pg_temp
as $$
  select coalesce(sum((e.value ->> 'stock')::bigint), 0)::bigint
    from pos.products p
    cross join lateral jsonb_array_elements(p.stock) as e(value)
   where p.deleted_at is null;
$$;

revoke all on function pos.total_stock_pieces() from public, anon;
grant execute on function pos.total_stock_pieces() to authenticated;

-- ── 6) Lapida activa: un documento borrado no vuelve ────────────────────────
-- Es la ULTIMA defensa, no la principal: lo normal es que la terminal invalide
-- sus operaciones al aplicar la epoca. Esto cubre el residuo —una cola vieja,
-- un equipo que no llego a leer la epoca— y deja el rechazo visible en el panel
-- de sincronizacion en vez de resucitar el dato en silencio.
create or replace function pos.reject_purged_document()
returns trigger
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_kind text := tg_argv[0];
  v_identity text;
begin
  if v_kind = 'sale' then v_identity := new.operation_id;
  else v_identity := new.id;
  end if;
  if nullif(trim(coalesce(v_identity, '')), '') is null then
    return new;
  end if;
  if exists (
    select 1 from pos.purged_documents t
     where t.kind = v_kind and t.identity = v_identity
  ) then
    raise exception 'operation_purged'
      using errcode = 'P0001',
            detail = format('%s %s fue eliminado por una limpieza de datos de prueba', v_kind, v_identity),
            hint = 'Ese documento ya no existe: la terminal debe descartar la operacion pendiente';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_reject_purged on pos.sales;
create trigger sales_reject_purged
before insert on pos.sales
for each row execute function pos.reject_purged_document('sale');

drop trigger if exists returns_reject_purged on pos.returns;
create trigger returns_reject_purged
before insert on pos.returns
for each row execute function pos.reject_purged_document('return');

drop trigger if exists exchanges_reject_purged on pos.exchanges;
create trigger exchanges_reject_purged
before insert on pos.exchanges
for each row execute function pos.reject_purged_document('exchange');

drop trigger if exists loan_documents_reject_purged on pos.loan_documents;
create trigger loan_documents_reject_purged
before insert on pos.loan_documents
for each row execute function pos.reject_purged_document('loan');

-- ── 7) La autoridad transaccional ───────────────────────────────────────────
create or replace function pos.purge_test_data(p_purge_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pos, pg_temp
as $$
declare
  v_prior       pos.test_data_purges%rowtype;
  v_now         timestamptz := now();
  v_epoch       bigint;
  v_plan        jsonb;
  v_deleted     jsonb;
  v_kept        jsonb;
  v_left        jsonb;
  v_report      jsonb;
  v_unapplied   jsonb;
  v_fp_before   text;
  v_fp_after    text;
  v_pieces_before bigint;
  v_pieces_after  bigint;
  v_ventas      bigint;
  v_apartados   bigint;
  v_abonos      bigint;
  v_devol       bigint;
  v_cambios     bigint;
  v_prestamos   bigint;
  v_clientes    bigint;
  v_movs        bigint;
  v_comisiones  bigint;
  v_cierres     bigint;
  v_reservas    bigint;
  v_rec         record;
begin
  -- Destructivo y global: solo un administrador activo.
  if not pos.is_active_admin() then
    raise exception 'purge_requires_admin'
      using errcode = '42501',
            detail = 'Solo un administrador activo puede borrar los datos de prueba';
  end if;
  if nullif(trim(coalesce(p_purge_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_purge_id');
  end if;

  -- Dos terminales pulsando a la vez: la segunda espera y encuentra el trabajo hecho.
  perform pg_advisory_xact_lock(hashtext('pos.purge_test_data'));

  -- Idempotencia por ticket: un reintento tras perder la respuesta NO vuelve a
  -- borrar ni a restaurar; devuelve el informe original.
  select * into v_prior from pos.test_data_purges where purge_id = p_purge_id;
  if found then
    return v_prior.report || jsonb_build_object(
      'ok', true, 'idempotent', true, 'purge_id', v_prior.purge_id,
      'epoch', v_prior.epoch, 'purged_at', v_prior.purged_at
    );
  end if;

  -- ── Plan de restauracion ──────────────────────────────────────────────────
  -- Se DERIVA de los documentos, con identidad de producto y de talla. Nunca de
  -- una cifra capturada. Un apartado no aparece (nunca descontó); un apartado ya
  -- liquidado aparece UNA vez, por su reserva.
  with sku_unique as (
    select p.sku, min(p.id) as product_id, count(*) as n
      from pos.products p
     where p.sku is not null and p.deleted_at is null
     group by p.sku
  ),
  doc_lines as (
    -- Ventas cobradas: la reserva remota es la evidencia del descuento.
    select 'venta'::text as origen, r.folio as ref,
           x.product_id as raw_id, null::text as sku, x.talla,
           x.qty::bigint as delta
      from pos.stock_reservations r
      cross join lateral jsonb_to_recordset(r.lines)
        as x(product_id text, talla text, qty integer)
    union all
    -- Ventas heredadas sin reserva: manda el renglon con el estado del documento.
    select 'venta', s.folio, i.product_id, i.sku, i.talla, i.qty::bigint
      from pos.sales s
      join pos.sale_items i on i.folio = s.folio
     where s.estado not in ('Apartado', 'Cancelado')
       and not exists (
         select 1 from pos.stock_reservations r where r.folio = s.folio
       )
    union all
    -- Una devolucion habia REINGRESADO piezas: revertirla las vuelve a quitar.
    select 'devolucion', t.folio, ri.product_id, ri.sku, ri.talla,
           -ri.qty::bigint
      from pos.returns t
      join pos.return_items ri on ri.return_id = t.id
    union all
    -- Un cambio movio el inventario en los DOS sentidos: entro lo devuelto y
    -- salio lo entregado. Revertirlo deshace ambos.
    select 'cambio', e.folio, null::text, xi.sku, xi.talla,
           case when xi.lado = 'devuelto' then -xi.qty::bigint else xi.qty::bigint end
      from pos.exchanges e
      join pos.exchange_items xi on xi.exchange_id = e.id
    -- Los prestamos no mueven existencias: no hay nada que revertir.
  ),
  resolved as (
    select d.origen, d.ref, d.sku, d.talla, d.delta,
           case
             when d.raw_id is not null
               and exists (select 1 from pos.products p where p.id = d.raw_id)
               then d.raw_id
             when u.n = 1 then u.product_id
             else null
           end as product_id,
           case
             when d.raw_id is not null
               and exists (select 1 from pos.products p where p.id = d.raw_id)
               then null
             when u.n = 1 then null
             when u.n > 1 then 'sku_ambiguo'
             else 'producto_inexistente'
           end as issue
      from doc_lines d
      left join sku_unique u on u.sku = d.sku
  ),
  deltas as (
    select product_id, talla, sum(delta)::bigint as delta
      from resolved
     where product_id is not null and nullif(trim(coalesce(talla, '')), '') is not null
     group by product_id, talla
    having sum(delta) <> 0
  )
  select jsonb_build_object(
    'deltas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', product_id, 'talla', talla, 'delta', delta
             ) order by product_id, talla) from deltas), '[]'::jsonb),
    'ambiguos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'origen', origen, 'ref', ref, 'sku', sku, 'talla', talla
             ) order by ref, sku) from resolved where issue = 'sku_ambiguo'), '[]'::jsonb),
    'sin_producto', coalesce((
      select jsonb_agg(jsonb_build_object(
               'origen', origen, 'ref', ref, 'sku', sku, 'talla', talla
             ) order by ref, sku) from resolved
       where issue = 'producto_inexistente'), '[]'::jsonb)
  ) into v_plan;

  -- Un SKU que resuelve a dos productos hace imposible saber a cual devolver las
  -- piezas. Se detiene ANTES de tocar nada: no hay estado a medias que deshacer.
  if jsonb_array_length(v_plan -> 'ambiguos') > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'identity_ambiguous',
      'message', 'Hay renglones cuyo SKU resuelve a mas de un producto',
      'ambiguos', v_plan -> 'ambiguos'
    );
  end if;

  -- ── Snapshot ANTES ────────────────────────────────────────────────────────
  v_fp_before := pos.config_fingerprint();
  v_pieces_before := pos.total_stock_pieces();
  select count(*) into v_ventas from pos.sales where estado <> 'Apartado';
  select count(*) into v_apartados from pos.sales where estado = 'Apartado';
  select count(*) into v_abonos from pos.sale_payments;
  select count(*) into v_devol from pos.returns;
  select count(*) into v_cambios from pos.exchanges;
  select count(*) into v_prestamos from pos.loan_documents;
  select count(*) into v_clientes from pos.clients
   where generic is not true and deleted_at is null;
  select count(*) into v_movs from pos.movements
   where tipo in ('Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)');
  select count(*) into v_comisiones from pos.liquidations where tipo <> 'corte';
  select count(*) into v_cierres from pos.liquidations where tipo = 'corte';
  select count(*) into v_reservas from pos.stock_reservations;

  -- Un delta cuya talla ya no tiene entrada en el arreglo del producto no puede
  -- restaurarse sin inventar una: se informa en vez de adivinar.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', d.product_id, 'talla', d.talla, 'delta', d.delta)), '[]'::jsonb)
    into v_unapplied
    from jsonb_to_recordset(v_plan -> 'deltas')
      as d(product_id text, talla text, delta bigint)
   where not exists (
     select 1 from pos.products p
      cross join lateral jsonb_array_elements(p.stock) as e(value)
      where p.id = d.product_id and e.value ->> 'talla' = d.talla
   );

  -- ── Restauracion de existencias ───────────────────────────────────────────
  -- Se aplica por (product_id, talla) sobre el arreglo `stock` del producto. Una
  -- talla desactivada en el catalogo sigue teniendo piezas que devolver, asi que
  -- el catalogo vigente no interviene: manda la identidad guardada en el arreglo.
  for v_rec in
    select d.product_id, d.talla, d.delta,
           (e.value ->> 'stock')::bigint as actual,
           (e.ordinality - 1)::int as idx,
           count(*) over (partition by d.product_id, d.talla) as matches
      from jsonb_to_recordset(v_plan -> 'deltas')
        as d(product_id text, talla text, delta bigint)
      join pos.products p on p.id = d.product_id
      cross join lateral jsonb_array_elements(p.stock)
        with ordinality as e(value, ordinality)
     where e.value ->> 'talla' = d.talla
     order by d.product_id, d.talla
  loop
    -- El mismo codigo de talla en dos entradas del arreglo es identidad ambigua:
    -- se detiene la transaccion entera antes de inventar a cual sumar.
    if v_rec.matches > 1 then
      raise exception 'talla_ambigua'
        using errcode = 'P0001',
              detail = format('El producto %s tiene %s entradas con la talla %s',
                              v_rec.product_id, v_rec.matches, v_rec.talla);
    end if;
    update pos.products p
       set stock = jsonb_set(
             p.stock, array[v_rec.idx::text, 'stock'],
             to_jsonb(greatest(0, v_rec.actual + v_rec.delta)), false
           ),
           sync_base_version = null,
           sync_device_id = 'purge:' || p_purge_id
     where p.id = v_rec.product_id;
  end loop;

  -- ── Lapidas antes de borrar ───────────────────────────────────────────────
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'sale', s.operation_id, p_purge_id from pos.sales s
   where nullif(trim(coalesce(s.operation_id, '')), '') is not null
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'return', t.id, p_purge_id from pos.returns t
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'exchange', e.id, p_purge_id from pos.exchanges e
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'loan', l.id, p_purge_id from pos.loan_documents l
  on conflict (kind, identity) do nothing;

  -- ── Vaciado de lo operativo ───────────────────────────────────────────────
  -- Orden seguro para las referencias: hijos y documentos dependientes primero.
  -- `physical_card_redemptions.sale_folio` referencia la venta con ON DELETE
  -- RESTRICT, asi que va ANTES que pos.sales o el borrado fallaria entero.
  --
  -- Es la aplicacion operativa de un beneficio de descuento (H-52); la
  -- DEFINICION del beneficio vive en pos.lookup / pos.promotions y no se toca.
  delete from pos.physical_card_redemptions;
  delete from pos.exchange_items;
  delete from pos.exchanges;
  delete from pos.return_items;
  delete from pos.returns;
  delete from pos.sale_payments;
  delete from pos.sale_items;
  delete from pos.sales;
  delete from pos.loan_documents;
  delete from pos.liquidations;
  delete from pos.stock_reservations;
  -- Diarios de idempotencia de operaciones que ya no existen.
  delete from pos.sale_commits;
  delete from pos.return_commits;
  delete from pos.exchange_commits;
  delete from pos.layaway_liquidation_commits;
  -- Diagnostico de sincronizacion de filas que ya no existen.
  delete from pos.sync_conflicts;
  -- Consecutivo diario del folio (H-33): sin ventas no hay folio que reutilizar.
  delete from pos.folio_counters;
  -- Kardex: SOLO lo que generaron las operaciones borradas. 'Entrada', 'Ajuste'
  -- y 'Transferencia' son historial de inventario y se conservan.
  delete from pos.movements
   where tipo in ('Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)');

  -- Clientes de prueba: lapida H-06, no borrado fisico. Asi la baja VIAJA a las
  -- demas terminales por el pull normal y una cola vieja no puede reinsertarlos.
  update pos.clients
     set deleted_at = v_now, sync_base_version = null,
         sync_device_id = 'purge:' || p_purge_id
   where generic is not true and deleted_at is null;
  update pos.clients
     set compras = 0, total = 0, ultima = null, sync_base_version = null,
         sync_device_id = 'purge:' || p_purge_id
   where generic is true;

  -- Vendedores: se conservan enteros. Solo los acumulados del periodo vuelven a
  -- cero; comision_pct, meta_mes, nivel, politica, usuario y contrasena no se tocan.
  update pos.sellers
     set ventas_mes = 0, ventas_num = 0, comision_acum = 0,
         sync_base_version = null, sync_device_id = 'purge:' || p_purge_id
   where ventas_mes <> 0 or ventas_num <> 0 or comision_acum <> 0;

  -- ── Verificacion DENTRO de la transaccion ─────────────────────────────────
  v_fp_after := pos.config_fingerprint();
  v_pieces_after := pos.total_stock_pieces();

  select jsonb_build_object(
    'ventas', (select count(*) from pos.sales),
    'renglones_venta', (select count(*) from pos.sale_items),
    'abonos', (select count(*) from pos.sale_payments),
    'devoluciones', (select count(*) from pos.returns),
    'cambios', (select count(*) from pos.exchanges),
    'prestamos', (select count(*) from pos.loan_documents),
    'comisiones', (select count(*) from pos.liquidations),
    'reservas', (select count(*) from pos.stock_reservations),
    'clientes', (select count(*) from pos.clients
                  where generic is not true and deleted_at is null),
    'movimientos_operativos', (select count(*) from pos.movements
      where tipo in ('Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)')),
    'vendedores_con_acumulado', (select count(*) from pos.sellers
      where ventas_mes <> 0 or ventas_num <> 0 or comision_acum <> 0)
  ) into v_left;

  if (select bool_or(x.v <> '0')
        from jsonb_each_text(v_left) as x(k, v)) then
    raise exception 'purge_incomplete'
      using errcode = 'P0001', detail = v_left::text;
  end if;

  -- La configuracion es la invariante dura: si algo de ella se movio, la
  -- limpieza entera se deshace. Es lo que convierte «no se toca nada» en una
  -- garantia comprobada en vez de una promesa.
  if v_fp_before is distinct from v_fp_after then
    raise exception 'purge_changed_configuration'
      using errcode = 'P0001',
            detail = format('huella antes=%s despues=%s', v_fp_before, v_fp_after);
  end if;

  -- ── Sello de la epoca ─────────────────────────────────────────────────────
  select greatest(
           (extract(epoch from v_now) * 1000)::bigint,
           coalesce(max(epoch), 0) + 1
         ) into v_epoch
    from pos.test_data_purges;

  v_deleted := jsonb_build_object(
    'ventas', v_ventas, 'apartados', v_apartados, 'abonos', v_abonos,
    'devoluciones', v_devol, 'cambios', v_cambios, 'prestamos', v_prestamos,
    'clientes', v_clientes, 'movimientos', v_movs,
    'comisiones', v_comisiones, 'cierres', v_cierres, 'reservas', v_reservas
  );
  v_kept := jsonb_build_object(
    'productos', (select count(*) from pos.products where deleted_at is null),
    'descuentos', (select count(*) from pos.promotions where deleted_at is null),
    'vendedores', (select count(*) from pos.sellers where deleted_at is null),
    'catalogos', (select count(*) from pos.lookup),
    'ajustes', (select count(*) from pos.settings where key <> '_resetMark'),
    'movimientos_inventario', (select count(*) from pos.movements),
    'permisos_por_rol', (select count(*) from pos.role_screen_permissions)
  );

  v_report := jsonb_build_object(
    'ok', true, 'idempotent', false, 'purge_id', p_purge_id,
    'epoch', v_epoch, 'purged_at', v_now,
    'eliminados', v_deleted,
    'conservados', v_kept,
    'piezas_antes', v_pieces_before,
    'piezas_despues', v_pieces_after,
    'ajustes_inventario', v_plan -> 'deltas',
    'lineas_sin_producto', v_plan -> 'sin_producto',
    'tallas_sin_entrada', v_unapplied,
    'config_huella_antes', v_fp_before,
    'config_huella_despues', v_fp_after,
    'config_intacta', true,
    'verificacion', v_left
  );

  insert into pos.test_data_purges (purge_id, epoch, purged_at, actor_email, report)
  values (p_purge_id, v_epoch, v_now, auth.jwt() ->> 'email', v_report);

  -- Marca historica: las terminales con el paquete anterior a H-68 siguen
  -- limpiandose por `applyResetMark`. No es un ajuste de la tienda y la app la
  -- excluye de la configuracion a proposito (ver store.jsx toConfigState).
  insert into pos.settings (key, value, updated_at)
  values ('_resetMark', to_jsonb(v_epoch), v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return v_report;
end;
$$;

revoke all on function pos.purge_test_data(text) from public, anon;
grant execute on function pos.purge_test_data(text) to authenticated;

comment on function pos.purge_test_data(text) is
  'H-68: borra los datos operativos de prueba y restaura las existencias en una sola transaccion. Conserva productos, catalogos, descuentos, vendedores, usuarios y permisos; lo comprueba con pos.config_fingerprint() y se deshace entera si algo de eso cambia.';

commit;
