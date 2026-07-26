# Margen mínimo efectivo en promociones

**Riesgo:** H-11
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Con `discount.minMarginPct=45`, precio $1,000, costo $450 y descuento 40%, el
motor devolvía $600. El piso configurado es $450/(1-0.45) = $818.18.
`test-discounts.mjs` reprodujo el precio inferior y la ausencia de
`capped=true`: 30 casos pasaron y 2 fallaron.

## Causa raíz

`PROMOS.applyStack()` recibía únicamente precio y promociones. No consultaba
configuración ni conocía el costo. Tanto `lineUnit()` como `previewDraft()`
omitían el producto, por lo que POS y vista previa repetían el mismo cálculo
incompleto.

## Diseño

El margen bruto mínimo cumple `(precio-costo)/precio >= margen`. El piso
correspondiente es `costo/(1-margen)`. Se aplica después de combinar porcentajes
y montos fijos, y nunca puede elevar el precio de lista. Si el producto ya está
debajo del margen, se bloquea el descuento adicional. Costo no positivo o
margen 0 desactivan el piso para preservar registros incompletos e históricos.

## Solución

- `balam/discounts.jsx` aplica el piso en el motor único y devuelve `capped`.
- Punto de Venta y vista previa pasan el producto al mismo cálculo.
- `balam/settings.jsx` muestra el margen en Ventas y POS y persiste valores
  limitados a 0–100 con los componentes gráficos existentes.
- `test-discounts.mjs` cubre porcentaje, fijo, acumuladas, costo cero, costo
  igual al precio, margen 100%, POS, vista previa y configuración.
- Se regeneraron `index.html` y `POS Balam (offline).html` desde las fuentes.

## Pruebas

- Antes: `node test-discounts.mjs` — 30 pasaron, 2 fallaron.
- Después: `node test-discounts.mjs` — 43 pasaron, 0 fallaron.
- `node test-sale-coherence.mjs` — 17 pasaron, 0 fallaron.
- `node test-commission.mjs` — 10 pasaron, 0 fallaron.
- `node test-returns.mjs` — 17 pasaron, 0 fallaron.
- `node test-store-queue.mjs` — 62 pasaron, 0 fallaron.
- `node test-smoke.mjs` — 13 pasaron, 0 fallaron.
- `node build-offline.mjs` — ambos artefactos regenerados correctamente.

## Riesgo residual y pendientes

Sin costo positivo no existe base verificable para aplicar margen; esos
productos conservan el cálculo anterior. La corrección sólo afecta ventas
nuevas y no reinterpreta snapshots históricos.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-11--margen-mínimo-configurado-pero-no-aplicado`
- Arquitectura: `docs/02-architecture.md#promociones-y-margen-mínimo`
