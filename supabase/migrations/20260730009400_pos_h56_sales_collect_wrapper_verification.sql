begin;
do $$
begin
  if not has_function_privilege('authenticated',
    'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)',
    'execute')
  or not has_function_privilege('authenticated',
    'pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)',
    'execute')
  or has_function_privilege('anon',
    'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)',
    'execute')
  or has_function_privilege('anon',
    'pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)',
    'execute')
  or not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='pos' and p.proname in (
      'commit_sale_checked','commit_sale_with_additional_discount_checked'
    ) and pg_get_functiondef(p.oid) like '%require_sale_commit_capabilities%'
    group by n.nspname having count(*)=2
  ) then
    raise exception 'H56_COLLECT_WRAPPER_FAILED';
  end if;
  raise notice 'H56_COLLECT_WRAPPERS guard=ok acl=ok';
end;
$$;
commit;
