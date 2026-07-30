begin;
do $$
begin
  if has_table_privilege('authenticated','pos.products','insert')
     or has_table_privilege('authenticated','pos.products','update')
     or has_table_privilege('authenticated','pos.products','delete')
     or has_function_privilege('anon','pos.save_products_checked(uuid,jsonb)','execute')
     or has_function_privilege('anon','pos.delete_product_checked(uuid,text,bigint,text)','execute')
     or not has_function_privilege('authenticated','pos.save_products_checked(uuid,jsonb)','execute')
     or not has_function_privilege('authenticated','pos.delete_product_checked(uuid,text,bigint,text)','execute') then
    raise exception 'H56_INVENTORY_ACL_FAILED';
  end if;
  raise notice 'H56_INVENTORY acl=ok direct_write=denied capabilities=separate';
end;
$$;
commit;
