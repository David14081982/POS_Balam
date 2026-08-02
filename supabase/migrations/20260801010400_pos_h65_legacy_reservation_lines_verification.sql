-- Verificacion autocontenida de H-65 para reservas historicas cuyo JSON tiene
-- orden distinto o pares product_id+talla repetidos. Todos los fixtures se
-- crean y eliminan dentro de esta transaccion.

begin;

do $$
declare
  v_user constant uuid := '00000000-0000-0000-0000-000000006503';
  v_email constant text := 'h65.reservation.verify@invalid.local';
  v_seller constant text := 'h65-reservation-verify-seller';
  v_product_a constant text := 'h65-reservation-product-a';
  v_product_b constant text := 'h65-reservation-product-b';
  v_product_mismatch constant text := 'h65-reservation-product-mismatch';
  v_product_rollback constant text := 'h65-reservation-product-rollback';
  v_folio constant text := 'H65-VERIFY-RESERVATION-EQUIVALENT';
  v_operation constant text := 'h65-verify-reservation-equivalent-operation';
  v_commit constant text := 'h65-verify-reservation-equivalent-commit';
  v_mismatch_folio constant text := 'H65-VERIFY-RESERVATION-MISMATCH';
  v_mismatch_operation constant text := 'h65-verify-reservation-mismatch-operation';
  v_rollback_folio constant text := 'H65-VERIFY-RESERVATION-ROLLBACK';
  v_rollback_operation constant text := 'h65-verify-reservation-rollback-operation';
  v_template pos.products%rowtype;
  v_product pos.products%rowtype;
  v_prior_lines jsonb;
  v_canonical_lines jsonb;
  v_mismatch_lines jsonb;
  v_rollback_lines jsonb;
  v_payment jsonb;
  v_context jsonb;
  v_result jsonb;
  v_state jsonb;
  v_item_a1 bigint;
  v_item_b bigint;
  v_item_a2 bigint;
  v_mismatch_item bigint;
  v_rollback_item bigint;
  v_stock_a integer;
  v_stock_b integer;
  v_stock_mismatch integer;
  v_stock_rollback integer;
  v_sale_before jsonb;
  v_items_before jsonb;
  v_payments_before jsonb;
  v_movements_before jsonb;
  v_products_before jsonb;
  v_sale_after jsonb;
  v_items_after jsonb;
  v_payments_after jsonb;
  v_movements_after jsonb;
  v_products_after jsonb;
  v_failed boolean := false;
  v_inventory_before jsonb;
  v_inventory_after jsonb;
  v_core_oid regprocedure;
  v_checked_oid regprocedure;
  v_sale_checked_oid regprocedure;
  v_discount_checked_oid regprocedure;
begin
  if exists(select 1 from auth.users where id = v_user)
     or exists(select 1 from pos.sellers where id = v_seller)
     or exists(select 1 from pos.products where id in (
       v_product_a, v_product_b, v_product_mismatch, v_product_rollback
     ))
     or exists(select 1 from pos.sales
       where folio like 'H65-VERIFY-RESERVATION-%')
     or exists(select 1 from pos.stock_reservations
       where operation_id like 'h65-verify-reservation-%')
     or exists(select 1 from pos.layaway_liquidation_commits
       where operation_id like 'h65-verify-reservation-%') then
    raise exception 'H65_LEGACY_RESERVATION_FIXTURE_COLLISION';
  end if;

  -- Huella del inventario real ANTES de crear un solo fixture. La decision E1
  -- de H-65 prohibe ajustar piezas: esta migracion debe poder demostrar que no
  -- movio ninguna. No se codifica ningun producto concreto; la invariante es
  -- que la matriz completa vuelve identica al terminar.
  select jsonb_build_object(
      'products', count(*),
      'active', count(*) filter (where p.deleted_at is null),
      'pieces', coalesce(sum((
        select sum(greatest((e ->> 'stock')::numeric, 0))
          from jsonb_array_elements(p.stock) e
      )) filter (where p.deleted_at is null), 0),
      'fingerprint', md5(string_agg(p.id || '=' || coalesce(p.stock::text, ''),
        E'\n' order by p.id))
    )
    into v_inventory_before
    from pos.products p;
  raise notice 'H65 inventory_before=%', v_inventory_before;

  select * into v_template from pos.products
   where deleted_at is null order by id limit 1;
  if v_template.id is null then
    raise exception 'H65_LEGACY_RESERVATION_REQUIRES_PRODUCT_TEMPLATE';
  end if;

  -- La preparacion administrativa no hereda una identidad de otra migracion.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}'::jsonb::text, true);
  insert into auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',v_user,'authenticated',
    'authenticated',v_email,'',now(),
    '{"provider":"email","providers":["email"]}','{}',now(),now()
  );
  insert into pos.sellers(
    id,nombre,email,role,active,ventas_mes,ventas_num,comision_acum
  ) values (v_seller,'H65 Reservation Seller',v_email,'vendedor',true,0,0,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active)
  values(v_user,'vendedor',true);

  v_product := v_template;
  v_product.id := v_product_a;
  v_product.sku := 'H65-RESERVATION-A';
  v_product.nombre := 'Producto H65 reserva A';
  v_product.stock := '[{"talla":"M","escala":"L","stock":5}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_product_b;
  v_product.sku := 'H65-RESERVATION-B';
  v_product.nombre := 'Producto H65 reserva B';
  v_product.stock := '[{"talla":"L","escala":"L","stock":4}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_product_mismatch;
  v_product.sku := 'H65-RESERVATION-MISMATCH';
  v_product.nombre := 'Producto H65 reserva distinta';
  v_product.stock := '[{"talla":"M","escala":"L","stock":5}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_product_rollback;
  v_product.sku := 'H65-RESERVATION-ROLLBACK';
  v_product.nombre := 'Producto H65 reserva rollback';
  v_product.stock := '[{"talla":"M","escala":"L","stock":4}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  -- Apartado principal: tres renglones, dos de ellos repiten A+M. La reserva
  -- antigua expresa B primero y conserva separados los dos renglones de A.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    v_folio,v_operation,'2026-08-01T10:00:00-07:00','Cliente reserva H65',
    '[]'::jsonb,'Apartado','Apartado',4,86.21,13.79,100,16,true,
    40,60,40,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    v_folio,v_product_a,'H65-RESERVATION-A','Producto H65 reserva A',
    'M',1,25,25,25,'[]'::jsonb
  ) returning id into v_item_a1;
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    v_folio,v_product_b,'H65-RESERVATION-B','Producto H65 reserva B',
    'L',1,25,25,25,'[]'::jsonb
  ) returning id into v_item_b;
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    v_folio,v_product_a,'H65-RESERVATION-A','Producto H65 reserva A',
    'M',2,25,25,25,'[]'::jsonb
  ) returning id into v_item_a2;
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-reservation-equivalent-advance',v_folio,
    '2026-08-01T10:00:00-07:00','anticipo','Efectivo',40,40,0,0,0
  );

  -- El caso desigual tambien es legacy: operation_id y product_id se adoptan
  -- temporalmente para derivar la intencion y deben volver a NULL al rechazar.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    v_mismatch_folio,null,'2026-08-01T10:05:00-07:00','Cliente mismatch H65',
    '[]'::jsonb,'Apartado','Apartado',2,43.10,6.90,50,16,true,
    20,30,20,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    v_mismatch_folio,null,'H65-RESERVATION-MISMATCH',
    'Producto H65 reserva distinta','M',2,25,25,25,'[]'::jsonb
  ) returning id into v_mismatch_item;
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-reservation-mismatch-advance',v_mismatch_folio,
    '2026-08-01T10:05:00-07:00','anticipo','Efectivo',20,20,0,0,0
  );

  -- El tercer caso llega hasta el core y falla tarde al acreditar un vendedor
  -- inexistente. La reserva previa debe sobrevivir al rollback sin descontarse
  -- de nuevo; venta, pago final, movimiento y commits deben volver al inicio.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    v_rollback_folio,v_rollback_operation,'2026-08-01T10:10:00-07:00',
    'Cliente rollback H65','["h65-reservation-missing-seller"]'::jsonb,
    'Apartado','Apartado',2,43.10,6.90,50,16,true,20,30,20,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    v_rollback_folio,v_product_rollback,'H65-RESERVATION-ROLLBACK',
    'Producto H65 reserva rollback','M',2,25,25,25,'[]'::jsonb
  ) returning id into v_rollback_item;
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-reservation-rollback-advance',v_rollback_folio,
    '2026-08-01T10:10:00-07:00','anticipo','Efectivo',20,20,0,0,0
  );

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',v_user,'email',v_email,'role','authenticated'
  )::text, true);

  v_prior_lines := jsonb_build_array(
    jsonb_build_object('product_id',v_product_b,'talla','L','qty',1),
    jsonb_build_object('product_id',v_product_a,'talla','M','qty',2),
    jsonb_build_object('product_id',v_product_a,'talla','M','qty',1)
  );
  v_canonical_lines := jsonb_build_array(
    jsonb_build_object('product_id',v_product_a,'talla','M','qty',3),
    jsonb_build_object('product_id',v_product_b,'talla','L','qty',1)
  );
  v_result := pos.reserve_sale_stock(v_operation,v_folio,v_prior_lines);
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or coalesce((v_result ->> 'idempotent')::boolean,true)
     or (select lines from pos.stock_reservations
          where operation_id=v_operation) is distinct from v_prior_lines then
    raise exception 'H65_LEGACY_RESERVATION_SEED_FAILED: %', v_result;
  end if;

  select (e ->> 'stock')::integer into v_stock_a
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_a and e ->> 'talla'='M';
  select (e ->> 'stock')::integer into v_stock_b
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_b and e ->> 'talla'='L';
  if v_stock_a is distinct from 2 or v_stock_b is distinct from 3 then
    raise exception 'H65_LEGACY_RESERVATION_SEED_STOCK_FAILED';
  end if;

  v_payment := jsonb_build_object(
    'id','h65-reservation-equivalent-liquidation','folio',v_folio,
    'fecha','2026-08-01T12:00:00-07:00','tipo','liquidacion',
    'metodo','Tarjeta','monto',60,'efectivo',0,'tarjeta',60,
    'transferencia',0,'otro',0
  );
  v_context := jsonb_build_object(
    'item_identities',jsonb_build_array(
      jsonb_build_object('sale_item_id',v_item_a1,'product_id',v_product_a,
        'sku','H65-RESERVATION-A','talla','M'),
      jsonb_build_object('sale_item_id',v_item_b,'product_id',v_product_b,
        'sku','H65-RESERVATION-B','talla','L'),
      jsonb_build_object('sale_item_id',v_item_a2,'product_id',v_product_a,
        'sku','H65-RESERVATION-A','talla','M')
    ),
    'commission_amount',0,'commission_base','neto'
  );
  v_result := pos.commit_layaway_liquidation_checked(
    v_commit,v_operation,v_folio,v_payment,'[]'::jsonb,v_context
  );
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or coalesce((v_result ->> 'idempotent')::boolean,true)
     or not coalesce((v_result ->> 'stock_reserved')::boolean,false)
     or not coalesce((v_result ->> 'stock_idempotent')::boolean,false)
     or v_result ->> 'reservation_operation_id' is distinct from v_operation
     or v_result -> 'reservation' -> 'lines' is distinct from v_prior_lines
     or (select stock_lines from pos.layaway_liquidation_commits
          where operation_id=v_operation) is distinct from v_prior_lines then
    raise exception 'H65_LEGACY_RESERVATION_ADOPTION_FAILED: %', v_result;
  end if;

  select (e ->> 'stock')::integer into v_stock_a
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_a and e ->> 'talla'='M';
  select (e ->> 'stock')::integer into v_stock_b
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_b and e ->> 'talla'='L';
  if v_stock_a is distinct from 2 or v_stock_b is distinct from 3
     or (select estado from pos.sales where folio=v_folio) <> 'Pagado'
     or (select count(*) from pos.sale_payments where folio=v_folio) <> 2
     or (select count(*) from pos.movements
          where ref=v_folio and tipo='Venta') <> 3
     or (select count(*) from pos.stock_reservations
          where operation_id=v_operation) <> 1
     or (select count(*) from pos.sale_commits where commit_id=v_commit) <> 1
     or (select count(*) from pos.layaway_liquidation_commits
          where operation_id=v_operation) <> 1 then
    raise exception 'H65_LEGACY_RESERVATION_DOUBLE_DISCOUNT_OR_NON_ATOMIC';
  end if;

  -- El estado autoritativo historico sigue exigiendo representacion exacta.
  -- La respuesta anterior y el ledger demuestran que la frontera reutilizo la
  -- reserva; esta pareja de consultas prueba por que no bastaba normalizarla.
  v_state := pos.sale_commit_authoritative_state(
    v_operation,v_folio,v_prior_lines
  );
  if not coalesce((v_state ->> 'stock_reserved')::boolean,false)
     or v_state -> 'reservation' -> 'lines' is distinct from v_prior_lines then
    raise exception 'H65_LEGACY_RESERVATION_EXACT_STATE_FAILED: %', v_state;
  end if;
  v_state := pos.sale_commit_authoritative_state(
    v_operation,v_folio,v_canonical_lines
  );
  if coalesce((v_state ->> 'stock_reserved')::boolean,false) then
    raise exception 'H65_LEGACY_RESERVATION_STATE_WAS_NOT_EXACT: %', v_state;
  end if;

  -- Replay del mismo commit: ningun segundo efecto y misma reserva exacta.
  v_result := pos.commit_layaway_liquidation_checked(
    v_commit,v_operation,v_folio,v_payment,'[]'::jsonb,v_context
  );
  select (e ->> 'stock')::integer into v_stock_a
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_a and e ->> 'talla'='M';
  select (e ->> 'stock')::integer into v_stock_b
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_b and e ->> 'talla'='L';
  if not coalesce((v_result ->> 'idempotent')::boolean,false)
     or not coalesce((v_result ->> 'stock_idempotent')::boolean,false)
     or v_result -> 'reservation' -> 'lines' is distinct from v_prior_lines
     or v_stock_a is distinct from 2 or v_stock_b is distinct from 3
     or (select count(*) from pos.sale_payments where folio=v_folio) <> 2
     or (select count(*) from pos.movements where ref=v_folio) <> 3
     or (select count(*) from pos.sale_commits where commit_id=v_commit) <> 1 then
    raise exception 'H65_LEGACY_RESERVATION_REPLAY_FAILED: %', v_result;
  end if;

  -- Cualquier commit generico que llegue tarde, incluso si su snapshot local
  -- aun dice Apartado o ya dice Pagado, se detiene contra el ledger H-65. Se
  -- comparan las cinco proyecciones para demostrar ausencia total de efectos.
  select to_jsonb(s) into v_sale_before
    from pos.sales s where s.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
    into v_items_before from pos.sale_items i where i.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha,p.id),'[]'::jsonb)
    into v_payments_before from pos.sale_payments p where p.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb)
    into v_movements_before from pos.movements m where m.ref=v_folio;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
    into v_products_before from pos.products p
   where p.id in (v_product_a,v_product_b);

  v_result := pos.commit_sale_checked(
    'h65-verify-reservation-late-paid-commit',v_operation,
    jsonb_build_object(
      'folio',v_folio,'operation_id',v_operation,'estado','Pagado'
    ),'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_canonical_lines,true,
    null,'[]'::jsonb
  );
  if v_result ->> 'error' is distinct from 'layaway_already_liquidated'
     or v_result ->> 'operation_id' is distinct from v_operation
     or v_result ->> 'folio' is distinct from v_folio then
    raise exception 'H65_LATE_GENERIC_PAID_COMMIT_NOT_REJECTED: %', v_result;
  end if;

  v_result := pos.commit_sale_with_additional_discount_checked(
    'h65-verify-reservation-late-layaway-commit',
    'h65-verify-reservation-stale-operation',
    jsonb_build_object(
      'folio',v_folio,'operation_id',v_operation,'estado','Apartado'
    ),'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_canonical_lines,false,
    null,'[]'::jsonb
  );
  if v_result ->> 'error' is distinct from 'layaway_already_liquidated'
     or v_result ->> 'operation_id'
          is distinct from 'h65-verify-reservation-stale-operation'
     or v_result ->> 'folio' is distinct from v_folio
     or v_result ->> 'reservation_operation_id'
          is distinct from v_operation then
    raise exception 'H65_LATE_GENERIC_LAYAWAY_COMMIT_NOT_REJECTED: %', v_result;
  end if;

  select to_jsonb(s) into v_sale_after
    from pos.sales s where s.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
    into v_items_after from pos.sale_items i where i.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha,p.id),'[]'::jsonb)
    into v_payments_after from pos.sale_payments p where p.folio=v_folio;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb)
    into v_movements_after from pos.movements m where m.ref=v_folio;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
    into v_products_after from pos.products p
   where p.id in (v_product_a,v_product_b);
  if v_sale_after is distinct from v_sale_before
     or v_items_after is distinct from v_items_before
     or v_payments_after is distinct from v_payments_before
     or v_movements_after is distinct from v_movements_before
     or v_products_after is distinct from v_products_before
     or exists(select 1 from pos.sale_commits where commit_id in (
       'h65-verify-reservation-late-paid-commit',
       'h65-verify-reservation-late-layaway-commit'
     )) then
    raise exception 'H65_LATE_GENERIC_COMMIT_CHANGED_AUTHORITATIVE_STATE';
  end if;

  -- Reserva e intencion distintas: rechazo estructurado y rollback explicito
  -- de las adopciones legacy hechas antes de derivar los renglones.
  v_mismatch_lines := jsonb_build_array(jsonb_build_object(
    'product_id',v_product_mismatch,'talla','M','qty',1
  ));
  v_result := pos.reserve_sale_stock(
    v_mismatch_operation,v_mismatch_folio,v_mismatch_lines
  );
  if not coalesce((v_result ->> 'ok')::boolean,false) then
    raise exception 'H65_MISMATCH_RESERVATION_SEED_FAILED: %', v_result;
  end if;
  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-reservation-mismatch-commit',v_mismatch_operation,
    v_mismatch_folio,jsonb_build_object(
      'id','h65-reservation-mismatch-liquidation','folio',v_mismatch_folio,
      'fecha','2026-08-01T12:05:00-07:00','tipo','liquidacion',
      'metodo','Efectivo','monto',30,'efectivo',30,'tarjeta',0,
      'transferencia',0,'otro',0
    ),'[]'::jsonb,jsonb_build_object(
      'item_identities',jsonb_build_array(jsonb_build_object(
        'sale_item_id',v_mismatch_item,'product_id',v_product_mismatch,
        'sku','H65-RESERVATION-MISMATCH','talla','M'
      )),
      'commission_amount',0,'commission_base','neto'
    )
  );
  select (e ->> 'stock')::integer into v_stock_mismatch
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_mismatch and e ->> 'talla'='M';
  if v_result ->> 'error' is distinct from 'operation_mismatch'
     or v_result ->> 'reason' is distinct from 'reservation_lines_mismatch'
     or not coalesce((v_result ->> 'stock_reserved')::boolean,false)
     or v_result -> 'reserved_lines' is distinct from v_mismatch_lines
     or v_stock_mismatch is distinct from 4
     or (select operation_id from pos.sales
          where folio=v_mismatch_folio) is not null
     or (select product_id from pos.sale_items
          where id=v_mismatch_item) is not null
     or (select estado from pos.sales
          where folio=v_mismatch_folio) <> 'Apartado'
     or (select count(*) from pos.sale_payments
          where folio=v_mismatch_folio) <> 1
     or exists(select 1 from pos.movements where ref=v_mismatch_folio)
     or exists(select 1 from pos.sale_commits
          where commit_id='h65-verify-reservation-mismatch-commit')
     or exists(select 1 from pos.layaway_liquidation_commits
          where operation_id=v_mismatch_operation) then
    raise exception 'H65_RESERVATION_MISMATCH_WROTE_STATE: %', v_result;
  end if;

  -- Falla tardia: la reserva previa queda exactamente una vez y todos los
  -- efectos propios de la liquidacion se revierten por la transaccion.
  v_rollback_lines := jsonb_build_array(
    jsonb_build_object('product_id',v_product_rollback,'talla','M','qty',1),
    jsonb_build_object('product_id',v_product_rollback,'talla','M','qty',1)
  );
  v_result := pos.reserve_sale_stock(
    v_rollback_operation,v_rollback_folio,v_rollback_lines
  );
  if not coalesce((v_result ->> 'ok')::boolean,false) then
    raise exception 'H65_ROLLBACK_RESERVATION_SEED_FAILED: %', v_result;
  end if;
  v_failed := false;
  begin
    perform pos.commit_layaway_liquidation_checked(
      'h65-verify-reservation-rollback-commit',v_rollback_operation,
      v_rollback_folio,jsonb_build_object(
        'id','h65-reservation-rollback-liquidation','folio',v_rollback_folio,
        'fecha','2026-08-01T12:10:00-07:00','tipo','liquidacion',
        'metodo','Efectivo','monto',30,'efectivo',30,'tarjeta',0,
        'transferencia',0,'otro',0
      ),jsonb_build_array(jsonb_build_object(
        'id','h65-reservation-missing-seller','base_version',0,
        'ventas_mes_delta',50,'ventas_num_delta',1,
        'comision_acum_delta',0,'after_ventas_mes',50,
        'after_ventas_num',1,'after_comision_acum',0
      )),jsonb_build_object(
        'item_identities',jsonb_build_array(jsonb_build_object(
          'sale_item_id',v_rollback_item,'product_id',v_product_rollback,
          'sku','H65-RESERVATION-ROLLBACK','talla','M'
        )),
        'commission_amount',0,'commission_base','neto'
      )
    );
  exception when others then
    v_failed := true;
  end;
  select (e ->> 'stock')::integer into v_stock_rollback
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_product_rollback and e ->> 'talla'='M';
  if not v_failed or v_stock_rollback is distinct from 2
     or (select lines from pos.stock_reservations
          where operation_id=v_rollback_operation)
            is distinct from v_rollback_lines
     or (select estado from pos.sales
          where folio=v_rollback_folio) <> 'Apartado'
     or (select saldo from pos.sales where folio=v_rollback_folio) <> 30
     or (select count(*) from pos.sale_payments
          where folio=v_rollback_folio) <> 1
     or exists(select 1 from pos.movements where ref=v_rollback_folio)
     or exists(select 1 from pos.sale_commits
          where commit_id='h65-verify-reservation-rollback-commit')
     or exists(select 1 from pos.layaway_liquidation_commits
          where operation_id=v_rollback_operation) then
    raise exception 'H65_LEGACY_RESERVATION_LATE_ROLLBACK_FAILED';
  end if;

  -- ACL compatible: el core sigue privado y la frontera checked conserva el
  -- unico execute de aplicacion, protegido por su capability H-56.
  v_core_oid := to_regprocedure(
    'pos.commit_layaway_liquidation(text,text,text,jsonb,jsonb,jsonb)'
  );
  v_checked_oid := to_regprocedure(
    'pos.commit_layaway_liquidation_checked(text,text,text,jsonb,jsonb,jsonb)'
  );
  v_sale_checked_oid := to_regprocedure(
    'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'
  );
  v_discount_checked_oid := to_regprocedure(
    'pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'
  );
  if v_core_oid is null or v_checked_oid is null
     or v_sale_checked_oid is null or v_discount_checked_oid is null
     or has_function_privilege('public',v_core_oid,'execute')
     or has_function_privilege('anon',v_core_oid,'execute')
     or has_function_privilege('authenticated',v_core_oid,'execute')
     or not has_function_privilege('service_role',v_core_oid,'execute')
     or has_function_privilege('public',v_checked_oid,'execute')
     or has_function_privilege('anon',v_checked_oid,'execute')
     or not has_function_privilege('authenticated',v_checked_oid,'execute')
     or has_function_privilege('public',v_sale_checked_oid,'execute')
     or has_function_privilege('anon',v_sale_checked_oid,'execute')
     or not has_function_privilege('authenticated',v_sale_checked_oid,'execute')
     or has_function_privilege('public',v_discount_checked_oid,'execute')
     or has_function_privilege('anon',v_discount_checked_oid,'execute')
     or not has_function_privilege(
       'authenticated',v_discount_checked_oid,'execute'
     )
     or not exists(
       select 1 from pg_proc p where p.oid=v_core_oid::oid
        and p.prosecdef
        and coalesce(p.proconfig,'{}'::text[])
            @> array['search_path=pos, pg_temp']
     ) then
    raise exception 'H65_LEGACY_RESERVATION_ACL_FAILED';
  end if;

  -- Limpieza explicita, sin depender del rollback global de la migracion.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}'::jsonb::text, true);
  delete from pos.layaway_liquidation_commits
   where operation_id like 'h65-verify-reservation-%';
  delete from pos.sale_payments
   where folio like 'H65-VERIFY-RESERVATION-%';
  delete from pos.movements
   where ref like 'H65-VERIFY-RESERVATION-%';
  delete from pos.sale_items
   where folio like 'H65-VERIFY-RESERVATION-%';
  delete from pos.sales
   where folio like 'H65-VERIFY-RESERVATION-%';
  delete from pos.sale_commits
   where commit_id like 'h65-verify-reservation-%';
  delete from pos.stock_reservations
   where operation_id like 'h65-verify-reservation-%';
  delete from pos.products where id in (
    v_product_a,v_product_b,v_product_mismatch,v_product_rollback
  );
  delete from pos.user_capability_overrides where user_id=v_user;
  delete from pos.user_permission_role_assignments where user_id=v_user;
  delete from pos.sellers where id=v_seller;
  delete from auth.users where id=v_user;

  if exists(select 1 from auth.users where id=v_user)
     or exists(select 1 from pos.sellers where id=v_seller)
     or exists(select 1 from pos.products where id in (
       v_product_a,v_product_b,v_product_mismatch,v_product_rollback
     ))
     or exists(select 1 from pos.sales
       where folio like 'H65-VERIFY-RESERVATION-%')
     or exists(select 1 from pos.sale_items
       where folio like 'H65-VERIFY-RESERVATION-%')
     or exists(select 1 from pos.sale_payments
       where folio like 'H65-VERIFY-RESERVATION-%')
     or exists(select 1 from pos.movements
       where ref like 'H65-VERIFY-RESERVATION-%')
     or exists(select 1 from pos.sale_commits
       where commit_id like 'h65-verify-reservation-%')
     or exists(select 1 from pos.stock_reservations
       where operation_id like 'h65-verify-reservation-%')
     or exists(select 1 from pos.layaway_liquidation_commits
       where operation_id like 'h65-verify-reservation-%')
     or exists(select 1 from pos.user_permission_role_assignments
       where user_id=v_user) then
    raise exception 'H65_LEGACY_RESERVATION_CLEANUP_FAILED';
  end if;

  select jsonb_build_object(
      'products', count(*),
      'active', count(*) filter (where p.deleted_at is null),
      'pieces', coalesce(sum((
        select sum(greatest((e ->> 'stock')::numeric, 0))
          from jsonb_array_elements(p.stock) e
      )) filter (where p.deleted_at is null), 0),
      'fingerprint', md5(string_agg(p.id || '=' || coalesce(p.stock::text, ''),
        E'\n' order by p.id))
    )
    into v_inventory_after
    from pos.products p;
  raise notice 'H65 inventory_after=%', v_inventory_after;
  if v_inventory_after is distinct from v_inventory_before then
    raise exception 'H65_VERIFICATION_MOVED_REAL_INVENTORY: % -> %',
      v_inventory_before, v_inventory_after;
  end if;

  raise notice 'H65 legacy_reservation=adopted exact_lines=preserved canonical_mismatch=denied replay=ok rollback=ok acl=ok cleanup=ok inventory=untouched';
end;
$$;

commit;
