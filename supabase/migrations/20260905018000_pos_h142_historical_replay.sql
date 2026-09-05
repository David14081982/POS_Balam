begin;

-- H142: overload with document origin; the original V1 adapter stays authoritative.
create or replace function pos.h133_operational_items(
 p_items jsonb, p_exchange boolean, p_source_folio text
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos
as $h142$
declare v_items jsonb; v_out jsonb:='[]'; i jsonb; p pos.products%rowtype; v_matches bigint;
begin
 v_items:=pos.h133_operational_items(p_items,p_exchange);
 for i in select value from jsonb_array_elements(v_items) loop
  select * into p from pos.products where id=i->>'product_id' and record_model='v2' and deleted_at is null;
  if found and (not p_exchange or i->>'lado'='devuelto')
     and nullif(i->>'barcode_code','') is not null
     and i->>'barcode_code'<>p.barcode_code
     and coalesce(p.barcode_aliases,'[]'::jsonb) ? (i->>'barcode_code') then
   select count(*) into v_matches from (
    select s.line_id from pos.sale_items s
     where s.folio=p_source_folio and s.line_id=i->>'source_sale_line_id'
       and s.product_id=p.id and s.talla=i->>'talla' and s.barcode_code=i->>'barcode_code'
    union all
    select s.line_id from pos.exchange_items s join pos.exchanges e on e.id=s.exchange_id
     where e.origen_folio=p_source_folio and s.lado='entregado'
       and s.line_id=i->>'source_sale_line_id' and s.product_id=p.id
       and s.talla=i->>'talla' and s.barcode_code=i->>'barcode_code'
   ) exact_source;
   if v_matches=1 then
    i:=i||jsonb_build_object('source_barcode_code',i->>'barcode_code','barcode_code',p.barcode_code);
   end if;
  end if;
  v_out:=v_out||jsonb_build_array(i);
 end loop;
 return v_out;
end;
$h142$;
revoke all on function pos.h133_operational_items(jsonb,boolean,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION pos.commit_return_checked(p_commit_id text, p_return jsonb, p_items jsonb, p_moves jsonb, p_stock_lines jsonb, p_client_effect jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb, p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_items jsonb;v_stock jsonb;v_prior jsonb;
begin
  -- Already confirmed historical payloads retain their original idempotency hash.
  perform 1 from pos.return_commits where commit_id=p_commit_id for share;
  if found then
    v_prior:=pos.h94_commit_return_delegate(p_commit_id,p_return,p_items,p_moves,
      p_stock_lines,p_client_effect,p_seller_effects,p_legacy);
    if v_prior->>'error' is distinct from 'commit_mismatch' then return v_prior; end if;
  end if;
  v_items:=pos.h133_operational_items(p_items,false,p_return->>'folio');
  v_stock:=pos.h133_operational_items(p_stock_lines,false);
  return pos.h133_commit_return_delegate(p_commit_id,p_return,v_items,p_moves,v_stock,
    p_client_effect,p_seller_effects,p_legacy);
end;
$function$;

CREATE OR REPLACE FUNCTION pos.commit_exchange_checked(p_commit_id text, p_exchange jsonb, p_items jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_prior jsonb;
begin
  perform 1 from pos.exchange_commits where commit_id=p_commit_id for share;
  if found then
    v_prior:=pos.h94_commit_exchange_delegate(p_commit_id,p_exchange,p_items,
      p_moves,p_payment,p_seller_effects);
    if v_prior->>'error' is distinct from 'commit_mismatch' then return v_prior; end if;
  end if;
  return pos.h133_commit_exchange_delegate(p_commit_id,p_exchange,
    pos.h133_operational_items(p_items,true,p_exchange->>'origen_folio'),p_moves,p_payment,p_seller_effects);
end;
$function$;

commit;
