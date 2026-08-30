-- H-133: el contrato operacional aplica a filas activas. Los 28 tombstones V2
-- conservan literalmente su identidad histórica y nunca vuelven a venderse.
begin;

alter table pos.products drop constraint if exists products_v2_shape_check;
alter table pos.products add constraint products_v2_shape_check check (
  record_model='v1' or deleted_at is not null or (
    nullif(trim(size_category_id),'') is not null and
    nullif(trim(size_code),'') is not null and
    stock_quantity is not null and stock_quantity>=0 and
    nullif(trim(barcode_code),'') is not null and
    barcode_code~'^3[0-9]{25}$' and barcode_contract=3 and
    jsonb_typeof(barcode_aliases)='array' and
    jsonb_typeof(ornament_color_codes)='array' and
    nullif(trim(physical_signature),'') is not null
  )
) not valid;

commit;
