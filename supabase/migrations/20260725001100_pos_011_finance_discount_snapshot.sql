-- Regla de Finanzas: conservar el descuento y los precios que explican el total.
-- No actualiza ventas históricas; sus nuevos campos permanecen NULL.
alter table pos.sales
  add column if not exists descuento numeric(12,2);

alter table pos.sale_items
  add column if not exists precio_base numeric(12,2),
  add column if not exists precio_original numeric(12,2);

alter table pos.sales
  drop constraint if exists sales_discount_valid,
  add constraint sales_discount_valid check (descuento is null or descuento >= 0);

alter table pos.sale_items
  drop constraint if exists sale_items_prices_valid,
  add constraint sale_items_prices_valid check (
    (precio_base is null or precio_base >= 0)
    and (precio_original is null or precio_original >= 0)
  );
