-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — BORRAR DATOS DE PRUEBA (Supabase)  ·  CONSERVA EL INVENTARIO    ║
-- ║                                                                              ║
-- ║  BORRA:  ventas + sus renglones, devoluciones + sus renglones, descuentos/   ║
-- ║          promociones, liquidaciones de comisión, los movimientos de tipo     ║
-- ║          'Venta' y 'Devolución', y los clientes registrados.                 ║
-- ║                                                                              ║
-- ║  CONSERVA:                                                                   ║
-- ║    • pos.products  → INVENTARIO INTACTO (productos, precios, costos, fotos,  ║
-- ║      códigos de barras y stock). Esta versión NO lo toca.                     ║
-- ║    • pos.movements de tipo 'Entrada' / 'Ajuste' / 'Transferencia' → historial ║
-- ║      de cómo se cargó el inventario.                                          ║
-- ║    • pos.sellers   → usuarios/vendedores; solo se ponen sus acumulados a cero.║
-- ║    • pos.lookup / pos.settings → catálogos y configuración de la tienda.      ║
-- ║    • el cliente genérico 'Público en general' (lo requiere el POS).           ║
-- ║                                                                              ║
-- ║  ⚠ ESTO SOLO LIMPIA LA NUBE. El POS es local-first: cada navegador guarda su  ║
-- ║  propia copia y, cuando la nube llega vacía, la app NO borra lo local (a      ║
-- ║  propósito, ver store.jsx → pullDomain). Después de correr esto, entra al POS ║
-- ║  en CADA dispositivo donde probaste y pulsa:                                  ║
-- ║      Configuración → Simulación → "Borrar datos de prueba"                     ║
-- ║  Ese botón vacía lo local y devuelve al stock las piezas de las ventas de     ║
-- ║  prueba. Sin él, las pruebas reaparecen y pueden re-subirse a la nube.        ║
-- ║                                                                              ║
-- ║  Cómo usar: Supabase → SQL Editor → pega TODO esto → Run.                     ║
-- ║  Es una transacción: o corre completo, o no cambia nada.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

begin;

-- 1) Ventas y devoluciones. CASCADE arrastra sale_items/return_items (FK on delete
--    cascade). NO se incluye pos.products: el inventario se queda como está.
truncate table
  pos.sale_items,
  pos.sales,
  pos.return_items,
  pos.returns
restart identity cascade;

-- 2) Descuentos/promociones y liquidaciones de comisión de las pruebas.
truncate table
  pos.promotions,
  pos.liquidations
restart identity;

-- 3) Movimientos: SOLO los que generan las ventas y devoluciones. Los de tipo
--    'Entrada', 'Ajuste' y 'Transferencia' son historial de inventario y se conservan.
delete from pos.movements
  where tipo in ('Venta', 'Devolución');

-- 4) Clientes registrados en las pruebas; se conserva SOLO el genérico de mostrador.
--    (Va después del truncate de ventas: pos.sales.cliente_id los referencia.)
delete from pos.clients
  where generic is not true;

-- 5) Contadores del cliente genérico a cero (acumuló compras durante las pruebas).
update pos.clients
  set compras = 0,
      total   = 0,
      ultima  = null
  where generic is true;

-- 6) Acumulados de vendedores a cero (ventas del periodo y comisión de las pruebas).
--    El usuario, su contraseña, su % de comisión y su meta NO se tocan.
update pos.sellers
  set ventas_mes    = 0,
      ventas_num    = 0,
      comision_acum = 0;

commit;

-- ── Verificación ────────────────────────────────────────────────────────────────
-- Deben quedar en 0: sales, sale_items, returns, return_items, promotions,
-- liquidations y movimientos de venta/devolución.  clients = 1 (el genérico).
-- products debe conservar TU número de productos (NO cero).
select 'sales (0)'                as tabla, count(*) from pos.sales
union all select 'sale_items (0)',          count(*) from pos.sale_items
union all select 'returns (0)',             count(*) from pos.returns
union all select 'return_items (0)',        count(*) from pos.return_items
union all select 'promotions (0)',          count(*) from pos.promotions
union all select 'liquidations (0)',        count(*) from pos.liquidations
union all select 'movs venta/devol (0)',    count(*) from pos.movements where tipo in ('Venta','Devolución')
union all select 'clients (1 = genérico)',  count(*) from pos.clients
union all select '--- CONSERVADOS ---',     0
union all select 'products (tu inventario)',count(*) from pos.products
union all select 'movs de inventario',      count(*) from pos.movements
union all select 'sellers',                 count(*) from pos.sellers
union all select 'lookup (catálogos)',      count(*) from pos.lookup
union all select 'settings (config)',       count(*) from pos.settings;
