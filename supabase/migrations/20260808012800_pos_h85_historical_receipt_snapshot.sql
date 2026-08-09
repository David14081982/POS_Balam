begin;

alter table pos.sales
  add column if not exists receipt_snapshot jsonb;

alter table pos.sales
  drop constraint if exists sales_receipt_snapshot_shape_ck;
alter table pos.sales
  add constraint sales_receipt_snapshot_shape_ck check (
    receipt_snapshot is null or (
      jsonb_typeof(receipt_snapshot) = 'object'
      and receipt_snapshot ->> 'version' = '1'
      and jsonb_typeof(receipt_snapshot -> 'lines') = 'array'
    )
  );

-- H-83 sigue siendo el delegado que persiste colores de ornamento. H-85 solo
-- extiende la misma transaccion con evidencia cerrada del comprobante.
alter function pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h85_commit_sale_delegate;
alter function pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
  rename to h85_commit_sale_with_additional_discount_delegate;

revoke all on function
  pos.h85_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.h85_commit_sale_with_additional_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
from public, anon, authenticated;

create or replace function pos.commit_sale_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h85_commit_sale_delegate(p_commit_id, p_operation_id, p_sale,
    p_items, p_moves, p_payments, p_stock_lines, p_reserve_stock,
    p_client_effect, p_seller_effects);
  if coalesce((v_result ->> 'ok')::boolean, false)
     and jsonb_typeof(p_sale -> 'receipt_snapshot') = 'object' then
    update pos.sales
       set receipt_snapshot = p_sale -> 'receipt_snapshot'
     where folio = p_sale ->> 'folio' and receipt_snapshot is null;
  end if;
  return v_result;
end;
$$;

create or replace function pos.commit_sale_with_additional_discount_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pos, pg_temp as $$
declare v_result jsonb;
begin
  v_result := pos.h85_commit_sale_with_additional_discount_delegate(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, p_reserve_stock, p_client_effect, p_seller_effects);
  if coalesce((v_result ->> 'ok')::boolean, false)
     and jsonb_typeof(p_sale -> 'receipt_snapshot') = 'object' then
    update pos.sales
       set receipt_snapshot = p_sale -> 'receipt_snapshot'
     where folio = p_sale ->> 'folio' and receipt_snapshot is null;
  end if;
  return v_result;
end;
$$;

revoke all on function
  pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
from public, anon;
grant execute on function
  pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb),
  pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)
to authenticated;

update pos.system_manifest
set schema_version = greatest(schema_version, 20260808012800), updated_at = now()
where singleton;

commit;
