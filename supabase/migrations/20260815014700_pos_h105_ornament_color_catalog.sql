-- H-105: ornament_color refleja color sin fusionar ambos catálogos.
begin;

do $$
declare
  v_operation_id constant text := 'h105-color-to-ornament-20260815-v1';
  v_before text;
  v_after text;
  v_version bigint;
  v_payload_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('pos.config',0));
  select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id),''))
    into v_before from pos.products p;

  if exists(select 1 from pos.config_commits where operation_id=v_operation_id) then
    if exists(select 1 from pos.lookup c where c.kind='color' and c.active
      and not exists(select 1 from pos.lookup o where o.kind='ornament_color'
        and o.code=c.code and o.label=c.label and o.active=c.active
        and o.meta=c.meta and o.sort_order=c.sort_order))
      or not exists(select 1 from pos.lookup where kind='ornament_color' and code='AZL' and not active)
      or exists(select 1 from pos.lookup where kind='ornament_color' and code='NE') then
      raise exception 'h105_idempotent_state_mismatch';
    end if;
    raise notice 'H105_ORNAMENT_COLOR already applied';
    return;
  end if;

  if exists(select 1 from pos.products p where
      coalesce(p.ornament_color_codes,'[]'::jsonb) @> '["NE"]'::jsonb
      or coalesce(p.orn_colors,'[]'::jsonb) @> '["NE"]'::jsonb
      or jsonb_path_exists(coalesce(p.attrs,'{}'::jsonb), '$.** ? (@ == "NE")')) then
    raise exception 'h105_ne_product_use_detected';
  end if;
  if not exists(select 1 from pos.lookup where kind='ornament_color' and code='AZL') then
    raise exception 'h105_azl_legacy_lookup_missing';
  end if;

  insert into pos.lookup(kind,code,label,active,meta,sort_order,updated_at)
  select 'ornament_color',code,label,active,meta,sort_order,now()
  from pos.lookup where kind='color'
  on conflict(kind,code) do update set label=excluded.label,active=excluded.active,
    meta=excluded.meta,sort_order=excluded.sort_order,updated_at=now();

  update pos.lookup set active=false,updated_at=now()
    where kind='ornament_color' and code='AZL';
  delete from pos.lookup where kind='ornament_color' and code='NE';

  select version into v_version from pos.config_sync_state where singleton for update;
  update pos.config_sync_state set version=version+1,updated_at=now()
    where singleton returning version into v_version;
  v_payload_hash := md5((select coalesce(jsonb_agg(to_jsonb(l) - 'updated_at' order by code)::text,'[]')
    from pos.lookup l where kind in ('color','ornament_color')));
  insert into pos.config_commits(operation_id,payload_hash,committed_version,device_id)
    values(v_operation_id,v_payload_hash,v_version,'migration-h105');

  select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id),''))
    into v_after from pos.products p;
  if v_before <> v_after then raise exception 'h105_products_changed'; end if;
end $$;

commit;
