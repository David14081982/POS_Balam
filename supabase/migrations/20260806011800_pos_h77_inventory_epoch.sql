-- H-77: las escrituras administrativas de inventario deben pertenecer a la
-- misma epoca y protocolo que el servidor. Las funciones historicas quedan
-- como implementacion interna para conservar toda su semantica estabilizada.

create or replace function pos.assert_sync_write_context(
  p_protocol_version integer,
  p_data_epoch bigint
) returns void
language plpgsql
security definer
set search_path = pg_catalog, pos
as $$
declare v_manifest pos.system_manifest%rowtype;
begin
  select * into v_manifest from pos.system_manifest where singleton for share;
  if not found then raise exception 'sync_manifest_missing'; end if;
  if p_protocol_version < v_manifest.sync_protocol_min
     or p_protocol_version > v_manifest.sync_protocol_current then
    raise exception 'sync_protocol_incompatible';
  end if;
  if p_data_epoch <> v_manifest.data_epoch then
    raise exception 'sync_epoch_mismatch';
  end if;
end;
$$;

create or replace function pos.save_products_checked_v2(
  p_operation_id uuid,
  p_rows jsonb,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pos
as $$
begin
  perform pos.assert_sync_write_context(p_protocol_version,p_data_epoch);
  return pos.save_products_checked(p_operation_id,p_rows);
end;
$$;

create or replace function pos.delete_product_checked_v2(
  p_operation_id uuid,
  p_id text,
  p_base_version bigint,
  p_device_id text,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pos
as $$
begin
  perform pos.assert_sync_write_context(p_protocol_version,p_data_epoch);
  return pos.delete_product_checked(
    p_operation_id,p_id,p_base_version,p_device_id
  );
end;
$$;

revoke all on function pos.assert_sync_write_context(integer,bigint) from public,anon,authenticated;
revoke all on function pos.save_products_checked(uuid,jsonb) from authenticated;
revoke all on function pos.delete_product_checked(uuid,text,bigint,text) from authenticated;
revoke all on function pos.save_products_checked_v2(uuid,jsonb,integer,bigint) from public,anon;
revoke all on function pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint) from public,anon;
grant execute on function pos.save_products_checked_v2(uuid,jsonb,integer,bigint) to authenticated;
grant execute on function pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint) to authenticated;
