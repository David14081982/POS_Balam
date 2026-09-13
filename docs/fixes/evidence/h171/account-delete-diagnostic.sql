-- Historical invalid diagnostic: tableforest=true is incompatible with the XPath
-- /table/row below. NULL counts are NOT evidence of zero FK dependencies.
-- Correct executed replacement: auth-dependencies-direct.sql and its JSON result.
-- Retained only to explain the rejected inference; never use this output for cleanup.
-- BALAM H171: read-only diagnosis; never executes Auth deletion or a business command.
begin read only;
set local statement_timeout = '30s';
with target as (
  select request_id, target_user_id, actor_id, action, state, created_at, updated_at
  from pos.online_account_requests
  where request_id = '70549527-4867-4342-94d2-38e770b0f2a9'::uuid
), dependencies as (
  select c.conname, c.conrelid::regclass::text as relation,
    a.attname as column_name, c.confdeltype,
    pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
    and cardinality(c.conkey) = 1
), counts as (
  select d.*, (xpath('/table/row/rows/text()', query_to_xml(
    format('select count(*) as rows from %s where %I = %L::uuid',
      d.relation, d.column_name, t.target_user_id), false, true, '')))[1]::text::bigint as rows
  from dependencies d cross join target t
)
select now() as observed_at,
  (select row_to_json(t) from target t) as request,
  (select json_build_object('exists', true, 'deleted_at', u.deleted_at,
    'banned_until', u.banned_until, 'qa_marker',
    u.raw_app_meta_data ->> 'balam_account_request_id')
   from auth.users u join target t on t.target_user_id = u.id) as auth_state,
  (select json_agg(c order by c.relation, c.column_name) from counts c where c.rows > 0) as referenced_by;
commit;
