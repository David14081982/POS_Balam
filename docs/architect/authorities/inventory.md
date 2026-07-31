---
capa: conocimiento
applies_to: [domain, database]
related_histories: [H-01, H-36, H-46, H-57, H-59, H-61]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Catálogo y existencias

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Cuánto cuesta esta talla antes de promociones?
**Autoridad:** `DATA.listPrice(producto, talla)`
**Definición:** `balam/data.jsx` · excepciones en `pos.products.precios_talla`
**Creada por:** H-36 · **Decisión:** `ADR-009`
**Consumidores:** `grep -rn "listPrice" balam/ test-*.mjs`

## ¿Qué tallas aplican a este producto y cuántas piezas existen?
**Autoridad:** `DATA.resolveProductSizes(producto, catálogos, variantes)`
**Definición:** `balam/data.jsx` · categoría persistida en
`producto.attrs.__sizeCategoryId` · catálogos en `CONFIG`
**Creada por:** H-57 · **Endurecida por:** H-59
**Consumidores:** `grep -rn "resolveProductSizes" balam/ test-*.mjs`

## ¿Qué opciones muestra el filtro global de tallas y en qué orden?
**Autoridad:** `DATA.resolveSizeFilterGroups()` — responde con una **estructura
por categoría**, no con una lista. `DATA.resolveSizeFilterOptions()` es su
proyección plana **derivada**, no una segunda respuesta
**Definición:** `balam/data.jsx` · categorías, su orden, tallas activas y orden
de cada talla salen de `CONFIG`; no consulta productos ni existencias. Identidad
de opción: `{ sizeCategoryId, sizeId }`
**Creada por:** H-59 · **Reformada por:** H-61
**Consumidores:** `grep -rn "resolveSizeFilterGroups\|resolveSizeFilterOptions" balam/ test-*.mjs`

## ¿Qué precio muestra este artículo en el catálogo?
**Autoridad:** `DATA.priceRange(producto)` — **derivada** de `listPrice` sobre
las tallas con existencias; no reimplementa la resolución
**Definición:** `balam/data.jsx`
**Creada por:** H-36 · **Decisión:** `ADR-009`
**Consumidores:** `grep -rn "priceRange" balam/`

## ¿Hay inventario para esta venta?
**Autoridad:** `pos.reserve_sale_stock()`, invocada dentro de `pos.commit_sale()`
**Definición:** migraciones `20260725001700`, `20260725001800`
**Creada por:** H-01 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "reserve_sale_stock" supabase/ balam/`

## ¿Cuántas unidades de este artículo están fuera por un préstamo?
**Autoridad:** `DATA.loanedQty(sku, talla)` — el préstamo **no** mueve existencias,
así que esta cifra se deriva de la colección y no del stock
**Definición:** `balam/data.jsx` § préstamos · `docs/02-architecture.md` § Préstamos de mercancía
**Creada por:** H-46
**Consumidores:** `grep -rn "loanedQty" balam/ test-*.mjs`

## ¿Cuántas piezas de este préstamo faltan por regresar?
**Autoridad:** `DATA.prestamoPendientes(prestamo)`
**Definición:** `balam/data.jsx` § préstamos
**Creada por:** H-46
**Consumidores:** `grep -rn "prestamoPendientes" balam/ test-*.mjs`

## ¿Está vencido este préstamo, y por cuántos días?
**Autoridad:** `DATA.prestamoAtraso(prestamo, hoy)` — compara la fecha esperada
**guardada en el documento**; un préstamo cerrado nunca está vencido
**Definición:** `balam/data.jsx` § préstamos
**Creada por:** H-46 · **Decisión:** `ADR-002`
**Consumidores:** `grep -rn "prestamoAtraso\|prestamosVencidos" balam/ test-*.mjs`
