# Autoridad única de categorías y existencias por talla

**Riesgo:** H-57
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Configuración mantenía las tallas oficiales en `size_letter` y `size_number`,
pero los productos no guardaban cuál categoría les correspondía. POS armaba el
filtro con ambos catálogos y el selector recorría `p.stock`; Inventario volvía a
alinear ambas escalas por su cuenta.

`node test-product-sizes.mjs` antes del cambio: **0 pasaron, 9 fallaron**. No
existía una autoridad compartida y no podía demostrarse que `0` conservara su
tipo, que `A` fuera un valor configurado o que una talla de otra categoría no
se mezclara.

## Causa raíz

El catálogo sí era la fuente de los valores, etiquetas, actividad y orden por
posición, pero faltaba la relación producto → categoría. Cada pantalla resolvía
una parte distinta usando `escala`, `talla` o los dos catálogos globales.
`code` funcionaba simultáneamente como identidad y valor histórico; no existía
un contrato que diferenciara esos conceptos ni una identidad de variante.

## Diseño

Los catálogos existentes siguen siendo las categorías; no se creó otro
catálogo. `code` permanece como ID estable. El valor real es `meta.value` cuando
está configurado y, para compatibilidad, `code` en los registros históricos.
La etiqueta es `label`, el orden es `meta.order` o la posición estable del
arreglo y la actividad es `active`.

La asignación vive en `producto.attrs.__sizeCategoryId`, que ya se sincroniza y
cachea offline. `DATA.resolveProductSizes()` enlaza esa categoría con las
variantes por valor real y escala. Los históricos se infieren sólo si tienen
stock positivo en una única escala; los ambiguos conservan ambas hasta que
Inventario exija elegir categoría al guardarlos. La regla vigente se conserva:
selector y detalle ocultan existencias cero; la autoridad sí las devuelve.

## Solución

- `balam/config.jsx` declara y enumera las categorías de talla existentes.
- `balam/data.jsx` publica la autoridad con categoría, ID, valor, etiqueta,
  orden, existencia, variante y actividad.
- `balam/inventory.jsx` captura la categoría y usa la autoridad en existencias,
  precios especiales y detalle.
- `balam/pos.jsx` deriva de la autoridad el filtro y “Selecciona talla”.
- `balam/store.jsx` recupera la asignación desde `attrs` sin cambiar el esquema.
- Configuración identifica las tarjetas como “Categorías por talla”.

## Pruebas

- Reproducción final: `test-product-sizes.mjs` **9/9**.
- Precio por talla: `test-variant-price.mjs` **38/38**.
- E2E de precio por talla: `test-precio-talla-e2e.mjs` **19/19**.
- Filtros de Inventario: `test-filtros-inventario.mjs` **18/18**.
- Cola offline: `test-store-queue.mjs` **115/115**.
- Contratos: `test-module-contracts.mjs` **40/40**.
- Smoke del bundle: `test-smoke.mjs bundle` **17/17**.
- Navegación: `test-ui-navigation.mjs` **15/15**.
- `node build-offline.mjs`: correcto, 71 assets.

## Riesgo residual y pendientes

Los catálogos históricos almacenan números como texto (`"34"`, `"36"`, etc.).
Se conservan para no romper claves de stock, precios, códigos de barras ni
ventas. La autoridad soporta valores numéricos reales mediante `meta.value`
para nuevas configuraciones. Un producto histórico con existencias positivas
en ambas escalas no se reasigna automáticamente: debe elegirse su categoría al
editarlo, evitando ocultar stock por una inferencia arbitraria.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-57.
- Autoridad: `docs/architect/authorities/inventory.md`.
- Arquitectura: `docs/02-architecture.md`.
