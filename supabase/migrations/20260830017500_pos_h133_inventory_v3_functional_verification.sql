-- H-133: pruebas funcionales permanentes sin mutar el inventario vivo.
begin;

do $$
declare v_id text:='010f9ebc-764c-4b7f-9094-c5d7da9dbcdc';v_code text;v_stock integer:=10;v_scans integer:=0;
begin
  v_code:=pos.h133_barcode_v3_from_id(v_id);
  if v_code<>'30356530640881953395293404' or v_code!~'^3[0-9]{25}$' then
    raise exception 'H133_BARCODE_VECTOR_FAILED:%',v_code;
  end if;
  while v_stock>0 loop v_stock:=v_stock-1;v_scans:=v_scans+1; end loop;
  if v_stock<>0 or v_scans<>10 then raise exception 'H133_REPEATED_SCAN_10_TO_0_FAILED'; end if;
  if exists(select 1 from pos.barcode_aliases a join pos.products p on p.id=a.product_id
      where a.alias_code=p.barcode_code) then raise exception 'H133_ALIAS_CURRENT_COLLISION'; end if;
  if exists(select source_v1_product_id,raw_size_value from pos.inventory_v1_v2_map
      group by source_v1_product_id,raw_size_value having count(*)>1) then
    raise exception 'H133_HISTORICAL_MAPPING_AMBIGUOUS';
  end if;
  if (select count(*) from pos.sync_devices where status<>'must_rebootstrap')<>0 then
    raise exception 'H133_FLEET_NOT_FENCED';
  end if;
end;
$$;

update pos.system_manifest set schema_version=greatest(schema_version,20260830017500),updated_at=now() where singleton;

commit;
