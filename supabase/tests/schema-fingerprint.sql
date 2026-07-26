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
  select 'rls|' || c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'pos' and c.relkind in ('r', 'p')
  union all
  select 'policy|' || tablename || '|' || policyname || '|' || cmd || '|' ||
         array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' ||
         coalesce(with_check, '')
    from pg_policies where schemaname = 'pos'
)
select md5(string_agg(item, E'\n' order by item)) as pos_schema_fingerprint
from schema_objects;
