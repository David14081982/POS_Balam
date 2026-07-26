-- H-10: semillas puente para que las verificaciones 020-026 sean ejecutables
-- en una instalación completamente limpia. La 030 las elimina al final.

insert into pos.products (
  id, cat, manga, tela, color, cuello, modelo, nombre, orn, orn_colors,
  precio, costo, pop, stock, sku, barcode_urls, attrs,
  sync_base_version, sync_device_id
) values (
  '__h10_clean_product__', '21', 'ML', 'ALG', 'BL', 'NOR', 'H10',
  'Producto puente H10', '—', '[]', 100, 50, false,
  '[{"talla":"M","escala":"L","stock":10}]',
  '__H10_CLEAN_PRODUCT__', '{}', '{}', 0, 'h10-clean-seed'
)
on conflict (id) do nothing;

insert into pos.clients (
  id, nombre, compras, total, generic, sync_base_version, sync_device_id
) values (
  '__h10_clean_client__', 'Cliente puente H10', 0, 0, false,
  0, 'h10-clean-seed'
)
on conflict (id) do nothing;
