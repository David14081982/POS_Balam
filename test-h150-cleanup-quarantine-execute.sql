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
create function pg_temp.h150_fail_epoch() returns trigger language plpgsql as $$begin raise exception 'H150_INJECTED_FAILURE'; end$$;
create trigger h150_fail_epoch before update on pos.system_manifest for each row execute function pg_temp.h150_fail_epoch();
do $$
declare p jsonb; b jsonb; result jsonb; again jsonb; receipt jsonb; before_rows jsonb; epoch bigint; rejected boolean;
begin
  select jsonb_agg(to_jsonb(x) order by x.id) into before_rows from pos.products x;
  select data_epoch into epoch from pos.system_manifest;
  p:=pos.preview_test_data_cleanup('custom','{"sales":true,"reclassifications":true}',6);
  if not (p->>'executable')::boolean or (p->'counts'->>'operaciones_archivadas')::integer<>2 then raise exception 'H150_PREVIEW_FAILED:%',p; end if;
  again:=pos.preview_test_data_cleanup('custom','{"sales":true,"reclassifications":true}',5);
  if (again->>'executable')::boolean then raise exception 'H150_OLD_CLIENT_ACCEPTED'; end if;
  b:=pos.create_test_data_cleanup_backup('custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',6,'fixture','h150-exec-A');
  if b->'document'->'payload'->'quarantined_operations'<>p->'quarantine_discard' then raise exception 'H150_BACKUP_INCOMPLETE'; end if;
  begin
    perform pos.execute_test_data_cleanup('h150-execution','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
    raise exception 'H150_EXPECTED_INJECTED_FAILURE';
  exception when others then if sqlerrm<>'H150_INJECTED_FAILURE' then raise; end if; end;
  if exists(select 1 from pos.sync_quarantine_cases where discarded_by_cleanup is not null)
    or exists(select 1 from pos.test_data_cleanup_operations where cleanup_id='h150-execution') then raise exception 'H150_ATOMICITY_FAILED'; end if;
  drop trigger h150_fail_epoch on pos.system_manifest;
  result:=pos.execute_test_data_cleanup('h150-execution','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
  if (select count(*) from pos.sync_quarantine_cases where discarded_by_cleanup='h150-execution' and status='rejected')<>2 then raise exception 'H150_DISCARD_NOT_DURABLE'; end if;
  if not exists(select 1 from pos.sync_quarantine_cases where operation_id='h150-keep-config' and status='pending_review' and discarded_by_cleanup is null) then raise exception 'H150_UNSELECTED_LOST'; end if;
  if (select jsonb_agg(to_jsonb(x) order by x.id) from pos.products x)<>before_rows then raise exception 'H150_INVENTORY_CHANGED'; end if;
  again:=pos.execute_test_data_cleanup('h150-execution','custom','{"sales":true,"reclassifications":true}',p->>'plan_hash',(b->>'backup_id')::uuid,'LIMPIAR OPERACIONES',6,'fixture','h150-exec-A');
  if not (again->>'idempotent')::boolean or (select data_epoch from pos.system_manifest)<>epoch+1 then raise exception 'H150_RETRY_DUPLICATED'; end if;
  receipt:=pos.test_data_cleanup_receipt('h150-execution');
  if receipt->'result'->'quarantine_discard'<>p->'quarantine_discard' then raise exception 'H150_RECEIPT_MISSING_SCOPE'; end if;
  rejected:=false;
  begin perform pos.assert_device_recovery_write('h150-exec-A',array['h150-discard-sale']); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'H150_REPLAY_NOT_FENCED'; end if;
  perform pos.assert_device_recovery_write('h150-exec-A',array['h150-new-sale']);
  perform pos.report_sync_quarantine('h150-exec-A','h150-discard-sale',epoch+1,epoch,'sale','sales',null,'Old archive',repeat('a',64),'{}');
  if (select count(*) from pos.sync_quarantine_cases where operation_id='h150-discard-sale')<>1 then raise exception 'H150_REPORT_REOPENED_DISCARD'; end if;
  rejected:=false;
  begin perform pos.admin_decide_sync_quarantine('h150-exec-A','h150-discard-sale',epoch,'approve',null); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'H150_APPROVAL_REOPENED_DISCARD'; end if;
  raise notice 'H150_EXECUTE_OK 13/13';
end $$;
rollback;
