# Sistema de comprobantes históricos

**Riesgo:** H-85
**Estado:** RESUELTO
**Fecha:** 08/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Una venta se registró con una prenda blanca. Al editar el producto a rojo, la
reimpresión cambió; al insertar un clon con el mismo SKU, tomó datos del clon.
Además, Historial no ofrecía reimpresión de contado, Reportes imprimía una hoja
vacía, la devolución directa no emitía documento y Cambios ignoraba
`print.auto`. El arnés rojo inicial `node test-h85-receipts.mjs` terminó **3
pasaron, 15 fallaron**.

## Causa raíz

`BalamTicket` resolvía color y talla mediante `D.products.find(sku)` durante el
render. La venta no conservaba una evidencia visual completa. Las otras
superficies usaban contratos separados: Reportes invocaba el modo térmico que
oculta `#root`, Cambios imprimía incondicionalmente y la devolución sólo cerraba
con un aviso efímero.

## Diseño

- `receiptSnapshot.version=1` es la evidencia visual cerrada de ventas nuevas.
- El ticket sólo consume snapshot y campos documentales congelados.
- Una venta antigua nunca consulta el producto vigente: conserva códigos crudos
  y omite lo que históricamente no existe.
- Reimprimir es una proyección sin escritura ni efectos comerciales.
- Reportes genera un documento A4 autocontenido; no cambia el CSS térmico.
- La devolución directa tiene documento propio y no usa vocabulario de Cambio.
- `UI.useReceiptAutoPrint()` gobierna POS, Apartados, Cambios y el acuse directo;
  un montaje imprime cero o una vez según `print.auto` y siempre deja acción manual.

No se modifican SKU, identidades de producto/variante, códigos de barras de
inventario, stock, precios ni reglas H-83/H-84.

## Solución

`DATA.recordSale()` congela tienda, vendedor y presentación por renglón. STORE
transporta `receipt_snapshot`; la migración `12800` añade el JSONB con forma
validada y lo persiste dentro de los RPC atómicos vigentes sin sobrescribir uno
existente. `BalamTicket` eliminó toda consulta normal al catálogo. Reportes suma
reimpresión por folio y salidas Imprimir/PDF propias. Devoluciones monta
`BalamReturnReceipt`. La impresión automática se centralizó en `shared.jsx`.

## Pruebas

- `node test-h85-receipts.mjs`: **18/18**. Cubre los casos 1–8 y 12 requeridos,
  clon con SKU duplicado, persistencia y ausencia de excepciones.
- `node test-ticket-print.mjs`: **23/23**; ticket largo de 1,736 px, dos hojas,
  80 mm, sin recorte ni desbordamiento.
- `node test-layaway-screen.mjs`: **55/55**; Apartados sin regresión.
- `node test-cambio-e2e.mjs`: **37/37**; `print.auto` habilitado imprime una vez.
- `node test-h73-comprobante-del-cambio.mjs`: **29/29**.
- `node test-returns.mjs`: **17/17**.
- `node test-sale-coherence.mjs`: **20/20**; cobros, pagos, devoluciones y sync.
- `node test-report-revenue.mjs`: **24/24**.
- H-83: **32/32 + 17/17**; H-84: **19/19**.
- Migraciones: **31/31**; módulos: **41/41**; smoke bundle: **17/17**;
  build reproducible: **8/8**.
- `node build-offline.mjs`: artefactos regenerados sin red de ejecución.

Las migraciones `20260808012800/12900` se aplicaron al proyecto enlazado; la
verificación SQL terminó correctamente y el `db push --dry-run` posterior
respondió `Remote database is up to date`.

## Riesgo residual y pendientes

Las ventas anteriores a H-85 no adquieren datos que nunca congelaron. Por
diseño, una etiqueta histórica ausente se muestra como código crudo o se omite;
rellenarla desde Inventario crearía evidencia falsa. El sitio publicado se
registrará al desplegar el cliente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-85---los-comprobantes-no-son-una-proyección-histórica-cerrada`
- `docs/02-architecture.md#evidencia-visual-del-comprobante-histórico`
- `docs/architect/authorities/sales.md`
