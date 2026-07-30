-- H-56 Fase 5: frontera exacta de sales.collect.
begin;

create or replace function pos.require_sale_commit_capabilities(
  p_sale jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security definer
set search_path=pos,pg_temp
as $$
declare
  v_folio text := p_sale->>'folio';
  v_existing_layaway boolean;
  v_has_money boolean;
begin
  select coalesce(estado = 'Apartado', false) into v_existing_layaway
  from pos.sales where folio=v_folio;
  v_existing_layaway := coalesce(v_existing_layaway,false);
  v_has_money := jsonb_typeof(p_payments)='array'
    and jsonb_array_length(p_payments)>0
    and exists(
      select 1 from jsonb_array_elements(p_payments) p
      where coalesce((p->>'monto')::numeric,0)>0
    );
  if v_existing_layaway then
    perform pos.require_current_capability('sales.collect');
  else
    perform pos.require_current_capability('sales.create');
    if v_has_money then
      perform pos.require_current_capability('sales.collect');
    end if;
  end if;
end;
$$;

create or replace function pos.commit_sale_checked(
 p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,
 p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,
 p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
begin
 perform pos.require_sale_commit_capabilities(p_sale,p_payments);
 return pos.commit_sale(p_commit_id,p_operation_id,p_sale,p_items,p_moves,
  p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
end; $$;

create or replace function pos.commit_sale_with_additional_discount_checked(
 p_commit_id text,p_operation_id text,p_sale jsonb,p_items jsonb,p_moves jsonb,
 p_payments jsonb,p_stock_lines jsonb,p_reserve_stock boolean,
 p_client_effect jsonb default null,p_seller_effects jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
begin
 perform pos.require_sale_commit_capabilities(p_sale,p_payments);
 return pos.commit_sale_with_additional_discount(p_commit_id,p_operation_id,
  p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,
  p_client_effect,p_seller_effects);
end; $$;

revoke all on function pos.require_sale_commit_capabilities(jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function pos.require_sale_commit_capabilities(jsonb,jsonb)
  to service_role;
commit;
