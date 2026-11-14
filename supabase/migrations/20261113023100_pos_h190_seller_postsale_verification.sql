-- H190: metadata-only verification; behavioral cases use isolated PGlite.
begin;
do $h190_verify$
declare relation text; signature text;
begin
  if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n'))<>'d250cdd879860bf1cb3014b5b38b1310'
    or (select prosecdef from pg_proc where oid='pos.restrict_seller_product_update()'::regprocedure)
  then raise exception 'H190_GUARD_NOT_VERIFIED'; end if;
  foreach relation in array array['products','returns','return_items','online_requests'] loop
    if not (select relrowsecurity from pg_class where oid=('pos.'||relation)::regclass)
      or has_table_privilege('authenticated','pos.'||relation,'insert,update,delete,truncate')
      or has_any_column_privilege('authenticated','pos.'||relation,'insert,update')
      or has_table_privilege('anon','pos.'||relation,'select,insert,update,delete,truncate')
      or has_any_column_privilege('anon','pos.'||relation,'select,insert,update')
    then raise exception 'H190_TABLE_BOUNDARY_DRIFT: %',relation; end if;
  end loop;
  foreach relation in array array['returns','return_items'] loop
    if not has_table_privilege('authenticated','pos.'||relation,'select')
      or not exists(select 1 from pg_policies where schemaname='pos' and tablename=relation
        and policyname='h190_refund_select' and cmd='SELECT' and permissive='PERMISSIVE'
        and roles=array['authenticated']::name[] and qual='pos.current_has_capability(''sales.refund''::text)' and with_check is null)
    then raise exception 'H190_READ_POLICY_DRIFT: %',relation; end if;
  end loop;
  foreach signature in array array[
    'pos.reserve_sale_stock(text,text,jsonb)',
    'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'pos.online_request_context()'
  ] loop
    if has_function_privilege('authenticated',signature,'execute')
      or has_function_privilege('anon',signature,'execute')
      or not (select prosecdef from pg_proc where oid=signature::regprocedure)
    then raise exception 'H190_PRIVATE_TRANSACTION_DRIFT: %',signature; end if;
  end loop;
  if not has_function_privilege('authenticated','pos.execute_online_command(uuid,jsonb)','execute')
    or (select count(*) from pg_trigger where tgrelid='pos.products'::regclass
      and tgname in('products_restrict_seller_update','h94_sync_v2_stock_shape','h164_online_authority','products_guard_entity_version') and tgenabled='O')<>4
  then raise exception 'H190_GATEWAY_OR_TRIGGER_DRIFT'; end if;
end $h190_verify$;
commit;
