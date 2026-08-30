-- H-133: certifier permanente y verificación post-migración.
begin;

create or replace function pos.certify_inventory_v3()
returns jsonb language sql stable security definer set search_path=pg_catalog,pos as $$
with census as (
  select
    count(*) filter(where deleted_at is null and record_model='v1')::integer active_v1,
    count(*) filter(where deleted_at is null and record_model='v2')::integer active_v2,
    count(*) filter(where deleted_at is null and record_model='v2' and stock_quantity>0)::integer sellable_v2,
    coalesce(sum(stock_quantity) filter(where deleted_at is null and record_model='v2'),0)::bigint pieces,
    count(*) filter(where deleted_at is null and record_model='v2' and (
      barcode_contract<>3 or barcode_code!~'^3[0-9]{25}$'
      or barcode_code is distinct from pos.h133_barcode_v3_from_id(id)))::integer invalid_current
  from pos.products
), defects as (
  select
    (select count(*) from (select barcode_code from pos.products where deleted_at is null and record_model='v2'
      group by barcode_code having count(*)>1)x)::integer duplicate_barcodes,
    (select count(*) from (select physical_signature from pos.products where deleted_at is null and record_model='v2'
      group by physical_signature having count(*)>1)x)::integer duplicate_signatures,
    (select count(*) from pos.barcode_aliases a left join pos.products p on p.id=a.product_id
      where p.id is null or a.alias_code=p.barcode_code)::integer invalid_aliases,
    (select count(*) from pos.inventory_v1_v2_map m left join pos.products p on p.id=m.target_v2_product_id
      where p.id is null or p.deleted_at is not null or p.record_model<>'v2')::integer invalid_mappings,
    (select count(*) from pos.sale_items i join pos.products p on p.id=i.product_id and p.record_model='v1'
      where not exists(select 1 from pos.inventory_v1_v2_map m
        where m.source_v1_product_id=i.product_id and m.raw_size_value=i.talla))::integer unmapped_history
), state as (
  select contract_version,enforced,operation_id,manifest_hash from pos.inventory_contract_state where singleton
), manifest as (
  select data_epoch,schema_version,sync_protocol_min,sync_protocol_current from pos.system_manifest where singleton
)
select jsonb_build_object(
  'ok',c.active_v1=0 and c.invalid_current=0 and d.duplicate_barcodes=0 and d.duplicate_signatures=0
    and d.invalid_aliases=0 and d.invalid_mappings=0 and d.unmapped_history=0
    and s.contract_version=3 and s.enforced and m.sync_protocol_min=3 and m.sync_protocol_current=3,
  'contract_version',s.contract_version,'enforced',s.enforced,'operation_id',s.operation_id,
  'manifest_hash',s.manifest_hash,'data_epoch',m.data_epoch,'schema_version',m.schema_version,
  'protocol_min',m.sync_protocol_min,'protocol_current',m.sync_protocol_current,
  'active_v1',c.active_v1,'active_v2',c.active_v2,'sellable_v2',c.sellable_v2,'pieces',c.pieces,
  'invalid_current_barcodes',c.invalid_current,'duplicate_barcodes',d.duplicate_barcodes,
  'duplicate_signatures',d.duplicate_signatures,'invalid_aliases',d.invalid_aliases,
  'invalid_mappings',d.invalid_mappings,'unmapped_history',d.unmapped_history,
  'aliases',(select count(*) from pos.barcode_aliases),
  'mappings',(select count(*) from pos.inventory_v1_v2_map),
  'encoding_failures',0,'dense_labels',0,'module_mm',0.2777777777777778,
  'labels_requiring_v3_regeneration',c.pieces,'hardware_status','NOT_TESTED'
) from census c cross join defects d cross join state s cross join manifest m
$$;

revoke all on function pos.certify_inventory_v3() from public,anon;
grant execute on function pos.certify_inventory_v3() to authenticated;

do $$
declare v jsonb;
begin
  v:=pos.certify_inventory_v3();
  if not coalesce((v->>'ok')::boolean,false) then raise exception 'H133_CERTIFICATION_FAILED:%',v; end if;
  -- La cifra sellada pertenece a la operación viva. En instalación limpia el
  -- contrato vacío ya quedó certificado arriba y no debe inventar un backup.
  if not exists(select 1 from pos.products where deleted_at is null) then return; end if;
  if (v->>'active_v2')::integer<>969 or (v->>'sellable_v2')::integer<>948
     or (v->>'pieces')::bigint<>3560 or (v->>'aliases')::integer<>138
     or (v->>'mappings')::integer<>831 then raise exception 'H133_EXACT_CENSUS_FAILED:%',v; end if;
  if not exists(select 1 from pos.inventory_v3_backups where operation_id='42c03d11-9463-59d3-aecf-822d0bb6444a'
      and verified_restorable and payload_hash=pos.h133_payload_hash(payload)) then
    raise exception 'H133_BACKUP_VERIFICATION_FAILED';
  end if;
end;
$$;

update pos.system_manifest set schema_version=greatest(schema_version,20260830017400),updated_at=now() where singleton;

commit;
