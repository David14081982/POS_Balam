-- H-101: verificación estructural sin conservar fixtures.
do $$
begin
  if not exists(select 1 from information_schema.columns
      where table_schema='pos' and table_name='products' and column_name='reference_family_id'
        and data_type='uuid') then raise exception 'H101_REFERENCE_FAMILY_COLUMN_MISSING'; end if;
  if exists(select 1 from pos.products where record_model='v1' and reference_family_id is not null) then
    raise exception 'H101_V1_FAMILY_CONTAMINATION';
  end if;
  if exists(select 1 from pos.products where record_model='v2' and reference_family_id is null) then
    raise exception 'H101_V2_FAMILY_MISSING';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='pos'
      and indexname='pos_products_reference_family_idx') then
    raise exception 'H101_REFERENCE_FAMILY_INDEX_MISSING';
  end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='pos' and p.proname='commit_reference_family_batch') then
    raise exception 'H101_BATCH_RPC_MISSING';
  end if;
  if position('capability_operation_audit' in pg_get_functiondef(
      'pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)'::regprocedure))=0 then
    raise exception 'H101_BATCH_AUDIT_MISSING';
  end if;
end $$;
