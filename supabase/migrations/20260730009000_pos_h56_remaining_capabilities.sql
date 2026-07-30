begin;
create or replace function pos.commit_sale_checked(
 p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,
 p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,
 p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
begin
 perform pos.require_current_capability('sales.create');
 return pos.commit_sale(p_commit_id,p_operation_id,p_sale,p_items,p_moves,
  p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
end; $$;
create or replace function pos.commit_sale_with_additional_discount_checked(
 p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,
 p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,
 p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
begin
 perform pos.require_current_capability('sales.create');
 return pos.commit_sale_with_additional_discount(p_commit_id,p_operation_id,
  p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,
  p_client_effect,p_seller_effects);
end; $$;
revoke all on function pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) from public,anon,authenticated;
revoke all on function pos.commit_sale_with_additional_discount(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) from public,anon,authenticated;
revoke all on function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) from public,anon;
revoke all on function pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) from public,anon;
grant execute on function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) to authenticated;
grant execute on function pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) to authenticated;

drop policy if exists active_admin_all on pos.clients;
drop policy if exists clients_admin_select on pos.clients;
drop policy if exists clients_capability_insert on pos.clients;
drop policy if exists clients_capability_update on pos.clients;
drop policy if exists clients_capability_delete on pos.clients;
create policy clients_admin_select on pos.clients for select to authenticated using(pos.is_active_admin());
create policy clients_capability_insert on pos.clients for insert to authenticated with check(pos.current_has_capability('customers.create'));
create policy clients_capability_update on pos.clients for update to authenticated using(pos.current_has_capability('customers.update')) with check(pos.current_has_capability('customers.update'));
create policy clients_capability_delete on pos.clients for delete to authenticated using(pos.current_has_capability('customers.delete'));

drop policy if exists active_admin_all on pos.promotions;
drop policy if exists promotions_admin_select on pos.promotions;
drop policy if exists promotions_capability_write on pos.promotions;
create policy promotions_admin_select on pos.promotions for select to authenticated using(pos.is_active_admin());
create policy promotions_capability_write on pos.promotions for all to authenticated using(pos.current_has_capability('promotions.manage')) with check(pos.current_has_capability('promotions.manage'));

drop policy if exists active_admin_all on pos.sellers;
drop policy if exists sellers_admin_select on pos.sellers;
drop policy if exists sellers_capability_write on pos.sellers;
create policy sellers_admin_select on pos.sellers for select to authenticated using(pos.is_active_admin());
create policy sellers_capability_write on pos.sellers for all to authenticated using(pos.current_has_capability('sellers.manage')) with check(pos.current_has_capability('sellers.manage'));
commit;
