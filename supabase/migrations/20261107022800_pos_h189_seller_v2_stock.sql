-- H-189: exact one-function patch. No commercial DML, ACL, RLS or trigger changes.
-- PREPARED ONLY. Remote deployment requires the owner's separate authorization.
begin;
set local lock_timeout='5s';
do $h189$
declare
  prior pg_proc%rowtype; actual pg_proc%rowtype; body text;
begin
  select * into strict prior from pg_proc where oid='pos.restrict_seller_product_update()'::regprocedure;
  body := replace(pg_get_functiondef(prior.oid),E'\r\n',E'\n');
  if md5(body) not in ('d46ec34ee3d2c1cd47870fbc757e65a5','605bf2f7add6117c0cd17436e3945c32') then raise exception 'H189_GUARD_SOURCE_DRIFT'; end if;
  if md5(body)='d46ec34ee3d2c1cd47870fbc757e65a5' then
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
  end if;
  select * into strict actual from pg_proc where oid=prior.oid;
  if md5(replace(pg_get_functiondef(actual.oid),E'\r\n',E'\n'))<>'605bf2f7add6117c0cd17436e3945c32'
    or actual.proowner is distinct from prior.proowner or actual.proacl is distinct from prior.proacl
    or actual.prosecdef is distinct from prior.prosecdef or actual.proconfig is distinct from prior.proconfig
  then raise exception 'H189_GUARD_CONTRACT_DRIFT'; end if;
end $h189$;
commit;
