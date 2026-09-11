-- H-155: ordering an existing multiselection does not reclassify a reference.
-- No data backfill. Keep NEW: the existing RPC/ACK compares the submitted payload.
begin;
set local lock_timeout = '10s';

do $h155$
declare
  v_oid regprocedure := 'pos.h94_guard_used_reference_identity()'::regprocedure;
  v_before text; v_after text; v_body text; v_metadata jsonb;
  v_from text := 'new.ornament_color_codes is distinct from old.ornament_color_codes';
  v_to text := $replacement$case
         when jsonb_typeof(new.ornament_color_codes) = 'array'
          and jsonb_typeof(old.ornament_color_codes) = 'array' then
           case when exists(select 1 from jsonb_array_elements(new.ornament_color_codes) c(value)
                              where jsonb_typeof(c.value) is distinct from 'string')
                       or exists(select 1 from jsonb_array_elements(old.ornament_color_codes) c(value)
                              where jsonb_typeof(c.value) is distinct from 'string')
             then new.ornament_color_codes is distinct from old.ornament_color_codes
             else (select jsonb_agg(c.value order by c.value) from jsonb_array_elements(new.ornament_color_codes) c(value))
                    is distinct from
                  (select jsonb_agg(c.value order by c.value) from jsonb_array_elements(old.ornament_color_codes) c(value))
           end
         else new.ornament_color_codes is distinct from old.ornament_color_codes
       end$replacement$;
begin
  select pg_get_functiondef(p.oid), p.prosrc,
    jsonb_build_object('owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,
      'config',p.proconfig,'language',p.prolang,'returns',p.prorettype,'args',p.proargtypes::text)
    into v_before,v_body,v_metadata from pg_proc p where p.oid=v_oid;
  -- Audited H-133 body. Fail closed if a later correction changed any other guard.
  if md5(btrim(replace(v_body,E'\r\n',E'\n'),E' \t\r\n')) <> 'e6d8ff1ec5c58b16e8520787b7e5b006'
     or (length(v_before)-length(replace(v_before,v_from,'')))/length(v_from) <> 1 then
    raise exception 'H155_IDENTITY_GUARD_SOURCE_DRIFT';
  end if;
  v_after := replace(v_before,v_from,v_to);
  execute v_after;
  if v_metadata is distinct from (select jsonb_build_object(
      'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,
      'language',p.prolang,'returns',p.prorettype,'args',p.proargtypes::text)
      from pg_proc p where p.oid=v_oid) then
    raise exception 'H155_IDENTITY_GUARD_METADATA_CHANGED';
  end if;
end;
$h155$;
commit;
