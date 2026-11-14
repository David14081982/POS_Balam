-- H192 verification; no production fixture.
begin;
do $verify$
begin
 if md5(replace(pg_get_functiondef('pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> '06ac1e239bfb34ed7363cbfbb86573f0' then raise exception 'H192_FUNCTION_DRIFT: pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure),E'\r\n',E'\n')) <> '485107508f6a3c9df8cccdc0869405ad' then raise exception 'H192_FUNCTION_DRIFT: pos.dispatch_online_command(uuid,jsonb,integer)'; end if;
 if md5(replace(pg_get_functiondef('pos.online_save_entities(text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> '4a1523342e9d0479e6596978274dd5a2' then raise exception 'H192_FUNCTION_DRIFT: pos.online_save_entities(text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.resolve_operational_capability(uuid,text)'::regprocedure),E'\r\n',E'\n')) <> '29e62e54f05bc239a4ddf3b84d8aa369' then raise exception 'H192_FUNCTION_DRIFT: pos.resolve_operational_capability(uuid,text)'; end if;
 if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n')) <> '6c53af55f86f09ed49d733d6ba570669' then raise exception 'H192_FUNCTION_DRIFT: pos.restrict_seller_product_update()'; end if;
 if md5(replace(pg_get_functiondef('pos.user_screen_permissions_version(uuid)'::regprocedure),E'\r\n',E'\n')) <> '86a9a51367b6056c4d915657ecfa4cba' then raise exception 'H192_FUNCTION_DRIFT: pos.user_screen_permissions_version(uuid)'; end if;
 if exists(select 1 from pos.screen_operational_capabilities() where screen_key like 'config.%'
  or capability_key in('settings.manage','permissions.manage','sellers.manage')) then raise exception 'H192_ADMIN_CAPABILITY_MAPPING'; end if;
 if has_function_privilege('authenticated','pos.sync_user_screen_capabilities(uuid)','execute')
  or has_function_privilege('anon','pos.sync_user_screen_capabilities(uuid)','execute')
  or has_function_privilege('authenticated','pos.screen_operational_capabilities()','execute')
  then raise exception 'H192_PRIVATE_SYNC'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='pos' and c.relname in('products','returns','return_items','liquidations','loan_documents','user_capability_overrides') and not c.relrowsecurity)
  or has_table_privilege('authenticated','pos.products','update')
  or has_table_privilege('authenticated','pos.user_capability_overrides','insert')
  then raise exception 'H192_WRITE_BOUNDARY'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='pos.user_capability_overrides'::regclass
  and tgname='h166_snapshot_changed') then raise exception 'H192_INVALIDATION'; end if;
end $verify$;
commit;
