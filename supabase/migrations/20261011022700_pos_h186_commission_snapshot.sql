-- H186: retain the H69 commission evidence on NEW financial-version-2 sales.
-- The additional-discount delegate stores the amount/base, but omits its rows.
-- No historical backfill or commission-policy recalculation belongs here.
begin;
set local lock_timeout='10s';

create function pos.h186_assert_commission_snapshot(p_sale jsonb,p_effects jsonb) returns void
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare entry jsonb; effect jsonb; amount numeric:=0; grouped_rows jsonb; grouped_effects jsonb;
begin
 if jsonb_typeof(p_sale->'comisiones') is distinct from 'array'
  or jsonb_typeof(p_effects) is distinct from 'array'
  or p_sale->>'comision_base' not in ('neto','bruto')
  or p_sale->>'comision_base' is null then
  raise exception 'FINANCIAL_COMMISSION_SNAPSHOT_REQUIRED' using errcode='23514'; end if;
 for entry in select value from jsonb_array_elements(p_sale->'comisiones') loop
  if jsonb_typeof(entry) is distinct from 'object' or nullif(entry->>'sellerId','') is null then
   raise exception 'FINANCIAL_COMMISSION_SNAPSHOT_MISMATCH' using errcode='23514'; end if;
  -- Preserve the policy/tier evidence verbatim. Do not infer a new commission
  -- from a rounded effective percentage, nor round the existing sales shares.
  perform pos.h186_money(entry->'base');
  amount:=amount+pos.h186_money(entry->'monto');
 end loop;
 if amount<>pos.h186_money(p_sale->'comision') then
  raise exception 'FINANCIAL_COMMISSION_TOTAL_MISMATCH' using errcode='23514'; end if;
 for effect in select value from jsonb_array_elements(p_effects) loop
  if jsonb_typeof(effect) is distinct from 'object' or nullif(effect->>'id','') is null then
   raise exception 'FINANCIAL_COMMISSION_EFFECT_MISMATCH' using errcode='23514'; end if;
  perform pos.h186_money(effect->'comision_acum_delta');
 end loop;
 -- Repeated sellers are supported by H69. Compare grouped amounts, including
 -- zero entries, rather than inventing a uniqueness rule or changing shares.
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into grouped_rows from
  (select value->>'sellerId' id,sum((value->>'monto')::numeric) amount
   from jsonb_array_elements(p_sale->'comisiones') group by 1) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into grouped_effects from
  (select value->>'id' id,sum((value->>'comision_acum_delta')::numeric) amount
   from jsonb_array_elements(p_effects) group by 1) x;
 if grouped_rows is distinct from grouped_effects then
  raise exception 'FINANCIAL_COMMISSION_EFFECT_MISMATCH' using errcode='23514'; end if;
end $$;
revoke all on function pos.h186_assert_commission_snapshot(jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare definition text; anchor text; old_acl aclitem[]; old_config text[]; old_owner oid; old_definer boolean;
 target regprocedure; source_hash text;
begin
 foreach target in array array['pos.h186_assert_sale(jsonb)'::regprocedure,'pos.h186_persist_sale(jsonb)'::regprocedure,
  'pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure] loop
  select pg_get_functiondef(oid),md5(btrim(replace(prosrc,E'\r\n',E'\n'),E' \t\r\n')),
   proacl,proconfig,proowner,prosecdef into definition,source_hash,old_acl,old_config,old_owner,old_definer
   from pg_proc where oid=target;
  if target='pos.h186_assert_sale(jsonb)'::regprocedure then
   if source_hash<>'d407201c699431f17ebd4da42b493b56' then raise exception 'H186_227_ASSERT_SOURCE_DRIFT'; end if;
   anchor:='if exists(select 1 from pos.layaway_liquidation_commits where operation_id=coalesce(p_command->>''saleOperationId'',p_command->>''operationId'')) then return; end if;';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_LIQUIDATION_ANCHOR'; end if;
   definition:=replace(definition,anchor,$replay$
   if exists(select 1 from pos.layaway_liquidation_commits where operation_id=coalesce(p_command->>'saleOperationId',p_command->>'operationId')) then
    -- H65 hashes amount/base but not commission_rows. H69 writes those rows
    -- again on replay, so V2 must compare the complete frozen snapshot first.
    if coalesce(p_command#>'{commissionSnapshot,amount}','0') is distinct from old_sale->'comision'
     or coalesce(p_command#>'{commissionSnapshot,base}','"neto"') is distinct from old_sale->'comision_base'
     or coalesce(p_command#>'{commissionSnapshot,rows}','[]') is distinct from old_sale->'comisiones' then
     raise exception 'FINANCIAL_FROZEN_COMMISSION_REPLAY_MISMATCH' using errcode='23514'; end if;
    return;
   end if;
$replay$||$liquidation$
   perform pos.h186_assert_commission_snapshot(jsonb_build_object(
    'comision',coalesce(p_command#>'{commissionSnapshot,amount}','0'),
    'comision_base',coalesce(p_command#>'{commissionSnapshot,base}','"neto"'),
    'comisiones',coalesce(p_command#>'{commissionSnapshot,rows}','[]')),
    coalesce(p_command->'sellerEffects','[]'));
$liquidation$);
   anchor:='''receipt_snapshot'',''items''];';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_FROZEN_ANCHOR'; end if;
   definition:=replace(definition,anchor,'''receipt_snapshot'',''items'',''comision'',''comision_base'',''comisiones''];');
   anchor:='  perform pos.h186_assert_payments(s,p_command->''payments'');';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_PAYMENT_ANCHOR'; end if;
   definition:=replace(definition,anchor,E'  if coalesce(p_command->''sellerEffects'',''[]''::jsonb) is distinct from ''[]''::jsonb then\n   raise exception ''FINANCIAL_FROZEN_COMMISSION_EFFECT_MISMATCH'' using errcode=''23514''; end if;\n'||anchor);
   anchor:=' request:=s->''financial_request'';';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_NEW_SALE_ANCHOR'; end if;
   definition:=replace(definition,anchor,E' perform pos.h186_assert_commission_snapshot(s,coalesce(p_command->''sellerEffects'',''[]''::jsonb));\n'||anchor);
  elsif target='pos.h186_persist_sale(jsonb)'::regprocedure then
   if source_hash<>'237f220363dcdf9bcda6264e9ea9bf40' then raise exception 'H186_227_PERSIST_SOURCE_DRIFT'; end if;
   anchor:='original_total=(s->>''original_total'')::numeric where folio=s->>''folio'';';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_PERSIST_ANCHOR'; end if;
   definition:=replace(definition,anchor,E'original_total=(s->>''original_total'')::numeric,\n   comisiones=case when p_command->>''mode''=''payment'' then comisiones else s->''comisiones'' end\n   where folio=s->>''folio'';');
  else
   if source_hash<>'fde6cd54450046221695d13291bc842e' then raise exception 'H186_227_DISPATCH_SOURCE_DRIFT'; end if;
   anchor:='if r->>''ok''=''true'' then perform pos.h186_persist_sale(p_command); end if;';
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'H186_227_RESPONSE_ANCHOR'; end if;
   definition:=replace(definition,anchor,$response$
   if r->>'ok'='true' then
    perform pos.h186_persist_sale(p_command);
    if exists(select 1 from pos.sales s where s.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio') and s.financial_version=2) then
     -- Delegates assembled their response before the final H69/H85/H94/H186
     -- persistence. Seal the receipt from the final rows, in their existing order.
     r:=r||jsonb_build_object(
      'sale',(select to_jsonb(s) from pos.sales s where s.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio')),
      'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from pos.sale_items i
        where i.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio')));
    end if;
   end if;
$response$);
  end if;
  execute definition;
  if exists(select 1 from pg_proc where oid=target and
   (proacl is distinct from old_acl or proconfig is distinct from old_config or proowner<>old_owner or prosecdef<>old_definer)) then
   raise exception 'H186_227_AUTHORITY_METADATA_DRIFT'; end if;
 end loop;
end $patch$;

-- Self-contained pure verification: no commercial DML, Auth or online-command
-- impersonation. Persistence is exercised through the isolated full dispatcher
-- regression; an already active online runtime must retain its write fence.
do $verify$
declare snapshot jsonb:='{"comision":1.25,"comision_base":"bruto","comisiones":[{"sellerId":"qa","base":25,"monto":1.25,"pct":5}]}';
 effects jsonb:='[{"id":"qa","comision_acum_delta":1.25,"ventas_mes_delta":25}]';
begin
 perform pos.h186_assert_commission_snapshot(snapshot,effects);
 begin
  perform pos.h186_assert_commission_snapshot(snapshot||'{"comision":1.24}',effects);
  raise exception 'H186_227_INVALID_TOTAL_ACCEPTED';
 exception when check_violation then
  if sqlerrm<>'FINANCIAL_COMMISSION_TOTAL_MISMATCH' then raise; end if;
 end;
 begin
  perform pos.h186_assert_commission_snapshot(snapshot,'[]');
  raise exception 'H186_227_MISSING_EFFECT_ACCEPTED';
 exception when check_violation then
  if sqlerrm<>'FINANCIAL_COMMISSION_EFFECT_MISMATCH' then raise; end if;
 end;
 if has_function_privilege('authenticated','pos.h186_assert_commission_snapshot(jsonb,jsonb)','execute')
  or has_function_privilege('anon','pos.h186_assert_commission_snapshot(jsonb,jsonb)','execute')
  or has_function_privilege('service_role','pos.h186_assert_commission_snapshot(jsonb,jsonb)','execute') then
  raise exception 'H186_227_HELPER_EXPOSED'; end if;
end $verify$;
commit;
