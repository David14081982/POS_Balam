# Trazabilidad del descuento y presentación del ticket

**Riesgo:** H-32
**Estado:** RESUELTO
**Fecha:** 27/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Finanzas pidió un orden fijo en el resumen de venta y en el ticket impreso:
precio original → importe → IVA → descuento → total a pagar, con el porcentaje
de la promoción junto al descuento. El sistema no podía cumplirlo por dos
razones distintas.

La primera es de presentación: importe e IVA se calculaban sobre el **total
cobrado**, no sobre el **precio original**, y el descuento se imprimía antes
del importe.

La segunda es de datos. `PROMOS.lineUnit()` ya devolvía las promociones que
aplicaron a cada renglón, pero `recordSale` descartaba esa lista y guardaba
sólo `precio`, `precioBase` y `precioOrig`. La venta perdía la identidad de la
promoción al guardarse, así que el porcentaje configurado era irrecuperable y
la única salida habría sido derivarlo dividiendo descuento entre precio —
expresamente prohibido por Finanzas, porque produce números que ningún
administrador configuró: 7.14% cuando conviven artículos elegibles y no
elegibles, 4.8% cuando el descuento fue de monto fijo, 15% cuando dos
promociones se acumularon sobre el mismo artículo.

El diagnóstico también encontró que `pos.jsx` y `data.jsx` evaluaban el motor
por separado para el mismo renglón. Hoy coinciden porque `lineUnit` es una
función pura, pero una promoción que venciera entre agregar al carrito y
confirmar hacía que el POS mostrara un precio y `recordSale` guardara otro.

## Causa raíz

La evidencia del descuento existía en memoria y moría en `recordSale`. El
renglón guardaba el resultado del cálculo pero no su justificación, y ningún
campo permitía distinguir "sin promoción" de "promoción desconocida".

## Diseño

Cada renglón persiste `promos`: una copia congelada `[{ id, nombre, tipo,
valor }]` de las promociones que produjeron su precio. Es copia y no
referencia, así que sobrevive a que el administrador edite o elimine la
promoción — que hoy es borrado duro.

Un arreglo vacío significa "sin promoción". La **ausencia** del campo significa
"venta anterior a H-32", que nunca imprime porcentaje. No hizo falta un número
de versión de esquema: la distinción ya es inequívoca.

`DATA.resolveLineDiscount(producto, talla)` es la única fuente de la resolución.
El POS la calcula una vez por renglón y la adjunta a la línea; `recordSale`
consume lo que recibe. El renglón es dueño de su precio.

La presentación calcula el precio original como `total + descuento`, de modo
que la resta impresa cuadra exactamente con el total, y deriva importe e IVA de
él. **Ningún importe guardado cambia**: `subtotal`, `iva`, `total` y `descuento`
conservan su significado y sus valores, y la invariante `subtotal + iva = total`
que protege comisiones y devoluciones sigue intacta.

El porcentaje se imprime **sólo** si todos los renglones con descuento traen
evidencia, cada uno con exactamente una promoción, todas porcentuales y todas
con el mismo valor configurado. Monto fijo, promociones distintas, acumulación
o venta histórica sin evidencia imprimen únicamente el importe.

El motor de promociones **no se modificó**. La acumulación, el piso de margen y
las reglas comerciales siguen exactamente igual.

## Solución

- `balam/data.jsx`: `resolveLineDiscount()`, `recordSale` consume la resolución
  y persiste `promos` por renglón; el generador de datos de prueba resuelve
  igual que el POS.
- `balam/pos.jsx`: resuelve una vez por renglón y pasa la resolución al resumen
  y a `recordSale`. Ya no llama al motor.
- `balam/pos-ticket.jsx`: `desglose()` y `pctDeEvidencia()` compartidos por el
  resumen y el ticket; orden de Finanzas en ambos; el renglón del carrito
  reutiliza la resolución en vez de reconsultar el motor.
- `balam/store.jsx`: `promos` viaja a `pos.sale_items` y regresa, condicional
  como los precios.
- `supabase/migrations/20260727004000_pos_h32_discount_trace.sql`: columna
  `promos jsonb` y `commit_sale` actualizado para transportarla.
- `index.html` y `POS Balam (offline).html`: artefactos regenerados.

Cortesías quedaron expresamente fuera: conservan su comportamiento previo.

## Pruebas

- `node test-discount-trace.mjs`: 65/65 — formato exacto de Finanzas, evidencia
  persistida, inmutabilidad ante edición y borrado de la promoción, monto fijo,
  artículos no elegibles, promociones distintas, acumulación, ventas históricas,
  transporte entre terminales, neutralidad de precios y cortesías.
- `node test-discounts.mjs`: 43/43 **sin modificar** — evidencia de que el motor
  no se tocó.
- `node test-store-queue.mjs`: 97/97 · `test-sale-coherence` 17/17 ·
  `test-returns` 17/17 · `test-liquidations` 10/10 · `test-commission` 10/10 ·
  `test-module-contracts` 36/36 · `test-migrations` 24/24 ·
  `test-effective-commission` 22/22 · `test-concurrency` 9/9 ·
  `test-role-access` 10/10 · `test-eligible-sellers` 10/10 ·
  `test-seller-avatars` 13/13 · `test-image-processing` 5/5 ·
  `test-supabase-sdk` 4/4 · `test-browser-harness-entry` 8/8 ·
  `test-build-reproducibility` 8/8 · `test-folio-concurrency` 4/4 ·
  `test-ui-navigation` 13/13 · `test-auto-fotos` 11/11 ·
  `test-export-modelo` 14/14 · `test-filtros-inventario` 18/18 ·
  `test-import-fotos` 23/23 · `test-reset-propaga` 21/21 ·
  `test-reset-pruebas` 19/19 · `test-xlsx-security` 17/17.
- `node test-smoke.mjs` 15/15 y `node test-smoke.mjs bundle` 17/17.
- `node build-offline.mjs`: correcto, 67 recursos.
- Verificación visual en Chrome real sobre el bundle, con un artículo de
  $1,250.00 y una promoción de 10%. Resumen del Punto de venta y ticket
  impreso, ambos idénticos al formato pedido:

```
Precio original    $1,250.00
Importe            $1,077.59
IVA (16%)            $172.41
Descuento (SOBRE PRECIO ORIGINAL) 10%   − $125.00
TOTAL A PAGAR      $1,125.00
```

  Evidencia persistida en la venta:
  `{"total":1125,"descuento":125,"promos":[{"id":"promo-demo","nombre":"DESCUENTO JULIO","tipo":"pct","valor":10}]}`

## Despliegue y validación en producción

Migración `20260727004000_pos_h32_discount_trace.sql` aplicada al proyecto
`Balam` el 27/07/2026, antes de publicar el cliente. Antes de reemplazar
`commit_sale` se comparó la definición viva contra la migración original: el
cuerpo coincidía carácter por carácter, y la versión nueva difiere de la
anterior **únicamente** en `promos`. No había ediciones manuales que pisar.

Verificado en la base: `pos.sale_items.promos` existe como `jsonb`, y
`pos.commit_sale` declara e inserta el campo.

Venta controlada ejecutada contra el RPC real, como apartado para no tocar
inventario. El renglón quedó con `precio_original = 1250.00`,
`precio_base = 1125.00` y
`promos = [{"id":"promo-1784916982784","tipo":"pct","valor":10,"nombre":"DESCUENTO JULIO"}]`.

La lectura desde otra terminal se simuló con el mapeo real de `store.jsx` y la
presentación real de `pos-ticket.jsx` sobre las filas reales de la nube:

- la venta de validación recuperó la evidencia e imprimió `10%`;
- las cinco ventas históricas reales —incluidas dos con $100.00 de descuento—
  no recuperaron evidencia y **no imprimieron ningún porcentaje**, en vez de
  derivar el 22.2% que habría salido de dividir descuento entre precio.

`pos.sale_items.promos` no tiene ninguna llave foránea hacia `pos.promotions`
(verificado: 0 restricciones), por lo que editar o eliminar la promoción no
puede alterar un ticket ya emitido.

La venta de validación se eliminó al terminar. La base quedó en su estado
exacto previo: 5 ventas, 5 renglones, 3 promociones y 240 productos.

## Riesgo residual y pendientes

Bajo el formato aprobado, `Importe + IVA = Precio original`, que **no** es igual
al total a pagar cuando hay descuento. Es lo solicitado expresamente por
Finanzas y queda registrado aquí para que no se reporte como defecto.

Las ventas anteriores a H-32 nunca imprimirán porcentaje. Es correcto por
diseño: no existe evidencia y no se deriva.

## Mejoras futuras registradas, fuera de H-32

- `PROMOS.previewDraft()` aplica sólo la promoción en edición, así que la vista
  previa administrativa no muestra la acumulación real que produciría la
  configuración. Es un defecto del motor, ajeno a este alcance.
- El motor calcula `capped` cuando el piso de margen recorta un descuento, pero
  ni el POS ni el ticket lo muestran.
- Rediseño del modelo de promociones (orígenes, instrumentos al portador,
  convenios, selección por el vendedor) queda como proyecto independiente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-32--trazabilidad-del-descuento-y-presentación-del-ticket`.
- Arquitectura: `docs/02-architecture.md`, sección `Promociones y margen mínimo`.
- Instantánea financiera previa: `docs/fixes/margen-minimo-promociones.md`.
