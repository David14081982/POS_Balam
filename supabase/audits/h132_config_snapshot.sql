-- H-132 · Autoridad CONFIG necesaria para derivar SKU/firma igual que BALAM.
with catalog_rows as (
  select kind, jsonb_agg(jsonb_build_object(
    'code', code,
    'label', label,
    'active', active,
    'meta', coalesce(meta, '{}'::jsonb)
  ) order by sort_order, code) as items
  from pos.lookup
  group by kind
), catalogs as (
  select coalesce(jsonb_object_agg(kind, items), '{}'::jsonb) value
  from catalog_rows
), config_settings as (
  select coalesce(jsonb_object_agg(key, value) filter (where key not in ('_catalogMeta', 'store.logo')), '{}'::jsonb) value
  from pos.settings
), catalog_meta as (
  select coalesce((select value from pos.settings where key = '_catalogMeta'), '{}'::jsonb) value
)
select jsonb_build_object(
  'v', 1,
  'catalogs', catalogs.value,
  'catalogMeta', catalog_meta.value,
  'settings', config_settings.value
) as config
from catalogs, config_settings, catalog_meta;
