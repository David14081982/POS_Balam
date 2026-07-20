-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — LIMPIAR DATOS DE PRUEBA (Supabase)                             ║
-- ║  Borra inventario, ventas, devoluciones, promociones, movimientos,          ║
-- ║  liquidaciones y CLIENTES de prueba. CONSERVA:                               ║
-- ║    • catálogos y configuración (pos.lookup, pos.settings): colores, telas,   ║
-- ║      tallas, receta del SKU, ajustes de la tienda.                           ║
-- ║    • usuarios/vendedores (pos.sellers): solo se ponen sus contadores en cero.║
-- ║    • el cliente genérico 'Público en general' (lo requiere el POS).          ║
-- ║  BORRA: todos los clientes registrados (excepto el genérico).                ║
-- ║                                                                              ║
-- ║  Cómo usar: Supabase → SQL Editor → pega TODO esto → Run.                     ║
-- ║  Es una transacción: o corre completo, o no cambia nada.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

begin;

-- 1) Vacía las tablas transaccionales y el inventario de prueba.
--    CASCADE arrastra sale_items/return_items (FK on delete cascade).
truncate table
  pos.sale_items,
  pos.sales,
  pos.return_items,
  pos.returns,
  pos.movements,
  pos.promotions,
  pos.liquidations,
  pos.products
restart identity cascade;

-- 2) Borra los clientes registrados; conserva SOLO el genérico de mostrador.
delete from pos.clients
  where generic is not true;

-- 3) Reinicia contadores del cliente genérico (por si acumuló compras en pruebas).
update pos.clients
  set compras = 0,
      total   = 0,
      ultima  = null
  where generic is true;

-- 4) Reinicia los acumulados de vendedores (comisiones y ventas del periodo a cero).
update pos.sellers
  set ventas_mes    = 0,
      ventas_num    = 0,
      comision_acum = 0;

commit;

-- Verificación rápida (deben dar 0 las de arriba; clients debe quedar en 1 = el genérico):
select 'products'     as tabla, count(*) from pos.products
union all select 'sales',        count(*) from pos.sales
union all select 'sale_items',   count(*) from pos.sale_items
union all select 'returns',      count(*) from pos.returns
union all select 'return_items', count(*) from pos.return_items
union all select 'movements',    count(*) from pos.movements
union all select 'promotions',   count(*) from pos.promotions
union all select 'liquidations', count(*) from pos.liquidations
union all select 'clients (solo genérico)', count(*) from pos.clients
union all select 'sellers (conservados)',   count(*) from pos.sellers
union all select 'lookup  (conservado)',    count(*) from pos.lookup
union all select 'settings(conservado)',    count(*) from pos.settings;
