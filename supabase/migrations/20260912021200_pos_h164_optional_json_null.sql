-- H164: JSON null is absence only for the four legacy SQL-optional objects.
-- Sale/discount/return client effects and exchange difference payment accept
-- SQL NULL. Required arrays, layaway payment, hashes, CAS and receipts retain
-- their exact contracts. CREATE OR REPLACE preserves owner and existing ACL.
begin;
set local lock_timeout='10s';

create or replace function pos.dispatch_online_command(p_request_id uuid,p_command jsonb,p_depth integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare
 k text:=p_command->>'type'; domain text:=p_command->>'kind'; r jsonb; x jsonb;
 m pos.system_manifest%rowtype; d text; a jsonb; n integer:=0; old_row jsonb; child_result jsonb;
begin
 if not pos.online_request_context() then raise exception 'ONLINE_COMMAND_REQUIRED' using errcode='42501'; end if;
 d:=pos.assert_online_device();
 select * into m from pos.system_manifest where singleton for share;
 if p_command ? 'accountRequestId' then p_command:=pos.online_account_profile_command(p_command); end if;
 case k
 when 'batch','sizeMigration' then
  if k='sizeMigration' and (exists(select 1 from pos.sales) or exists(select 1 from pos.returns)
   or exists(select 1 from pos.exchanges) or exists(select 1 from pos.loan_documents where deleted_at is null)
   or exists(select 1 from pos.movements) or exists(select 1 from pos.sale_payments)) then
   raise exception 'SIZE_MIGRATION_HAS_COMMERCIAL_HISTORY' using errcode='23514'; end if;
  if p_depth<>0 or jsonb_typeof(p_command->'commands')<>'array' or jsonb_array_length(p_command->'commands') not between 1 and 200 then
   raise exception 'INVALID_COMMAND_BATCH' using errcode='22023'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'commands') loop
   n:=n+1; r:=r||jsonb_build_array(pos.dispatch_online_command(md5(p_request_id::text||':'||n)::uuid,x,p_depth+1));
  end loop;
 when 'upsert' then
  if domain='products' then
   perform pos.online_check_rows('products',p_command->'rows');
   if coalesce((p_command->>'familyBatch')::boolean,false) then
    r:=pos.commit_reference_family_batch(p_request_id,(p_command->>'referenceFamilyId')::uuid,p_command->'rows',m.sync_protocol_current,m.data_epoch);
   else r:=pos.save_products_checked_v2(p_request_id,p_command->'rows',m.sync_protocol_current,m.data_epoch); end if;
  else r:=pos.online_save_entities(domain,p_command->'rows'); end if;
 when 'profileUpdate','staffUpdate' then
  if domain is distinct from 'sellers' then raise exception 'INVALID_PROFILE_KIND'; end if;
  r:=pos.online_save_entities('sellers',p_command->'rows');
 when 'softDelete' then
  if domain='products' then
   r:=pos.delete_product_checked_v2(p_request_id,p_command->>'val',(p_command->>'baseVersion')::bigint,d,m.sync_protocol_current,m.data_epoch);
  elsif domain in('clients','sellers','promotions') then
   perform pos.require_current_capability(case domain when 'clients' then 'customers.delete' when 'sellers' then 'sellers.manage' else 'promotions.manage' end);
   if domain='sellers' and exists(select 1 from pos.online_account_requests ar where ar.target_user_id::text=p_command->>'val'
     and ar.state not in('completed','rejected','cancelled')
     and ar.request_id::text is distinct from current_setting('pos.online_account',true)) then
    raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
   perform pos.online_check_rows(domain,jsonb_build_array(jsonb_build_object('id',p_command->>'val','sync_base_version',(p_command->>'baseVersion')::bigint)));
   r:=pos.soft_delete_entity(domain,p_command->>'val',(p_command->>'baseVersion')::bigint,d);
  else raise exception 'INVALID_DELETE_KIND'; end if;
 when 'productDeleteScope' then
  r:=pos.delete_products_checked_v2(p_request_id,p_command->>'scope',(p_command->>'referenceFamilyId')::uuid,
   p_command->'targets',d,m.sync_protocol_current,m.data_epoch);
 when 'clearInventory' then
  perform pos.require_current_capability('inventory.delete');
  if jsonb_typeof(p_command->'targets') is distinct from 'array' then raise exception 'INVALID_INVENTORY_DELETE_SCOPE'; end if;
  if (select count(*) from pos.products where deleted_at is null)<>jsonb_array_length(p_command->'targets')
   or exists(select 1 from pos.products p where p.deleted_at is null and not exists(
    select 1 from jsonb_array_elements(p_command->'targets') t where t->>'id'=p.id)) then
   raise exception 'INVENTORY_SCOPE_CHANGED' using errcode='40001'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'targets') order by value->>'id' loop
   n:=n+1;
   child_result:=pos.delete_products_checked_v2(md5(p_request_id::text||':'||n)::uuid,
    'reference',null,jsonb_build_array(x),d,m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'INVENTORY_DELETE_NOT_CONFIRMED'; end if;
   r:=r||jsonb_build_array(child_result);
  end loop;
 when 'config' then
  r:=pos.commit_config(p_request_id::text,(p_command->>'expectedVersion')::bigint,d,p_command->'lookup',p_command->'settings',m.sync_protocol_current,m.data_epoch);
  if r->>'ok'='false' then raise exception using message=coalesce(r->>'error','CONFIG_REJECTED'); end if;
  if jsonb_typeof(p_command->'productUpdates')='array' and jsonb_array_length(p_command->'productUpdates')>0 then
   perform pos.online_check_rows('products',p_command->'productUpdates');
   child_result:=pos.save_products_checked_v2(md5(p_request_id::text||':products')::uuid,p_command->'productUpdates',m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'CONFIG_PRODUCTS_NOT_CONFIRMED'; end if;
  end if;
 when 'sale' then
  if coalesce(p_command->>'mode','')<>'layaway_liquidation' then
   select to_jsonb(s) into old_row from pos.sales s where folio=p_command#>>'{header,folio}' for update;
   if p_command->>'mode'='payment' then
    a:=p_command->'expectedSale';
    if old_row is null or jsonb_typeof(a) is distinct from 'object'
     or not a ?& array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']
     or exists(select 1 from unnest(array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']) key
      where coalesce(old_row->key,'null'::jsonb) is distinct from coalesce(a->key,'null'::jsonb)) then
     raise exception 'SALE_VERSION_CONFLICT' using errcode='40001'; end if;
   elsif old_row is not null then
    raise exception 'SALE_ALREADY_EXISTS' using errcode='40001';
   else
    if p_command->'quoteContext' is distinct from pos.online_quote_context() then
     raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
    a:=p_command->'expectedProducts';
    if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
     or exists(select 1 from jsonb_array_elements(p_command->'items') line where not exists(
      select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
     raise exception 'SALE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
    for x in select value from jsonb_array_elements(a) order by value->>'id' loop
     if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
      and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
      raise exception 'SALE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
    end loop;
   end if;
  end if;
  if p_command->>'mode'='layaway_liquidation' then
   r:=pos.commit_layaway_liquidation_checked(p_request_id::text,coalesce(p_command->>'saleOperationId',p_command->>'operationId'),p_command->>'folio',
    p_command->'payment',coalesce(p_command->'sellerEffects','[]'),
    jsonb_build_object('item_identities',coalesce(p_command->'itemIdentities','[]'),
     'commission_amount',coalesce(p_command#>'{commissionSnapshot,amount}','0'),
     'commission_base',coalesce(p_command#>'{commissionSnapshot,base}','"neto"'),
     'commission_rows',coalesce(p_command#>'{commissionSnapshot,rows}','[]')));
  elsif jsonb_typeof(p_command#>'{header,descuentos_adicionales}')='array' then
   r:=pos.commit_sale_with_additional_discount_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'));
  else
   r:=pos.commit_sale_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'));
  end if;
 when 'return' then
  if coalesce((p_command->>'legacy')::boolean,false) then
   raise exception 'LEGACY_REPLAY_RETIRED' using errcode='22023';
  end if;
  r:=pos.commit_return_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),coalesce(p_command->'stockLines','[]'),nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'),false);
 when 'exchange' then
  if p_command->'quoteContext' is distinct from pos.online_quote_context() then
   raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
  a:=p_command->'expectedProducts';
  if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
   or exists(select 1 from jsonb_array_elements(p_command->'items') line where line->>'lado'='entregado' and not exists(
    select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
   raise exception 'EXCHANGE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(a) order by value->>'id' loop
   if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
    and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
    raise exception 'EXCHANGE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
  end loop;
  r:=pos.commit_exchange_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),nullif(p_command->'payment','null'::jsonb),coalesce(p_command->'seller_effects','[]'));
 when 'loanOperation' then
  if p_command->>'action' in('deliver','edit') and exists(
   select 1 from jsonb_array_elements(p_command#>'{loan,lineas}') line
   where not exists(select 1 from pos.products p where p.id=coalesce(line->>'productId',line->>'product_id') and p.deleted_at is null)
  ) then raise exception 'LOAN_PRODUCT_NOT_FOUND' using errcode='23514'; end if;
  r:=pos.commit_loan_operation(p_request_id,p_command->>'action',p_command->'loan',coalesce((p_command->>'expectedVersion')::bigint,0));
 when 'referenceReclassification' then
  r:=pos.commit_reference_reclassification(p_request_id::text,p_command->>'sourceProductId',p_command->>'targetProductId',
   (p_command->>'quantity')::integer,p_command->>'actor',p_command->>'reason',p_command->>'reversalOf');
 when 'commissionSettle' then r:=pos.settle_commission_checked(p_request_id,p_command->>'sellerId');
 when 'commissionClose' then r:=pos.close_commission_period_checked(p_request_id);
 when 'commissionAdjustment' then r:=pos.apply_commission_adjustment_checked(p_request_id,coalesce(p_command->'rows','[]'),coalesce(p_command->>'motivo',''));
 when 'folio' then
  r:=pos.reserve_folio_block(p_command->>'prefix',case when p_command->>'businessDate' ~ '^\d{6}$' then to_date(p_command->>'businessDate','YYMMDD') else (p_command->>'businessDate')::date end,1,coalesce((p_command->>'floor')::integer,0));
  if r->>'ok'='true' then r:=r||jsonb_build_object('folio',(r->>'prefix')||'-'||to_char((r->>'business_date')::date,'YYMMDD')||'-'||lpad(r->>'from',greatest(case when p_command->>'documentKind'='loan' then 3 else 4 end,length(r->>'from')),'0')); end if;
 when 'physicalCard','physicalCardClaim' then
  r:=to_jsonb(pos.claim_physical_card(p_command->>'folio',p_command->>'claimToken'));
 when 'deviceUpdate' then
  r:=to_jsonb(pos.admin_update_sync_device(p_command->>'deviceId',p_command->>'displayName',p_command->>'deviceType'));
 when 'deviceRetire' then
  r:=to_jsonb(pos.admin_set_sync_device_retired(p_command->>'deviceId',(p_command->>'retired')::boolean,p_command->>'note'));
 when 'pointZeroBackup' then
  r:=pos.create_point_zero_backup(p_command->>'previewToken',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'pointZero' then
  r:=pos.execute_point_zero(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'previewToken',
   (p_command->>'backupId')::uuid,p_command->>'confirmation',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanupBackup' then
  r:=pos.create_test_data_cleanup_backup(p_command->>'preset',p_command->'selection',p_command->>'planHash',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanup' then
  r:=pos.execute_test_data_cleanup(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'preset',p_command->'selection',
   p_command->>'planHash',(p_command->>'backupId')::uuid,p_command->>'confirmation',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'permissions' then
  a:=p_command->'args';
  if p_command->>'rpc'='admin_sync_screen_permission_catalog' then
   r:=to_jsonb(pos.admin_sync_screen_permission_catalog(a->'p_entries',(a->>'p_expected_version')::bigint));
  elsif p_command->>'rpc'='admin_apply_user_screen_permissions_checked' then
   r:=to_jsonb(pos.admin_apply_user_screen_permissions_checked((a->>'p_target_user_id')::uuid,a->>'p_role_code',a->'p_overrides',
    a->>'p_expected_version',array(select jsonb_array_elements_text(a->'p_screen_keys'))));
  else raise exception 'UNKNOWN_PERMISSION_COMMAND' using errcode='22023'; end if;
 else raise exception using errcode='22023',message='UNKNOWN_ONLINE_COMMAND',detail=coalesce(k,'null');
 end case;
 if r is null or r='false'::jsonb or r->>'ok'='false' then
  raise exception using errcode='P0001',message=coalesce(r->>'error','OPERATION_NOT_CONFIRMED'),detail=coalesce(r::text,'null');
 end if;
 return r;
end $$;
commit;
