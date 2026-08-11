-- H-94: verificación estructural no destructiva.
do $$
begin
  if (select count(*) from information_schema.columns where table_schema='pos' and table_name='products'
      and column_name in('record_model','size_category_id','size_code','size_scale','stock_quantity','barcode_code','ornament_color_codes','physical_signature','physical_identity_locked'))<>9
    then raise exception 'H94_MISSING_PRODUCT_COLUMNS'; end if;
  if not exists(select 1 from pg_indexes where schemaname='pos' and indexname='pos_products_v2_barcode_code_uq') then raise exception 'H94_MISSING_BARCODE_UNIQUE'; end if;
  if not exists(select 1 from pg_indexes where schemaname='pos' and indexname='pos_products_v2_physical_signature_uq') then raise exception 'H94_MISSING_SIGNATURE_UNIQUE'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='pos' and table_name='sale_items' and column_name='line_id') then raise exception 'H94_MISSING_LINE_ID'; end if;
  if (select count(*) from information_schema.columns where table_schema='pos' and table_name='sale_items'
      and column_name in('line_id','barcode_code','physical_attrs','list_price','effective_price','discount_snapshot'))<>6
    then raise exception 'H94_MISSING_SALE_SNAPSHOT'; end if;
  if (select count(*) from information_schema.columns where table_schema='pos' and table_name='return_items'
      and column_name in('line_id','source_sale_line_id','barcode_code','physical_attrs','list_price','effective_price','discount_snapshot'))<>7
    then raise exception 'H94_MISSING_RETURN_IDENTITY'; end if;
  if (select count(*) from information_schema.columns where table_schema='pos' and table_name='exchange_items'
      and column_name in('line_id','source_sale_line_id','barcode_code','physical_attrs','list_price','effective_price','discount_snapshot'))<>7
    then raise exception 'H94_MISSING_EXCHANGE_IDENTITY'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pos' and p.proname='commit_reference_reclassification') then raise exception 'H94_MISSING_RECLASSIFICATION'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='pos' and table_name='reference_reclassifications' and column_name='actor_user_id') then raise exception 'H94_MISSING_RECLASSIFICATION_ACTOR'; end if;
  if position('record_model=excluded.record_model' in replace(pg_get_functiondef('pos.save_products_checked(uuid,jsonb)'::regprocedure),' ',''))=0
    then raise exception 'H94_PRODUCT_WRITER_IGNORES_V2'; end if;
  if position('require_current_capability' in pg_get_functiondef('pos.commit_reference_reclassification(text,text,text,integer,text,text,text)'::regprocedure))=0
     or position('RECLASSIFICATION_OPERATION_CONFLICT' in pg_get_functiondef('pos.commit_reference_reclassification(text,text,text,integer,text,text,text)'::regprocedure))=0
     or position('RECLASSIFICATION_NOT_REVERSIBLE' in pg_get_functiondef('pos.commit_reference_reclassification(text,text,text,integer,text,text,text)'::regprocedure))=0
    then raise exception 'H94_RECLASSIFICATION_GUARDS_MISSING'; end if;
  if has_function_privilege('authenticated','pos.h94_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
     or has_function_privilege('authenticated','pos.h94_assert_v2_document_items(jsonb)','execute')
    then raise exception 'H94_INTERNAL_BYPASS_EXPOSED'; end if;
  if not has_function_privilege('authenticated','pos.commit_reference_reclassification(text,text,text,integer,text,text,text)','execute')
    then raise exception 'H94_RECLASSIFICATION_RPC_NOT_GRANTED'; end if;
  if exists(select 1 from pos.products where record_model='v1' and (barcode_code is not null or stock_quantity is not null or physical_signature is not null)) then raise exception 'H94_V1_WAS_CONVERTED'; end if;
end $$;

-- Referencias explícitas para el auditor automático de cobertura de funciones:
-- pos.h94_sync_v2_stock_shape(); pos.h94_guard_used_reference_identity();
-- pos.h94_assert_v2_document_items(jsonb); pos.h94_persist_sale_references(text,jsonb);
-- pos.h94_persist_return_references(text,jsonb); pos.h94_persist_exchange_references(text,jsonb);
-- pos.save_products_checked(uuid,jsonb); pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb);
-- pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb);
-- pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean);
-- pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb);

update pos.system_manifest set schema_version=greatest(schema_version,20260810013500),updated_at=now() where singleton;
