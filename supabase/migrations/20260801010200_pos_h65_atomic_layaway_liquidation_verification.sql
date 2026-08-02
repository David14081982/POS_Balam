-- Verificacion remota autocontenida de H-65. Todos los fixtures se eliminan.

begin;

do $$
declare
  v_user constant uuid := '00000000-0000-0000-0000-000000006501';
  v_email constant text := 'h65.verify@invalid.local';
  v_seller constant text := 'h65-verify-seller';
  v_product_id constant text := 'h65-verify-product';
  v_generic_product_id constant text := 'h65-generic-product';
  v_rollback_product_id constant text := 'h65-rollback-product';
  v_legacy_product_id constant text := 'h65-legacy-product';
  v_ambiguous_product_a constant text := 'h65-ambiguous-product-a';
  v_ambiguous_product_b constant text := 'h65-ambiguous-product-b';
  v_folio constant text := 'H65-VERIFY-LAYAWAY';
  v_operation constant text := 'h65-verify-operation';
  v_commit constant text := 'h65-verify-commit';
  v_product pos.products%rowtype;
  v_template pos.products%rowtype;
  v_result jsonb;
  v_state jsonb;
  v_payment jsonb;
  v_effects jsonb;
  v_context jsonb;
  v_stock integer;
  v_sale_item_id bigint;
  v_legacy_item_id bigint;
  v_missing_item_id bigint;
  v_ambiguous_item_id bigint;
  v_before_cards integer;
  v_failed boolean := false;
  v_denied boolean := false;
  v_migration_role name := current_user;
  v_checked_oid regprocedure;
  v_core_oid regprocedure;
begin
  if exists(select 1 from auth.users where id = v_user)
     or exists(select 1 from pos.sellers where id = v_seller)
     or exists(select 1 from pos.products where id in (
       v_product_id, v_generic_product_id, v_rollback_product_id,
       v_legacy_product_id, v_ambiguous_product_a, v_ambiguous_product_b
     ))
     or exists(select 1 from pos.sales where folio like 'H65-VERIFY-%')
     or exists(select 1 from pos.layaway_liquidation_commits
       where operation_id like 'h65-verify-%') then
    raise exception 'H65_FIXTURE_COLLISION';
  end if;

  select * into v_template from pos.products
   where deleted_at is null order by id limit 1;
  if v_template.id is null then
    raise exception 'H65_REQUIRES_PRODUCT_TEMPLATE';
  end if;

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
  ) values (v_seller,'H65 Seller',v_email,'vendedor',true,0,0,0);
  insert into pos.user_permission_role_assignments(user_id,role_code,active)
  values(v_user,'vendedor',true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',v_user,'email',v_email,'role','authenticated'
  )::text, true);

  v_product := v_template;
  v_product.id := v_product_id;
  v_product.sku := 'H65-SKU';
  v_product.nombre := 'Producto H65';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_legacy_product_id;
  v_product.sku := 'H65-LEGACY-SKU';
  v_product.nombre := 'Producto H65 legacy';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_ambiguous_product_a;
  v_product.sku := 'H65-DUPLICATE-SKU';
  v_product.nombre := 'Producto H65 ambiguo A';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_ambiguous_product_b;
  v_product.sku := 'H65-DUPLICATE-SKU';
  v_product.nombre := 'Producto H65 ambiguo B';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_generic_product_id;
  v_product.sku := 'H65-GENERIC-SKU';
  v_product.nombre := 'Producto H65 generico';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_product := v_template;
  v_product.id := v_rollback_product_id;
  v_product.sku := 'H65-ROLLBACK-SKU';
  v_product.nombre := 'Producto H65 rollback';
  v_product.stock := '[{"talla":"M","escala":"L","stock":2}]'::jsonb;
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := null;
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  -- Apartado H-52 ya creado: tarjeta fisica consumida una vez, anticipo 40 y
  -- saldo 60. La liquidacion debe conservar sus snapshots, no reclamarla otra vez.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado,
    return_limit_days,return_expires_at,
    descuento_adicional,total_antes_descuento_adicional,
    descuentos_adicionales
  ) values (
    v_folio,v_operation,'2026-08-01T10:00:00-07:00','Cliente H65',
    jsonb_build_array(v_seller),'Apartado','Apartado',1,
    86.21,13.79,100,16,true,40,60,40,0,0,0,15,null,
    10,110,jsonb_build_array(jsonb_build_object(
      'origin','Tarjeta fisica','cardFolio','H65-CARD',
      'claimToken','h65-claim','onlineVerified',true,
      'benefitCode','H65','benefitName','H65 beneficio',
      'appliedBy',v_email
    ))
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos,descuento_adicional
  ) values (
    v_folio,v_product_id,'H65-SKU','Producto H65','M',1,100,
    110,110,'[]'::jsonb,10
  ) returning id into v_sale_item_id;
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-verify-advance',v_folio,'2026-08-01 10:00','anticipo',
    'Efectivo',40,40,0,0,0
  );
  insert into pos.physical_card_redemptions(
    folio,sale_folio,claim_token,claimed_by,benefit_code,benefit_name,
    redeemed_by,redeemed_at
  ) values (
    'H65-CARD',v_folio,'h65-claim',v_user,'H65','H65 beneficio',v_email,now()
  );
  select count(*) into v_before_cards from pos.physical_card_redemptions
   where folio = 'H65-CARD' and sale_folio = v_folio;

  v_payment := jsonb_build_object(
    'id','h65-verify-liquidation','folio',v_folio,
    'fecha','2026-08-01T12:00:00-07:00','tipo','liquidacion',
    'metodo','Tarjeta','monto',60,'efectivo',0,'tarjeta',60,
    'transferencia',0,'otro',0
  );
  v_effects := jsonb_build_array(jsonb_build_object(
    'id',v_seller,'base_version',0,
    'ventas_mes_delta',100,'ventas_num_delta',1,
    'comision_acum_delta',5,'after_ventas_mes',100,
    'after_ventas_num',1,'after_comision_acum',5
  ));
  v_context := jsonb_build_object(
    'item_identities', jsonb_build_array(jsonb_build_object(
      'sale_item_id',v_sale_item_id,'product_id',v_product_id,
      'sku','H65-SKU','talla','M'
    )),
    'commission_amount',5,
    'commission_base','neto'
  );

  v_result := pos.commit_layaway_liquidation_checked(
    v_commit,v_operation,v_folio,v_payment,v_effects,v_context
  );
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or coalesce((v_result ->> 'idempotent')::boolean,true)
     or not coalesce((v_result ->> 'stock_reserved')::boolean,false)
     or coalesce((v_result ->> 'stock_idempotent')::boolean,true)
     or v_result ->> 'reservation_operation_id' <> v_operation then
    raise exception 'H65_LIQUIDATION_CONTRACT_FAILED: %', v_result;
  end if;
  select (e ->> 'stock')::integer into v_stock
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id = v_product_id and e ->> 'talla' = 'M';
  if v_stock <> 1
     or (select estado from pos.sales where folio = v_folio) <> 'Pagado'
     or (select saldo from pos.sales where folio = v_folio) <> 0
     or (select count(*) from pos.stock_reservations where operation_id=v_operation) <> 1
     or (select count(*) from pos.sale_payments where folio=v_folio) <> 2
     or (select count(*) from pos.movements where ref=v_folio and tipo='Venta') <> 1
     or not exists(select 1 from pos.movements where ref=v_folio
       and product_id=v_product_id and talla='M' and cant=-1)
     or (select count(*) from pos.layaway_liquidation_commits
       where operation_id=v_operation) <> 1
     or (select comision from pos.sales where folio=v_folio) <> 5
     or (select comision_base from pos.sales where folio=v_folio) <> 'neto'
     or (v_result -> 'sale' ->> 'comision')::numeric <> 5
     or v_result -> 'sale' ->> 'comision_base' <> 'neto' then
    raise exception 'H65_LIQUIDATION_NOT_ATOMIC';
  end if;
  if (select context from pos.layaway_liquidation_commits
       where operation_id=v_operation) <> v_context
     or (select adopted_operation_id from pos.layaway_liquidation_commits
       where operation_id=v_operation)
     or jsonb_array_length((select adopted_item_identities
       from pos.layaway_liquidation_commits where operation_id=v_operation)) <> 0 then
    raise exception 'H65_CONTEXT_OR_ADOPTION_AUDIT_FAILED';
  end if;
  if (select descuento_adicional from pos.sales where folio=v_folio) <> 10
     or (select descuento_adicional from pos.sale_items where folio=v_folio) <> 10
     or (select count(*) from pos.physical_card_redemptions
       where folio='H65-CARD' and sale_folio=v_folio) <> v_before_cards then
    raise exception 'H65_H52_SNAPSHOT_OR_CARD_CHANGED';
  end if;

  v_state := pos.sale_commit_authoritative_state(
    v_operation,v_folio,
    jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,'talla','M','qty',1
    ))
  );
  if not coalesce((v_state ->> 'stock_reserved')::boolean,false)
     or v_state -> 'sale' ->> 'estado' <> 'Pagado'
     or jsonb_array_length(v_state -> 'items') <> 1
     or jsonb_array_length(v_state -> 'payments') <> 2
     or jsonb_array_length(v_state -> 'movements') <> 1 then
    raise exception 'H65_AUTHORITATIVE_STATE_FAILED: %', v_state;
  end if;

  -- Mismo commit: no cambia stock, pagos, movimientos ni vendedores.
  v_result := pos.commit_layaway_liquidation_checked(
    v_commit,v_operation,v_folio,v_payment,v_effects,v_context
  );
  select (e ->> 'stock')::integer into v_stock
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id = v_product_id and e ->> 'talla' = 'M';
  if not coalesce((v_result ->> 'idempotent')::boolean,false)
     or not coalesce((v_result ->> 'stock_idempotent')::boolean,false)
     or v_stock <> 1
     or (select ventas_num from pos.sellers where id=v_seller) <> 1
     or (select count(*) from pos.sale_payments where folio=v_folio) <> 2
     or (select count(*) from pos.movements where ref=v_folio) <> 1 then
    raise exception 'H65_SAME_COMMIT_REPLAY_FAILED: %', v_result;
  end if;

  -- Otro commit_id con la misma intencion converge por operation_id.
  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-commit-2',v_operation,v_folio,v_payment,v_effects,v_context
  );
  if not coalesce((v_result ->> 'idempotent')::boolean,false)
     or v_result ->> 'original_commit_id' <> v_commit
     or (select count(*) from pos.layaway_liquidation_commits
       where operation_id=v_operation) <> 1 then
    raise exception 'H65_OPERATION_REPLAY_FAILED: %', v_result;
  end if;

  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-commit-mismatch',v_operation,v_folio,
    v_payment || jsonb_build_object('monto',61,'tarjeta',61),v_effects,v_context
  );
  if v_result ->> 'error' <> 'operation_mismatch' then
    raise exception 'H65_OPERATION_MISMATCH_NOT_REJECTED: %', v_result;
  end if;

  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-context-mismatch',v_operation,v_folio,v_payment,v_effects,
    v_context || jsonb_build_object('commission_amount',6)
  );
  if v_result ->> 'error' <> 'operation_mismatch' then
    raise exception 'H65_CONTEXT_NOT_INCLUDED_IN_HASH: %', v_result;
  end if;

  -- Documento legacy: operation_id y product_id nacieron NULL. La adopcion
  -- exige PK de renglon + SKU/talla exactos y un SKU unico en el servidor.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    'H65-VERIFY-LEGACY',null,'2026-08-01T10:00:00-07:00','Cliente legacy',
    '[]'::jsonb,'Apartado','Apartado',1,43.10,6.90,50,16,true,20,30,20,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    'H65-VERIFY-LEGACY',null,'H65-LEGACY-SKU','Producto H65 legacy',
    'M',1,50,50,50,'[]'::jsonb
  ) returning id into v_legacy_item_id;
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-legacy-advance','H65-VERIFY-LEGACY','2026-08-01 10:00',
    'anticipo','Efectivo',20,20,0,0,0
  );
  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-legacy-commit','h65-verify-legacy-operation',
    'H65-VERIFY-LEGACY',jsonb_build_object(
      'id','h65-legacy-liquidation','folio','H65-VERIFY-LEGACY',
      'fecha','2026-08-01T12:10:00-07:00','tipo','liquidacion',
      'metodo','Tarjeta','monto',30,'efectivo',0,'tarjeta',30,
      'transferencia',0,'otro',0
    ),'[]'::jsonb,jsonb_build_object(
      'item_identities',jsonb_build_array(jsonb_build_object(
        'sale_item_id',v_legacy_item_id,'product_id',v_legacy_product_id,
        'sku','H65-LEGACY-SKU','talla','M'
      )),
      'commission_amount',2.50,'commission_base','bruto'
    )
  );
  select (e ->> 'stock')::integer into v_stock
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id=v_legacy_product_id and e ->> 'talla'='M';
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or not coalesce((v_result ->> 'adopted_operation_id')::boolean,false)
     or jsonb_array_length(v_result -> 'adopted_item_identities') <> 1
     or (select operation_id from pos.sales
          where folio='H65-VERIFY-LEGACY') <> 'h65-verify-legacy-operation'
     or (select product_id from pos.sale_items
          where folio='H65-VERIFY-LEGACY') <> v_legacy_product_id
     or (select comision from pos.sales
          where folio='H65-VERIFY-LEGACY') <> 2.50
     or (select comision_base from pos.sales
          where folio='H65-VERIFY-LEGACY') <> 'bruto'
     or v_stock <> 1
     or not (select adopted_operation_id from pos.layaway_liquidation_commits
          where operation_id='h65-verify-legacy-operation')
     or jsonb_array_length((select adopted_item_identities
          from pos.layaway_liquidation_commits
          where operation_id='h65-verify-legacy-operation')) <> 1 then
    raise exception 'H65_LEGACY_ADOPTION_FAILED: %', v_result;
  end if;

  -- Sin mapeo exacto no se adopta nada.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    'H65-VERIFY-MISSING',null,'2026-08-01T10:00:00-07:00','Cliente missing',
    '[]'::jsonb,'Apartado','Apartado',1,43.10,6.90,50,16,true,20,30,20,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    'H65-VERIFY-MISSING',null,'H65-LEGACY-SKU','Producto H65 legacy',
    'M',1,50,50,50,'[]'::jsonb
  ) returning id into v_missing_item_id;
  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-missing-commit','h65-verify-missing-operation',
    'H65-VERIFY-MISSING',jsonb_build_object(
      'id','h65-missing-liquidation','folio','H65-VERIFY-MISSING',
      'fecha','2026-08-01T12:20:00-07:00','tipo','liquidacion',
      'metodo','Efectivo','monto',30,'efectivo',30,'tarjeta',0,
      'transferencia',0,'otro',0
    ),'[]'::jsonb,jsonb_build_object(
      'item_identities','[]'::jsonb,
      'commission_amount',0,'commission_base','neto'
    )
  );
  if v_result ->> 'error' <> 'layaway_item_identity_missing'
     or (select operation_id from pos.sales
          where folio='H65-VERIFY-MISSING') is not null
     or (select product_id from pos.sale_items
          where id=v_missing_item_id) is not null
     or exists(select 1 from pos.layaway_liquidation_commits
          where operation_id='h65-verify-missing-operation')
     or exists(select 1 from pos.stock_reservations
          where operation_id='h65-verify-missing-operation') then
    raise exception 'H65_MISSING_IDENTITY_WROTE_STATE: %', v_result;
  end if;

  -- Incluso con un product_id propuesto, un SKU duplicado en servidor es
  -- ambiguo: no se elige el primero ni se persiste la adopcion parcial.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    'H65-VERIFY-AMBIGUOUS',null,'2026-08-01T10:00:00-07:00','Cliente ambiguo',
    '[]'::jsonb,'Apartado','Apartado',1,43.10,6.90,50,16,true,20,30,20,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    'H65-VERIFY-AMBIGUOUS',null,'H65-DUPLICATE-SKU','Producto ambiguo',
    'M',1,50,50,50,'[]'::jsonb
  ) returning id into v_ambiguous_item_id;
  v_result := pos.commit_layaway_liquidation_checked(
    'h65-verify-ambiguous-commit','h65-verify-ambiguous-operation',
    'H65-VERIFY-AMBIGUOUS',jsonb_build_object(
      'id','h65-ambiguous-liquidation','folio','H65-VERIFY-AMBIGUOUS',
      'fecha','2026-08-01T12:30:00-07:00','tipo','liquidacion',
      'metodo','Efectivo','monto',30,'efectivo',30,'tarjeta',0,
      'transferencia',0,'otro',0
    ),'[]'::jsonb,jsonb_build_object(
      'item_identities',jsonb_build_array(jsonb_build_object(
        'sale_item_id',v_ambiguous_item_id,'product_id',v_ambiguous_product_a,
        'sku','H65-DUPLICATE-SKU','talla','M'
      )),
      'commission_amount',0,'commission_base','neto'
    )
  );
  if v_result ->> 'error' <> 'layaway_item_sku_ambiguous'
     or (select operation_id from pos.sales
          where folio='H65-VERIFY-AMBIGUOUS') is not null
     or (select product_id from pos.sale_items
          where id=v_ambiguous_item_id) is not null
     or exists(select 1 from pos.layaway_liquidation_commits
          where operation_id='h65-verify-ambiguous-operation')
     or exists(select 1 from pos.stock_reservations
          where operation_id='h65-verify-ambiguous-operation') then
    raise exception 'H65_AMBIGUOUS_SKU_WROTE_STATE: %', v_result;
  end if;

  if (select count(*) from pos.sale_stock_reservation_status(
       array[v_operation,'h65-verify-without-reservation']
     ) where operation_id=v_operation and stock_reserved
       and reservation_operation_id=v_operation) <> 1
     or (select count(*) from pos.sale_stock_reservation_status(
       array[v_operation,'h65-verify-without-reservation']
     ) where operation_id='h65-verify-without-reservation'
       and not stock_reserved and reservation_operation_id is null) <> 1 then
    raise exception 'H65_PULL_STATUS_FAILED';
  end if;

  -- Rollback tardio: el vendedor congelado no existe. commit_sale alcanza la
  -- reserva antes de fallar al acreditar el efecto; todo debe volver al inicio.
  insert into pos.sales(
    folio,operation_id,fecha,cliente,vendedores,metodo,estado,items,
    subtotal,iva,total,iva_pct,iva_included,anticipo,saldo,
    pago_efectivo,pago_otro,descuento,valor_regalado
  ) values (
    'H65-VERIFY-ROLLBACK','h65-verify-rollback-operation',
    '2026-08-01T10:00:00-07:00','Cliente rollback',
    '["h65-missing-seller"]'::jsonb,'Apartado','Apartado',1,
    86.21,13.79,100,16,true,40,60,40,0,0,0
  );
  insert into pos.sale_items(
    folio,product_id,sku,nombre,talla,qty,precio,
    precio_base,precio_original,promos
  ) values (
    'H65-VERIFY-ROLLBACK',v_rollback_product_id,'H65-ROLLBACK-SKU',
    'Producto H65 rollback','M',1,100,100,100,'[]'::jsonb
  );
  insert into pos.sale_payments(
    id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro
  ) values (
    'h65-rollback-advance','H65-VERIFY-ROLLBACK','2026-08-01 10:00',
    'anticipo','Efectivo',40,40,0,0,0
  );
  v_failed := false;
  begin
    perform pos.commit_layaway_liquidation_checked(
      'h65-verify-rollback-commit','h65-verify-rollback-operation',
      'H65-VERIFY-ROLLBACK',jsonb_build_object(
        'id','h65-rollback-liquidation','folio','H65-VERIFY-ROLLBACK',
        'fecha','2026-08-01T12:30:00-07:00','tipo','liquidacion',
        'metodo','Efectivo','monto',60,'efectivo',60,'tarjeta',0,
        'transferencia',0,'otro',0
      ),jsonb_build_array(jsonb_build_object(
        'id','h65-missing-seller','base_version',0,
        'ventas_mes_delta',100,'ventas_num_delta',1,
        'comision_acum_delta',0,'after_ventas_mes',100,
        'after_ventas_num',1,'after_comision_acum',0
      ))
    );
  exception when others then
    v_failed := true;
  end;
  select (e ->> 'stock')::integer into v_stock
    from pos.products p cross join lateral jsonb_array_elements(p.stock) e
   where p.id = v_rollback_product_id and e ->> 'talla' = 'M';
  if not v_failed or v_stock <> 2
     or (select estado from pos.sales where folio='H65-VERIFY-ROLLBACK') <> 'Apartado'
     or exists(select 1 from pos.stock_reservations
       where operation_id='h65-verify-rollback-operation')
     or exists(select 1 from pos.layaway_liquidation_commits
       where operation_id='h65-verify-rollback-operation')
     or exists(select 1 from pos.sale_commits
       where commit_id='h65-verify-rollback-commit')
     or exists(select 1 from pos.movements where ref='H65-VERIFY-ROLLBACK')
     or exists(select 1 from pos.sale_payments where id='h65-rollback-liquidation') then
    raise exception 'H65_LATE_FAILURE_DID_NOT_ROLL_BACK';
  end if;

  -- El wrapper general deriva reserva aunque el cliente mande false y devuelve
  -- el snapshot autoritativo. Su replay conserva ambos niveles de idempotencia.
  v_result := pos.commit_sale_checked(
    'h65-generic-commit','h65-generic-operation',jsonb_build_object(
      'folio','H65-VERIFY-GENERIC','operation_id','h65-generic-operation',
      'fecha','2026-08-01T13:00:00-07:00','cliente','Cliente generico',
      'vendedores','[]'::jsonb,'metodo','Efectivo','estado','Pagado','items',1,
       'subtotal',86.21,'iva',13.79,'total',100,'iva_pct',16,
       'iva_included',true,'anticipo',100,'saldo',0,
       'pago_efectivo',100,'pago_otro',0,'descuento',0,'valor_regalado',0,
       'comision',4.25,'comision_base','bruto'
    ),jsonb_build_array(jsonb_build_object(
      'folio','H65-VERIFY-GENERIC','product_id',v_generic_product_id,
      'sku','H65-GENERIC-SKU','nombre','Producto H65 generico','talla','M',
      'qty',1,'precio',100,'precio_base',100,'precio_original',100,
      'promos','[]'::jsonb
    )),jsonb_build_array(jsonb_build_object(
      'fecha','2026-08-01T13:00:00-07:00','tipo','Venta',
      'producto','Producto H65 generico','sku','H65-GENERIC-SKU',
      'cant',-1,'ref','H65-VERIFY-GENERIC'
    )),jsonb_build_array(jsonb_build_object(
      'id','h65-generic-payment','folio','H65-VERIFY-GENERIC',
      'fecha','2026-08-01 13:00','tipo','venta','metodo','Efectivo',
      'monto',100,'efectivo',100,'tarjeta',0,'transferencia',0,'otro',0
    )),jsonb_build_array(jsonb_build_object(
      'product_id',v_generic_product_id,'talla','M','qty',1
    )),false,null,'[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or not coalesce((v_result ->> 'stock_reserved')::boolean,false)
     or coalesce((v_result ->> 'stock_idempotent')::boolean,true)
     or v_result ->> 'reservation_operation_id' <> 'h65-generic-operation'
     or v_result -> 'sale' ->> 'estado' <> 'Pagado'
     or (v_result -> 'sale' ->> 'comision')::numeric <> 4.25
     or v_result -> 'sale' ->> 'comision_base' <> 'bruto'
     or (select comision from pos.sales
          where folio='H65-VERIFY-GENERIC') <> 4.25
     or (select comision_base from pos.sales
          where folio='H65-VERIFY-GENERIC') <> 'bruto'
     or jsonb_array_length(v_result -> 'payments') <> 1 then
    raise exception 'H65_GENERIC_CHECKED_CONTRACT_FAILED: %', v_result;
  end if;
  v_result := pos.commit_sale_checked(
    'h65-generic-commit','h65-generic-operation',jsonb_build_object(
      'folio','H65-VERIFY-GENERIC','operation_id','h65-generic-operation',
      'fecha','2026-08-01T13:00:00-07:00','cliente','Cliente generico',
      'vendedores','[]'::jsonb,'metodo','Efectivo','estado','Pagado','items',1,
       'subtotal',86.21,'iva',13.79,'total',100,'iva_pct',16,
       'iva_included',true,'anticipo',100,'saldo',0,
       'pago_efectivo',100,'pago_otro',0,'descuento',0,'valor_regalado',0,
       'comision',4.25,'comision_base','bruto'
    ),jsonb_build_array(jsonb_build_object(
      'folio','H65-VERIFY-GENERIC','product_id',v_generic_product_id,
      'sku','H65-GENERIC-SKU','nombre','Producto H65 generico','talla','M',
      'qty',1,'precio',100,'precio_base',100,'precio_original',100,
      'promos','[]'::jsonb
    )),jsonb_build_array(jsonb_build_object(
      'fecha','2026-08-01T13:00:00-07:00','tipo','Venta',
      'producto','Producto H65 generico','sku','H65-GENERIC-SKU',
      'cant',-1,'ref','H65-VERIFY-GENERIC'
    )),jsonb_build_array(jsonb_build_object(
      'id','h65-generic-payment','folio','H65-VERIFY-GENERIC',
      'fecha','2026-08-01 13:00','tipo','venta','metodo','Efectivo',
      'monto',100,'efectivo',100,'tarjeta',0,'transferencia',0,'otro',0
    )),jsonb_build_array(jsonb_build_object(
      'product_id',v_generic_product_id,'talla','M','qty',1
    )),false,null,'[]'::jsonb
  );
  if not coalesce((v_result ->> 'commit_idempotent')::boolean,false)
     or not coalesce((v_result ->> 'stock_idempotent')::boolean,false) then
    raise exception 'H65_GENERIC_CHECKED_REPLAY_FAILED: %', v_result;
  end if;

  -- El wrapper H-52 tambien expone el contrato, incluso cuando un apartado aun
  -- no reserva. Este fixture no usa tarjeta fisica; la prueba de no reconsumo es
  -- la liquidacion H-52 principal de arriba.
  v_result := pos.commit_sale_with_additional_discount_checked(
    'h65-h52-commit','h65-h52-operation',jsonb_build_object(
      'folio','H65-VERIFY-H52','operation_id','h65-h52-operation',
      'fecha','2026-08-01T14:00:00-07:00','cliente','Cliente H52',
      'vendedores','[]'::jsonb,'metodo','Apartado','estado','Apartado','items',1,
      'subtotal',86.21,'iva',13.79,'total',100,'iva_pct',16,
      'iva_included',true,'anticipo',40,'saldo',60,
       'pago_efectivo',40,'pago_otro',0,'descuento',0,'valor_regalado',0,
       'comision',3.50,'comision_base','neto',
       'descuento_adicional',10,'total_antes_descuento_adicional',110,
      'descuentos_adicionales',jsonb_build_array(jsonb_build_object(
        'origin','Empleado','benefitCode','EMP10','benefitName','Empleado'
      ))
    ),jsonb_build_array(jsonb_build_object(
      'folio','H65-VERIFY-H52','product_id',v_generic_product_id,
      'sku','H65-GENERIC-SKU','nombre','Producto H65 generico','talla','M',
      'qty',1,'precio',100,'precio_base',110,'precio_original',110,
      'promos','[]'::jsonb,'descuento_adicional',10
    )),'[]'::jsonb,jsonb_build_array(jsonb_build_object(
      'id','h65-h52-advance','folio','H65-VERIFY-H52',
      'fecha','2026-08-01 14:00','tipo','anticipo','metodo','Efectivo',
      'monto',40,'efectivo',40,'tarjeta',0,'transferencia',0,'otro',0
    )),jsonb_build_array(jsonb_build_object(
      'product_id',v_generic_product_id,'talla','M','qty',1
    )),false,null,'[]'::jsonb
  );
  if not coalesce((v_result ->> 'ok')::boolean,false)
     or coalesce((v_result ->> 'stock_reserved')::boolean,true)
     or v_result ->> 'reservation_operation_id' is not null
     or (v_result -> 'sale' ->> 'comision')::numeric <> 3.50
     or v_result -> 'sale' ->> 'comision_base' <> 'neto'
     or (v_result -> 'items' -> 0 ->> 'descuento_adicional')::numeric <> 10 then
    raise exception 'H65_H52_CHECKED_CONTRACT_FAILED: %', v_result;
  end if;

  -- Matriz minima de frontera: el core permanece privado, checked solo se
  -- expone a authenticated y la capacidad sales.collect sigue siendo default
  -- deny para anon, override deny y perfiles inactivos.
  v_checked_oid := to_regprocedure(
    'pos.commit_layaway_liquidation_checked(text,text,text,jsonb,jsonb,jsonb)'
  );
  v_core_oid := to_regprocedure(
    'pos.commit_layaway_liquidation(text,text,text,jsonb,jsonb,jsonb)'
  );
  if v_checked_oid is null or v_core_oid is null
     or has_function_privilege('public',v_checked_oid,'execute')
     or has_function_privilege('anon',v_checked_oid,'execute')
     or not has_function_privilege('authenticated',v_checked_oid,'execute')
     or has_function_privilege('public',v_core_oid,'execute')
     or has_function_privilege('anon',v_core_oid,'execute')
     or has_function_privilege('authenticated',v_core_oid,'execute')
     or not has_function_privilege('service_role',v_core_oid,'execute')
     or not exists (
       select 1 from pg_proc p where p.oid=v_checked_oid::oid
         and p.prosecdef
         and coalesce(p.proconfig,'{}'::text[])
             @> array['search_path=pos, pg_temp']
     ) then
    raise exception 'H65_RPC_ACL_OR_SECURITY_DEFINER_FAILED';
  end if;

  v_denied := false;
  begin
    execute 'set local role anon';
    perform pos.commit_layaway_liquidation_checked(
      v_commit,v_operation,v_folio,v_payment,v_effects,v_context
    );
    execute format('set local role %I',v_migration_role);
  exception when insufficient_privilege then
    execute format('set local role %I',v_migration_role);
    v_denied := true;
  end;
  execute format('set local role %I',v_migration_role);
  if not v_denied then
    raise exception 'H65_ANON_RPC_NOT_REJECTED';
  end if;

  v_denied := false;
  begin
    execute 'set local role authenticated';
    perform pos.commit_layaway_liquidation(
      v_commit,v_operation,v_folio,v_payment,v_effects,v_context
    );
    execute format('set local role %I',v_migration_role);
  exception when insufficient_privilege then
    execute format('set local role %I',v_migration_role);
    v_denied := true;
  end;
  execute format('set local role %I',v_migration_role);
  if not v_denied then
    raise exception 'H65_AUTHENTICATED_CORE_NOT_PRIVATE';
  end if;

  insert into pos.user_capability_overrides(user_id,capability_key,effect)
  values(v_user,'sales.collect','deny');
  v_denied := false;
  begin
    execute 'set local role authenticated';
    perform pos.commit_layaway_liquidation_checked(
      v_commit,v_operation,v_folio,v_payment,v_effects,v_context
    );
    execute format('set local role %I',v_migration_role);
  exception when sqlstate '42501' then
    execute format('set local role %I',v_migration_role);
    v_denied := true;
  when others then
    execute format('set local role %I',v_migration_role);
    raise;
  end;
  execute format('set local role %I',v_migration_role);
  delete from pos.user_capability_overrides
   where user_id=v_user and capability_key='sales.collect';
  if not v_denied then
    raise exception 'H65_CAPABILITY_DENY_NOT_ENFORCED';
  end if;

  -- El trigger historico de vendedores consulta el JWT aun cuando la migracion
  -- ya recupero su rol. Se limpia la identidad solo durante esta preparacion
  -- administrativa; despues se restaura para probar el rechazo real.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}'::jsonb::text, true);
  update pos.sellers set active=false where id=v_seller;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',v_user,'email',v_email,'role','authenticated'
  )::text, true);
  v_denied := false;
  begin
    execute 'set local role authenticated';
    perform pos.commit_layaway_liquidation_checked(
      v_commit,v_operation,v_folio,v_payment,v_effects,v_context
    );
    execute format('set local role %I',v_migration_role);
  exception when sqlstate '42501' then
    execute format('set local role %I',v_migration_role);
    v_denied := true;
  when others then
    execute format('set local role %I',v_migration_role);
    raise;
  end;
  execute format('set local role %I',v_migration_role);
  update pos.sellers set active=true where id=v_seller;
  if not v_denied then
    raise exception 'H65_INACTIVE_PROFILE_NOT_REJECTED';
  end if;

  -- Limpieza explicita y comprobada.
  delete from pos.physical_card_redemptions where folio='H65-CARD';
  delete from pos.layaway_liquidation_commits
   where operation_id like 'h65-verify-%';
  delete from pos.sale_payments where folio like 'H65-VERIFY-%';
  delete from pos.movements where ref like 'H65-VERIFY-%';
  delete from pos.sale_items where folio like 'H65-VERIFY-%';
  delete from pos.sales where folio like 'H65-VERIFY-%';
  delete from pos.sale_commits
   where commit_id like 'h65-verify-%'
      or commit_id in ('h65-generic-commit','h65-h52-commit');
  delete from pos.stock_reservations
   where operation_id like 'h65-verify-%'
      or operation_id in ('h65-generic-operation','h65-h52-operation');
  delete from pos.products where id in (
    v_product_id,v_generic_product_id,v_rollback_product_id,
    v_legacy_product_id,v_ambiguous_product_a,v_ambiguous_product_b
  );
  delete from pos.user_capability_overrides where user_id=v_user;
  delete from pos.user_permission_role_assignments where user_id=v_user;
  delete from pos.sellers where id=v_seller;
  delete from auth.users where id=v_user;

  if exists(select 1 from auth.users where id=v_user)
     or exists(select 1 from pos.products where id in (
       v_product_id,v_generic_product_id,v_rollback_product_id,
       v_legacy_product_id,v_ambiguous_product_a,v_ambiguous_product_b
     ))
     or exists(select 1 from pos.sales where folio like 'H65-VERIFY-%')
     or exists(select 1 from pos.stock_reservations
       where operation_id like 'h65-verify-%'
          or operation_id in ('h65-generic-operation','h65-h52-operation'))
     or exists(select 1 from pos.sale_commits
       where commit_id like 'h65-verify-%'
          or commit_id in ('h65-generic-commit','h65-h52-commit'))
     or exists(select 1 from pos.layaway_liquidation_commits
       where operation_id like 'h65-verify-%')
     or exists(select 1 from pos.user_capability_overrides where user_id=v_user) then
    raise exception 'H65_CLEANUP_FAILED';
  end if;

  raise notice 'H65 atomic=ok legacy_adoption=ok ambiguity=deny commission=ok acl=ok idempotence=ok rollback=ok h52=ok status=ok wrappers=ok cleanup=ok';
end;
$$;

commit;
