-- 20260730006600_pos_h47_commit_exchange_sellers.sql
--
-- H-47 (C7) · `commit_exchange` acredita la comision del excedente DENTRO de la
-- misma transaccion que escribe el cambio.
--
-- Hasta ahora la funcion no tenia forma de tocar a los vendedores: calculaba
-- `base_comision`, la guardaba y no la acreditaba a nadie. La comision quedaba
-- registrada y sin pagar.
--
-- El texto se GENERO del vigente —`20260729006300`— y se le aplicaron 8
-- sustituciones verificadas una a una, sin reescribir la funcion a mano
-- (`AP-05`):
--   1. parametro `p_seller_effects`, con valor por omision para no romper
--      ninguna llamada anterior;
--   2. declaraciones de cursor y de resultado;
--   3. validacion de forma del parametro nuevo;
--   4. inclusion en el hash de idempotencia: efectos distintos no son el mismo
--      commit;
--   5. y 6. la cabecera guarda la evidencia congelada de la comision;
--   7. aplicacion de los efectos con la MISMA guarda de version que
--      `commit_sale`, que distingue un reenvio de la cola de una suma nueva;
--   8. el resultado devuelve los vendedores afectados.
--
-- La firma gana un parametro, asi que `revoke`, `grant` y `comment` nombran la
-- nueva aridad. La antigua de cinco parametros sigue existiendo en la base y se
-- retira al final, para que ninguna llamada en vuelo quede sin funcion.
--
-- Un cambio NO es un pedido: la funcion no toca `ventas_mes` ni `ventas_num`.

create or replace function pos.commit_exchange(
  p_commit_id text,
  p_exchange  jsonb,   -- {id, folio, origen_folio, fecha, usuario, notas}
  p_items     jsonb,   -- [{lado, product_id, sku, nombre, talla, qty, motivo}]
  p_moves     jsonb default '[]'::jsonb,
  p_payment   jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_id           text := p_exchange ->> 'id';
  v_folio        text := p_exchange ->> 'folio';
  v_origen       text := p_exchange ->> 'origen_folio';
  v_hash         text;
  v_prior        pos.exchange_commits%rowtype;
  v_expira       date;
  v_hoy          date := coalesce(nullif(left(p_exchange ->> 'fecha', 10), '')::date, current_date);
  v_shortages    jsonb;
  v_reconocido   numeric := 0;
  v_entregado    numeric := 0;
  v_diferencia   numeric := 0;
  v_no_aprov     numeric := 0;
  v_base_com     numeric := 0;
  v_rec          record;
  v_products     jsonb := '[]'::jsonb;
  v_pago_monto   numeric := 0;
  v_effect       record;
  v_sellers      jsonb := '[]'::jsonb;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para registrar cambios' using errcode = '42501';
  end if;

  -- 1) Forma
  if nullif(trim(p_commit_id), '') is null
     or nullif(trim(coalesce(v_id, '')), '') is null
     or nullif(trim(coalesce(v_folio, '')), '') is null
     or nullif(trim(coalesce(v_origen, '')), '') is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_typeof(coalesce(p_moves, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_seller_effects, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, sku text, talla text, qty integer)
     where coalesce(x.lado, '') not in ('devuelto', 'entregado')
        or nullif(trim(coalesce(x.sku, '')), '') is null
        or nullif(trim(coalesce(x.talla, '')), '') is null
        or nullif(trim(coalesce(x.product_id, '')), '') is null
        or coalesce(x.qty, 0) <= 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  -- Un cambio exige las dos mitades: sin ellas es una devolución o una venta.
  if not exists (select 1 from jsonb_to_recordset(p_items) as x(lado text) where x.lado = 'devuelto')
     or not exists (select 1 from jsonb_to_recordset(p_items) as x(lado text) where x.lado = 'entregado') then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  v_hash := md5(jsonb_build_object(
    'exchange', p_exchange, 'items', p_items, 'moves', coalesce(p_moves, '[]'::jsonb),
    'payment', coalesce(p_payment, 'null'::jsonb),
    'seller_effects', coalesce(p_seller_effects, '[]'::jsonb)
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_commit_id));

  -- 2) Idempotencia
  select * into v_prior from pos.exchange_commits where commit_id = p_commit_id;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.exchange_id <> v_id or v_prior.folio <> v_folio then
      return jsonb_build_object('ok', false, 'error', 'commit_mismatch');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true,
      'exchange', (select to_jsonb(e) from pos.exchanges e where e.id = v_id));
  end if;

  -- 3) Serializa todos los documentos de la misma venta
  perform 1 from pos.sales where folio = v_origen for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if exists (select 1 from pos.exchanges where id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'exchange_id_conflict');
  end if;

  -- 4) Plazo de posventa (H-34). El derecho a cambiar está sujeto al plazo de la
  --    venta origen; nulo significa sin límite, igual que en devoluciones.
  select return_expires_at into v_expira from pos.sales where folio = v_origen;
  if v_expira is not null and v_hoy > v_expira then
    return jsonb_build_object('ok', false, 'error', 'exchange_window_closed',
      'expires_at', v_expira);
  end if;

  -- 5) Saldo disponible (H-35/H-37). La autoridad ya suma el suministro de
  --    cambios anteriores, así que una pieza recibida antes puede recambiarse.
  with pedido as (
    select x.sku, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_items) as x(lado text, sku text, talla text, qty integer)
     where x.lado = 'devuelto'
     group by x.sku, x.talla
  ),
  saldo as (
    select b.sku, b.talla, b.disponible as qty
      from pos.sale_line_balance(v_origen, v_id) b
  )
  select jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'talla', p.talla,
           'requested', p.qty, 'available', coalesce(s.qty, 0)
         ) order by p.sku, p.talla)
    into v_shortages
    from pedido p
    left join saldo s on s.sku = p.sku and s.talla is not distinct from p.talla
   where p.qty > coalesce(s.qty, 0);

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_exchange_quantity',
      'items', v_shortages);
  end if;

  -- 6) Valoración. SIEMPRE en el servidor (Contrato §3).
  select coalesce(sum(x.qty * pos.line_recognized_value(v_origen, x.sku, x.talla)), 0)
    into v_reconocido
    from jsonb_to_recordset(p_items) as x(lado text, sku text, talla text, qty integer)
   where x.lado = 'devuelto';

  select coalesce(sum(x.qty * pos.list_price(x.product_id, x.talla)), 0)
    into v_entregado
    from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, talla text, qty integer)
   where x.lado = 'entregado';

  if v_entregado >= v_reconocido then
    v_diferencia := round(v_entregado - v_reconocido, 2);
    v_no_aprov := 0;
  else
    -- El sobrante se pierde: nunca sale efectivo (Contrato §4).
    v_diferencia := 0;
    v_no_aprov := round(v_reconocido - v_entregado, 2);
  end if;
  v_base_com := v_diferencia;   -- §7: sólo el excedente genera comisión

  -- 6b) El cobro se valida ANTES de escribir nada. En 20260728005700 estas dos
  --     salidas ocurrian despues de insertar cabecera, renglones y movimientos:
  --     un `return` de plpgsql no aborta la transaccion, asi que un cobro mal
  --     formado dejaba el documento a medias. Es el defecto que H-04 existe para
  --     impedir. Ahora no se escribe una sola fila hasta que el dinero cuadra.
  if v_diferencia > 0 then
    if p_payment is null then
      return jsonb_build_object('ok', false, 'error', 'payment_required',
        'expected', v_diferencia);
    end if;
    v_pago_monto := coalesce((p_payment ->> 'monto')::numeric, 0);
    if round(v_pago_monto, 2) <> v_diferencia then
      return jsonb_build_object('ok', false, 'error', 'payment_mismatch',
        'expected', v_diferencia, 'received', v_pago_monto);
    end if;
  end if;

  -- 7) Inventario. Bloqueo estable de TODOS los productos implicados, en un solo
  --    orden, para evitar deadlocks entre cambios concurrentes.
  perform p.id from pos.products p
   where p.id in (select distinct x.product_id from jsonb_to_recordset(p_items)
                    as x(product_id text))
   order by p.id
   for update;

  -- Toda talla implicada debe existir en su producto.
  with lineas as (
    select x.product_id, x.talla from jsonb_to_recordset(p_items)
      as x(product_id text, talla text) group by x.product_id, x.talla
  )
  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'talla', l.talla,
           'reason', case when p.id is null then 'product_not_found' else 'size_not_found' end)
         order by l.product_id, l.talla)
    into v_shortages
    from lineas l
    left join pos.products p on p.id = l.product_id and p.deleted_at is null
   where p.id is null
      or not exists (select 1 from jsonb_array_elements(p.stock) e where e ->> 'talla' = l.talla);

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_stock_target', 'items', v_shortages);
  end if;

  -- Reserva de lo ENTREGADO: se valida ANTES de escribir, dentro del mismo
  -- bloqueo, así que dos terminales no pueden entregar la última pieza (H-01).
  with pedido as (
    select x.product_id, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_items)
        as x(lado text, product_id text, talla text, qty integer)
     where x.lado = 'entregado'
     group by x.product_id, x.talla
  )
  select jsonb_agg(jsonb_build_object('product_id', pe.product_id, 'talla', pe.talla,
           'requested', pe.qty, 'available', (e.value ->> 'stock')::integer)
         order by pe.product_id, pe.talla)
    into v_shortages
    from pedido pe
    join pos.products p on p.id = pe.product_id
    cross join lateral jsonb_array_elements(p.stock) e
   where e.value ->> 'talla' = pe.talla
     and (e.value ->> 'stock')::integer < pe.qty;

  if v_shortages is not null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'items', v_shortages);
  end if;

  -- Movimiento neto por (producto, talla): + lo devuelto, − lo entregado.
  for v_rec in
    with delta as (
      select x.product_id, x.talla,
             sum(case when x.lado = 'devuelto' then x.qty else -x.qty end)::integer as qty
        from jsonb_to_recordset(p_items)
          as x(lado text, product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select d.product_id, d.talla, d.qty,
           (e.value ->> 'stock')::integer as available,
           e.ordinality::integer - 1 as stock_index
      from delta d
      join pos.products p on p.id = d.product_id
      cross join lateral jsonb_array_elements(p.stock) with ordinality as e(value, ordinality)
     where e.value ->> 'talla' = d.talla and d.qty <> 0
     order by d.product_id, d.talla
  loop
    update pos.products p
       set stock = jsonb_set(p.stock, array[v_rec.stock_index::text, 'stock'],
             to_jsonb(greatest(v_rec.available + v_rec.qty, 0)), false),
           sync_base_version = p.sync_version,
           sync_device_id = 'exchange:' || p_commit_id
     where p.id = v_rec.product_id;
  end loop;

  -- 8) Documento
  insert into pos.exchanges (
    id, folio, origen_folio, fecha, usuario, vendedor_id, revisado_por,
    valor_reconocido, valor_entregado, diferencia, valor_no_aprovechado,
    base_comision, comision_monto, comision_base, comision_pct, notas
  ) values (
    v_id, v_folio, v_origen, p_exchange ->> 'fecha', p_exchange ->> 'usuario',
    p_exchange ->> 'vendedor_id', p_exchange ->> 'revisado_por',
    v_reconocido, v_entregado, v_diferencia, v_no_aprov, v_base_com,
    coalesce((p_exchange ->> 'comision_monto')::numeric, 0),
    nullif(p_exchange ->> 'comision_base', ''),
    coalesce((p_exchange ->> 'comision_pct')::numeric, 0),
    p_exchange ->> 'notas'
  );

  insert into pos.exchange_items (exchange_id, lado, sku, nombre, talla, qty, precio, motivo, condicion)
  select v_id, x.lado, x.sku, x.nombre, x.talla, x.qty,
         case when x.lado = 'entregado'
              then pos.list_price(x.product_id, x.talla)
              else pos.line_recognized_value(v_origen, x.sku, x.talla) end,
         x.motivo, x.condicion
    from jsonb_to_recordset(p_items)
      as x(lado text, product_id text, sku text, nombre text, talla text, qty integer,
           motivo text, condicion text);

  -- 9) Movimientos de inventario (historial de sólo lectura para el cliente)
  if jsonb_array_length(coalesce(p_moves, '[]'::jsonb)) > 0 then
    insert into pos.movements (fecha, tipo, producto, sku, cant, ref)
    select x.fecha, x.tipo, x.producto, x.sku, x.cant, coalesce(x.ref, v_folio)
      from jsonb_to_recordset(p_moves)
        as x(fecha timestamptz, tipo text, producto text, sku text, cant integer, ref text);
  end if;

  -- 10) Cobro de la diferencia. Ledger único, con el folio PROPIO del cambio:
  --     usar el de la venta origen violaria §8 y ademas commit_sale borra por
  --     folio antes de reinsertar. Nunca se emite un pago negativo.
  if v_diferencia > 0 then
    insert into pos.sale_payments (id, folio, fecha, tipo, metodo, monto,
                                   efectivo, tarjeta, transferencia, otro)
    values (
      p_payment ->> 'id', v_folio, p_payment ->> 'fecha', 'cambio',
      coalesce(p_payment ->> 'metodo', 'Efectivo'), v_diferencia,
      coalesce((p_payment ->> 'efectivo')::numeric, 0),
      coalesce((p_payment ->> 'tarjeta')::numeric, 0),
      coalesce((p_payment ->> 'transferencia')::numeric, 0),
      coalesce((p_payment ->> 'otro')::numeric, 0)
    );
  end if;

  -- 10) Comision del excedente. Mismo criterio de reintento que `commit_sale`:
  -- si la version del vendedor ya avanzo UNO sobre la base leida y el valor final
  -- coincide, este efecto ya se aplico y es un reenvio de la cola; se deja como
  -- esta en vez de sumarlo dos veces.
  --
  -- Un cambio NO es un pedido: aqui no se tocan `ventas_mes` ni `ventas_num`, de
  -- modo que el conteo de ventas, el ticket promedio y las metas del equipo no se
  -- mueven. Solo el acumulado de comision.
  for v_effect in
    select *
      from jsonb_to_recordset(coalesce(p_seller_effects, '[]'::jsonb)) as x(
        id text, comision_acum_delta numeric, base_version bigint,
        after_comision_acum numeric
      )
  loop
    update pos.sellers
       set comision_acum = case
             when sync_version = coalesce(v_effect.base_version, 0) + 1
              and comision_acum = v_effect.after_comision_acum
             then comision_acum
             else greatest(0, comision_acum + coalesce(v_effect.comision_acum_delta, 0)) end,
           sync_base_version = sync_version,
           sync_device_id = 'exchange:' || p_commit_id
     where id = v_effect.id and active = true and deleted_at is null;
    if not found then
      raise exception 'Vendedor del cambio no existe o esta inactivo' using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_seller_effects, '[]'::jsonb))
       as x(id text, comision_acum_delta numeric)
   );

  insert into pos.exchange_commits (commit_id, exchange_id, folio, payload_hash, actor_email)
  values (p_commit_id, v_id, v_folio, v_hash, auth.jwt() ->> 'email');

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_products
    from pos.products p
   where p.id in (select distinct x.product_id from jsonb_to_recordset(p_items)
                    as x(product_id text));

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'exchange', (select to_jsonb(e) from pos.exchanges e where e.id = v_id),
    'products', v_products, 'sellers', v_sellers
  );
end;
$$;

comment on function pos.commit_exchange(text, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'H-47: autoridad transaccional unica del cambio, ahora tambien de la comision del excedente. Confirma plazo, saldo, valoracion, inventario en dos sentidos, documento y cobro, o revierte todo. Nunca devuelve efectivo.';

revoke all on function pos.commit_exchange(text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function pos.commit_exchange(text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- La version de cinco parametros queda sin usar: el cliente siempre envia el
-- sexto. Se retira para que no exista una via que acredite el cambio sin
-- acreditar su comision.
drop function if exists pos.commit_exchange(text, jsonb, jsonb, jsonb, jsonb);
