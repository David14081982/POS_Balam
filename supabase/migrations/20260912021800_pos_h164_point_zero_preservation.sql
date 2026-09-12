-- H164: distinguish resettable V2 stock/audit versions from protected configuration.
-- Generate from live authorities; keep both preservation guards and online fencing.
begin;
set local lock_timeout='10s';
do $point_zero_preservation$
declare f text; marker text; replacement text;
begin
 f:=pg_get_functiondef('pos.config_fingerprint()'::regprocedure);
 marker:='to_jsonb(x) - ''stock'' - ''sync_version''';
 replacement:='to_jsonb(x) - ''stock'' - ''stock_quantity'' - ''sync_version''';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_POINT_ZERO_STOCK_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.point_zero_preserved_hash()'::regprocedure);
 marker:='''updated_at'',''sync_base_version'',''sync_device_id'']';
 replacement:='''updated_at'',''sync_version'',''sync_base_version'',''sync_device_id'']';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_POINT_ZERO_SELLER_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.execute_point_zero(text,text,uuid,text,text,text)'::regprocedure);
 marker:='update pos.sync_devices set status=''must_rebootstrap'' where device_id is not null and status <> ''revoked'';';
 replacement:='if not (select enabled from pos.online_runtime where singleton) then '||marker||' end if;';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_POINT_ZERO_DEVICE_SOURCE_DRIFT'; end if;
 execute replace(f,marker,replacement);
end $point_zero_preservation$;
notify pgrst,'reload schema';
commit;
