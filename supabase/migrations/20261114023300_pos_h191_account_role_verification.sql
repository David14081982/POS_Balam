-- H191: metadata verification only; no production fixtures.
begin;
do $verify$
begin
 if not exists(select 1 from pg_proc where oid='pos.online_save_entities(text,jsonb)'::regprocedure and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=pg_catalog, pos, auth'])
  or has_function_privilege('authenticated','pos.online_save_entities(text,jsonb)','execute')
  or has_function_privilege('anon','pos.online_save_entities(text,jsonb)','execute') then raise exception 'H191_PRIVATE_BOUNDARY'; end if;
 if not exists(select 1 from pg_proc where oid='pos.admin_user_permission_snapshot(uuid,text[])'::regprocedure and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=pos, auth, pg_temp'])
  or not has_function_privilege('authenticated','pos.admin_user_permission_snapshot(uuid,text[])','execute')
  or has_function_privilege('anon','pos.admin_user_permission_snapshot(uuid,text[])','execute') then raise exception 'H191_SNAPSHOT_BOUNDARY'; end if;
 if has_table_privilege('authenticated','pos.user_permission_role_assignments','insert')
  or has_table_privilege('authenticated','pos.sellers','insert')
  or not (select relrowsecurity from pg_class where oid='pos.user_permission_role_assignments'::regclass)
  then raise exception 'H191_DIRECT_WRITE'; end if;
end $verify$;
commit;
