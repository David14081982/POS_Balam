-- H189 metadata verification; full behavioral matrix runs on isolated PostgreSQL.
-- No production seeds, commercial DML, cleanup, sequence changes or permission changes.
begin;
do $h189_verify$
begin
  if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n'))<>'605bf2f7add6117c0cd17436e3945c32'
     or (select prosecdef from pg_proc where oid='pos.restrict_seller_product_update()'::regprocedure)
  then raise exception 'H189_GUARD_NOT_VERIFIED'; end if;
  if not (select relrowsecurity from pg_class where oid='pos.products'::regclass)
    or has_table_privilege('authenticated','pos.products','update')
    or has_any_column_privilege('authenticated','pos.products','update')
    or has_table_privilege('anon','pos.products','update')
    or has_any_column_privilege('anon','pos.products','update')
    or has_table_privilege('authenticated','pos.online_requests','insert')
    or has_table_privilege('authenticated','pos.online_requests','update')
    or has_function_privilege('authenticated','pos.reserve_sale_stock(text,text,jsonb)','execute')
    or has_function_privilege('anon','pos.reserve_sale_stock(text,text,jsonb)','execute')
    or has_function_privilege('authenticated','pos.online_request_context()','execute')
    or not has_function_privilege('authenticated','pos.execute_online_command(uuid,jsonb)','execute')
  then raise exception 'H189_PRIVATE_TRANSACTION_BOUNDARY_DRIFT'; end if;
  if (select count(*) from pg_trigger where tgrelid='pos.products'::regclass
      and tgname in('products_restrict_seller_update','h94_sync_v2_stock_shape','h164_online_authority','products_guard_entity_version')
      and tgenabled='O')<>4 then raise exception 'H189_PRODUCT_TRIGGER_DRIFT'; end if;
  if not (select prosecdef from pg_proc where oid='pos.reserve_sale_stock(text,text,jsonb)'::regprocedure)
    or not (select prosecdef from pg_proc where oid='pos.online_request_context()'::regprocedure)
  then raise exception 'H189_RESERVATION_SECURITY_DRIFT'; end if;
end $h189_verify$;
commit;
