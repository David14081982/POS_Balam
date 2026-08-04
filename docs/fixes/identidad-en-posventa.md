# La posventa identifica la pieza por la línea de la venta, nunca por SKU

**Riesgo:** H-72
**Estado:** RESUELTO
**Fecha:** 03/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

H-71 cerró la devolución pero dejó registrados tres huecos de la misma familia.
Los tres comparten causa: **un dato mutable y no único —el SKU, o el catálogo
vigente— decidía a qué pieza física apuntaba una operación de posventa.**

**A1 · El pull de devoluciones descartaba `product_id`.** `pushReturn` lo escribe
en `return_items` (`balam/store.jsx`), pero el pull no lo leía de vuelta, a
diferencia de `saleItemFromRow`. Tras sincronizar, la devolución local quedaba
peor identificada que la remota.

**A2 · La restitución se saltaba en silencio si la talla ya no estaba en el
catálogo.** `stockVariantOf()` resuelve a través del catálogo y devuelve `null`
cuando el código de talla fue retirado (escenario H-64); el `if (e)` sin `else`
convertía eso en un no-evento: se reembolsaba y la pieza no volvía.

**A3 · `recordExchange` resolvía por SKU y podía valorar en $0.** Con
`products.find(x => x.id === l.productId || x.sku === l.sku)`, un SKU duplicado
desviaba la pieza devuelta a otro artículo, y una identidad irresoluble hacía
`listPrice(undefined, talla)` → **0**, registrando un cambio con una prenda
valorada en cero.

**D-8 · La pantalla del Cambio derivaba la prenda con un `find` por SKU.**
`balam/returns.jsx` construía cada renglón devuelto con
`p: D.products.find(x => x.sku === r.sku)`. Con un SKU duplicado la pantalla
mostraba **la foto del clon**, el botón «misma prenda» **abría el clon**, y el
`productId` que enviaba a `recordExchange` era el del clon: éste es el defecto
que alimentaba A3.

### Reproducción previa, en rojo

| Arnés | Resultado antes | Resultado después |
|---|---|---|
| `test-h72-identidad-posventa.mjs` (A2, A3, D-8) | **5 pasaron, 11 fallaron** (5/16) | **16/16** |
| `test-store-queue.mjs` § 41 (A1) | **158 pasaron, 1 falló** | **159/159** |

Evidencia medida sobre el artefacto:

- A2: talla `ZZZ` fuera del catálogo → existencias **5 → 5** (debía ser 5 → 6).
- A3: SKU duplicado → vendido **19 → 19**, clon **3 → 4**, `productId` del
  renglón devuelto `P-CLON`.
- A3: identidad irresoluble → cambio registrado con
  `{lado:'entregado', precio: 0}`.
- D-8: el modal de «misma prenda» mostraba **$5.00 · 3 pz** (el clon) en vez de
  **$2,000.00 · 20 pz** (la prenda vendida). Verificado además contra el
  artefacto de `HEAD` con la aserción definitiva, para descartar que la prueba
  fuera verde por casualidad.

## Causa raíz

Cuatro consultas distintas resolvían identidad por un campo que no lo es:

1. `balam/store.jsx` § `pullDomain`, rama `returns`: el mapeo omitía
   `product_id`.
2. `balam/data.jsx` § `recordReturn`: `stockVariantOf()` como única vía al
   renglón de existencias, con `if (e)` mudo.
3. `balam/data.jsx` § `recordExchange`: `x.sku === l.sku` como respaldo de
   identidad, en la comprobación de candados, en la valoración y en el documento.
4. `balam/returns.jsx` § `ExchangeDetail`: `find` por SKU para la prenda del
   renglón devuelto.

En los cuatro casos el dato correcto ya existía: `sale.lineas[].productId`, que
H-32 congela desde la venta, y el renglón crudo de `producto.stock[]`, que guarda
las piezas por el valor de talla sin depender del catálogo.

## Diseño

**Contrato.** Ninguna operación de posventa puede mover existencias sin saber
**qué producto** y **qué renglón de existencias** toca. La identidad del producto
la fija la línea histórica de la venta; la del renglón de existencias, el valor
crudo de talla. Sin las dos, la operación se rechaza **entera**.

**Autoridades.** Se reutiliza `resolveReturnProduct()` de H-71 y se añaden dos
entradas, no una regla nueva:

- `saleLineProduct(sale, line)` — misma resolución, **sin lanzar**: devuelve el
  producto o `null`. La consume la interfaz, que debe pintar un renglón aunque la
  identidad no resuelva. Se exporta en `window.DATA`.
- `resolveReturnStockEntry(product, talla)` — `stockVariantOf()` primero y
  `stockEntryByIdentity()` como respaldo, que localiza el renglón por el valor
  crudo. Si esa identidad no es única —cero o varias equivalentes— lanza
  `STOCK_IDENTITY_AMBIGUOUS`.

**Precedencia corregida.** `resolveReturnProduct` ahora prefiere el `productId`
**de la venta** sobre el que envíe el llamador. Antes ganaba el del llamador, y
la pantalla del Cambio enviaba precisamente el que había reconstruido por SKU: el
documento de la venta no puede quedar por debajo de un dato reconstruido.

**Cambio de comportamiento declarado.** Un renglón entregado en un cambio exige
ahora `productId` explícito y resoluble; la pantalla siempre lo envía. Una
devolución cuya talla tenga existencias ambiguas se bloquea con mensaje
accionable. Ninguna venta, devolución o cambio histórico se migró.

## Solución

- `balam/store.jsx` § `pullDomain`: el renglón bajado conserva
  `productId: x.product_id`.
- `balam/data.jsx`: nuevas `saleLineProduct()` y `resolveReturnStockEntry()`;
  `resolveReturnProduct()` prioriza la línea de la venta; `recordReturn` resuelve
  producto **y** renglón de existencias antes de mutar; `recordExchange` resuelve
  la identidad de todos sus renglones antes de comprobar candados, valorar y
  mover, y elimina el respaldo por SKU.
- `balam/returns.jsx` § `ExchangeDetail`: consume `D.saleLineProduct(sale, r)`.
- Artefactos regenerados con `node build-offline.mjs`.

## Pruebas

Comandos ejecutados y resultados exactos:

    node test-h72-identidad-posventa.mjs      16/16   (previo 5/16)
    node test-store-queue.mjs                159/159  (previo 158/1)
    node test-h71-devolucion-identidad.mjs    29/29
    node test-returns.mjs                     17/17
    node test-line-balance.mjs                38/38
    node test-exchange-model.mjs              28/28
    node test-exchange-commit.mjs             32/32
    node test-exchange-reports.mjs            24/24
    node test-exchange-screen.mjs             45/45
    node test-cambio-e2e.mjs                  37/37
    node test-exchange-commission.mjs         30/30
    node test-h65-layaway-liquidation.mjs     35/35
    node test-h65-layaway-e2e.mjs             28/28
    node test-liquidations.mjs                12/12
    node test-loans-sync.mjs                  69/69
    node test-filtros-inventario.mjs          18/18
    node test-product-sizes.mjs                9/9
    node test-sale-coherence.mjs              20/20
    node test-h70-clientes-ventas.mjs         39/39
    node test-h69-commissions.mjs             88/88
    node test-module-contracts.mjs            41/41
    node test-smoke.mjs                       15/15
    node test-ui-navigation.mjs               15/15
    node test-build-reproducibility.mjs         8/8
    node test-ux-metrics.mjs                  sin retroceso (11 interacciones, 2 validaciones)

**Ausencia de efectos parciales.** El arnés toma una huella completa —existencias
de todos los productos, estado e importes de todas las ventas, número de pagos,
devoluciones, cambios, movimientos y llamadas a la costura de sincronización—
antes y después de cada operación bloqueada, y exige que sean idénticas. Se
comprueba en los dos bloqueos nuevos: devolución con existencias ambiguas y
cambio con identidad irresoluble.

`test-concurrency.mjs` y `test-reset-propaga.mjs` fallan igual que en `HEAD`:
deuda preexistente registrada en H-70 y ajena a este trabajo.

## Riesgo residual y pendientes

- El movimiento de inventario de una devolución sigue sin llevar `productId`
  (`balam/data.jsx` § `recordReturn`, y `pushReturn` en `balam/store.jsx`), a
  diferencia del de una venta. No afecta existencias ni identidad de la
  devolución; se deja fuera porque tocarlo exige revisar el esquema remoto de
  `movements`. Registrado.
- El nombre `resolveLayawayProduct` responde una pregunta más amplia que los
  apartados; renombrarlo rompería el arnés estático de H-65. Deuda de
  nomenclatura conservada de H-71.
- D-3, D-4 y D-5 del informe de auditoría siguen abiertos y fuera de alcance.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-72
- Historia hermana: `docs/fixes/devolucion-por-identidad.md` (H-71)
- Autoridades: `docs/architect/authorities/sales.md`
- Decisiones: `ADR-011`, `ADR-002` · Reglas: `R-DOM-01`, `R-DOM-05`, `R-DEL-05`,
  `R-DEL-10`, `R-DEL-11`, `R-CLI-06`
