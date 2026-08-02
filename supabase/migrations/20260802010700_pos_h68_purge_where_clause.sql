-- POS Balam - H-68 (correccion): cada borrado de la limpieza lleva su condicion.
--
-- SINTOMA. Al pulsar «Borrar datos de prueba» desde el sitio publicado, Supabase
-- respondia `DELETE requires a WHERE clause` y la transaccion entera hacia
-- rollback: ni la nube ni la terminal cambiaron.
--
-- CAUSA. `pos.purge_test_data()` vaciaba diecisiete tablas con `delete from
-- pos.<tabla>;` sin condicion (migracion 20260802010500, lineas 465-484). Supabase
-- precarga la biblioteca `safeupdate` para el rol `authenticated`, que rechaza
-- cualquier UPDATE o DELETE sin WHERE. La migracion se aplico y su verificacion
-- paso porque `db push` corre como `postgres`, sin esa guarda; el navegador entra
-- como `authenticated` y si la tiene. La frontera es SECURITY DEFINER, pero la
-- guarda es de SESION: cambiar de dueño no la desactiva, y esta bien que asi sea.
--
-- CORRECCION. La guarda NO se toca. La limpieza calcula primero su PLAN —los
-- identificadores exactos de los documentos que va a borrar— y cada DELETE se
-- ejecuta contra ese plan: `where <pk> = any(...)`. Ademas cada borrado COMPRUEBA
-- su propio conteo contra el plan y aborta la transaccion entera si difiere, asi
-- que la condicion no solo es explicita: es verificable.
--
-- Cambio de alcance declarado: `pos.sync_conflicts` deja de vaciarse. Es una
-- superficie de diagnostico, del mismo lado que las bitacoras de auditoria que
-- H-68 ya conservaba a proposito, y ninguna pantalla la lee.

begin;

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
  v_unapplied   jsonb;
  v_deleted     jsonb;
  v_kept        jsonb;
  v_left        jsonb;
  v_report      jsonb;
  v_fp_before   text;
  v_fp_after    text;
  v_pieces_before bigint;
  v_pieces_after  bigint;
  -- Plan de borrado: la identidad EXACTA de cada fila que se va a eliminar.
  v_sale_folios      text[];
  v_sale_ops         text[];
  v_sale_item_ids    bigint[];
  v_payment_ids      text[];
  v_return_ids       text[];
  v_return_item_ids  bigint[];
  v_exchange_ids     text[];
  v_exchange_item_ids bigint[];
  v_loan_ids         text[];
  v_liq_ids          text[];
  v_reservation_ops  text[];
  v_card_folios      text[];
  v_sale_commits     text[];
  v_return_commits   text[];
  v_exchange_commits text[];
  v_layaway_commits  text[];
  v_movement_ids     bigint[];
  v_client_ids       text[];
  v_folio_counters   jsonb;
  v_rows             bigint;
  v_ventas      bigint;
  v_apartados   bigint;
  v_cierres     bigint;
  v_comisiones  bigint;
  v_rec         record;
begin
  if not pos.is_active_admin() then
    raise exception 'purge_requires_admin'
      using errcode = '42501',
            detail = 'Solo un administrador activo puede borrar los datos de prueba';
  end if;
  if nullif(trim(coalesce(p_purge_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_purge_id');
  end if;

  perform pg_advisory_xact_lock(hashtext('pos.purge_test_data'));

  select * into v_prior from pos.test_data_purges where purge_id = p_purge_id;
  if found then
    return v_prior.report || jsonb_build_object(
      'ok', true, 'idempotent', true, 'purge_id', v_prior.purge_id,
      'epoch', v_prior.epoch, 'purged_at', v_prior.purged_at
    );
  end if;

  -- ── Plan de restauracion de existencias ───────────────────────────────────
  with sku_unique as (
    select p.sku, min(p.id) as product_id, count(*) as n
      from pos.products p
     where p.sku is not null and p.deleted_at is null
     group by p.sku
  ),
  doc_lines as (
    select 'venta'::text as origen, r.folio as ref,
           x.product_id as raw_id, null::text as sku, x.talla,
           x.qty::bigint as delta
      from pos.stock_reservations r
      cross join lateral jsonb_to_recordset(r.lines)
        as x(product_id text, talla text, qty integer)
    union all
    select 'venta', s.folio, i.product_id, i.sku, i.talla, i.qty::bigint
      from pos.sales s
      join pos.sale_items i on i.folio = s.folio
     where s.estado not in ('Apartado', 'Cancelado')
       and not exists (
         select 1 from pos.stock_reservations r where r.folio = s.folio
       )
    union all
    select 'devolucion', t.folio, ri.product_id, ri.sku, ri.talla,
           -ri.qty::bigint
      from pos.returns t
      join pos.return_items ri on ri.return_id = t.id
    union all
    select 'cambio', e.folio, null::text, xi.sku, xi.talla,
           case when xi.lado = 'devuelto' then -xi.qty::bigint else xi.qty::bigint end
      from pos.exchanges e
      join pos.exchange_items xi on xi.exchange_id = e.id
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

  if jsonb_array_length(v_plan -> 'ambiguos') > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'identity_ambiguous',
      'message', 'Hay renglones cuyo SKU resuelve a mas de un producto',
      'ambiguos', v_plan -> 'ambiguos'
    );
  end if;

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

  -- ── Plan de BORRADO ───────────────────────────────────────────────────────
  -- Cada arreglo es la lista cerrada de filas que esta limpieza puede tocar.
  -- Ningun DELETE de abajo mira la tabla entera: todos preguntan por esta lista.
  select array_agg(s.folio order by s.folio),
         array_remove(array_agg(s.operation_id order by s.folio), null),
         count(*) filter (where s.estado <> 'Apartado'),
         count(*) filter (where s.estado = 'Apartado')
    into v_sale_folios, v_sale_ops, v_ventas, v_apartados
    from pos.sales s;
  v_sale_folios := coalesce(v_sale_folios, '{}'::text[]);
  v_sale_ops := coalesce(v_sale_ops, '{}'::text[]);

  select coalesce(array_agg(i.id order by i.id), '{}'::bigint[]) into v_sale_item_ids
    from pos.sale_items i;
  select coalesce(array_agg(p.id order by p.id), '{}'::text[]) into v_payment_ids
    from pos.sale_payments p;
  select coalesce(array_agg(t.id order by t.id), '{}'::text[]) into v_return_ids
    from pos.returns t;
  select coalesce(array_agg(ri.id order by ri.id), '{}'::bigint[]) into v_return_item_ids
    from pos.return_items ri;
  select coalesce(array_agg(e.id order by e.id), '{}'::text[]) into v_exchange_ids
    from pos.exchanges e;
  select coalesce(array_agg(xi.id order by xi.id), '{}'::bigint[]) into v_exchange_item_ids
    from pos.exchange_items xi;
  select coalesce(array_agg(l.id order by l.id), '{}'::text[]) into v_loan_ids
    from pos.loan_documents l;
  select coalesce(array_agg(q.id order by q.id), '{}'::text[]),
         count(*) filter (where q.tipo <> 'corte'),
         count(*) filter (where q.tipo = 'corte')
    into v_liq_ids, v_comisiones, v_cierres
    from pos.liquidations q;
  v_liq_ids := coalesce(v_liq_ids, '{}'::text[]);
  select coalesce(array_agg(r.operation_id order by r.operation_id), '{}'::text[])
    into v_reservation_ops from pos.stock_reservations r;
  select coalesce(array_agg(c.folio order by c.folio), '{}'::text[])
    into v_card_folios from pos.physical_card_redemptions c;
  select coalesce(array_agg(c.commit_id order by c.commit_id), '{}'::text[])
    into v_sale_commits from pos.sale_commits c;
  select coalesce(array_agg(c.commit_id order by c.commit_id), '{}'::text[])
    into v_return_commits from pos.return_commits c;
  select coalesce(array_agg(c.commit_id order by c.commit_id), '{}'::text[])
    into v_exchange_commits from pos.exchange_commits c;
  select coalesce(array_agg(c.commit_id order by c.commit_id), '{}'::text[])
    into v_layaway_commits from pos.layaway_liquidation_commits c;
  select coalesce(array_agg(m.id order by m.id), '{}'::bigint[])
    into v_movement_ids from pos.movements m
   where m.tipo in ('Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)');
  select coalesce(array_agg(c.id order by c.id), '{}'::text[])
    into v_client_ids from pos.clients c
   where c.generic is not true and c.deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
           'prefix', f.prefix, 'business_date', f.business_date)), '[]'::jsonb)
    into v_folio_counters from pos.folio_counters f;

  -- ── Snapshot ANTES ────────────────────────────────────────────────────────
  v_fp_before := pos.config_fingerprint();
  v_pieces_before := pos.total_stock_pieces();

  -- ── Restauracion de existencias ───────────────────────────────────────────
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
  select 'sale', x, p_purge_id from unnest(v_sale_ops) as x
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'return', x, p_purge_id from unnest(v_return_ids) as x
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'exchange', x, p_purge_id from unnest(v_exchange_ids) as x
  on conflict (kind, identity) do nothing;
  insert into pos.purged_documents (kind, identity, purge_id)
  select 'loan', x, p_purge_id from unnest(v_loan_ids) as x
  on conflict (kind, identity) do nothing;

  -- ── Vaciado de lo operativo, fila por fila declarada ──────────────────────
  -- Cada sentencia pregunta por su plan y comprueba cuantas filas toco. Un
  -- descuadre aborta la transaccion entera: la condicion es explicita Y verificable.

  -- Va primero: `sale_folio` referencia la venta con ON DELETE RESTRICT.
  delete from pos.physical_card_redemptions c where c.folio = any(v_card_folios);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_card_folios) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('physical_card_redemptions: %s de %s', v_rows, cardinality(v_card_folios));
  end if;

  delete from pos.exchange_items xi where xi.id = any(v_exchange_item_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_exchange_item_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('exchange_items: %s de %s', v_rows, cardinality(v_exchange_item_ids));
  end if;

  delete from pos.exchanges e where e.id = any(v_exchange_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_exchange_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('exchanges: %s de %s', v_rows, cardinality(v_exchange_ids));
  end if;

  delete from pos.return_items ri where ri.id = any(v_return_item_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_return_item_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('return_items: %s de %s', v_rows, cardinality(v_return_item_ids));
  end if;

  delete from pos.returns t where t.id = any(v_return_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_return_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('returns: %s de %s', v_rows, cardinality(v_return_ids));
  end if;

  delete from pos.sale_payments p where p.id = any(v_payment_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_payment_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('sale_payments: %s de %s', v_rows, cardinality(v_payment_ids));
  end if;

  delete from pos.sale_items i where i.id = any(v_sale_item_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_sale_item_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('sale_items: %s de %s', v_rows, cardinality(v_sale_item_ids));
  end if;

  delete from pos.sales s where s.folio = any(v_sale_folios);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_sale_folios) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('sales: %s de %s', v_rows, cardinality(v_sale_folios));
  end if;

  delete from pos.loan_documents l where l.id = any(v_loan_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_loan_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('loan_documents: %s de %s', v_rows, cardinality(v_loan_ids));
  end if;

  delete from pos.liquidations q where q.id = any(v_liq_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_liq_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('liquidations: %s de %s', v_rows, cardinality(v_liq_ids));
  end if;

  delete from pos.stock_reservations r where r.operation_id = any(v_reservation_ops);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_reservation_ops) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('stock_reservations: %s de %s', v_rows, cardinality(v_reservation_ops));
  end if;

  delete from pos.sale_commits c where c.commit_id = any(v_sale_commits);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_sale_commits) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('sale_commits: %s de %s', v_rows, cardinality(v_sale_commits));
  end if;

  delete from pos.return_commits c where c.commit_id = any(v_return_commits);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_return_commits) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('return_commits: %s de %s', v_rows, cardinality(v_return_commits));
  end if;

  delete from pos.exchange_commits c where c.commit_id = any(v_exchange_commits);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_exchange_commits) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('exchange_commits: %s de %s', v_rows, cardinality(v_exchange_commits));
  end if;

  delete from pos.layaway_liquidation_commits c
   where c.commit_id = any(v_layaway_commits);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_layaway_commits) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('layaway_liquidation_commits: %s de %s', v_rows, cardinality(v_layaway_commits));
  end if;

  -- Consecutivo diario del folio (H-33): sin ventas no hay folio que reutilizar.
  delete from pos.folio_counters f
   where exists (
     select 1 from jsonb_to_recordset(v_folio_counters)
       as x(prefix text, business_date date)
      where x.prefix = f.prefix and x.business_date = f.business_date
   );
  get diagnostics v_rows = row_count;
  if v_rows <> jsonb_array_length(v_folio_counters) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('folio_counters: %s de %s', v_rows, jsonb_array_length(v_folio_counters));
  end if;

  -- Kardex: por IDENTIDAD de fila, no por tipo. 'Entrada', 'Ajuste' y
  -- 'Transferencia' nunca entraron al plan y por tanto no pueden tocarse.
  delete from pos.movements m where m.id = any(v_movement_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_movement_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('movements: %s de %s', v_rows, cardinality(v_movement_ids));
  end if;

  -- Clientes de prueba: lapida H-06, no borrado fisico.
  update pos.clients c
     set deleted_at = v_now, sync_base_version = null,
         sync_device_id = 'purge:' || p_purge_id
   where c.id = any(v_client_ids);
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_client_ids) then
    raise exception 'purge_delete_mismatch'
      using errcode = 'P0001', detail = format('clients: %s de %s', v_rows, cardinality(v_client_ids));
  end if;

  update pos.clients c
     set compras = 0, total = 0, ultima = null, sync_base_version = null,
         sync_device_id = 'purge:' || p_purge_id
   where c.generic is true;

  update pos.sellers s
     set ventas_mes = 0, ventas_num = 0, comision_acum = 0,
         sync_base_version = null, sync_device_id = 'purge:' || p_purge_id
   where s.ventas_mes <> 0 or s.ventas_num <> 0 or s.comision_acum <> 0;

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
    'ventas', v_ventas, 'apartados', v_apartados,
    'abonos', cardinality(v_payment_ids),
    'devoluciones', cardinality(v_return_ids),
    'cambios', cardinality(v_exchange_ids),
    'prestamos', cardinality(v_loan_ids),
    'clientes', cardinality(v_client_ids),
    'movimientos', cardinality(v_movement_ids),
    'comisiones', v_comisiones, 'cierres', v_cierres,
    'reservas', cardinality(v_reservation_ops)
  );
  v_kept := jsonb_build_object(
    'productos', (select count(*) from pos.products where deleted_at is null),
    'descuentos', (select count(*) from pos.promotions where deleted_at is null),
    'vendedores', (select count(*) from pos.sellers where deleted_at is null),
    'catalogos', (select count(*) from pos.lookup),
    'ajustes', (select count(*) from pos.settings where key <> '_resetMark'),
    'movimientos_inventario', (select count(*) from pos.movements),
    'permisos_por_rol', (select count(*) from pos.role_screen_permissions),
    'diagnosticos_sincronizacion', (select count(*) from pos.sync_conflicts)
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

  insert into pos.settings (key, value, updated_at)
  values ('_resetMark', to_jsonb(v_epoch), v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return v_report;
end;
$$;

revoke all on function pos.purge_test_data(text) from public, anon;
grant execute on function pos.purge_test_data(text) to authenticated;

comment on function pos.purge_test_data(text) is
  'H-68: borra los datos operativos de prueba y restaura las existencias en una sola transaccion. Cada DELETE lleva condicion explicita contra el plan de identidades y comprueba su propio conteo (safeupdate compatible). Conserva productos, catalogos, descuentos, vendedores, usuarios, permisos y diagnosticos; lo comprueba con pos.config_fingerprint() y se deshace entero si algo de eso cambia.';

commit;
