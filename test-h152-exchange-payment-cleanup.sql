-- Destructive fixtures only in the isolated loopback h150_exact database.
begin;
do $$ begin if current_database()<>'h150_exact' then raise exception 'LOCAL_DATABASE_REQUIRED'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000150","email":"qa-h150@example.test","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000150',true);
create temp table h152_checks(name text,ok boolean);
create function pg_temp.h152_check(label text,condition boolean) returns void language plpgsql as $$
begin insert into h152_checks values(label,coalesce(condition,false)); end $$;
insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,record_model,stock)
values('h152-product','GUA','MC','ALG','BLA','H152','Testigo conservado','H152','v1','[{"talla":"M","stock":5}]');
insert into pos.stock_reservations(operation_id,folio,lines) values('h152-sale','H152-SALE','[{"product_id":"h152-product","talla":"M","qty":1}]');
insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
values('H152-SALE','Prueba','[]','Tarjeta','Pagado',1,100,'h152-sale','[]');
insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id)
values('H152-SALE','h152-product','H152','Testigo conservado','M',1,100,'h152-line');
insert into pos.exchanges(id,folio,origen_folio,fecha,valor_reconocido,valor_entregado,diferencia,base_comision,comision_monto)
values('cmb-h152-a','H152-EXCHANGE-A','H152-SALE','2026-09-09 10:00',100,890,790,790,0),
 ('cmb-h152-b','H152-EXCHANGE-B','H152-SALE','2026-09-09 10:05',100,200,100,100,0);
-- No item rows: isolate monetary dependency from stock restoration, tested by H113/H150.
insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,tarjeta)
values('pay-cmb-h152-a','H152-EXCHANGE-A','2026-09-09 10:00','cambio','Tarjeta',790,790),
 ('legacy-h152-payment','H152-EXCHANGE-B','2026-09-09 10:05','cambio','Tarjeta',100,100),
 ('h152-sale-payment','H152-SALE','2026-09-09 09:00','venta','Tarjeta',100,100),
 ('h152-unrelated-payment','H152-UNRELATED','2026-09-09 09:05','cambio','Tarjeta',25,25),
 ('h152-same-folio-sale','H152-EXCHANGE-A','2026-09-09 09:10','venta','Tarjeta',30,30);
do $$
declare p jsonb; b jsonb; r jsonb; p2 jsonb; rejected boolean:=false;
begin
 p:=pos.preview_test_data_cleanup('custom','{"exchanges":true}',6);
 perform pg_temp.h152_check('preview executable', (p->>'executable')::boolean);
 perform pg_temp.h152_check('exact payment IDs including legacy identity',p->'documents'->'payment_ids'='["legacy-h152-payment","pay-cmb-h152-a"]'::jsonb);
 b:=pos.create_test_data_cleanup_backup('custom','{"exchanges":true}',p->>'plan_hash',6,'h152','h152');
 perform pg_temp.h152_check('backup includes exactly $890', (select sum((x->>'monto')::numeric)=890 and count(*)=2 from jsonb_array_elements(b->'document'->'payload'->'sale_payments') x));
 update pos.sale_payments set monto=101,tarjeta=101 where id='legacy-h152-payment';
 p2:=pos.preview_test_data_cleanup('custom','{"exchanges":true}',6);
 perform pg_temp.h152_check('payment mutation invalidates plan',p2->>'plan_hash'<>p->>'plan_hash');
 begin
  perform pos.execute_test_data_cleanup('h152-stale','custom','{"exchanges":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'h152','h152');
  raise exception 'H152_UNEXPECTED_ACCEPT';
 exception when others then
  if sqlerrm='cleanup_preview_changed' then rejected:=true;
  elsif sqlerrm<>'H152_UNEXPECTED_ACCEPT' then raise; end if;
 end;
 perform pg_temp.h152_check('stale payment backup rejected',rejected);
 update pos.sale_payments set monto=100,tarjeta=100 where id='legacy-h152-payment';
 r:=pos.execute_test_data_cleanup('h152-valid','custom','{"exchanges":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'h152','h152');
 perform pg_temp.h152_check('selected exchange payments removed',not exists(select 1 from pos.sale_payments where id in ('pay-cmb-h152-a','legacy-h152-payment')));
 perform pg_temp.h152_check('retained payments unchanged', (select count(*)=3 and sum(monto)=155 from pos.sale_payments));
 perform pg_temp.h152_check('sale and inventory retained',exists(select 1 from pos.sales where folio='H152-SALE') and (select stock from pos.products where id='h152-product')='[{"talla":"M","stock":5}]'::jsonb);
 perform pg_temp.h152_check('event carries exact payment identities',r->'identities'->'payment_ids'=p->'documents'->'payment_ids');
 perform pg_temp.h152_check('repeat is idempotent',(pos.execute_test_data_cleanup('h152-valid','custom','{"exchanges":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'h152','h152')->>'idempotent')::boolean);
end $$;
table h152_checks;
select count(*) filter(where ok) as passed,count(*) filter(where not ok) as failed from h152_checks;
do $$ begin if exists(select 1 from h152_checks where not ok) then raise exception 'H152_REGRESSION_FAILED'; end if; end $$;
rollback;
