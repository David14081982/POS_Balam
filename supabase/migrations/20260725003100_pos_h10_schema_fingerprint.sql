-- H-10: producción debe coincidir semánticamente con dos instalaciones limpias.

do $$
declare
  v_fingerprint text;
  v_categories text;
  v_expected constant text := 'a7d720a0d8a5f6ae5d33c5c1f61f3e49';
begin
  with schema_objects as (
    select 'table|' || tablename as item
      from pg_tables where schemaname = 'pos'
    union all
    select 'column|' || table_name || '|' || column_name || '|' ||
           udt_name || '|' || is_nullable
      from information_schema.columns where table_schema = 'pos'
    union all
    select 'function|' || p.proname || '|' ||
           pg_get_function_identity_arguments(p.oid) || '|' ||
           pg_get_function_result(p.oid) || '|' || p.prokind::text || '|' ||
           p.provolatile::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pos'
    union all
    select 'constraint|' || c.relname || '|' || x.conname || '|' ||
           pg_get_constraintdef(x.oid, true)
      from pg_constraint x
      join pg_class c on c.oid = x.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'pos' and x.contype <> 'n'
    union all
    select 'index|' || tablename || '|' || indexname || '|' || indexdef
      from pg_indexes where schemaname = 'pos'
    union all
    select 'rls|' || c.relname || '|' || c.relrowsecurity || '|' ||
           c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'pos' and c.relkind in ('r', 'p')
    union all
    select 'policy|' || tablename || '|' || policyname || '|' || cmd || '|' ||
           array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' ||
           coalesce(with_check, '')
      from pg_policies where schemaname = 'pos'
  ), category_summaries as (
    select split_part(item, '|', 1) as category,
           count(*) as object_count,
           md5(string_agg(item, E'\n' order by item)) as category_fingerprint
      from schema_objects
     group by split_part(item, '|', 1)
  )
  select md5(string_agg(item, E'\n' order by item)),
         (
           select string_agg(
                    category || ':' || object_count || ':' ||
                    category_fingerprint,
                    ',' order by category
                  )
             from category_summaries
         )
    into v_fingerprint, v_categories
    from schema_objects;

  if v_fingerprint is distinct from v_expected then
    raise exception
      'H10_SCHEMA_FINGERPRINT_MISMATCH expected=% actual=% categories=%',
      v_expected, v_fingerprint, v_categories;
  end if;
end;
$$;
