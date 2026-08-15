-- H-105: contrato final, sin fixtures persistentes.
begin;
do $$
declare v_colors bigint; v_active bigint; v_total bigint;
begin
  select count(*) filter(where active) into v_colors from pos.lookup where kind='color';
  select count(*) filter(where active),count(*) into v_active,v_total from pos.lookup where kind='ornament_color';
  if v_active <> v_colors or v_total <> v_colors + 1 then
    raise exception 'h105_catalog_counts color=% active=% total=%',v_colors,v_active,v_total;
  end if;
  if exists(select 1 from pos.lookup c where c.kind='color' and c.active
    and not exists(select 1 from pos.lookup o where o.kind='ornament_color'
      and o.code=c.code and o.label=c.label and o.active=c.active
      and o.meta=c.meta and o.sort_order=c.sort_order)) then
    raise exception 'h105_catalog_projection_mismatch';
  end if;
  if not exists(select 1 from pos.lookup where kind='ornament_color' and code='AZL' and not active)
     or exists(select 1 from pos.lookup where kind='ornament_color' and code='NE') then
    raise exception 'h105_alias_contract_failed';
  end if;
  if not exists(select 1 from pos.config_commits where operation_id='h105-color-to-ornament-20260815-v1') then
    raise exception 'h105_config_commit_missing';
  end if;
end $$;
commit;
