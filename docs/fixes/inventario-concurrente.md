# Reserva atómica de inventario concurrente

**Riesgo:** H-01
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Dos vendedores temporales leyeron una pieza con `sync_version=1`. Ambas ventas
se insertaron con HTTP 201. El primer snapshot dejó stock 0 y versión 2; el
segundo conflicto conservó esa misma fila, pero no invalidó la segunda venta.
Supabase terminó con dos ventas autoritativas para una sola pieza.

## Causa raíz

`DATA.recordSale()` descontaba localmente y disparaba dos rutas independientes:
un snapshot de productos y una operación de venta. `STORE` insertaba la venta
sin consultar el inventario remoto. El control optimista de H-06 evitaba que un
snapshot obsoleto sobrescribiera el producto, pero no relacionaba ese conflicto
con la venta ya persistida.

## Diseño

- Primera reserva confirmada gana.
- Bloqueo de filas y validación de todas las tallas antes de modificar.
- Descuento por delta, no por snapshot completo.
- `operation_id` estable para reintentos idempotentes.
- Venta cobrada nueva inválida sin reserva coincidente.
- Apartado sin descuento hasta su liquidación.
- Venta offline sin stock remoto: permanece recuperable en cola y se marca
  `stock_pending`.
- Compatibilidad con ventas históricas y operaciones antiguas en cola.

## Solución

- `balam/data.jsx` conserva el cambio local pero no envía el snapshot de
  productos durante una venta; agrega `productId`, `operation_id` local y
  estado de sincronización.
- `balam/store.jsx` reserva stock antes de insertar, reconcilia versiones,
  conserva rechazos recuperables y migra operaciones de venta antiguas.
- `20260725001700_pos_atomic_stock_reservation.sql` crea
  `pos.stock_reservations`, `pos.reserve_sale_stock()` y elimina el UPDATE
  directo de productos para vendedores.
- `20260725001800_pos_require_stock_reservation.sql` agrega
  `sales.operation_id` y el trigger que impide ventas cobradas nuevas sin
  reserva.
- Los artefactos `index.html` y `POS Balam (offline).html` fueron regenerados.

## Pruebas

Supabase real:

- dos RPC concurrentes sobre stock 1: exactamente uno `ok=true` y uno
  `insufficient_stock`;
- venta ganadora: HTTP 201;
- venta perdedora sin reserva: HTTP 400;
- reintento ganador: `ok=true`, `idempotent=true`;
- PATCH directo de vendedor: respuesta vacía y stock sin cambios;
- resultado final: stock 0, `sync_version=2`, una venta autoritativa;
- migraciones 017 y 018 presentes local y remotamente;
- cero cuentas, perfiles, productos, ventas o reservas temporales restantes.

Regresiones:

- `node test-store-queue.mjs`: 42/42;
- `node test-concurrency.mjs`: 9/9;
- `node test-sale-coherence.mjs`: 15/15;
- `node test-commission.mjs`: 10/10;
- `node test-role-access.mjs`: 10/10;
- `node build-offline.mjs`: correcto.

`test-returns.mjs` y `test-liquidations.mjs` no iniciaron por timeout al cargar
dependencias de navegador; no reportaron un fallo de dominio.

## Riesgo residual y pendientes

Una venta offline perdedora continúa visible localmente como
`stock_pending` y permanece en cola. Puede confirmarse cuando se reponga stock;
no se inserta remotamente mientras sea insuficiente.

La venta y la devolución completas quedaron integradas posteriormente en las
transacciones de H-04. La colisión del folio visible quedó resuelta
posteriormente en H-02.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-01--inventario-concurrente`
- Arquitectura: `docs/02-architecture.md#reserva-atómica-de-stock`
