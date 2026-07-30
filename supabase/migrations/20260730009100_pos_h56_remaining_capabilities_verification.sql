begin;
do $$
begin
 if has_function_privilege('authenticated','pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
 or not has_function_privilege('authenticated','pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
 or has_function_privilege('anon','pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
 or not has_function_privilege('authenticated','pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
 or has_function_privilege('anon','pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)','execute')
 or not exists(select 1 from pg_policies where schemaname='pos' and tablename='clients' and policyname='clients_capability_update')
 or not exists(select 1 from pg_policies where schemaname='pos' and tablename='promotions' and policyname='promotions_capability_write')
 or not exists(select 1 from pg_policies where schemaname='pos' and tablename='sellers' and policyname='sellers_capability_write')
 then raise exception 'H56_REMAINING_CAPABILITIES_FAILED'; end if;
 raise notice 'H56_REMAINING sales=ok customers=ok promotions=ok sellers=ok';
end; $$;
commit;
