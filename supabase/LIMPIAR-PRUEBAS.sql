-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — BORRAR DATOS DE PRUEBA  ·  CONSERVA EL INVENTARIO               ║
-- ║                                                                              ║
-- ║  Lo normal es hacerlo desde la app:                                          ║
-- ║      Configuración → Datos de demostración → «Borrar datos de prueba»        ║
-- ║  Ese botón llama exactamente a lo mismo que este archivo y además limpia la   ║
-- ║  terminal en el acto. Esto es el camino de respaldo (H-68).                   ║
-- ║                                                                              ║
-- ║  BORRA, dentro de UNA transacción: ventas y sus renglones, cobros y abonos,   ║
-- ║  apartados, devoluciones, cambios, préstamos, comisiones liquidadas y         ║
-- ║  cierres, reservas de inventario, diarios de confirmación, canjes de tarjeta  ║
-- ║  física, conflictos de sincronización, el consecutivo diario del folio, los   ║
-- ║  movimientos de venta/devolución/cambio y los clientes de prueba.             ║
-- ║                                                                              ║
-- ║  CONSERVA, y lo COMPRUEBA con una huella tomada antes y después:              ║
-- ║    • pos.products     → inventario, precios, costos, fotos, códigos y tallas. ║
-- ║      Sólo se RESTAURAN las existencias que las operaciones borradas movieron. ║
-- ║    • pos.promotions   → descuentos y beneficios configurados.                 ║
-- ║    • pos.sellers      → usuarios, contraseñas, % de comisión, metas y nivel;  ║
-- ║      sólo se ponen en cero sus acumulados del periodo.                        ║
-- ║    • pos.lookup / pos.settings → catálogos y configuración de la tienda.      ║
-- ║    • permisos y capacidades (H-56) completos.                                 ║
-- ║    • movimientos de tipo 'Entrada' / 'Ajuste' / 'Transferencia'.              ║
-- ║    • el cliente genérico 'Público en general' (con sus contadores en cero).   ║
-- ║  Si algo de eso cambiara, la limpieza ENTERA se deshace sola.                 ║
-- ║                                                                              ║
-- ║  LAS DEMÁS TERMINALES SE LIMPIAN SOLAS, incluidas las que estén APAGADAS: la  ║
-- ║  limpieza sella una ÉPOCA que cada equipo lee al encender, ANTES de subir su  ║
-- ║  cola pendiente. Con eso invalida sus operaciones de datos ya borrados, se    ║
-- ║  limpia y restaura su inventario. Y si alguna se escapara, las lápidas de     ║
-- ║  pos.purged_documents impiden que el documento vuelva a insertarse.           ║
-- ║                                                                              ║
-- ║  Cómo usar: Supabase → SQL Editor → pega TODO esto → Run.                     ║
-- ║  Requiere haber aplicado la migración 20260802010500_pos_h68_purge_test_data. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- El identificador hace la operación idempotente: si vuelves a correr el MISMO
-- id, devuelve el informe original y no borra ni restaura otra vez. Para una
-- limpieza nueva, cambia el texto (o usa gen_random_uuid()::text).
select jsonb_pretty(pos.purge_test_data(gen_random_uuid()::text));

-- ── Verificación ────────────────────────────────────────────────────────────
-- El informe de arriba ya trae `verificacion` (todo en cero), `piezas_antes` /
-- `piezas_despues` y `config_intacta`. Esto lo confirma desde fuera.
select 'ventas (0)'                as tabla, count(*) from pos.sales
union all select 'renglones venta (0)',      count(*) from pos.sale_items
union all select 'cobros y abonos (0)',      count(*) from pos.sale_payments
union all select 'devoluciones (0)',         count(*) from pos.returns
union all select 'cambios (0)',              count(*) from pos.exchanges
union all select 'préstamos (0)',            count(*) from pos.loan_documents
union all select 'comisiones (0)',           count(*) from pos.liquidations
union all select 'reservas (0)',             count(*) from pos.stock_reservations
union all select 'movs venta/devol/cambio (0)', count(*) from pos.movements
  where tipo in ('Venta','Devolución','Cambio (entra)','Cambio (sale)')
union all select 'clientes de prueba (0)',   count(*) from pos.clients
  where generic is not true and deleted_at is null
union all select '--- CONSERVADOS ---',      0
union all select 'productos (tu inventario)',count(*) from pos.products where deleted_at is null
union all select 'piezas en existencia',     pos.total_stock_pieces()
union all select 'descuentos configurados',  count(*) from pos.promotions where deleted_at is null
union all select 'movs de inventario',       count(*) from pos.movements
union all select 'vendedores',               count(*) from pos.sellers
union all select 'lookup (catálogos)',       count(*) from pos.lookup
union all select 'settings (config)',        count(*) from pos.settings;
