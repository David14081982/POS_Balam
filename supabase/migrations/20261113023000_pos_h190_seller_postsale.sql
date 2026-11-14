-- H190: one trigger function and two read policies, installed atomically.
-- Generated from the live H189 definition; its sale branch is byte-for-byte intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $h190$
declare prior pg_proc%rowtype; actual pg_proc%rowtype;
begin
  select * into strict prior from pg_proc where oid='pos.restrict_seller_product_update()'::regprocedure;
  if md5(replace(pg_get_functiondef(prior.oid),E'\r\n',E'\n'))<>'605bf2f7add6117c0cd17436e3945c32'
  then raise exception 'H190_GUARD_SOURCE_DRIFT'; end if;
  execute $definition$CREATE OR REPLACE FUNCTION pos.restrict_seller_product_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  compared_new jsonb := to_jsonb(new);
  compared_old jsonb := to_jsonb(old);
begin
  -- H189: only the private sale reservation's decrement may normalize the V2 mirror.
  -- This function remains SECURITY INVOKER: a direct authenticated UPDATE never
  -- inherits the reservation owner's identity. A client GUC alone is insufficient.
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.reserve_sale_stock(text,text,jsonb)'::regprocedure))
     and new.stock_quantity >= 0 and new.stock_quantity < old.stock_quantity
     and new.sync_device_id like 'sale:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'sale'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  -- H190: private post-sale transactions may normalize their V2 stock mirror.
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure))
     and new.stock_quantity >= 0 and new.stock_quantity > old.stock_quantity
     and new.sync_device_id like 'return:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'return'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))
     and new.stock_quantity >= 0
     and new.sync_device_id like 'exchange:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'exchange'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  if pos.is_active_seller() and not pos.is_active_admin() and
     (compared_new - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) is distinct from
     (compared_old - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) then
    raise exception 'El vendedor sólo puede actualizar existencias'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
$definition$;
  select * into strict actual from pg_proc where oid=prior.oid;
  if md5(replace(pg_get_functiondef(actual.oid),E'\r\n',E'\n'))<>'d250cdd879860bf1cb3014b5b38b1310'
    or actual.proowner is distinct from prior.proowner or actual.proacl is distinct from prior.proacl
    or actual.prosecdef is distinct from prior.prosecdef or actual.proconfig is distinct from prior.proconfig
  then raise exception 'H190_GUARD_CONTRACT_DRIFT'; end if;
end $h190$;
create policy h190_refund_select on pos.returns for select to authenticated
  using (pos.current_has_capability('sales.refund'));
create policy h190_refund_select on pos.return_items for select to authenticated
  using (pos.current_has_capability('sales.refund'));
-- Verify the complete boundary before this transaction commits.
do $h190_verify$
declare relation text; signature text;
begin
  if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n'))<>'d250cdd879860bf1cb3014b5b38b1310'
    or (select prosecdef from pg_proc where oid='pos.restrict_seller_product_update()'::regprocedure)
  then raise exception 'H190_GUARD_NOT_VERIFIED'; end if;
  foreach relation in array array['products','returns','return_items','online_requests'] loop
    if not (select relrowsecurity from pg_class where oid=('pos.'||relation)::regclass)
      or has_table_privilege('authenticated','pos.'||relation,'insert,update,delete,truncate')
      or has_any_column_privilege('authenticated','pos.'||relation,'insert,update')
      or has_table_privilege('anon','pos.'||relation,'select,insert,update,delete,truncate')
      or has_any_column_privilege('anon','pos.'||relation,'select,insert,update')
    then raise exception 'H190_TABLE_BOUNDARY_DRIFT: %',relation; end if;
  end loop;
  foreach relation in array array['returns','return_items'] loop
    if not has_table_privilege('authenticated','pos.'||relation,'select')
      or not exists(select 1 from pg_policies where schemaname='pos' and tablename=relation
        and policyname='h190_refund_select' and cmd='SELECT' and permissive='PERMISSIVE'
        and roles=array['authenticated']::name[] and qual='pos.current_has_capability(''sales.refund''::text)' and with_check is null)
    then raise exception 'H190_READ_POLICY_DRIFT: %',relation; end if;
  end loop;
  foreach signature in array array[
    'pos.reserve_sale_stock(text,text,jsonb)',
    'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'pos.online_request_context()'
  ] loop
    if has_function_privilege('authenticated',signature,'execute')
      or has_function_privilege('anon',signature,'execute')
      or not (select prosecdef from pg_proc where oid=signature::regprocedure)
    then raise exception 'H190_PRIVATE_TRANSACTION_DRIFT: %',signature; end if;
  end loop;
  if not has_function_privilege('authenticated','pos.execute_online_command(uuid,jsonb)','execute')
    or (select count(*) from pg_trigger where tgrelid='pos.products'::regclass
      and tgname in('products_restrict_seller_update','h94_sync_v2_stock_shape','h164_online_authority','products_guard_entity_version') and tgenabled='O')<>4
  then raise exception 'H190_GATEWAY_OR_TRIGGER_DRIFT'; end if;
end $h190_verify$;
commit;
