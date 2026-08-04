# La devolución restituye el inventario por identidad, no por SKU

**Riesgo:** H-71
**Estado:** RESUELTO
**Fecha:** 03/08/2026
**Commit:** `e09efc8`
**Artefacto publicado:** sha256
`bf8f71729f3dd482e8877208822c0242da635da1a8d246f92d1f7429d421dc31`
(8 834 300 bytes), idéntico byte a byte al `index.html` del commit y verificado
por ejecución sobre `https://david14081982.github.io/POS_Balam/`
(`verify-h71-publicado.mjs` 10/10).

## Problema y reproducción

`recordReturn` localizaba el producto al que devolver la pieza con
`products.find(x => x.sku === l.sku)` y protegía la escritura con un `if (p)`
sin `else`. El SKU no es identidad —lo dice `ADR-011` y lo aprendió H-65—, así
que bastaba con que el catálogo de hoy no coincidiera con el de la venta para
que la devolución reembolsara dinero sin regresar la mercancía al inventario, o
la regresara a un artículo ajeno. En los dos casos el fallo era **silencioso**:
la operación se declaraba correcta.

Reproducción sobre el artefacto publicado (`index.html`), no sobre la fuente:

**Caso 1 — SKU cambiado después de la venta.** Venta de `P-BETA` talla `L`
(SKU `21-MC-ALG-AZ`). El administrador cambia el SKU del producto. Se devuelve
la pieza.

| | Antes de H-71 | Esperado |
|---|---|---|
| Devolución | aceptada, `ok: true` | aceptada |
| Reembolso | $2 000 | $2 000 |
| Existencias | **19 → 19** | 19 → 20 |
| `productId` del documento | **`undefined`** | `P-BETA` |

**Caso 2 — dos productos con el mismo SKU.** Venta de `P-BETA` talla `M`.
Aparece `P-CLON` con el mismo SKU, primero en el arreglo.

| | Antes de H-71 | Esperado |
|---|---|---|
| Existencias del vendido | **19 → 19** | 19 → 20 |
| Existencias del ajeno | **3 → 4** | 3 → 3 |
| `productId` del documento | **`P-CLON`** | `P-BETA` |

Arnés: `test-h71-devolucion-identidad.mjs`. Reproducción roja previa:
**11 pasaron, 18 fallaron** (11/29).

## Causa raíz

`balam/data.jsx`, función `recordReturn`. Tres consultas distintas resolvían el
producto por un campo que no es identidad:

1. la comprobación de candados de apartado —`productId` primero, pero con
   `|| products.find(p => p.sku === line.sku)` como respaldo por `find()`—;
2. **la restitución de existencias**, por SKU exclusivamente, con `if (p)` mudo:
   el origen de los dos casos anteriores;
3. la construcción de `ret.lineas[].productId`, también por SKU, que congelaba
   en el documento la identidad equivocada o ninguna.

El dato correcto ya existía y estaba a la mano: desde H-32 cada renglón de venta
congela `productId` (`sale.lineas[].productId`). La pantalla de Devoluciones
envía renglones **sin identidad** —`{sku, nombre, talla, qty, motivo, precio}`,
`balam/returns.jsx` § `confirm()`—, así que la única fuente legítima de identidad
es el renglón congelado en la venta, y `recordReturn` nunca lo consultaba para
mover existencias.

Contribuyó la ausencia de atomicidad: las existencias se mutaban dentro del mismo
recorrido que resolvía el producto, de modo que un renglón irresoluble dejaba a
los anteriores ya aplicados.

## Diseño

**Contrato.** Una devolución sólo puede aplicarse si sabe, para **cada** renglón,
a qué producto regresar la pieza. La identidad es `productId`, tomada del renglón
congelado en la venta. El SKU se conserva **únicamente** como puente para
documentos históricos y sólo cuando identifica un producto único. Sin identidad
resoluble la devolución **se rechaza entera** y no toca nada.

**Autoridad.** No se reimplementa la regla: `resolveReturnProduct(sale, line)`
consume `resolveLayawayProduct()`, la autoridad que creó H-65, y sólo traduce el
mensaje al vocabulario de la devolución conservando su `code` (`R-DOM-01`).
`resolveLayawayProduct` no se modificó: H-65 queda intacta, igual que H-66,
H-69 y H-70.

`resolveLayawayProduct` codifica los fallos del puente por SKU
(`PRODUCT_SKU_AMBIGUOUS`, `PRODUCT_NOT_FOUND`) pero lanza **sin código** cuando
un `productId` congelado ya no existe en el catálogo. Para una devolución ese
caso significa lo mismo —no hay a dónde regresar la pieza—, así que se normaliza
a `PRODUCT_NOT_FOUND` en la traducción, sin tocar la función de origen.

**Invariantes conservadas.** El plazo (H-34), el saldo por renglón (H-35), el
reembolso desde el snapshot cobrado, la reversión congelada de comisión (H-69) y
la idempotencia de la cola no cambian. Ninguna venta ni devolución histórica se
migró ni se reescribió.

**Compatibilidad.** Una venta anterior a H-32 sin `productId` se sigue
devolviendo por SKU mientras sea inequívoco, y el documento resultante adopta la
identidad resuelta. Es el caso D del arnés.

**Cambio de comportamiento declarado.** Antes, devolver un producto ya borrado
del catálogo reembolsaba en silencio sin restituir. Ahora se rechaza con un
mensaje accionable. Es deliberado: es preferible bloquear y explicar que pagar y
descuadrar el inventario.

## Solución

`balam/data.jsx`:

- **Nueva** `resolveReturnProduct(sale, line)` y su tabla de mensajes
  `RETURN_IDENTITY_MESSAGE`, inmediatamente antes de `recordReturn`.
- `recordReturn` resuelve **todos** los renglones antes de mutar nada y aborta
  con `{ ok: false, error, code }` si alguno no resuelve.
- La restitución de existencias y `stockLines` usan el producto ya resuelto; se
  eliminó el `if (p)` mudo.
- `ret.lineas[].productId` congela la identidad resuelta.

Artefactos `index.html` y `POS Balam (offline).html` regenerados con
`node build-offline.mjs`.

## Pruebas

Reproducción previa en rojo: **11/29** (11 pasaron, 18 fallaron).
Después de la corrección: `node test-h71-devolucion-identidad.mjs` → **29/29**,
sobre `index.html`, sin errores de consola. Cubre camino feliz, SKU cambiado,
SKU duplicado, venta legada sin `productId`, y los tres bloqueos —ambigüedad,
producto ausente y atomicidad— afirmados **en los dos sentidos** (`R-DEL-11`).

Regresión ejecutada, toda en verde:

| Suite | Resultado |
|---|---|
| `test-returns.mjs` | 17/17 |
| `test-line-balance.mjs` | 38/38 |
| `test-h65-layaway-liquidation.mjs` | 35/35 |
| `test-h65-layaway-e2e.mjs` | 28/28 |
| `test-exchange-model.mjs` | 28/28 |
| `test-exchange-commit.mjs` | 32/32 |
| `test-sale-coherence.mjs` | 20/20 |
| `test-h69-commissions.mjs` | 88/88 |
| `test-commission.mjs` | 10/10 |
| `test-h70-clientes-ventas.mjs` | 39/39 |
| `test-store-queue.mjs` | 155/155 |
| `test-module-contracts.mjs` | 41/41 |
| `test-smoke.mjs` | 15/15 |
| `test-ui-navigation.mjs` | 15/15 |
| `test-ticket-print.mjs` | 23/23 |
| `test-build-reproducibility.mjs` | 8/8 |
| `test-ux-metrics.mjs` | sin retroceso: 11 interacciones, 2 validaciones, recorrido completo |

`test-concurrency.mjs` y `test-reset-propaga.mjs` (13/8) fallan igual que en
`HEAD`: deuda preexistente registrada en H-70 y ajena a este trabajo.

Artefacto publicado: `node verify-h71-publicado.mjs` → **10/10**. Compara el
sha256 de lo servido por GitHub Pages contra el blob del commit y después
**ejerce la corrección en el paquete publicado**: SKU cambiado tras la venta
(19 → 20), SKU duplicado (vendido 19 → 20, ajeno 3 → 3) e identidad ambigua
(rechazada, sin mover stock ni dejar documento).

## Riesgo residual y pendientes

- **La variante de talla se sigue resolviendo sin guarda.** `stockVariantOf()`
  devuelve `null` si el código de talla del renglón ya no existe en el catálogo,
  y la restitución se salta en silencio con la misma forma del defecto corregido
  (`balam/data.jsx` § `recordReturn`, paso 1). Queda **fuera de alcance**
  (`R-DOM-05`): es otra pregunta —«¿a qué variante regresa la pieza?»—, exige su
  propia reproducción y toca el terreno de H-64/H-66. Registrado como pendiente
  de H-71.
- **El pull de devoluciones descarta `product_id`.** `balam/store.jsx`
  § `pullKind`, rama `returns`: la fila remota trae `product_id` y el mapeo local
  no lo copia, a diferencia de `saleItemFromRow`. No reabre H-71 —la identidad
  se toma de la venta, no del documento de devolución— pero deja documentos
  locales peor identificados que los remotos. Pendiente.
- **`recordExchange` conserva `x.sku === l.sku` como respaldo** con `find()`
  (`balam/data.jsx`). Un SKU duplicado puede resolver al producto equivocado y
  valorar en `$0` una pieza entregada. Fuera de alcance; registrado.
- El nombre `resolveLayawayProduct` responde hoy una pregunta más amplia que los
  apartados. Renombrarlo rompería el arnés estático de H-65, así que se conserva
  y se documenta la deuda de nomenclatura.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-71
- Autoridad: `docs/architect/authorities/sales.md` § ¿A qué producto pertenece
  este renglón devuelto?
- Corrección hermana: `docs/fixes/liquidacion-apartado-autoridad-stock.md` (H-65)
- Decisiones: `ADR-011` (identidad de talla), `ADR-002` (evidencia congelada)
- Reglas: `R-DOM-01`, `R-DOM-05`, `R-DEL-05`, `R-DEL-11`, `R-CLI-06`
