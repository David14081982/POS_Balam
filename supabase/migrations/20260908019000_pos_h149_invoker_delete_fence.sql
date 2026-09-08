-- H149: preserve invoker RLS. The BEFORE ROW trigger fences soft deletes,
-- which have no early idempotent ACK. No helper execute grant or elevation.
begin;
do $guard$ begin if md5(pg_get_functiondef('pos.soft_delete_entity(text,text,bigint,text)'::regprocedure))<>'3f6ccc429f1129cd5e5e8c562a8d8583' then raise exception 'H149 invoker drift'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.soft_delete_entity(p_entity text, p_id text, p_base_version bigint, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  result jsonb;
begin
  if p_entity not in ('products', 'clients', 'sellers', 'promotions') then
    raise exception 'Entidad no permitida: %', p_entity;
  end if;

  execute format(
    'update pos.%I
       set deleted_at = now(),
           sync_base_version = $2,
           sync_device_id = $3
     where id = $1
     returning to_jsonb(%I.*)',
    p_entity, p_entity
  ) into result using p_id, coalesce(p_base_version, 0), p_device_id;

  return result;
end;
$function$
;
commit;
