-- Exact completion of the user's already-confirmed cleanup. Never a broad purge.
-- Companion sealed backup is written atomically before deleting these two rows.
begin;
do $repair$
declare
 cleanup constant text:='8d996563-96db-4537-9930-032e86de15bd';
 repair constant text:='h152-exchange-payments:8d996563-96db-4537-9930-032e86de15bd';
 ids constant text[]:=array['pay-cmb-2ae5650d-be20-4047-b647-9f14004cf69c','pay-cmb-de5ce05f-ac06-4834-9905-89f19ba30f49'];
 original pos.test_data_cleanup_operations%rowtype; source pos.test_data_cleanup_backups%rowtype;
 rows_before jsonb; payload jsonb; backup uuid; epoch bigint; affected integer; preserved jsonb; after_preserved jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('pos.execute-test-data-cleanup',0));
 perform pg_advisory_xact_lock(hashtextextended('pos.h149.recovery-fence',0));
 select data_epoch into epoch from pos.system_manifest where singleton and system_mode='preproduction';
 if epoch is distinct from 8 then raise exception 'H152_REPAIR_ENVIRONMENT_CHANGED'; end if;
 select * into strict original from pos.test_data_cleanup_operations where cleanup_id=cleanup and status='completed';
 select * into strict source from pos.test_data_cleanup_backups where backup_id=original.backup_id;
 if source.backup_id<>'04a179dd-636d-42fc-80bd-9c2dc0df77d5'::uuid
   or source.payload_hash<>pos.point_zero_sha256(source.payload)
   or not coalesce((original.selection_normalized->>'exchanges')::boolean,false)
   or original.data_epoch_after<>epoch then raise exception 'H152_REPAIR_AUTHORITY_MISMATCH'; end if;
 perform 1 from pos.sale_payments where id=any(ids) order by id for update;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into rows_before from pos.sale_payments p where id=any(ids);
 if jsonb_array_length(rows_before)=0 and exists(select 1 from pos.test_data_cleanup_backups b where b.payload->>'repair_id'=repair and b.payload_hash=pos.point_zero_sha256(b.payload)) then
  raise notice 'H152_REPAIR_ALREADY_APPLIED'; return;
 end if;
 if jsonb_array_length(rows_before)<>2 or (select sum((p->>'monto')::numeric) from jsonb_array_elements(rows_before) p)<>890 then
  raise exception 'H152_REPAIR_PAYMENTS_CHANGED'; end if;
 if exists(
  select 1 from jsonb_array_elements(rows_before) p
  where p->>'tipo'<>'cambio' or not exists(
   select 1 from jsonb_array_elements(source.payload->'exchanges') e
   join pos.purged_documents d on d.kind='exchange' and d.identity=e->>'id' and d.purge_id=cleanup
   where p->>'id'='pay-'||(e->>'id') and p->>'folio'=e->>'folio'
     and (p->>'monto')::numeric=(e->>'diferencia')::numeric
     and (p->>'created_at')::timestamptz<=original.completed_at
     and not exists(select 1 from pos.exchanges live where live.id=e->>'id' or live.folio=e->>'folio')
     and not exists(select 1 from pos.sales s where s.folio=p->>'folio')
  )
 ) then raise exception 'H152_REPAIR_LINEAGE_MISMATCH'; end if;
 select jsonb_build_object(
  'products',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')) from pos.products p),
  'sellers',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')) from pos.sellers s),
  'other_payments',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')) from pos.sale_payments p where not(p.id=any(ids)))
 ) into preserved;
 payload:=jsonb_build_object('kind','cleanup_dependency_repair','repair_id',repair,'source_cleanup_id',cleanup,
  'source_backup_id',source.backup_id,'source_backup_hash',source.payload_hash,'executed_by_database_role',current_user,
  'reason','Complete the exchange-payment scope of the already-confirmed cleanup; no new commercial deletion scope',
  'sale_payments',rows_before,'preserved',preserved);
 insert into pos.test_data_cleanup_backups(cleanup_id,created_by,actor_email,device_id,client_build,protocol_version,
  data_epoch,preset,selection_normalized,plan_hash,payload_hash,payload)
 values(cleanup,original.actor_user_id,original.actor_email,'maintenance:h152','2026-09-09-h152',6,
  epoch,'repair-confirmed-cleanup',jsonb_build_object('exchanges',true),pos.point_zero_sha256(rows_before),pos.point_zero_sha256(payload),payload)
 returning backup_id into backup;
 delete from pos.sale_payments where id=any(ids);
 get diagnostics affected=row_count;
 if affected<>2 then raise exception 'H152_REPAIR_ROW_COUNT'; end if;
 select jsonb_build_object(
  'products',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')) from pos.products p),
  'sellers',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')) from pos.sellers s),
  'other_payments',(select pos.point_zero_sha256(coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')) from pos.sale_payments p where not(p.id=any(ids)))
 ) into after_preserved;
 if preserved<>after_preserved or source.payload_hash<>(select b.payload_hash from pos.test_data_cleanup_backups b where b.backup_id=source.backup_id) then
  raise exception 'H152_REPAIR_PRESERVATION_FAILED'; end if;
 raise notice 'H152_REPAIR_OK removed=2 amount=890 backup=% epoch=%',backup,epoch;
end $repair$;
commit;
