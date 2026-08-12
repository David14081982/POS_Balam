-- H-94 / 13800: identidad física exacta en Movimientos de Venta y Devolución.
-- Corrección hacia adelante: no infiere ni rellena movimientos históricos.

begin;

-- Impide que actividad concurrente se confunda con efectos de la verificación.
lock table pos.products, pos.sales, pos.sale_items, pos.sale_payments,
  pos.returns, pos.return_items, pos.exchanges, pos.exchange_items,
  pos.movements, pos.stock_reservations, pos.loan_documents,
  pos.reference_reclassifications, pos.sale_commits, pos.return_commits,
  pos.exchange_commits, pos.sellers, pos.user_permission_role_assignments,
  pos.sync_domain_versions in share row exclusive mode;

create temporary table h94_138_baseline (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

insert into h94_138_baseline(relation_name,row_count,row_fingerprint)
select 'products',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),',' order by p.id),'')) from pos.products p
union all
select 'products_v1',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),',' order by p.id),'')) from pos.products p where p.record_model='v1'
union all
select 'stock_total',pos.total_stock_pieces(),md5(pos.total_stock_pieces()::text)
union all
select 'sales',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.folio),'')) from pos.sales s
union all
select 'sale_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.id),'')) from pos.sale_items s
union all
select 'sale_payments',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.id),'')) from pos.sale_payments s
union all
select 'returns',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.id),'')) from pos.returns r
union all
select 'return_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.id),'')) from pos.return_items r
union all
select 'exchanges',count(*),md5(coalesce(string_agg(md5(to_jsonb(e)::text),',' order by e.id),'')) from pos.exchanges e
union all
select 'exchange_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(e)::text),',' order by e.id),'')) from pos.exchange_items e
union all
select 'movements',count(*),md5(coalesce(string_agg(md5(to_jsonb(m)::text),',' order by m.id),'')) from pos.movements m
union all
select 'stock_reservations',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.operation_id),'')) from pos.stock_reservations r
union all
select 'loan_documents',count(*),md5(coalesce(string_agg(md5(to_jsonb(l)::text),',' order by l.id),'')) from pos.loan_documents l
union all
select 'reference_reclassifications',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.operation_id),'')) from pos.reference_reclassifications r
union all
select 'sale_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.sale_commits c
union all
select 'return_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.return_commits c
union all
select 'exchange_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.exchange_commits c
union all
select 'sync_domain_versions',count(*),md5(coalesce(string_agg(md5(to_jsonb(v)::text),',' order by v.domain),'')) from pos.sync_domain_versions v;

create temporary table h94_138_privilege_baseline as
select p.oid::regprocedure::text function_name,
       has_function_privilege('public',p.oid,'execute') public_execute,
       has_function_privilege('anon',p.oid,'execute') anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') authenticated_execute
  from pg_proc p
 where p.oid in (
   'pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure,
   'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure
 );

-- R-DB-03: se transforma la definición desplegada, no una copia reescrita.
-- Cada fragmento viejo debe existir exactamente una vez o la migración aborta.
do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure
  ) into v_definition;

  v_old := 'insert into pos.movements (fecha, tipo, producto, sku, cant, ref)';
  v_new := 'insert into pos.movements (fecha, tipo, producto, product_id, sku, talla, cant, ref)';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H94_138_COMMIT_SALE_SHAPE_MISMATCH:movement_columns';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := 'select x.fecha::timestamptz, x.tipo, x.producto, x.sku, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(fecha text, tipo text, producto text, sku text, cant integer, ref text);';
  v_new := 'select x.fecha::timestamptz, x.tipo, x.producto, x.product_id, x.sku, x.talla, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(fecha text, tipo text, producto text, product_id text, sku text, talla text, cant integer, ref text);';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H94_138_COMMIT_SALE_SHAPE_MISMATCH:movement_values';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;

  select pg_get_functiondef(
    'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure
  ) into v_definition;

  v_old := 'return_id, fecha, tipo, producto, sku, cant, ref';
  v_new := 'return_id, fecha, tipo, producto, product_id, sku, talla, cant, ref';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H94_138_COMMIT_RETURN_SHAPE_MISMATCH:movement_columns';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := 'x.fecha::timestamptz, ''Devolución'', x.producto, x.sku, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(return_id text, fecha text, tipo text, producto text, sku text, cant integer, ref text);';
  v_new := 'x.fecha::timestamptz, ''Devolución'', x.producto, x.product_id, x.sku, x.talla, x.cant, v_folio
    from jsonb_to_recordset(p_moves)
      as x(return_id text, fecha text, tipo text, producto text, product_id text, sku text, talla text, cant integer, ref text);';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'H94_138_COMMIT_RETURN_SHAPE_MISMATCH:movement_values';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$$;

do $$
declare
  v_sale text;
  v_return text;
begin
  select pg_get_functiondef(
    'pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure
  ) into v_sale;
  select pg_get_functiondef(
    'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure
  ) into v_return;
  if position('producto, product_id, sku, talla, cant, ref' in v_sale)=0
     or position('x.producto, x.product_id, x.sku, x.talla, x.cant' in v_sale)=0
     or position('producto, product_id, sku, talla, cant, ref' in v_return)=0
     or position('x.producto, x.product_id, x.sku, x.talla, x.cant' in v_return)=0 then
    raise exception 'H94_138_MOVEMENT_WRITERS_NOT_REPLACED';
  end if;
  if exists (
    select 1 from h94_138_privilege_baseline b
    join pg_proc p on p.oid::regprocedure::text=b.function_name
    where b.public_execute<>has_function_privilege('public',p.oid,'execute')
       or b.anon_execute<>has_function_privilege('anon',p.oid,'execute')
       or b.authenticated_execute<>has_function_privilege('authenticated',p.oid,'execute')
  ) then
    raise exception 'H94_138_RPC_PRIVILEGES_CHANGED';
  end if;
end;
$$;

-- Las identidades consumidas por los fixtures son no transaccionales.
create temporary table h94_138_sequence_baseline (
  sequence_name text primary key,
  last_value bigint not null,
  is_called boolean not null
) on commit drop;

do $$
declare
  v_relation text;
  v_column text;
  v_sequence text;
  v_last bigint;
  v_called boolean;
begin
  for v_relation,v_column in values
    ('pos.sale_items','id'),('pos.return_items','id'),('pos.movements','id')
  loop
    v_sequence := pg_get_serial_sequence(v_relation,v_column);
    execute format('select last_value,is_called from %s',v_sequence) into v_last,v_called;
    insert into h94_138_sequence_baseline values(v_sequence,v_last,v_called);
  end loop;
end;
$$;

savepoint h94_138_verification;

do $$
declare
  v_actor constant uuid := '00000000-0000-4000-8000-000000941380';
  v_email constant text := 'h94.138.admin@invalid.local';
  v_a constant text := 'H94-138-A';
  v_b constant text := 'H94-138-B';
  v_sku constant text := 'H94-138-SKU-DUP';
  v_sale_a constant text := 'H94-138-SALE-A';
  v_sale_ab constant text := 'H94-138-SALE-AB';
  v_return_a constant text := 'H94-138-RETURN-A';
  v_late_sale constant text := 'H94-138-SALE-LATE';
  v_result jsonb;
  v_sale_head jsonb;
  v_items jsonb;
  v_moves jsonb;
  v_payments jsonb;
  v_stock_lines jsonb;
  v_sale_count bigint;
  v_item_count bigint;
  v_payment_count bigint;
  v_move_count bigint;
  v_sale_commit_count bigint;
  v_return_count bigint;
  v_return_item_count bigint;
  v_return_commit_count bigint;
begin
  if exists(select 1 from auth.users where id=v_actor)
     or exists(select 1 from pos.products where id in(v_a,v_b))
     or exists(select 1 from pos.sales where folio like 'H94-138-%')
     or exists(select 1 from pos.returns where id like 'H94-138-%') then
    raise exception 'H94_138_FIXTURE_COLLISION';
  end if;

  insert into auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values(
    '00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated',
    v_email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
  );
  insert into pos.sellers(id,nombre,email,role,active)
    values('h94-138-admin','Admin H94 138',v_email,'admin',true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active)
    values(v_actor,'admin',true);

  insert into pos.products(
    id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,
    stock,sku,attrs,record_model,size_category_id,size_code,size_scale,
    stock_quantity,barcode_code,ornament_color_codes,physical_signature
  ) values
    (v_a,'1','ML','ALG','BL','MAO','H94138','Referencia A Dorado','BEL','["DRO"]',100,40,
     '[]',v_sku,'{"corte":"REG"}','v2','size_number','40','N',
     3,'H94138A1','["DRO"]','H94|138|A'),
    (v_b,'1','ML','ALG','BL','MAO','H94138','Referencia B Azul','BEL','["AZL"]',100,40,
     '[]',v_sku,'{"corte":"REG"}','v2','size_number','40','N',
     3,'H94138B1','["AZL"]','H94|138|B');

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claim.email',v_email,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_actor::text,'email',v_email,'role','authenticated','aud','authenticated'
  )::text,true);

  -- Venta simple: A Dorado, stock 3 -> 2.
  v_sale_head := jsonb_build_object(
    'folio',v_sale_a,'fecha','2026-08-11T12:00:00Z','cliente','Cliente H94 138',
    'vendedores','[]'::jsonb,'metodo','Efectivo','estado','Pagado','items',1,
    'subtotal',100,'iva',0,'total',100,'iva_pct',0,'iva_included',true,
    'anticipo',100,'saldo',0,'pago_efectivo',100,'pago_otro',0,
    'descuento',0,'valor_regalado',0
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'folio',v_sale_a,'product_id',v_a,'line_id','H94-138-LINE-A1',
    'barcode_code','H94138A1','physical_attrs',jsonb_build_object(
      'material','ALG','ornamentColorCodes',jsonb_build_array('DRO'),'size','40'),
    'sku',v_sku,'nombre','Referencia A Dorado','talla','40','qty',1,
    'precio',100,'precio_base',100,'precio_original',100,'promos','[]'::jsonb,
    'list_price',100,'effective_price',100,'discount_snapshot','{}'::jsonb
  ));
  v_moves := jsonb_build_array(jsonb_build_object(
    'fecha','2026-08-11T12:00:00Z','tipo','Venta','producto','Referencia A Dorado',
    'product_id',v_a,'sku',v_sku,'talla','40','cant',-1,'ref',v_sale_a
  ));
  v_payments := jsonb_build_array(jsonb_build_object(
    'id','H94-138-PAY-A','folio',v_sale_a,'fecha','2026-08-11 12:00',
    'tipo','venta','metodo','Efectivo','monto',100,'efectivo',100,
    'tarjeta',0,'transferencia',0,'otro',0
  ));
  v_stock_lines := jsonb_build_array(jsonb_build_object('product_id',v_a,'talla','40','qty',1));
  v_result := pos.commit_sale_checked(
    'H94-138-COMMIT-SALE-A','H94-138-OP-SALE-A',v_sale_head,v_items,v_moves,
    v_payments,v_stock_lines,true,null,'[]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true
     or coalesce((v_result->>'idempotent')::boolean,false) is true
     or (select stock_quantity from pos.products where id=v_a)<>2
     or not exists(select 1 from pos.sale_items where folio=v_sale_a and product_id=v_a and talla='40')
     or not exists(select 1 from pos.movements where ref=v_sale_a and tipo='Venta'
       and product_id=v_a and talla='40' and sku=v_sku and cant=-1) then
    raise exception 'H94_138_SALE_EXACT_IDENTITY_FAILED:%',v_result;
  end if;

  select count(*) into v_sale_count from pos.sales;
  select count(*) into v_item_count from pos.sale_items;
  select count(*) into v_payment_count from pos.sale_payments;
  select count(*) into v_move_count from pos.movements;
  select count(*) into v_sale_commit_count from pos.sale_commits;
  v_result := pos.commit_sale_checked(
    'H94-138-COMMIT-SALE-A','H94-138-OP-SALE-A',v_sale_head,v_items,v_moves,
    v_payments,v_stock_lines,true,null,'[]'::jsonb
  );
  if coalesce((v_result->>'idempotent')::boolean,false) is not true
     or (select stock_quantity from pos.products where id=v_a)<>2
     or (select count(*) from pos.sales)<>v_sale_count
     or (select count(*) from pos.sale_items)<>v_item_count
     or (select count(*) from pos.sale_payments)<>v_payment_count
     or (select count(*) from pos.movements)<>v_move_count
     or (select count(*) from pos.sale_commits)<>v_sale_commit_count then
    raise exception 'H94_138_SALE_IDEMPOTENCY_FAILED:%',v_result;
  end if;

  -- Venta conjunta de A y B con el mismo SKU visible.
  v_sale_head := v_sale_head || jsonb_build_object(
    'folio',v_sale_ab,'fecha','2026-08-11T12:05:00Z','items',2,
    'subtotal',200,'total',200,'anticipo',200,'pago_efectivo',200
  );
  v_items := jsonb_build_array(
    jsonb_build_object(
      'folio',v_sale_ab,'product_id',v_a,'line_id','H94-138-LINE-A2','barcode_code','H94138A1',
      'physical_attrs',jsonb_build_object('material','ALG','ornamentColorCodes',jsonb_build_array('DRO'),'size','40'),
      'sku',v_sku,'nombre','Referencia A Dorado','talla','40','qty',1,
      'precio',100,'precio_base',100,'precio_original',100,'promos','[]'::jsonb,
      'list_price',100,'effective_price',100,'discount_snapshot','{}'::jsonb),
    jsonb_build_object(
      'folio',v_sale_ab,'product_id',v_b,'line_id','H94-138-LINE-B2','barcode_code','H94138B1',
      'physical_attrs',jsonb_build_object('material','ALG','ornamentColorCodes',jsonb_build_array('AZL'),'size','40'),
      'sku',v_sku,'nombre','Referencia B Azul','talla','40','qty',1,
      'precio',100,'precio_base',100,'precio_original',100,'promos','[]'::jsonb,
      'list_price',100,'effective_price',100,'discount_snapshot','{}'::jsonb)
  );
  v_moves := jsonb_build_array(
    jsonb_build_object('fecha','2026-08-11T12:05:00Z','tipo','Venta','producto','Referencia A Dorado',
      'product_id',v_a,'sku',v_sku,'talla','40','cant',-1,'ref',v_sale_ab),
    jsonb_build_object('fecha','2026-08-11T12:05:00Z','tipo','Venta','producto','Referencia B Azul',
      'product_id',v_b,'sku',v_sku,'talla','40','cant',-1,'ref',v_sale_ab)
  );
  v_payments := jsonb_build_array(jsonb_build_object(
    'id','H94-138-PAY-AB','folio',v_sale_ab,'fecha','2026-08-11 12:05',
    'tipo','venta','metodo','Efectivo','monto',200,'efectivo',200,
    'tarjeta',0,'transferencia',0,'otro',0
  ));
  v_stock_lines := jsonb_build_array(
    jsonb_build_object('product_id',v_a,'talla','40','qty',1),
    jsonb_build_object('product_id',v_b,'talla','40','qty',1)
  );
  v_result := pos.commit_sale_checked(
    'H94-138-COMMIT-SALE-AB','H94-138-OP-SALE-AB',v_sale_head,v_items,v_moves,
    v_payments,v_stock_lines,true,null,'[]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true
     or (select stock_quantity from pos.products where id=v_a)<>1
     or (select stock_quantity from pos.products where id=v_b)<>2
     or (select count(*) from pos.movements where ref=v_sale_ab and product_id=v_a and talla='40' and sku=v_sku)<>1
     or (select count(*) from pos.movements where ref=v_sale_ab and product_id=v_b and talla='40' and sku=v_sku)<>1 then
    raise exception 'H94_138_SALE_EXACT_IDENTITY_FAILED:duplicate_sku:%',v_result;
  end if;

  if exists(select 1 from pos.movements where ref in(v_sale_a,v_sale_ab)
      and (product_id is null or talla is null or sku is null or producto is null or tipo<>'Venta' or cant>=0)) then
    raise exception 'H94_138_KARDEX_SNAPSHOT_FAILED:sale';
  end if;

  -- Devuelve A de la venta conjunta: A 1 -> 2; B permanece en 2.
  v_items := jsonb_build_array(jsonb_build_object(
    'return_id',v_return_a,'product_id',v_a,'line_id','H94-138-RETURN-LINE-A',
    'source_sale_line_id','H94-138-LINE-A2','barcode_code','H94138A1',
    'physical_attrs',jsonb_build_object('material','ALG','ornamentColorCodes',jsonb_build_array('DRO'),'size','40'),
    'sku',v_sku,'nombre','Referencia A Dorado','talla','40','qty',1,
    'motivo','CAMBIO','precio',100,'list_price',100,'effective_price',100,
    'discount_snapshot','{}'::jsonb
  ));
  v_moves := jsonb_build_array(jsonb_build_object(
    'return_id',v_return_a,'fecha','2026-08-11T12:10:00Z','tipo','Devolución',
    'producto','Referencia A Dorado','product_id',v_a,'sku',v_sku,'talla','40',
    'cant',1,'ref',v_sale_ab
  ));
  v_stock_lines := jsonb_build_array(jsonb_build_object('product_id',v_a,'talla','40','qty',1));
  v_result := pos.commit_return_checked(
    'H94-138-COMMIT-RETURN-A',jsonb_build_object(
      'id',v_return_a,'folio',v_sale_ab,'cliente','Cliente H94 138',
      'vendedores','[]'::jsonb,'metodo','Efectivo','total',100,
      'notas','Fixture H94 138','fecha','2026-08-11 12:10'
    ),v_items,v_moves,v_stock_lines,null,'[]'::jsonb,false
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true
     or not exists(select 1 from pos.return_items where return_id=v_return_a
       and product_id=v_a and talla='40' and source_sale_line_id='H94-138-LINE-A2')
     or not exists(select 1 from pos.movements where return_id=v_return_a
       and ref=v_sale_ab and tipo='Devolución' and product_id=v_a
       and talla='40' and sku=v_sku and cant=1) then
    raise exception 'H94_138_RETURN_EXACT_IDENTITY_FAILED:%',v_result;
  end if;
  if (select stock_quantity from pos.products where id=v_a)<>2
     or (select stock_quantity from pos.products where id=v_b)<>2 then
    raise exception 'H94_138_RETURN_STOCK_FAILED';
  end if;
  if exists(select 1 from pos.movements where return_id=v_return_a
      and (product_id is null or talla is null or sku is null or producto is null
        or tipo<>'Devolución' or cant<=0)) then
    raise exception 'H94_138_KARDEX_SNAPSHOT_FAILED:return';
  end if;

  select count(*) into v_return_count from pos.returns;
  select count(*) into v_return_item_count from pos.return_items;
  select count(*) into v_move_count from pos.movements;
  select count(*) into v_return_commit_count from pos.return_commits;
  v_result := pos.commit_return_checked(
    'H94-138-COMMIT-RETURN-A',jsonb_build_object(
      'id',v_return_a,'folio',v_sale_ab,'cliente','Cliente H94 138',
      'vendedores','[]'::jsonb,'metodo','Efectivo','total',100,
      'notas','Fixture H94 138','fecha','2026-08-11 12:10'
    ),v_items,v_moves,v_stock_lines,null,'[]'::jsonb,false
  );
  if coalesce((v_result->>'idempotent')::boolean,false) is not true
     or (select stock_quantity from pos.products where id=v_a)<>2
     or (select stock_quantity from pos.products where id=v_b)<>2
     or (select count(*) from pos.returns)<>v_return_count
     or (select count(*) from pos.return_items)<>v_return_item_count
     or (select count(*) from pos.movements)<>v_move_count
     or (select count(*) from pos.return_commits)<>v_return_commit_count then
    raise exception 'H94_138_RETURN_IDEMPOTENCY_FAILED:%',v_result;
  end if;

  -- Falla después de reservar stock e insertar venta/items/movimiento: el pago
  -- inválido debe revertir la sentencia RPC completa.
  select count(*) into v_sale_count from pos.sales;
  select count(*) into v_item_count from pos.sale_items;
  select count(*) into v_payment_count from pos.sale_payments;
  select count(*) into v_move_count from pos.movements;
  select count(*) into v_sale_commit_count from pos.sale_commits;
  begin
    v_result := pos.commit_sale_checked(
      'H94-138-COMMIT-LATE','H94-138-OP-LATE',
      v_sale_head || jsonb_build_object('folio',v_late_sale,'items',1,'subtotal',100,'total',100,'anticipo',100,'pago_efectivo',100),
      jsonb_build_array((v_items->0) - 'return_id' - 'source_sale_line_id' || jsonb_build_object(
        'folio',v_late_sale,'line_id','H94-138-LATE-LINE')),
      jsonb_build_array(jsonb_build_object(
        'fecha','2026-08-11T12:15:00Z','tipo','Venta','producto','Referencia A Dorado',
        'product_id',v_a,'sku',v_sku,'talla','40','cant',-1,'ref',v_late_sale)),
      jsonb_build_array(jsonb_build_object(
        'id','H94-138-PAY-LATE','folio',v_late_sale,'fecha','2026-08-11 12:15',
        'tipo','venta','metodo','Efectivo','monto','NOT_NUMERIC','efectivo',100,
        'tarjeta',0,'transferencia',0,'otro',0)),
      jsonb_build_array(jsonb_build_object('product_id',v_a,'talla','40','qty',1)),
      true,null,'[]'::jsonb
    );
    raise exception 'H94_138_LATE_FAILURE_WAS_ACCEPTED:%',v_result;
  exception when invalid_text_representation then null;
  end;
  if exists(select 1 from pos.sales where folio=v_late_sale)
     or exists(select 1 from pos.sale_items where folio=v_late_sale)
     or exists(select 1 from pos.sale_payments where folio=v_late_sale)
     or exists(select 1 from pos.movements where ref=v_late_sale)
     or exists(select 1 from pos.sale_commits where commit_id='H94-138-COMMIT-LATE')
     or exists(select 1 from pos.stock_reservations where operation_id='H94-138-OP-LATE')
     or (select stock_quantity from pos.products where id=v_a)<>2
     or (select stock_quantity from pos.products where id=v_b)<>2
     or (select count(*) from pos.sales)<>v_sale_count
     or (select count(*) from pos.sale_items)<>v_item_count
     or (select count(*) from pos.sale_payments)<>v_payment_count
     or (select count(*) from pos.movements)<>v_move_count
     or (select count(*) from pos.sale_commits)<>v_sale_commit_count then
    raise exception 'H94_138_LATE_ROLLBACK_FAILED';
  end if;

  raise notice 'H94-138 sale_A_3_to_2=ok duplicate_sku_A_B=ok return_A_exact=ok';
  raise notice 'H94-138 kardex_identity=ok idempotency=ok late_rollback=ok';
end;
$$;

rollback to savepoint h94_138_verification;

do $$
declare v_sequence record;
begin
  for v_sequence in select * from h94_138_sequence_baseline loop
    perform setval(v_sequence.sequence_name::regclass,v_sequence.last_value,v_sequence.is_called);
  end loop;
end;
$$;

create temporary table h94_138_after (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

insert into h94_138_after(relation_name,row_count,row_fingerprint)
select 'products',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),',' order by p.id),'')) from pos.products p
union all
select 'products_v1',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),',' order by p.id),'')) from pos.products p where p.record_model='v1'
union all
select 'stock_total',pos.total_stock_pieces(),md5(pos.total_stock_pieces()::text)
union all
select 'sales',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.folio),'')) from pos.sales s
union all
select 'sale_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.id),'')) from pos.sale_items s
union all
select 'sale_payments',count(*),md5(coalesce(string_agg(md5(to_jsonb(s)::text),',' order by s.id),'')) from pos.sale_payments s
union all
select 'returns',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.id),'')) from pos.returns r
union all
select 'return_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.id),'')) from pos.return_items r
union all
select 'exchanges',count(*),md5(coalesce(string_agg(md5(to_jsonb(e)::text),',' order by e.id),'')) from pos.exchanges e
union all
select 'exchange_items',count(*),md5(coalesce(string_agg(md5(to_jsonb(e)::text),',' order by e.id),'')) from pos.exchange_items e
union all
select 'movements',count(*),md5(coalesce(string_agg(md5(to_jsonb(m)::text),',' order by m.id),'')) from pos.movements m
union all
select 'stock_reservations',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.operation_id),'')) from pos.stock_reservations r
union all
select 'loan_documents',count(*),md5(coalesce(string_agg(md5(to_jsonb(l)::text),',' order by l.id),'')) from pos.loan_documents l
union all
select 'reference_reclassifications',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by r.operation_id),'')) from pos.reference_reclassifications r
union all
select 'sale_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.sale_commits c
union all
select 'return_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.return_commits c
union all
select 'exchange_commits',count(*),md5(coalesce(string_agg(md5(to_jsonb(c)::text),',' order by c.commit_id),'')) from pos.exchange_commits c
union all
select 'sync_domain_versions',count(*),md5(coalesce(string_agg(md5(to_jsonb(v)::text),',' order by v.domain),'')) from pos.sync_domain_versions v;

do $$
begin
  if exists(
    (select * from h94_138_baseline except select * from h94_138_after)
    union all
    (select * from h94_138_after except select * from h94_138_baseline)
  ) then
    raise exception 'H94_138_PREEXISTING_DATA_CHANGED:%',(
      select jsonb_agg(to_jsonb(d)) from(
        (select 'before_only' side,b.* from h94_138_baseline b except
         select 'before_only',a.* from h94_138_after a)
        union all
        (select 'after_only',a.* from h94_138_after a except
         select 'after_only',b.* from h94_138_baseline b)
      ) d
    );
  end if;
  if exists(select 1 from pos.products where id in('H94-138-A','H94-138-B'))
     or exists(select 1 from pos.sales where folio like 'H94-138-%')
     or exists(select 1 from pos.returns where id like 'H94-138-%')
     or exists(select 1 from pos.movements where ref like 'H94-138-%')
     or exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000941380') then
    raise exception 'H94_138_FIXTURE_RESIDUE';
  end if;
  raise notice 'H94-138 preexisting_rows_and_inventory=unchanged fixtures=0';
end;
$$;

commit;
