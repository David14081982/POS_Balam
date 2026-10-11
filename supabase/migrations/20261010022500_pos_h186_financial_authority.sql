-- H186: exact financial contract for NEW sales. Historical documents stay frozen.
-- No costs, minimum margins or product identity migrations belong to this contract.
begin;
set local lock_timeout='10s';

-- Expand first. Raise this gate to 2 only after the matching client is served.
-- Version-2 requests are validated immediately, throughout the transition.
alter table pos.online_runtime add column min_financial_version smallint not null default 1
 check (min_financial_version in (1,2));

alter table pos.sales add column financial_version smallint;
alter table pos.sales add column financial_request jsonb;
alter table pos.sales add column original_total numeric(12,2);
alter table pos.sales add constraint sales_financial_version_chk check
 (financial_version is null or (financial_version=2 and financial_request is not null and jsonb_typeof(financial_request)='object' and original_total is not null and original_total>=0)) not valid;
alter table pos.promotions add constraint promotions_financial_value_chk check
 (tipo in ('pct','fijo') and valor<>'NaN'::numeric and valor>=0 and (tipo<>'pct' or valor<=100)) not valid;
alter table pos.returns drop constraint returns_components_valid;
alter table pos.returns add constraint returns_components_valid check
 (components is null or (total=0 and components='[]'::jsonb) or pos.money_components_valid(components,total)) not valid;

create function pos.h186_money(p_value jsonb) returns numeric
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare n numeric;
begin
 if jsonb_typeof(p_value) is distinct from 'number' then raise exception 'FINANCIAL_INVALID_MONEY' using errcode='22023'; end if;
 n:=(p_value#>>'{}')::numeric;
 if n<0 or n<>round(n,2) then raise exception 'FINANCIAL_INVALID_MONEY' using errcode='22023'; end if;
 return n;
end $$;

create function pos.h186_promo_snapshot(p_promos jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pos as $$
 select coalesce(jsonb_agg(p order by p->>'id'),'[]') from jsonb_array_elements(p_promos) p
$$;

-- The existing H90 wire carries components inside metodo; validate its decoded
-- document before DML, using the same decoder as the persistence trigger.
create function pos.h186_money_document(p_document jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare marker constant text:='__BALAM_MONEY_V1__'; payload jsonb; nominal text;
begin
 if left(p_document->>'metodo',length(marker))=marker then
  begin payload:=substring(p_document->>'metodo' from length(marker)+1)::jsonb;
  exception when others then raise exception 'invalid_money_components_wire' using errcode='22023'; end;
  nominal:=nullif(trim(payload->>'nominalMethod'),'');
  if nominal is null or not pos.money_components_valid(payload->'components',coalesce((p_document->>'monto')::numeric,(p_document->>'total')::numeric)) then
   raise exception 'invalid_money_components' using errcode='23514'; end if;
  return p_document||jsonb_build_object('metodo',nominal,'components',payload->'components');
 end if;
 return p_document;
end $$;

create or replace function pos.decode_money_components_wire() returns trigger
language plpgsql set search_path=pos,pg_temp as $$
declare decoded jsonb;
begin
 decoded:=pos.h186_money_document(to_jsonb(new));
 if new.metodo is distinct from decoded->>'metodo' then
  new.metodo:=decoded->>'metodo'; new.components:=decoded->'components';
 end if;
 return new;
end $$;

create function pos.h186_assert_payments(p_sale jsonb,p_payments jsonb) returns void
language plpgsql set search_path=pg_catalog,pos as $$
declare p jsonb; total numeric; paid numeric:=0; cash numeric:=0; others numeric:=0; amount numeric;
begin
 if jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'FINANCIAL_INVALID_PAYMENTS'; end if;
 total:=pos.h186_money(p_sale->'total');
 if exists(select 1 from jsonb_array_elements(p_payments) x group by x->>'id' having count(*)>1) then
  raise exception 'FINANCIAL_DUPLICATE_PAYMENT'; end if;
 for p in select pos.h186_money_document(value) from jsonb_array_elements(p_payments) loop
  amount:=pos.h186_money(p->'monto');
  if amount<=0 or nullif(p->>'id','') is null or p->>'folio' is distinct from p_sale->>'folio'
   or p->>'metodo' in ('Mixto','Apartado','Cortesía') and jsonb_array_length(coalesce(p->'components','[]'))=0
   or pos.h186_money(p->'efectivo')+pos.h186_money(p->'tarjeta')+pos.h186_money(p->'transferencia')+pos.h186_money(p->'otro')<>amount
   or pos.money_components_valid(p->'components',amount) is distinct from true
   or (select coalesce(sum((c->>'amount')::numeric),0) from jsonb_array_elements(p->'components') c where c->>'methodCode'='Efectivo')<>(p->>'efectivo')::numeric then
   raise exception 'FINANCIAL_PAYMENT_MISMATCH'; end if;
  paid:=paid+amount; cash:=cash+(p->>'efectivo')::numeric; others:=others+amount-(p->>'efectivo')::numeric;
 end loop;
 if paid<>pos.h186_money(p_sale->'anticipo') or cash<>pos.h186_money(p_sale->'pago_efectivo')
  or others<>pos.h186_money(p_sale->'pago_otro') or paid>total or total-paid<>pos.h186_money(p_sale->'saldo')
  or (p_sale->>'estado'<>'Apartado' and paid<>total) then raise exception 'FINANCIAL_PAYMENT_TOTAL_MISMATCH'; end if;
end $$;

create function pos.h186_assert_sale(p_command jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare
 s jsonb:=p_command->'header'; items jsonb:=p_command->'items'; old_sale jsonb; request jsonb; q jsonb;
 line jsonb; part jsonb; item jsonb; field text; pair record; part_index integer; expected_count integer:=0;
 payment jsonb; payments jsonb;
 courtesy boolean; frozen_fields text[]:=array['financial_version','financial_request','original_total','total','subtotal','iva','iva_pct','iva_included',
 'descuento','descuento_adicional','total_antes_descuento_adicional','descuentos_adicionales','valor_regalado','receipt_snapshot','items'];
 item_fields text[]:=array['line_id','product_id','sku','talla','qty','precio','precio_base','precio_original','promos','list_price','effective_price','discount_snapshot','descuento_adicional'];
begin
 if p_command->>'mode'='layaway_liquidation' then
  select to_jsonb(x) into old_sale from pos.sales x where folio=p_command->>'folio' for update;
  if coalesce((old_sale->>'financial_version')::integer,0)<>2 then return; end if;
  -- The established liquidation authority checks the exact stored replay hash.
  if exists(select 1 from pos.layaway_liquidation_commits where operation_id=coalesce(p_command->>'saleOperationId',p_command->>'operationId')) then return; end if;
  payment:=pos.h186_money_document(p_command->'payment');
  if pos.h186_money(payment->'monto')<>pos.h186_money(old_sale->'saldo') then raise exception 'FINANCIAL_LIQUIDATION_AMOUNT_MISMATCH'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into payments from pos.sale_payments p where folio=p_command->>'folio';
  s:=old_sale||jsonb_build_object('anticipo',old_sale->'total','saldo',0,'estado','Pagado',
   'pago_efectivo',(old_sale->>'pago_efectivo')::numeric+pos.h186_money(payment->'efectivo'),
   'pago_otro',(old_sale->>'pago_otro')::numeric+pos.h186_money(payment->'monto')-pos.h186_money(payment->'efectivo'));
  perform pos.h186_assert_payments(s,payments||jsonb_build_array(payment));
  return;
 end if;
 select to_jsonb(x) into old_sale from pos.sales x where folio=s->>'folio' for update;
 if p_command->>'mode'='payment' then
  if coalesce((old_sale->>'financial_version')::integer,0)<>2 then
   if nullif(s->'financial_version','null'::jsonb) is not null or nullif(s->'financial_request','null'::jsonb) is not null
    or nullif(s->'original_total','null'::jsonb) is not null then raise exception 'FINANCIAL_HISTORICAL_VERSION_MISMATCH'; end if;
   return;
  end if;
  foreach field in array frozen_fields loop
   if coalesce(s->field,case when field='valor_regalado' then '0'::jsonb else 'null'::jsonb end) is distinct from coalesce(old_sale->field,'null') then
    raise exception 'FINANCIAL_FROZEN_SALE_MISMATCH: %',field using errcode='23514'; end if;
  end loop;
  if jsonb_array_length(items)<>(select count(*) from pos.sale_items where folio=s->>'folio') or exists(
   select 1 from pos.sale_items stored where stored.folio=s->>'folio' and not exists(
    select 1 from jsonb_array_elements(items) i where i->>'line_id'=stored.line_id and not exists(
     select 1 from unnest(item_fields) f where coalesce(i->f,'null') is distinct from coalesce(to_jsonb(stored)->f,'null')))) then
   raise exception 'FINANCIAL_FROZEN_ITEMS_MISMATCH'; end if;
  if exists(select 1 from pos.sale_payments stored where stored.folio=s->>'folio' and not exists(
   select 1 from (select pos.h186_money_document(value) p from jsonb_array_elements(p_command->'payments')) decoded where p->>'id'=stored.id and not exists(
    select 1 from unnest(array['folio','fecha','tipo','metodo','monto','efectivo','tarjeta','transferencia','otro','components']) f
    where coalesce(p->f,'null') is distinct from coalesce(to_jsonb(stored)->f,'null')))) then
   raise exception 'FINANCIAL_FROZEN_PAYMENTS_MISMATCH'; end if;
  perform pos.h186_assert_payments(s,p_command->'payments');
  return;
 end if;
 if old_sale is not null then raise exception 'SALE_ALREADY_EXISTS' using errcode='40001'; end if;
 if s->>'financial_version' is distinct from '2' then
  if nullif(s->'financial_version','null'::jsonb) is null
   and (select min_financial_version from pos.online_runtime where singleton)=1 then return; end if;
  raise exception 'CLIENT_VERSION_UNSUPPORTED: FINANCIAL_VERSION_REQUIRED. Recarga BALAM para calcular y confirmar esta venta.' using errcode='22023'; end if;
 request:=s->'financial_request';
 if jsonb_typeof(request) is distinct from 'object' then raise exception 'FINANCIAL_REQUEST_REQUIRED'; end if;
 courtesy:=coalesce((request->>'courtesy')::boolean,false);
 if courtesy is distinct from (s->>'metodo'='Cortesía') or (courtesy and not exists(
  select 1 from pos.clients where id=s->>'cliente_id' and not generic and deleted_at is null)) then
  raise exception 'FINANCIAL_COURTESY_POLICY_MISMATCH'; end if;
 q:=pos.quote_sale(request->'inputs',coalesce(request->'applications','[]'),courtesy);
 for pair in select * from (values('original_total','originalTotal'),('total','finalTotal'),('subtotal','subtotal'),('iva','iva'),
  ('descuento','configuredDiscountTotal'),('descuento_adicional','additionalDiscountTotal'),('total_antes_descuento_adicional','beforeAdditionalTotal')) as fields(header_key,quote_key) loop
  if pos.h186_money(s->pair.header_key)<>(q->>pair.quote_key)::numeric then
   raise exception 'FINANCIAL_QUOTE_MISMATCH: %',pair.header_key using errcode='23514'; end if;
 end loop;
 if pos.h186_money(coalesce(s->'valor_regalado','0'))<>(q->>'valorRegalado')::numeric or s->'iva_pct' is distinct from '16'::jsonb
  or s->'iva_included' is distinct from 'true'::jsonb or s->'descuentos_adicionales' is distinct from q->'applications'
  or jsonb_typeof(items) is distinct from 'array' then raise exception 'FINANCIAL_QUOTE_MISMATCH: snapshot'; end if;
 if exists(select 1 from jsonb_array_elements(items) i group by i->>'line_id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(items) i group by i#>>'{discount_snapshot,financial,key}',i#>>'{discount_snapshot,financial,part}' having count(*)>1) then
  raise exception 'FINANCIAL_DUPLICATE_SEGMENT'; end if;
 for line in select value from jsonb_array_elements(q->'lines') loop
  part_index:=0;
  for part in select value from jsonb_array_elements(line->'parts') loop
   expected_count:=expected_count+1;
   select i into item from jsonb_array_elements(items) i where i#>>'{discount_snapshot,financial,key}'=line->>'key'
    and i#>>'{discount_snapshot,financial,part}'=part_index::text;
   if item is null or nullif(item->>'line_id','') is null or item#>>'{discount_snapshot,financial,version}' is distinct from '2'
    or item->>'folio' is distinct from s->>'folio' or item->>'product_id' is distinct from line->>'productId'
    or item->>'talla' is distinct from line->>'talla' or item->'qty' is distinct from part->'qty'
    or item->>'sku' is distinct from (select sku from pos.products where id=line->>'productId')
    or pos.h186_money(item->'precio')<>(part->>'unit')::numeric
    or pos.h186_money(item->'precio_base')<>(line#>>'{res,unit}')::numeric
    or pos.h186_money(item->'precio_original')<>(line#>>'{res,orig}')::numeric
    or pos.h186_money(item->'list_price')<>(line#>>'{res,orig}')::numeric
    or pos.h186_money(item->'effective_price')<>(part->>'unit')::numeric
    or pos.h186_money(item->'descuento_adicional')<>(part->>'additionalDiscount')::numeric
    or pos.h186_money(item#>'{discount_snapshot,additional}')<>(part->>'additionalDiscount')::numeric
    or pos.h186_promo_snapshot(item->'promos') is distinct from pos.h186_promo_snapshot(line#>'{res,promos}')
    or pos.h186_promo_snapshot(item#>'{discount_snapshot,promotions}') is distinct from pos.h186_promo_snapshot(line#>'{res,promos}') then
    raise exception 'FINANCIAL_LINE_MISMATCH: %, %',line->>'key',part_index using errcode='23514'; end if;
   part_index:=part_index+1;
  end loop;
 end loop;
 if expected_count<>jsonb_array_length(items) or (s->>'items')::integer is distinct from (
  select sum((i->>'qty')::integer)::integer from jsonb_array_elements(items) i) then raise exception 'FINANCIAL_ITEM_COUNT_MISMATCH'; end if;
 if coalesce((p_command->>'reserveStock')::boolean,false) is distinct from (s->>'estado'<>'Apartado') then raise exception 'FINANCIAL_STOCK_RESERVATION_REQUIRED'; end if;
 if coalesce((p_command->>'reserveStock')::boolean,false) and (
  (select jsonb_agg(to_jsonb(z) order by product_id,talla) from (
   select i->>'product_id' product_id,i->>'talla' talla,sum((i->>'qty')::integer) qty from jsonb_array_elements(items) i group by 1,2) z)
  is distinct from (select jsonb_agg(to_jsonb(z) order by product_id,talla) from (
   select i->>'product_id' product_id,i->>'talla' talla,sum((i->>'qty')::integer) qty from jsonb_array_elements(p_command->'stockLines') i group by 1,2) z)) then
  raise exception 'FINANCIAL_STOCK_LINES_MISMATCH'; end if;
 perform pos.h186_assert_payments(s,p_command->'payments');
end $$;

create function pos.h186_persist_sale(p_command jsonb) returns void
language plpgsql set search_path=pg_catalog,pos as $$
declare s jsonb:=p_command->'header';
begin
 if p_command->>'mode'='layaway_liquidation' or s->>'financial_version' is distinct from '2' then return; end if;
 update pos.sales set financial_version=2,financial_request=s->'financial_request',original_total=(s->>'original_total')::numeric where folio=s->>'folio';
 -- H52 joined by SKU/size; after H94 assigned immutable IDs, seal each segment exactly.
 update pos.sale_items stored set descuento_adicional=(i->>'descuento_adicional')::numeric
  from jsonb_array_elements(p_command->'items') i where stored.folio=s->>'folio' and stored.line_id=i->>'line_id';
 if (select sum(qty*precio) from pos.sale_items where folio=s->>'folio') is distinct from (s->>'total')::numeric
  or (select sum(descuento_adicional) from pos.sale_items where folio=s->>'folio') is distinct from (s->>'descuento_adicional')::numeric then
  raise exception 'FINANCIAL_PERSISTENCE_MISMATCH'; end if;
end $$;

-- Match the established empty/all-selected catalog semantics, including custom attributes.
create function pos.h186_dimension(p_selected jsonb,p_value text,p_kind text) returns boolean
language plpgsql stable set search_path=pg_catalog,pos as $$
begin
 if p_selected is null or p_selected='null' or p_selected='[]' then return true; end if;
 if jsonb_typeof(p_selected)<>'array' then raise exception 'FINANCIAL_INVALID_PROMOTION_SCOPE'; end if;
 if p_kind='__models' then
  if exists(select 1 from pos.products where deleted_at is null) and not exists(
   select 1 from pos.products where deleted_at is null and not p_selected @> jsonb_build_array(coalesce(modelo,''))) then return true; end if;
 elsif exists(select 1 from pos.lookup where kind=p_kind and active) and not exists(
  select 1 from pos.lookup where kind=p_kind and active and not p_selected @> jsonb_build_array(code)) then return true;
 end if;
 return coalesce(p_selected @> jsonb_build_array(p_value),false);
end $$;

create function pos.h186_promotion_matches(p_scope jsonb,p_product jsonb,p_size text) returns boolean
language plpgsql stable set search_path=pg_catalog,pos as $$
declare d record;
begin
 for d in select * from (values('cats','cat','category'),('telas','tela','fabric'),
  ('mangas','manga','sleeve'),('cuellos','cuello','neck'),('colores','color','color'),
  ('orns','orn','ornament'),('modelos','modelo','__models')) as dims(scope_key,product_key,kind) loop
  if not pos.h186_dimension(p_scope->d.scope_key,p_product->>d.product_key,d.kind) then return false; end if;
 end loop;
 for d in select key,value from jsonb_each(coalesce(p_scope->'attrs','{}')) loop
  if not pos.h186_dimension(d.value,p_product#>>array['attrs',d.key],d.key) then return false; end if;
 end loop;
 if jsonb_array_length(coalesce(p_scope->'tallas','[]'))>0 and not exists(
  select 1 from jsonb_array_elements_text(p_scope->'tallas') t where t=p_size) then return false; end if;
 return true;
end $$;

create function pos.quote_sale(p_inputs jsonb,p_applications jsonb default '[]',p_courtesy boolean default false)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare
 input jsonb; product pos.products%rowtype; promotion pos.promotions%rowtype; benefit pos.lookup%rowtype;
 lines jsonb:='[]'; apps jsonb:='[]'; promotions jsonb; line jsonb; app jsonb; raw jsonb; meta jsonb;
 original numeric:=0; before_add numeric:=0; final_total numeric:=0; subtotal numeric; gift numeric:=0;
 orig numeric; unit_price numeric; qty integer; pct numeric; fixed numeric; remaining numeric;
 value numeric; amount_before numeric; requested numeric; discount_amount numeric; assigned numeric; share numeric;
 eligible integer[]; idx integer; last_idx integer; app_index integer:=0; cents bigint; unit_cents bigint; remainder integer;
 parts jsonb; scope text; benefit_type text; business_now timestamp:=now() at time zone 'America/Hermosillo';
begin
 perform pos.require_current_capability('sales.create');
 perform pos.assert_online_device();
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)=0
  or jsonb_typeof(p_applications) is distinct from 'array' then raise exception 'FINANCIAL_INVALID_REQUEST' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_inputs) i group by i->>'key' having count(*)>1) then
  raise exception 'FINANCIAL_DUPLICATE_LINE_KEY' using errcode='22023'; end if;
 for input in select j.value from jsonb_array_elements(p_inputs) j loop
  if nullif(input->>'key','') is null or jsonb_typeof(input->'qty') is distinct from 'number'
   or (input->>'qty')::numeric<>trunc((input->>'qty')::numeric) or (input->>'qty')::numeric<=0
   or nullif(input->>'talla','') is null then raise exception 'FINANCIAL_INVALID_LINE' using errcode='22023'; end if;
  qty:=(input->>'qty')::integer;
  select * into product from pos.products where id=input->>'productId' and deleted_at is null;
  if not found then raise exception 'FINANCIAL_PRODUCT_NOT_FOUND' using errcode='22023'; end if;
  if not exists(select 1 from jsonb_array_elements(product.stock) s where s->>'talla'=input->>'talla') then
   raise exception 'FINANCIAL_SIZE_NOT_FOUND' using errcode='22023'; end if;
  orig:=pos.list_price(product.id,input->>'talla');
  if orig is null or orig<0 or orig<>round(orig,2) then raise exception 'FINANCIAL_INVALID_LIST_PRICE'; end if;
  pct:=0; fixed:=0; promotions:='[]';
  for promotion in select * from pos.promotions p where p.deleted_at is null and not p.pausado
   and (p.inicio is null or business_now>=p.inicio+coalesce(nullif(p.hora_inicio,''),'00:00')::time)
   and (p.fin is null or business_now<=p.fin+coalesce(nullif(p.hora_fin,''),'23:59')::time)
   order by p.id loop
   if pos.h186_promotion_matches(promotion.scope,to_jsonb(product),input->>'talla') then
    if promotion.tipo not in ('pct','fijo') or promotion.valor<0 or (promotion.tipo='pct' and promotion.valor>100) then
     raise exception 'FINANCIAL_INVALID_PROMOTION'; end if;
    if promotion.tipo='pct' then pct:=pct+promotion.valor; else fixed:=fixed+promotion.valor; end if;
    promotions:=promotions||jsonb_build_array(jsonb_build_object('id',promotion.id,'nombre',promotion.nombre,'tipo',promotion.tipo,'valor',promotion.valor));
   end if;
  end loop;
  unit_price:=round(greatest(0,orig*(1-least(pct,100)/100)-fixed),2);
  lines:=lines||jsonb_build_array(jsonb_build_object('key',input->>'key','productId',product.id,'talla',input->>'talla','qty',qty,
   'res',jsonb_build_object('orig',orig,'unit',unit_price,'promos',promotions),
   'originalTotal',orig*qty,'configuredTotal',unit_price*qty,'remaining',unit_price*qty,'additionalDiscount',0));
  original:=original+orig*qty; before_add:=before_add+unit_price*qty;
 end loop;
 for raw in select j.value from jsonb_array_elements(p_applications) j loop
  app_index:=app_index+1;
  select * into benefit from pos.lookup where kind='additional_benefit' and code=raw->>'benefitCode' and active;
  if not found then raise exception 'FINANCIAL_BENEFIT_NOT_FOUND'; end if;
  meta:=benefit.meta; scope:=coalesce(meta->>'scope','ticket'); benefit_type:=meta->>'benefitType';
  if raw->>'benefitName' is distinct from benefit.label
   or (raw ? 'maxPercent' and coalesce((raw->>'maxPercent')::numeric,0)<>coalesce((meta->>'maxPercent')::numeric,0))
   or (raw ? 'maxAmount' and coalesce((raw->>'maxAmount')::numeric,0)<>coalesce((meta->>'maxAmount')::numeric,0)) then
   raise exception 'FINANCIAL_BENEFIT_SNAPSHOT_MISMATCH'; end if;
  if raw->>'origin' is distinct from meta->>'origin' or raw->>'benefitType' is distinct from benefit_type
   or raw->>'scope' is distinct from scope or coalesce((raw->>'combinable')::boolean,false)<>coalesce((meta->>'combinable')::boolean,false)
   or (jsonb_array_length(p_applications)>1 and not coalesce((meta->>'combinable')::boolean,false)) then
   raise exception 'FINANCIAL_BENEFIT_POLICY_MISMATCH'; end if;
  if jsonb_typeof(coalesce(raw->'value','0')) is distinct from 'number' then raise exception 'FINANCIAL_INVALID_BENEFIT_VALUE'; end if;
  value:=coalesce((raw->>'value')::numeric,0);
  if value<0 or (benefit_type='fixed' and value<>round(value,2)) then raise exception 'FINANCIAL_INVALID_BENEFIT_VALUE'; end if;
  if not coalesce((meta->>'allowsCustomValue')::boolean,false) and value<>coalesce((meta->>'value')::numeric,0) then
   raise exception 'FINANCIAL_BENEFIT_VALUE_MISMATCH'; end if;
  if coalesce((meta->>'requiresReason')::boolean,false) and nullif(trim(raw->>'reason'),'') is null then
   raise exception 'FINANCIAL_BENEFIT_REASON_REQUIRED'; end if;
  if coalesce((meta->>'requiresFolio')::boolean,false) or meta->>'origin'='Tarjeta física' then
   if nullif(trim(raw->>'cardFolio'),'') is null or nullif(trim(raw->>'claimToken'),'') is null
    or (raw->>'onlineVerified')::boolean is distinct from true then raise exception 'FINANCIAL_CARD_CLAIM_REQUIRED'; end if;
  end if;
  if benefit_type not in ('percentage','fixed','courtesy_piece','courtesy_total')
   or (benefit_type in ('percentage','fixed') and value<=0)
   or (benefit_type='percentage' and (value>100 or (coalesce((meta->>'maxPercent')::numeric,0)>0 and value>(meta->>'maxPercent')::numeric)))
   or (benefit_type='fixed' and coalesce((meta->>'maxAmount')::numeric,0)>0 and value>(meta->>'maxAmount')::numeric) then
   raise exception 'FINANCIAL_INVALID_BENEFIT_VALUE'; end if;
  select array_agg((ordinality-1)::integer order by ordinality),sum((l->>'remaining')::numeric)
   into eligible,amount_before from jsonb_array_elements(lines) with ordinality a(l,ordinality)
   where (l->>'remaining')::numeric>0 and (scope='ticket' or (scope='item' and l->>'key'=raw->>'targetKey'));
  if eligible is null then raise exception 'FINANCIAL_NO_ELIGIBLE_AMOUNT'; end if;
  if benefit_type='percentage' then requested:=round(amount_before*value/100,2);
  elsif benefit_type='fixed' then requested:=value;
  elsif benefit_type='courtesy_total' then requested:=amount_before;
  else
   if scope<>'item' or cardinality(eligible)<>1 then raise exception 'FINANCIAL_COURTESY_ITEM_REQUIRED'; end if;
   line:=lines->eligible[1]; requested:=round((line->>'remaining')::numeric/(line->>'qty')::integer,2);
  end if;
  discount_amount:=least(amount_before,requested);
  if discount_amount<=0 then raise exception 'FINANCIAL_NO_DISCOUNT'; end if;
  assigned:=0; last_idx:=eligible[cardinality(eligible)];
  foreach idx in array eligible loop
   line:=lines->idx; remaining:=(line->>'remaining')::numeric;
   share:=case when idx=last_idx then discount_amount-assigned else round(discount_amount*remaining/amount_before,2) end;
   share:=least(remaining,discount_amount-assigned,greatest(0,share));
   lines:=jsonb_set(lines,array[idx::text],line||jsonb_build_object('remaining',remaining-share,'additionalDiscount',(line->>'additionalDiscount')::numeric+share));
   assigned:=assigned+share;
  end loop;
  -- Tiny proportional shares can all round down and exceed the final line's
  -- capacity. Finish the exact authorized amount, last eligible line first.
  for last_idx in reverse cardinality(eligible)..1 loop
   exit when assigned=discount_amount;
   idx:=eligible[last_idx]; line:=lines->idx; remaining:=(line->>'remaining')::numeric;
   share:=least(remaining,discount_amount-assigned);
   lines:=jsonb_set(lines,array[idx::text],line||jsonb_build_object('remaining',remaining-share,'additionalDiscount',(line->>'additionalDiscount')::numeric+share));
   assigned:=assigned+share;
  end loop;
  app:=raw||jsonb_build_object('id',coalesce(raw->>'id','additional-'||app_index),'scope',scope,
   'amountBefore',amount_before,'discountAmount',assigned,'amountAfter',amount_before-assigned);
  apps:=apps||jsonb_build_array(app);
 end loop;
 select sum((l->>'remaining')::numeric) into final_total from jsonb_array_elements(lines) l;
 if p_courtesy then
  gift:=final_total; final_total:=0;
 end if;
 for idx in 0..jsonb_array_length(lines)-1 loop
  line:=lines->idx; qty:=(line->>'qty')::integer;
  remaining:=case when p_courtesy then 0 else (line->>'remaining')::numeric end;
  cents:=(remaining*100)::bigint; unit_cents:=cents/qty; remainder:=(cents%qty)::integer; parts:='[]';
  unit_price:=case when p_courtesy then 0 else (line#>>'{res,unit}')::numeric end;
  if remainder>0 then parts:=parts||jsonb_build_array(jsonb_build_object('qty',remainder,'unit',(unit_cents+1)/100.0,
   'additionalDiscount',(unit_price-(unit_cents+1)/100.0)*remainder)); end if;
  if qty-remainder>0 then parts:=parts||jsonb_build_array(jsonb_build_object('qty',qty-remainder,'unit',unit_cents/100.0,
   'additionalDiscount',(unit_price-unit_cents/100.0)*(qty-remainder))); end if;
  if p_courtesy then line:=line||jsonb_build_object('remaining',0,'configuredTotal',0,'additionalDiscount',0,
   'res',(line->'res')||jsonb_build_object('unit',0)); end if;
  lines:=jsonb_set(lines,array[idx::text],line||jsonb_build_object('finalUnit',round(remaining/qty,2),'parts',parts));
 end loop;
 subtotal:=round(final_total/1.16,2);
 return jsonb_build_object('financialVersion',2,'originalTotal',original,'configuredDiscountTotal',case when p_courtesy then 0 else original-before_add end,
  'beforeAdditionalTotal',case when p_courtesy then 0 else before_add end,
  'additionalDiscountTotal',case when p_courtesy then 0 else before_add-final_total end,
  'subtotal',subtotal,'iva',final_total-subtotal,'ivaPct',16,'ivaIncluded',true,'finalTotal',final_total,
  'valorRegalado',gift,'applications',case when p_courtesy then '[]'::jsonb else apps end,'lines',lines);
end $$;

create function pos.h186_source_line(p_folio text,p_line_id text) returns jsonb
language plpgsql stable set search_path=pg_catalog,pos as $$
declare result jsonb; count_rows integer;
begin
 select count(*),jsonb_agg(x)->0 into count_rows,result from (
  select line_id,product_id,sku,talla,qty,precio from pos.sale_items where folio=p_folio and line_id=p_line_id
  union all
  select i.line_id,i.product_id,i.sku,i.talla,i.qty,i.precio from pos.exchange_items i join pos.exchanges e on e.id=i.exchange_id
   where e.origen_folio=p_folio and i.lado='entregado' and i.line_id=p_line_id
 ) x;
 if count_rows<>1 then raise exception 'FINANCIAL_SOURCE_LINE_REQUIRED'; end if;
 return result;
end $$;

-- Overload preserves the legacy function and changes valuation only for version 2 roots.
create function pos.line_recognized_value(p_folio text,p_sku text,p_talla text,p_line_id text) returns numeric
language plpgsql stable security definer set search_path=pg_catalog,pos as $$
declare source jsonb;
begin
 if coalesce((select financial_version from pos.sales where folio=p_folio),0)<>2 then
  return pos.line_recognized_value(p_folio,p_sku,p_talla); end if;
 source:=pos.h186_source_line(p_folio,p_line_id);
 if source->>'sku' is distinct from p_sku or source->>'talla' is distinct from p_talla then raise exception 'FINANCIAL_SOURCE_LINE_MISMATCH'; end if;
 return (source->>'precio')::numeric;
end $$;

create function pos.h186_assert_postsale(p_command jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pos as $$
declare
 kind text:=p_command->>'type'; h jsonb:=pos.h186_money_document(p_command->'header'); item jsonb; source jsonb; version integer;
 payment jsonb:=pos.h186_money_document(nullif(p_command->'payment','null'::jsonb));
 v_folio text; document_id text; requested integer; consumed integer; recognized numeric:=0; delivered numeric:=0; amount numeric;
begin
 v_folio:=case when kind='return' then h->>'folio' else h->>'origen_folio' end; document_id:=h->>'id';
 select financial_version into version from pos.sales where sales.folio=v_folio for update;
 if coalesce(version,0)<>2 then return; end if;
 if jsonb_typeof(p_command->'items') is distinct from 'array' or jsonb_array_length(p_command->'items')=0 then raise exception 'FINANCIAL_INVALID_POSTSALE_ITEMS'; end if;
 if exists(select 1 from jsonb_array_elements(p_command->'items') i group by i->>'line_id' having count(*)>1) then raise exception 'FINANCIAL_DUPLICATE_SEGMENT'; end if;
 for item in select value from jsonb_array_elements(p_command->'items') loop
  if nullif(item->>'line_id','') is null or jsonb_typeof(item->'qty') is distinct from 'number' or (item->>'qty')::numeric<=0
   or (item->>'qty')::numeric<>trunc((item->>'qty')::numeric) then raise exception 'FINANCIAL_INVALID_POSTSALE_ITEMS'; end if;
  if kind='exchange' and item->>'lado'='entregado' then
   amount:=pos.list_price(item->>'product_id',item->>'talla');
   delivered:=delivered+amount*(item->>'qty')::integer;
  else
   source:=pos.h186_source_line(v_folio,item->>'source_sale_line_id');
   if source->>'product_id' is distinct from item->>'product_id' or source->>'sku' is distinct from item->>'sku'
    or source->>'talla' is distinct from item->>'talla' then raise exception 'FINANCIAL_SOURCE_LINE_MISMATCH'; end if;
   select sum((i->>'qty')::integer) into requested from jsonb_array_elements(p_command->'items') i
    where i->>'source_sale_line_id'=item->>'source_sale_line_id' and (kind='return' or i->>'lado'='devuelto');
   select coalesce(sum(qty),0) into consumed from (
    select r.qty from pos.return_items r join pos.returns d on d.id=r.return_id
     where d.folio=v_folio and r.source_sale_line_id=item->>'source_sale_line_id' and (kind<>'return' or d.id<>document_id)
    union all
    select e.qty from pos.exchange_items e join pos.exchanges d on d.id=e.exchange_id
     where d.origen_folio=v_folio and e.lado='devuelto' and e.source_sale_line_id=item->>'source_sale_line_id' and (kind<>'exchange' or d.id<>document_id)
   ) uses;
   if requested+consumed>(source->>'qty')::integer then raise exception 'FINANCIAL_SOURCE_QUANTITY_EXCEEDED'; end if;
   amount:=(source->>'precio')::numeric; recognized:=recognized+amount*(item->>'qty')::integer;
  end if;
  if (kind='return' or item ? 'precio') and pos.h186_money(item->'precio')<>amount then raise exception 'FINANCIAL_POSTSALE_PRICE_MISMATCH'; end if;
 end loop;
 if kind='return' then
  if pos.h186_money(h->'total')<>recognized or (recognized>0 and pos.money_components_valid(h->'components',recognized) is distinct from true)
   or (recognized=0 and coalesce(h->'components','[]') not in ('[]'::jsonb,'null'::jsonb)) then raise exception 'FINANCIAL_REFUND_TOTAL_MISMATCH'; end if;
 else
  amount:=greatest(0,delivered-recognized);
  if (h ? 'valor_reconocido' and pos.h186_money(h->'valor_reconocido')<>recognized)
   or (h ? 'valor_entregado' and pos.h186_money(h->'valor_entregado')<>delivered)
   or (h ? 'diferencia' and pos.h186_money(h->'diferencia')<>amount)
   or (amount=0 and payment is not null)
   or (amount>0 and (pos.h186_money(payment->'monto')<>amount or pos.money_components_valid(payment->'components',amount) is distinct from true)) then
   raise exception 'FINANCIAL_EXCHANGE_TOTAL_MISMATCH'; end if;
 end if;
end $$;

create function pos.h186_persist_postsale(p_command jsonb) returns void
language plpgsql set search_path=pg_catalog,pos as $$
begin
 -- H90's zero-refund wire intentionally has no component at all. Freeze the
 -- empty distribution after its real quantity/zero-price validation, never a
 -- synthetic zero-valued payment. Historical return rows are not rewritten.
 if p_command->>'type'='return' and (p_command#>>'{header,total}')::numeric=0
  and exists(select 1 from pos.sales where folio=p_command#>>'{header,folio}' and financial_version=2) then
  update pos.returns set components='[]' where id=p_command#>>'{header,id}' and total=0;
 end if;
end $$;

-- Patch the current authority in place, retaining H164 admission, CAS, ACL and delegates.
-- Each anchor is checked, so unexpected database drift aborts this migration.
do $patch$
declare definition text; previous text; anchor text;
begin
 select pg_get_functiondef('pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure) into definition;
 anchor:='when ''sale'' then';
 if position(anchor in definition)=0 then raise exception 'H186_DISPATCH_SALE_ANCHOR'; end if;
 definition:=replace(definition,anchor,anchor||E'\n   perform pos.h186_assert_sale(p_command);');
 anchor:='when ''return'' then';
 if position(anchor in definition)=0 then raise exception 'H186_DISPATCH_RETURN_ANCHOR'; end if;
 definition:=replace(definition,anchor,E'   if r->>''ok''=''true'' then perform pos.h186_persist_sale(p_command); end if;\n'||anchor||E'\n   perform pos.h186_assert_postsale(p_command);');
 anchor:='when ''exchange'' then';
 if position(anchor in definition)=0 then raise exception 'H186_DISPATCH_EXCHANGE_ANCHOR'; end if;
 definition:=replace(definition,anchor,E'   if r->>''ok''=''true'' then perform pos.h186_persist_postsale(p_command); end if;\n'||anchor||E'\n   perform pos.h186_assert_postsale(p_command);');
 execute definition;
 select pg_get_functiondef('pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 previous:=definition;
 definition:=replace(definition,'pos.line_recognized_value(v_origen, x.sku, x.talla)','pos.line_recognized_value(v_origen, x.sku, x.talla, x.source_sale_line_id)');
 if length(previous)-length(replace(previous,'pos.line_recognized_value(v_origen, x.sku, x.talla)',''))<>2*length('pos.line_recognized_value(v_origen, x.sku, x.talla)') then raise exception 'H186_EXCHANGE_VALUE_ANCHOR'; end if;
 definition:=replace(definition,'as x(lado text, sku text, talla text, qty integer)','as x(lado text, sku text, talla text, qty integer, source_sale_line_id text)');
 definition:=replace(definition,'motivo text, condicion text);','motivo text, condicion text, source_sale_line_id text);');
 execute definition;
 select pg_get_functiondef('pos.commit_sale_with_additional_discount(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure) into definition;
 anchor:='perform pg_advisory_xact_lock(hashtext(''physical-card:'' || v_card));';
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_CARD_REDEMPTION_ANCHOR'; end if;
 -- A payment preserves its frozen V2 benefit. Never redeem its card again or
 -- extend the claim lifetime; a different sale or claim still follows H52.
 definition:=replace(definition,anchor,anchor||$card$
      if exists(select 1 from pos.sales where folio=v_folio and financial_version=2)
         and exists(select 1 from pos.physical_card_redemptions
           where folio=v_card and claim_token=v_claim and sale_folio=v_folio
             and benefit_code=v_app.app->>'benefitCode') then
        continue;
      end if;
$card$);
 execute definition;
end $patch$;

revoke all on function pos.h186_money(jsonb),pos.h186_money_document(jsonb),pos.h186_dimension(jsonb,text,text),pos.h186_promotion_matches(jsonb,jsonb,text),
 pos.h186_promo_snapshot(jsonb),pos.h186_assert_payments(jsonb,jsonb),pos.h186_assert_sale(jsonb),pos.h186_persist_sale(jsonb),
 pos.h186_source_line(text,text),pos.line_recognized_value(text,text,text,text),pos.h186_assert_postsale(jsonb),pos.h186_persist_postsale(jsonb),
 pos.quote_sale(jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function pos.quote_sale(jsonb,jsonb,boolean) to authenticated,service_role;
grant execute on function pos.h186_money_document(jsonb) to service_role;
commit;
