# Contrato Excel canónico de Inventario

**Riesgo:** H-86
**Estado:** RESUELTO
**Fecha:** 09/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Plantilla y Exportar comparten algunos helpers, pero no un escritor único; la
primera contiene una fila de ejemplo. Importar acepta una estructura permisiva,
sin versión, y aplica por SKU. Una carga vacía de 239 filas con 222 SKU únicos
termina en 222 productos porque las 17 filas repetidas actualizan el primer
producto creado para su SKU y reemplazan sus existencias.

## Causa raíz

El contrato está repartido entre encabezados, serializador, parser, lista de
campos y aplicador. SKU cumple indebidamente la función de identidad técnica de
actualización, y el archivo carece de versión y de varios campos persistentes.

## Diseño

`INVENTORY_XLSX_SCHEMA` es la autoridad de hojas, columnas, tipos,
serialización, parseo y compatibilidad. Plantilla y Exportar invocan el mismo
escritor con `[]` o con productos. La importación construye un plan completo,
bloquea cualquier ambigüedad y sólo después reemplaza el estado local de una
vez. No se modifica STORE ni el contrato remoto.

## Solución

- `balam/xlsx-io.jsx` publica el esquema `balam.inventory` v1 y un escritor
  compartido. Genera `Inventario`, `Catálogos` y `_BALAM`; esta última queda
  oculta y lleva versión y huellas técnicas.
- El contrato incluye precio general y por talla, colores generales, mapa H-83,
  costo, destacado, URL respaldable, atributos custom, categoría de talla,
  existencias completas e identidad/versión del producto.
- El parser acepta columnas reordenadas y bloquea ausencias, duplicados, versión
  incompatible, talla ambigua, JSON inválido y códigos de catálogo no válidos.
- Los heredados se identifican y advierten. Un campo que no existía se preserva
  en una actualización; no se completa silenciosamente.
- `planImport()` sólo prepara la operación. Actualiza por ID, da de alta sin ID
  únicamente cuando el SKU no existe y trata SKU existente/duplicado como
  conflicto. `applyImportPlan()` verifica que la vista previa no esté obsoleta y
  aplica una sola sustitución atómica.
- `balam/inventory.jsx` presenta altas, actualizaciones, conflictos, stock,
  precios y campos modificados; la confirmación permanece deshabilitada mientras
  exista un conflicto.
- `test-import-fotos.mjs` se adaptó al mismo libro canónico. No cambiaron DATA,
  CONFIG, STORE, Supabase, sincronización, SKU ni el modelo de existencias.

## Pruebas

- `node test-h86-inventory-xlsx-contract.mjs` — **37/37**. Verifica mismo
  escritor/esquema, plantilla vacía, round-trip estable, columnas movidas,
  heredados, catálogo inválido, conflictos y archivo `.xlsx` realmente
  descargado. El fixture histórico exacto de **239 filas / 222 SKU** produce 29
  filas en conflicto y **cero mutaciones**.
- `node test-h83-ornament-colors-by-size.mjs` y E2E — **32/32 + 17/17**.
- `node test-h84-product-form-ux-e2e.mjs` — **19/19**; métricas H-84 válidas.
- `node test-import-fotos.mjs`, `test-export-modelo.mjs` y
  `test-xlsx-security.mjs` — **23/23 + 14/14 + 17/17**.
- `node test-precio-talla-e2e.mjs` y `test-variant-price.mjs` — **19/19 +
  38/38**.
- `node test-product-sizes.mjs`, `test-h63-size-protection.mjs`,
  `test-h67-size-headers.mjs` y `test-h74-codigos-de-talla.mjs` — **9/9 +
  34/34 + 27/27 + 25/25**.
- `node test-filtros-inventario.mjs`, `test-module-contracts.mjs`,
  `test-ui-navigation.mjs`, `test-build-reproducibility.mjs` y
  `test-smoke.mjs bundle` — **18/18 + 41/41 + 15/15 + 8/8 + 17/17**.

## Riesgo residual y pendientes

Un archivo heredado sin ID cuyo SKU ya existe requiere resolución explícita; es
la compatibilidad segura prevista, no una actualización automática. El humo de
fuentes con Babel en navegador excedió el timeout histórico de 30 s por el mayor
tamaño del módulo; el bundle precompilado —artefacto servido— completó el mismo
recorrido en 17/17 y arrancó en 4.3 s.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-86.
- Autoridades: `docs/architect/authorities/inventory.md`.
- Antecedentes: H-36, H-67, H-74, H-83 y H-84.
