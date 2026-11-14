-- H190: metadata and aggregate evidence only; no identities or business payloads.
begin read only;
select jsonb_build_object(
 'at',statement_timestamp(),
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='20261107022800'),
 'guard',(select jsonb_build_object('definition',replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),
   'hash',md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')),'owner',pg_get_userbyid(p.proowner),
   'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig)
   from pg_proc p where p.oid='pos.restrict_seller_product_update()'::regprocedure),
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'hash',md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')),'owner',p.proowner,
   'acl',p.proacl,'config',p.proconfig,'security_definer',p.prosecdef) order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pos' and p.prokind='f'),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='pos'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl) order by c.relname)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and c.relkind='r'),
 'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and not t.tgisinternal),
 'rejected_returns',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by r.actor_id,r.request_id),'')))
   from pos.online_requests r where r.command_kind='return' and r.state='rejected' and r.created_at::date='2026-11-13'),
 'boundary',jsonb_build_object(
   'direct_product_update',has_table_privilege('authenticated','pos.products','update'),
   'direct_return_insert',has_table_privilege('authenticated','pos.returns','insert'),
   'direct_item_insert',has_table_privilege('authenticated','pos.return_items','insert'),
   'direct_request_update',has_table_privilege('authenticated','pos.online_requests','update'),
   'private_context_execute',has_function_privilege('authenticated','pos.online_request_context()','execute'),
   'gateway_execute',has_function_privilege('authenticated','pos.execute_online_command(uuid,jsonb)','execute'))
) as evidence;
commit;
