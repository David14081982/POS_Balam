# SKU visual familiar en Inventario

**Riesgo:** H-104
**Estado:** RESUELTO
**Fecha:** 15/08/2026
**Commit técnico:** `b2ae4d6`
**Commit documental:** `f483eb3`
**Commit de validación pública:** `b584edc`

## Problema y reproducción

Una familia V2 con varias referencias se mostraba en las vistas móvil y
escritorio de Inventario como `Varios SKU`. El texto no distinguía los segmentos
comunes, la variación de talla ni otras variantes físicas.

## Causa raíz

H-102 creó correctamente la proyección comercial familiar, pero la columna SKU
consumía `skuLabel`, diseñado como resumen neutral. No existía una autoridad de
presentación que aplicara la receta semántica vigente a las referencias con
existencia. La línea roja H-104 reprodujo los ocho escenarios con 0/8.

## Diseño

`DATA.familyVisualSku()` es una proyección pura y no persistida:

- V1 conserva exactamente `product.sku`.
- Una sola referencia disponible conserva su SKU real materializado.
- Sólo participan referencias con `stockQuantity > 0`.
- Recorre `CONFIG.skuParts()` y reutiliza `skuPartToken()`.
- Un segmento común conserva su token; la talla efectiva variable usa `T` y
  cualquier otro segmento variable usa `[VAR]`.
- Una familia agotada conserva el resumen neutral seguro y nunca toma la primera
  referencia como autoridad.

H-104 introdujo el resultado para la columna SKU móvil y escritorio de
Inventario. H-111 autoriza además su reutilización en la cabecera comercial del
selector de talla del POS; sigue siendo presentación derivada. `skuLabel`,
DetailDrawer, búsqueda e identidades reales permanecen intactos.

## Solución

- `balam/data.jsx`: autoridad derivada `familyVisualSku`.
- `balam/inventory.jsx`: consumo exclusivo en ambas representaciones de la lista.
- `test-h104-family-visual-sku.mjs`: contrato A–H.
- `test-h104-family-visual-sku-e2e.mjs`: BALAM QA real, navegación, detalle y
  evidencia en 320/360/390/430/1280 px.
- `index.html`, `POS Balam (offline).html` y `sw.js`: artefactos regenerados.

## Pruebas

- H-104 contrato: 8/8.
- H-104 E2E/BALAM QA: 18/18.
- H-100: 10/10.
- H-101: 26/26 + 12/12 + 10/10.
- H-102: 15/15 + 16/16.
- H-103: 15/15.
- Responsive: 492/492.
- Navegación: 15/15.
- Smoke bundle: 17/17.

No hubo llamadas ni escrituras a Supabase. Las pruebas de navegador interceptan
la nube y operan con fixtures locales.

GitHub Pages sirve 8,987,601 bytes con SHA-256
`fe35ddd43b41efda32943c2f67d8094dc8bf29ebd69d2e3b8219dbce50681c9b`.
La diferencia frente al blob Git consiste exclusivamente en normalizar sus 171
finales de línea CRLF a LF; después de esa normalización, tamaño y SHA-256 son
idénticos. El E2E H-104 ejecutado sobre los bytes descargados quedó 18/18.
`HEAD` y `origin/main` coinciden en `f483eb3`.

## Riesgo residual y pendientes

Ninguno conocido. El texto puede envolver en pantallas angostas, de forma
intencional, pero no produce overflow horizontal.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-104---inventario-muestra-un-sku-arbitrario-para-una-familia-v2`.
- Autoridad de inventario: `docs/architect/authorities/inventory.md`.
- Proyección comercial H-102: `docs/fixes/proyeccion-comercial-familias-v2.md`.
