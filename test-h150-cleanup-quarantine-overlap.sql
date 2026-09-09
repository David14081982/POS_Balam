-- DESTRUCTIVE FIXTURES: only the isolated h150_exact database. Always rollback.
begin;
do $$ begin if current_database()<>'h150_exact' then raise exception 'LOCAL_H150_DATABASE_REQUIRED'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000150","email":"qa-h150@example.test","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000150',true);
insert into pos.sync_devices(device_id,user_id,protocol_version,schema_version,data_epoch,queue_pending,queue_blocked,status)
select 'h150-exec-A','00000000-0000-4000-8000-000000000150',3,20260830017500,data_epoch,0,0,'online' from pos.system_manifest;
insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,user_id,operation_type,domain,summary,payload_hash)
select 'h150-exec-A',x.id,m.data_epoch,'00000000-0000-4000-8000-000000000150',x.type,x.domain,x.id,repeat('a',64)
from pos.system_manifest m cross join (values ('h150-discard-sale','sale','sales'),('h150-discard-product','productDeleteScope','products'),('h150-keep-config','config','config')) x(id,type,domain);
insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,record_model,stock)
values('h150-v1','GUA','MC','ALG','BLA','H150','Testigo V1','H150-V1','v1','[{"talla":"M","stock":7}]');
insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,record_model,stock_quantity,size_code,size_category_id,reference_family_id,physical_signature,barcode_code,barcode_contract)
values('h150-v2','GUA','MC','ALG','BLA','H150','Testigo V2','H150-V2','v2',9,'M','adult','00000000-0000-4000-8000-000000000151','h150-v2-signature','3'||repeat('0',22)||'150',3);

-- Already-confirmed sales may ALSO have an archived retry with the same ID.
insert into pos.sync_quarantine_cases(device_id,operation_id,remote_epoch,user_id,operation_type,domain,summary,payload_hash)
select 'h150-exec-A','h150-sale-v2',data_epoch,'00000000-0000-4000-8000-000000000150','sale','sales','V2 sale retry',repeat('b',64) from pos.system_manifest;
insert into pos.stock_reservations(operation_id,folio,lines) values
 ('h150-discard-sale','H150-OVERLAP-V1','[{"product_id":"h150-v1","talla":"M","qty":2}]'),
 ('h150-sale-v2','H150-OVERLAP-V2','[{"product_id":"h150-v2","talla":"M","qty":1}]');
insert into pos.sales(folio,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones) values
 ('H150-OVERLAP-V1','Prueba','[]','Efectivo','Pagado',2,200,'h150-discard-sale','[]'),
 ('H150-OVERLAP-V2','Prueba','[]','Efectivo','Pagado',1,100,'h150-sale-v2','[]');
insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id) values
 ('H150-OVERLAP-V1','h150-v1','H150-V1','Testigo V1','M',2,100,'h150-line-v1'),
 ('H150-OVERLAP-V2','h150-v2','H150-V2','Testigo V2','M',1,100,'h150-line-v2');
insert into pos.sale_commits(commit_id,operation_id,folio,payload_hash) values
 ('h150-discard-sale','h150-discard-sale','H150-OVERLAP-V1','fixture'),
 ('h150-sale-v2','h150-sale-v2','H150-OVERLAP-V2','fixture');
insert into pos.movements(tipo,producto,sku,cant,ref,product_id,talla,operation_id) values
 ('Venta','Testigo V1','H150-V1',-2,'H150-OVERLAP-V1','h150-v1','M','h150-discard-sale'),
 ('Venta','Testigo V2','H150-V2',-1,'H150-OVERLAP-V2','h150-v2','M','h150-sale-v2');
create function pg_temp.h150_fail_receipt() returns trigger language plpgsql as $$
begin if NEW.status='completed' then raise exception 'H150_INJECTED_RECEIPT_FAILURE'; end if; return NEW; end$$;
create trigger h150_fail_receipt before update on pos.test_data_cleanup_operations for each row execute function pg_temp.h150_fail_receipt();
do $$
declare p jsonb; b jsonb; r jsonb; epoch bigint; rejected boolean:=false;
begin
 select data_epoch into epoch from pos.system_manifest;
 p:=pos.preview_test_data_cleanup('custom','{"sales":true,"reclassifications":true}',6);
 if not (p->>'executable')::boolean or (p->'counts'->>'ventas')::int<>2 then raise exception 'H150_OVERLAP_PREVIEW:%',p; end if;
 if (select (x->>'target_stock')::int from jsonb_array_elements(p->'stock') x where x->>'product_id'='h150-v1')<>9
 or (select (x->>'target_stock')::int from jsonb_array_elements(p->'stock') x where x->>'product_id'='h150-v2')<>10 then raise exception 'H150_OVERLAP_STOCK_PLAN'; end if;
 b:=pos.create_test_data_cleanup_backup('custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',6,'fixture','h150-exec-A');
 if jsonb_array_length(b->'document'->'payload'->'sales')<>2
 or jsonb_array_length(b->'document'->'payload'->'quarantined_operations')<>3 then raise exception 'H150_OVERLAP_BACKUP'; end if;
 begin
  perform pos.execute_test_data_cleanup('h150-overlap','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
  raise exception 'H150_EXPECTED_RECEIPT_FAILURE';
 exception when others then if sqlerrm<>'H150_INJECTED_RECEIPT_FAILURE' then raise; end if; end;
 if (select count(*) from pos.sales)<>2 or exists(select 1 from pos.sync_quarantine_cases where discarded_by_cleanup is not null)
 or exists(select 1 from pos.test_data_cleanup_operations where cleanup_id='h150-overlap')
 or (select data_epoch from pos.system_manifest)<>epoch
 or (select stock_quantity from pos.products where id='h150-v2')<>9 then raise exception 'H150_OVERLAP_ROLLBACK'; end if;
 drop trigger h150_fail_receipt on pos.test_data_cleanup_operations;
 r:=pos.execute_test_data_cleanup('h150-overlap','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
 if not (r->>'ok')::boolean or (r->>'status')<>'completed' then raise exception 'H150_OVERLAP_EXECUTE'; end if;
 if exists(select 1 from pos.sales) or exists(select 1 from pos.sale_items) or exists(select 1 from pos.sale_commits)
 or exists(select 1 from pos.stock_reservations) or exists(select 1 from pos.movements) then raise exception 'H150_OVERLAP_DOCUMENTS_REMAIN'; end if;
 if (select (stock->0->>'stock')::int from pos.products where id='h150-v1')<>9
 or (select stock_quantity from pos.products where id='h150-v2')<>10
 or (select count(*) from pos.products)<>2 then raise exception 'H150_OVERLAP_STOCK_EXECUTE'; end if;
 if (select count(*) from pos.sync_quarantine_cases where discarded_by_cleanup='h150-overlap' and status='rejected')<>3
 or not exists(select 1 from pos.sync_quarantine_cases where operation_id='h150-keep-config' and status='pending_review') then raise exception 'H150_OVERLAP_DISCARD'; end if;
 r:=pos.execute_test_data_cleanup('h150-overlap','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
 if not (r->>'idempotent')::boolean or (select data_epoch from pos.system_manifest)<>epoch+1
 or (select stock_quantity from pos.products where id='h150-v2')<>10 then raise exception 'H150_OVERLAP_RETRY'; end if;
 begin perform pos.assert_device_recovery_write('h150-exec-A',array['h150-discard-sale']); exception when raise_exception then rejected:=sqlerrm='Esta operación se descartó al limpiar los datos de prueba.'; end;
 if not rejected then raise exception 'H150_OVERLAP_REPLAY'; end if;
 perform pos.assert_device_recovery_write('h150-exec-A',array['h150-fresh-operation']);
 if (pos.test_data_cleanup_receipt('h150-overlap')->'result'->>'status')<>'completed' then raise exception 'H150_OVERLAP_RECEIPT'; end if;
 raise notice 'H150_OVERLAP_OK 13/13';
end $$;
rollback;
