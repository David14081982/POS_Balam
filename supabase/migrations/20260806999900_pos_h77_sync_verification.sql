-- H-77: verificación autocontenida de objetos, permisos y defensas.
begin;

do $$
declare v_count integer; v_version bigint;
begin
  if not exists(select 1 from pos.system_manifest where singleton
      and sync_protocol_min=1 and sync_protocol_current>=sync_protocol_min
      and data_epoch>0) then
    raise exception 'h77_manifest_missing';
  end if;
  select count(*) into v_count from pos.sync_domain_versions;
  if v_count < 14 then raise exception 'h77_domains_missing: %',v_count; end if;
  if has_table_privilege('anon','pos.system_manifest','select')
     or has_table_privilege('anon','pos.sync_domain_versions','select')
     or has_table_privilege('anon','pos.sync_devices','select') then
    raise exception 'h77_anon_sync_access';
  end if;
  if has_table_privilege('authenticated','pos.lookup','insert')
     or has_table_privilege('authenticated','pos.lookup','update')
     or has_table_privilege('authenticated','pos.lookup','delete')
     or has_table_privilege('authenticated','pos.settings','insert') then
    raise exception 'h77_direct_config_write';
  end if;
  if has_function_privilege('authenticated','pos.bump_sync_domain(text,text)','execute')
     or has_function_privilege('authenticated','pos.touch_sync_domain()','execute') then
    raise exception 'h77_internal_function_exposed';
  end if;
  if not has_function_privilege('authenticated',
      'pos.commit_config(text,bigint,text,jsonb,jsonb,integer,bigint)','execute') then
    raise exception 'h77_commit_config_not_executable';
  end if;
  if has_function_privilege('authenticated','pos.save_products_checked(uuid,jsonb)','execute')
     or has_function_privilege('authenticated','pos.delete_product_checked(uuid,text,bigint,text)','execute') then
    raise exception 'h77_legacy_inventory_write_exposed';
  end if;
  if not has_function_privilege('authenticated',
      'pos.save_products_checked_v2(uuid,jsonb,integer,bigint)','execute')
     or not has_function_privilege('authenticated',
      'pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint)','execute') then
    raise exception 'h77_epoch_inventory_write_missing';
  end if;
  if not has_function_privilege('authenticated',
      'pos.establish_sync_point_zero(integer,bigint)','execute') then
    raise exception 'h77_point_zero_missing';
  end if;
  if not exists(select 1 from pos.inventory_sync_baselines where false) then
    -- La consulta tipada demuestra que la tabla existe sin requerir una linea base previa.
    null;
  end if;
  v_version := pos.bump_sync_domain('config','h77-verification');
  if v_version < 1 then raise exception 'h77_bump_sync_domain_failed'; end if;
  if not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='pos' and c.relname='products'
        and t.tgname='h77_sync_products' and not t.tgisinternal) then
    raise exception 'h77_touch_sync_domain_trigger_missing';
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='pos'
         and tablename='sync_domain_versions') then
    raise exception 'h77_realtime_publication_missing';
  end if;
end $$;

rollback;
