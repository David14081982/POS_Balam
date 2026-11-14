-- Metadata only: no personal identities, passwords or commercial payloads.
begin read only;
select jsonb_build_object(
 'at',statement_timestamp(),
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='20261107022800'),
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'definition',replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),
   'hash',md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)
   order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='pos' and p.prokind='f'),
 'assignments',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),''))) from pos.user_permission_role_assignments t),
 'screen_overrides',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id,screen_key),'')) from pos.user_screen_permission_overrides t),
 'capability_overrides',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id,capability_key),'')) from pos.user_capability_overrides t),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='pos'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and c.relkind='r'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and not t.tgisinternal)
) evidence;
commit;
