---
capa: conocimiento
applies_to: [domain, database]
related_histories: [H-01, H-36, H-46, H-57, H-59, H-61, H-94, H-100]
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

## ¿Qué identifica y qué distingue una referencia física V2?
**Autoridad:** `products.id` identifica; `barcode_code` localiza; SKU representa.
`DATA.physicalSignature()` deriva las dimensiones de `CONFIG.referenceParts()`
**Definición:** `balam/data.jsx`, `balam/config.jsx` y migración H-94
**Creada por:** H-94 · **Decisión:** `ADR-013`
**Consumidores:** `grep -rn "physicalSignature\|barcodeCode\|productId" balam/`

## ¿Qué SKU visible corresponde a esta pieza o referencia?
**Autoridad:** `DATA.materializedSku(producto, tallaExplícita)`; en V1 proyecta
el SKU base con la talla seleccionada y en V2 devuelve el SKU ya derivado por
`createReference()` desde `DATA.effectiveSize()`
**Definición:** `balam/data.jsx`; la etiqueta sólo consume el resultado y no
infiere talla ni reescribe el texto
**Creada por:** H-100 · **Decisión:** `ADR-013`
**Consumidores:** `grep -rn "materializedSku" balam/ test-*.mjs`

## ¿Cuál es la representación canónica de los atributos custom de un producto?
**Autoridad:** `DATA.canonicalProductAttrs(attrs, options)` omite únicamente los
kinds custom conocidos cuyo valor sea `null`, vacío o sólo espacios; preserva
claves `__*` y atributos históricos desconocidos. Con `validateRequired` rechaza
un catálogo obligatorio sin valor.
**Definición:** `balam/data.jsx` · metadata vigente en `CONFIG.catalogMeta`
**Creada por:** extensión H-86
**Consumidores:** `grep -rn "canonicalProductAttrs" balam/ test-*.mjs`

## ¿Qué tallas aplican a este producto y cuántas piezas existen?
**Autoridad:** `DATA.resolveProductSizes(producto, catálogos, variantes)`
**Definición:** `balam/data.jsx` · categoría persistida en
`producto.attrs.__sizeCategoryId` · catálogos en `CONFIG`
**Creada por:** H-57 · **Endurecida por:** H-59
**Consumidores:** `grep -rn "resolveProductSizes" balam/ test-*.mjs`

## ¿Qué referencias vivas tiene este código de talla?
**Autoridad:** `CONFIG.sizeCodeReferences(categoría, code)` — existencias
positivas, precios especiales, códigos de barras y alcance de promociones,
resueltos por **escala y valor real**, nunca por la apariencia del código
**Definición:** `balam/config.jsx` · promociones y productos por el gateway de
`CORE` · consumida por `updateItem`, `importCatalogs` e `inUse`
**Creada por:** H-63 · **Alcance:** protege `size_number`; `size_letter` conserva
su guarda anterior
**Consumidores:** `grep -rn "sizeCodeReferences\|sizeCodeProtected" balam/ test-*.mjs`

## ¿Cómo se llama en Excel la columna de una talla y a qué identidad escribe?
**Autoridad:** `XLSXIO.sizeColumns()` — devuelve las dos escalas con `value`
(identidad, la que localiza las piezas), `header` (etiqueta, la que se lee) y
`legacyHeader` (el encabezado de los archivos anteriores). Valida además que dos
tallas no produzcan la misma columna
**Definición:** `balam/xlsx-io.jsx` · el archivo exportado publica su mapa
columna → identidad en la hoja «Catálogos»
**Creada por:** H-67 · **Decisión:** `ADR-011` § 4 — un encabezado sin mapa nunca
se traduce por adivinación
**Consumidores:** `grep -rn "sizeColumns\|legacyHeader" balam/ test-*.mjs`

## ¿Cuál es el contrato Excel de Inventario y cómo se decide una importación?
**Autoridad:** `XLSXIO.schema` (`INVENTORY_XLSX_SCHEMA`) define hojas, versión,
columnas visibles y columnas técnicas. `XLSXIO.planImport()` es la única
autoridad de preflight: localiza actualizaciones por `_BALAM_ID_PRODUCTO`,
calcula altas/cambios/conflictos y no produce mutaciones. `applyImportPlan()`
aplica el plan completo únicamente si sigue vigente y no contiene conflictos
**Definición:** `balam/xlsx-io.jsx` · Plantilla y Exportar delegan en
`writeInventoryWorkbook()`; Importar consume el libro emitido por ese escritor
**Creada por:** H-86 · **Decisiones:** SKU es dato comercial, no identidad de
actualización; un error bloquea todas las filas; el orden físico de columnas no
forma parte de su identidad
**Consumidores:** `grep -rn "XLSXIO.schema\|planImport\|applyImportPlan" balam/ test-*.mjs`

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

## ¿Qué contiene el inventario y qué impide vaciarlo?
**Autoridad:** `DATA.inventoryFootprint()` — productos, piezas, renglones,
documentos que los citan, apartados, cola pendiente y el motivo de bloqueo.
`DATA.clearInventory()` ejecuta el vaciado **delegando** en `removeProduct`: no es
una segunda forma de borrar un producto
**Definición:** `balam/data.jsx` · huella de lo conservado con
`configFingerprint({ omitProductos: true })`
**Creada por:** H-76 · **Decisión:** `ADR-002` (los documentos conservan su
evidencia), `ADR-006` (la baja viaja por la cola)
**Consumidores:** `grep -rn "inventoryFootprint\|clearInventory" balam/ test-*.mjs`

## ¿Qué eliminará Punto Cero y puede ejecutarse ahora?
**Autoridad:** `pos.point_zero_preview()` para el plan sellado y
`pos.execute_point_zero()` para la decisión transaccional; el cliente no cuenta
ni borra tablas
**Definición:** migración `20260812013900` · `docs/02-architecture.md` § Punto Cero administrativo
**Creada por:** H-98 · **Decisiones:** `ADR-005`, `ADR-006`, `ADR-012`
**Consumidores:** `grep -rn "pointZeroPreview\|executePointZero\|point_zero_preview\|execute_point_zero" balam/ supabase/ test-h98-*.mjs`

## ¿Hay inventario para esta venta?
**Autoridad:** `pos.reserve_sale_stock()`, invocada dentro de `pos.commit_sale()`
**Definición:** migraciones `20260725001700`, `20260725001800`
**Creada por:** H-01 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "reserve_sale_stock" supabase/ balam/`

## ¿Cuántas unidades de este artículo están fuera por un préstamo?
**Autoridad:** `DATA.loanedQty(productId, talla)` para V2; SKU sólo como adaptador V1 — el préstamo **no** mueve existencias,
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
