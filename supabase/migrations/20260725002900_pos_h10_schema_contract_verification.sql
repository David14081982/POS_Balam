-- H-10: contrato final que debe cumplir cualquier instalación completa.
-- Sólo verifica; no altera datos ni objetos de negocio.
do $$
declare
  v_table text;
  v_column text;
  v_missing text[] := '{}';
begin
  if to_regnamespace('pos') is null then
    raise exception 'H10_SCHEMA_MISSING: pos';
  end if;

  foreach v_table in array array[
    'settings', 'lookup', 'products', 'clients', 'sellers', 'sales',
    'sale_items', 'movements', 'promotions', 'liquidations', 'returns',
    'return_items', 'sale_payments', 'sync_conflicts', 'stock_reservations',
    'sale_commits', 'return_commits'
  ] loop
    if to_regclass(format('pos.%I', v_table)) is null then
      v_missing := array_append(v_missing, 'table:' || v_table);
    end if;
  end loop;

  foreach v_column in array array[
    'products.costo', 'products.attrs', 'products.barcode_urls',
    'products.sync_version', 'products.deleted_at',
    'clients.nacimiento', 'clients.sync_version', 'clients.deleted_at',
    'sellers.email', 'sellers.role', 'sellers.active',
    'sellers.sync_version', 'sellers.deleted_at',
    'sales.operation_id', 'sales.subtotal', 'sales.iva', 'sales.iva_pct',
    'sales.descuento', 'sales.anticipo', 'sales.saldo',
    'sales.valor_regalado', 'sale_items.precio_base',
    'sale_items.precio_original', 'movements.return_id',
    'promotions.sync_version', 'promotions.deleted_at'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'pos'
        and c.table_name = split_part(v_column, '.', 1)
        and c.column_name = split_part(v_column, '.', 2)
    ) then
      v_missing := array_append(v_missing, 'column:' || v_column);
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pos' and p.proname = 'commit_sale'
  ) then
    v_missing := array_append(v_missing, 'function:commit_sale');
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pos' and p.proname = 'commit_return'
  ) then
    v_missing := array_append(v_missing, 'function:commit_return');
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pos' and p.proname = 'commit_legacy_return'
  ) then
    v_missing := array_append(v_missing, 'function:commit_legacy_return');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'H10_SCHEMA_CONTRACT_MISSING: %', array_to_string(v_missing, ',');
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pos'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ) then
    raise exception 'H10_RLS_DISABLED';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'pos'
      and ('anon' = any(roles) or policyname = 'auth_all')
  ) then
    raise exception 'H10_LEGACY_POLICY_PRESENT';
  end if;

  if has_schema_privilege('anon', 'pos', 'USAGE') then
    raise exception 'H10_ANON_SCHEMA_USAGE';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'product-photos' and public
  ) then
    raise exception 'H10_PRODUCT_PHOTOS_BUCKET_MISSING';
  end if;
end
$$;
