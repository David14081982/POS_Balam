-- H-132 · Snapshot exhaustivo read-only para el certificador de identidad.
select
  p.id::text,
  p.record_model,
  p.reference_family_id::text,
  p.cat,
  p.manga,
  p.tela,
  p.color,
  p.cuello,
  p.modelo,
  p.nombre,
  p.orn,
  p.orn_colors,
  p.ornament_color_codes,
  p.precio,
  p.costo,
  p.stock,
  p.stock_quantity,
  p.size_code,
  p.size_scale,
  p.size_category_id,
  p.sku,
  p.barcode_code,
  p.barcode_contract,
  p.barcode_aliases,
  p.physical_signature,
  p.attrs,
  coalesce((
    select jsonb_agg(distinct s.talla order by s.talla)
    from pos.sale_items s
    where s.product_id = p.id and nullif(btrim(coalesce(s.talla, '')), '') is not null
  ), '[]'::jsonb) as historical_size_codes,
  p.sync_version,
  p.deleted_at
from pos.products p
where p.deleted_at is null
order by p.id;
