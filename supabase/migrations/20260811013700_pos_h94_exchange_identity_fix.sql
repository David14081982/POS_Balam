-- H-94 / 13700: identidad exacta y snapshots V2 en Cambios.
-- Corrección hacia adelante: no interpreta históricos ni modifica inventario.

begin;

-- La huella se toma bajo candados de escritura para que una operación concurrente
-- no pueda confundirse con un efecto de esta migración.
lock table pos.products, pos.sales, pos.sale_items, pos.returns, pos.return_items,
  pos.exchanges, pos.movements, pos.stock_reservations, pos.loan_documents,
  pos.reference_reclassifications, pos.exchange_commits, pos.sale_payments,
  pos.sellers, pos.user_permission_role_assignments, pos.sync_domain_versions
  in share row exclusive mode;
lock table pos.exchange_items in access exclusive mode;

create temporary table h94_137_baseline (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

insert into h94_137_baseline(relation_name, row_count, row_fingerprint)
select 'products', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by p.id), '')) from pos.products p
union all
select 'stock_total', pos.total_stock_pieces(), md5(pos.total_stock_pieces()::text)
union all
select 'sales', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by s.folio), '')) from pos.sales s
union all
select 'sale_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by s.id), '')) from pos.sale_items s
union all
select 'returns', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.id), '')) from pos.returns r
union all
select 'return_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.id), '')) from pos.return_items r
union all
select 'exchanges', count(*), md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.id), '')) from pos.exchanges e
union all
select 'exchange_items', count(*), md5(coalesce(string_agg(md5((to_jsonb(e) - 'product_id')::text), ',' order by e.id), '')) from pos.exchange_items e
union all
select 'movements', count(*), md5(coalesce(string_agg(md5(to_jsonb(m)::text), ',' order by m.id), '')) from pos.movements m
union all
select 'stock_reservations', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.operation_id), '')) from pos.stock_reservations r
union all
select 'loan_documents', count(*), md5(coalesce(string_agg(md5(to_jsonb(l)::text), ',' order by l.id), '')) from pos.loan_documents l
union all
select 'reference_reclassifications', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.operation_id), '')) from pos.reference_reclassifications r
union all
select 'exchange_commits', count(*), md5(coalesce(string_agg(md5(to_jsonb(c)::text), ',' order by c.commit_id), '')) from pos.exchange_commits c
union all
select 'sale_payments', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by p.id), '')) from pos.sale_payments p
union all
select 'sync_domain_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(v)::text), ',' order by v.domain), '')) from pos.sync_domain_versions v;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'pos' and table_name = 'exchange_items'
      and column_name = 'product_id'
  ) then
    raise exception 'H94_137_UNEXPECTED_PRODUCT_ID_PREEXISTS';
  end if;
end;
$$;

alter table pos.exchange_items
  add column if not exists product_id text;

comment on column pos.exchange_items.product_id is
  'H-94: products.id exacto congelado por renglón. NULL identifica documentos históricos anteriores; nunca se infiere por SKU.';

create index if not exists pos_exchange_items_product_id_idx
  on pos.exchange_items(product_id)
  where product_id is not null;

-- R-DB-03: la función viva no se retipea. Se obtiene la definición desplegada
-- y se sustituyen cuatro fragmentos, cada uno exigido exactamente una vez.
do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    into v_definition;

  v_old := 'insert into pos.exchange_items (exchange_id, lado, sku, nombre, talla, qty, precio, motivo, condicion)';
  v_new := 'insert into pos.exchange_items (exchange_id, lado, product_id, sku, nombre, talla, qty, precio, motivo, condicion)';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H94_137_COMMIT_EXCHANGE_SHAPE_MISMATCH:exchange_columns';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'select v_id, x.lado, x.sku, x.nombre, x.talla, x.qty,';
  v_new := 'select v_id, x.lado, x.product_id, x.sku, x.nombre, x.talla, x.qty,';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H94_137_COMMIT_EXCHANGE_SHAPE_MISMATCH:exchange_values';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'insert into pos.movements (fecha, tipo, producto, sku, cant, ref)';
  v_new := 'insert into pos.movements (fecha, tipo, producto, product_id, sku, talla, cant, ref)';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H94_137_COMMIT_EXCHANGE_SHAPE_MISMATCH:movement_columns';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'select x.fecha, x.tipo, x.producto, x.sku, x.cant, coalesce(x.ref, v_folio)
      from jsonb_to_recordset(p_moves)
        as x(fecha timestamptz, tipo text, producto text, sku text, cant integer, ref text);';
  v_new := 'select x.fecha, x.tipo, x.producto, x.product_id, x.sku, x.talla, x.cant, coalesce(x.ref, v_folio)
      from jsonb_to_recordset(p_moves)
        as x(fecha timestamptz, tipo text, producto text, product_id text, sku text, talla text, cant integer, ref text);';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'H94_137_COMMIT_EXCHANGE_SHAPE_MISMATCH:movement_values';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$$;

do $$
declare v_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'pos' and table_name = 'exchange_items'
      and column_name = 'product_id' and is_nullable = 'YES'
  ) then
    raise exception 'H94_137_PRODUCT_ID_COLUMN_INVALID';
  end if;
  if exists (select 1 from pos.exchange_items where product_id is not null) then
    raise exception 'H94_137_HISTORICAL_BACKFILL_DETECTED';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'pos' and indexname = 'pos_exchange_items_product_id_idx'
      and indexdef ilike '%(product_id)%where (product_id is not null)%'
  ) then
    raise exception 'H94_137_PRODUCT_ID_INDEX_MISSING';
  end if;
  select pg_get_functiondef('pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    into v_definition;
  if position('exchange_id, lado, product_id, sku' in v_definition) = 0
     or position('producto, product_id, sku, talla' in v_definition) = 0 then
    raise exception 'H94_137_WRITER_NOT_REPLACED';
  end if;
  if has_function_privilege('authenticated',
       'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated',
       'pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon',
       'pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'H94_137_RPC_PRIVILEGES_CHANGED';
  end if;
end;
$$;

-- La verificación usa la vía pública real. Todo fixture, incluidas versiones de
-- sincronización, queda dentro de un savepoint y se revierte de una sola vez.
create temporary table h94_137_exchange_sequence_baseline (
  sequence_name text primary key,
  last_value bigint not null,
  is_called boolean not null
) on commit drop;

do $$
declare
  v_sequence text := pg_get_serial_sequence('pos.exchange_items', 'id');
  v_last bigint;
  v_called boolean;
begin
  execute format('select last_value, is_called from %s', v_sequence)
    into v_last, v_called;
  insert into h94_137_exchange_sequence_baseline
    values (v_sequence, v_last, v_called);
end;
$$;

savepoint h94_137_verification;

do $$
declare
  v_actor constant uuid := '00000000-0000-4000-8000-000000941370';
  v_email constant text := 'h94.137.admin@invalid.local';
  v_product_a constant text := 'H94-137-A';
  v_product_b constant text := 'H94-137-B';
  v_sale constant text := 'H94-137-SALE';
  v_operation constant text := 'H94-137-SALE-OP';
  v_exchange constant text := 'H94-137-EXCHANGE';
  v_late_exchange constant text := 'H94-137-EXCHANGE-LATE';
  v_sku constant text := 'H94-137-SKU-DUP';
  v_head jsonb;
  v_items jsonb;
  v_moves jsonb;
  v_result jsonb;
  v_stock_a integer;
  v_stock_b integer;
  v_exchange_count bigint;
  v_item_count bigint;
  v_move_count bigint;
  v_commit_count bigint;
begin
  if exists(select 1 from auth.users where id = v_actor)
     or exists(select 1 from pos.products where id in (v_product_a, v_product_b))
     or exists(select 1 from pos.sales where folio = v_sale)
     or exists(select 1 from pos.exchanges where id in (v_exchange, v_late_exchange)) then
    raise exception 'H94_137_FIXTURE_COLLISION';
  end if;

  insert into auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated',
    v_email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
  );
  insert into pos.sellers(id,nombre,email,role,active)
    values('h94-137-admin','Admin H94 137',v_email,'admin',true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active)
    values(v_actor,'admin',true);

  insert into pos.products(
    id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,precio,costo,
    stock,sku,attrs,record_model,size_category_id,size_code,size_scale,
    stock_quantity,barcode_code,ornament_color_codes,physical_signature
  ) values
    (v_product_a,'1','ML','ALG','BL','MAO','H94137','Referencia A','BEL','["DRO"]',100,40,
     '[]',v_sku,'{"corte":"REG","caracteristicas":"A"}','v2','size_number','40','N',
     1,'H94137A1','["DRO"]','H94|137|A'),
    (v_product_b,'1','ML','ALG','BL','MAO','H94137','Referencia B','BEL','["AZL"]',100,40,
     '[]',v_sku,'{"corte":"REG","caracteristicas":"B"}','v2','size_number','40','N',
     3,'H94137B1','["AZL"]','H94|137|B');

  insert into pos.stock_reservations(operation_id,folio,lines,actor_email)
    values(v_operation,v_sale,
      jsonb_build_array(jsonb_build_object('product_id',v_product_a,'talla','40','qty',2)),
      v_email);
  insert into pos.sales(folio,fecha,cliente,items,total,metodo,estado,operation_id)
    values(v_sale,now(),'Cliente H94 137',2,200,'Efectivo','Pagado',v_operation);
  insert into pos.sale_items(
    folio,product_id,line_id,barcode_code,physical_attrs,sku,nombre,talla,qty,
    precio,precio_base,precio_original,list_price,effective_price,discount_snapshot,
    ornamento,orn_colors
  ) values (
    v_sale,v_product_a,'H94-137-SALE-LINE','H94137A1',
    '{"material":"ALG","ornamentColorCodes":["DRO"],"size":"40"}',
    v_sku,'Referencia A','40',2,100,100,100,100,100,'{"additional":0}','BEL','["DRO"]'
  );

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claim.email',v_email,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_actor::text,'email',v_email,'role','authenticated','aud','authenticated'
  )::text,true);

  v_head := jsonb_build_object(
    'id',v_exchange,'folio','CB-H94-137-OK','origen_folio',v_sale,
    'fecha','2026-08-11 12:00','usuario',v_email
  );
  v_items := jsonb_build_array(
    jsonb_build_object(
      'lado','devuelto','product_id',v_product_a,'line_id','H94-137-RETURN-A',
      'source_sale_line_id','H94-137-SALE-LINE','barcode_code','H94137A1',
      'physical_attrs',jsonb_build_object('material','ALG','ornamentColorCodes',jsonb_build_array('DRO'),'size','40'),
      'sku',v_sku,'nombre','Referencia A','talla','40','qty',1,
      'list_price',100,'effective_price',100,'discount_snapshot',jsonb_build_object('additional',0),
      'ornamento','BEL','orn_colors',jsonb_build_array('DRO'),'condicion','Vendible'
    ),
    jsonb_build_object(
      'lado','entregado','product_id',v_product_b,'line_id','H94-137-DELIVER-B',
      'barcode_code','H94137B1',
      'physical_attrs',jsonb_build_object('material','ALG','ornamentColorCodes',jsonb_build_array('AZL'),'size','40'),
      'sku',v_sku,'nombre','Referencia B','talla','40','qty',1,
      'list_price',100,'effective_price',100,'discount_snapshot',jsonb_build_object('additional',0),
      'ornamento','BEL','orn_colors',jsonb_build_array('AZL')
    )
  );
  v_moves := jsonb_build_array(
    jsonb_build_object('fecha','2026-08-11T12:00:00Z','tipo','Cambio (entra)',
      'producto','Referencia A','product_id',v_product_a,'sku',v_sku,'talla','40','cant',1,'ref','CB-H94-137-OK'),
    jsonb_build_object('fecha','2026-08-11T12:00:00Z','tipo','Cambio (sale)',
      'producto','Referencia B','product_id',v_product_b,'sku',v_sku,'talla','40','cant',-1,'ref','CB-H94-137-OK')
  );

  v_result := pos.commit_exchange_checked(
    'H94-137-COMMIT',v_head,v_items,v_moves,null,'[]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true
     or coalesce((v_result->>'idempotent')::boolean,false) is true then
    raise exception 'H94_137_EXCHANGE_FAILED:%',v_result;
  end if;

  if (select count(*) from pos.exchange_items where exchange_id=v_exchange) <> 2
     or not exists(select 1 from pos.exchange_items where exchange_id=v_exchange
       and lado='devuelto' and product_id=v_product_a and sku=v_sku)
     or not exists(select 1 from pos.exchange_items where exchange_id=v_exchange
       and lado='entregado' and product_id=v_product_b and sku=v_sku) then
    raise exception 'H94_137_EXACT_PRODUCT_ID_FAILED';
  end if;

  if not exists(select 1 from pos.exchange_items where exchange_id=v_exchange
       and product_id=v_product_a and barcode_code='H94137A1'
       and ornamento='BEL' and orn_colors='["DRO"]'::jsonb
       and physical_attrs->>'material'='ALG' and line_id='H94-137-RETURN-A'
       and source_sale_line_id='H94-137-SALE-LINE' and list_price=100 and effective_price=100)
     or not exists(select 1 from pos.exchange_items where exchange_id=v_exchange
       and product_id=v_product_b and barcode_code='H94137B1'
       and ornamento='BEL' and orn_colors='["AZL"]'::jsonb
       and physical_attrs->'ornamentColorCodes'='["AZL"]'::jsonb
       and line_id='H94-137-DELIVER-B' and source_sale_line_id is null
       and list_price=100 and effective_price=100) then
    raise exception 'H94_137_SNAPSHOT_FAILED';
  end if;

  select stock_quantity into v_stock_a from pos.products where id=v_product_a;
  select stock_quantity into v_stock_b from pos.products where id=v_product_b;
  if v_stock_a<>2 or v_stock_b<>2
     or not exists(select 1 from pos.movements where ref='CB-H94-137-OK'
       and product_id=v_product_a and talla='40' and cant=1)
     or not exists(select 1 from pos.movements where ref='CB-H94-137-OK'
       and product_id=v_product_b and talla='40' and cant=-1) then
    raise exception 'H94_137_EXACT_STOCK_FAILED:A=% B=%',v_stock_a,v_stock_b;
  end if;

  select count(*) into v_exchange_count from pos.exchanges;
  select count(*) into v_item_count from pos.exchange_items;
  select count(*) into v_move_count from pos.movements;
  select count(*) into v_commit_count from pos.exchange_commits;
  v_result := pos.commit_exchange_checked(
    'H94-137-COMMIT',v_head,v_items,v_moves,null,'[]'::jsonb
  );
  if coalesce((v_result->>'idempotent')::boolean,false) is not true
     or (select count(*) from pos.exchanges)<>v_exchange_count
     or (select count(*) from pos.exchange_items)<>v_item_count
     or (select count(*) from pos.movements)<>v_move_count
     or (select count(*) from pos.exchange_commits)<>v_commit_count
     or (select stock_quantity from pos.products where id=v_product_a)<>2
     or (select stock_quantity from pos.products where id=v_product_b)<>2 then
    raise exception 'H94_137_IDEMPOTENCY_FAILED:%',v_result;
  end if;

  -- Falla después del commit delegado: la ausencia del source line la detecta
  -- el persistidor H-94. El bloque EXCEPTION demuestra rollback total.
  begin
    v_result := pos.commit_exchange_checked(
      'H94-137-COMMIT-LATE',
      jsonb_build_object('id',v_late_exchange,'folio','CB-H94-137-LATE',
        'origen_folio',v_sale,'fecha','2026-08-11 12:05','usuario',v_email),
      jsonb_build_array(
        (v_items->0) - 'source_sale_line_id'
          || jsonb_build_object('line_id','H94-137-LATE-A'),
        (v_items->1) || jsonb_build_object('line_id','H94-137-LATE-B')
      ),
      jsonb_build_array(
        (v_moves->0) || jsonb_build_object('ref','CB-H94-137-LATE'),
        (v_moves->1) || jsonb_build_object('ref','CB-H94-137-LATE')
      ),null,'[]'::jsonb
    );
    raise exception 'H94_137_LATE_FAILURE_WAS_ACCEPTED:%',v_result;
  exception when others then
    if sqlerrm <> 'V2_SOURCE_LINE_ID_REQUIRED' then raise; end if;
  end;

  if exists(select 1 from pos.exchanges where id=v_late_exchange)
     or exists(select 1 from pos.exchange_items where exchange_id=v_late_exchange)
     or exists(select 1 from pos.exchange_commits where commit_id='H94-137-COMMIT-LATE')
     or exists(select 1 from pos.movements where ref='CB-H94-137-LATE')
     or (select stock_quantity from pos.products where id=v_product_a)<>2
     or (select stock_quantity from pos.products where id=v_product_b)<>2
     or (select count(*) from pos.exchanges)<>v_exchange_count
     or (select count(*) from pos.exchange_items)<>v_item_count
     or (select count(*) from pos.movements)<>v_move_count
     or (select count(*) from pos.exchange_commits)<>v_commit_count then
    raise exception 'H94_137_LATE_ROLLBACK_FAILED';
  end if;

  raise notice 'H94-137 exact_ids=ok duplicate_sku=ok stock_A_1_to_2=ok stock_B_3_to_2=ok';
  raise notice 'H94-137 snapshots=ok idempotency=ok late_rollback=ok';
end;
$$;

rollback to savepoint h94_137_verification;

-- Las secuencias no son transaccionales. Se restaura explícitamente la única
-- consumida por el fixture, bajo el lock exclusivo mantenido desde el inicio.
do $$
declare v_sequence record;
begin
  for v_sequence in select * from h94_137_exchange_sequence_baseline loop
    perform setval(v_sequence.sequence_name::regclass,
      v_sequence.last_value,v_sequence.is_called);
  end loop;
end;
$$;

create temporary table h94_137_after (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

insert into h94_137_after(relation_name, row_count, row_fingerprint)
select 'products', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by p.id), '')) from pos.products p
union all
select 'stock_total', pos.total_stock_pieces(), md5(pos.total_stock_pieces()::text)
union all
select 'sales', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by s.folio), '')) from pos.sales s
union all
select 'sale_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(s)::text), ',' order by s.id), '')) from pos.sale_items s
union all
select 'returns', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.id), '')) from pos.returns r
union all
select 'return_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.id), '')) from pos.return_items r
union all
select 'exchanges', count(*), md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.id), '')) from pos.exchanges e
union all
select 'exchange_items', count(*), md5(coalesce(string_agg(md5((to_jsonb(e) - 'product_id')::text), ',' order by e.id), '')) from pos.exchange_items e
union all
select 'movements', count(*), md5(coalesce(string_agg(md5(to_jsonb(m)::text), ',' order by m.id), '')) from pos.movements m
union all
select 'stock_reservations', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.operation_id), '')) from pos.stock_reservations r
union all
select 'loan_documents', count(*), md5(coalesce(string_agg(md5(to_jsonb(l)::text), ',' order by l.id), '')) from pos.loan_documents l
union all
select 'reference_reclassifications', count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), ',' order by r.operation_id), '')) from pos.reference_reclassifications r
union all
select 'exchange_commits', count(*), md5(coalesce(string_agg(md5(to_jsonb(c)::text), ',' order by c.commit_id), '')) from pos.exchange_commits c
union all
select 'sale_payments', count(*), md5(coalesce(string_agg(md5(to_jsonb(p)::text), ',' order by p.id), '')) from pos.sale_payments p
union all
select 'sync_domain_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(v)::text), ',' order by v.domain), '')) from pos.sync_domain_versions v;

do $$
begin
  if exists(
    (select * from h94_137_baseline except select * from h94_137_after)
    union all
    (select * from h94_137_after except select * from h94_137_baseline)
  ) then
    raise exception 'H94_137_PREEXISTING_DATA_CHANGED:%',(
      select jsonb_agg(to_jsonb(d)) from (
        (select 'before_only' side,b.* from h94_137_baseline b except
         select 'before_only',a.* from h94_137_after a)
        union all
        (select 'after_only',a.* from h94_137_after a except
         select 'after_only',b.* from h94_137_baseline b)
      ) d
    );
  end if;
  if exists(select 1 from pos.products where id in ('H94-137-A','H94-137-B'))
     or exists(select 1 from pos.sales where folio='H94-137-SALE')
     or exists(select 1 from pos.exchanges where id like 'H94-137-%')
     or exists(select 1 from pos.exchange_items where line_id like 'H94-137-%')
     or exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000941370') then
    raise exception 'H94_137_FIXTURE_RESIDUE';
  end if;
  raise notice 'H94-137 preexisting_rows_and_inventory=unchanged fixtures=0';
end;
$$;

update pos.system_manifest
set schema_version=greatest(schema_version,20260811013700),updated_at=now()
where singleton;

commit;
