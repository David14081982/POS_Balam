# Los códigos de talla pasan a ser la talla real

**Riesgo:** H-74
**Estado:** RESUELTO — herramienta entregada; la ejecución sobre producción es del dueño
**Fecha:** 03/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El catálogo `size_number` guarda identidades históricas que **no son** la talla que
representan. Medido sobre el export real del dueño
(`Inventario_Balam_2026-08-03.xlsx`, hoja «Catálogos» → mapa de columnas):

| Identidad | Etiqueta | Productos | Piezas |
|---|---|---|---|
| `0` | 38 | 116 | 388 |
| `A` | 40 | 86 | 324 |
| `B` | 42 | 75 | 333 |
| `C` | 44 | 67 | 249 |
| `D` | 46 | 60 | 164 |
| `E` | 48 | 57 | 144 |
| `F` | 49 | 0 | 0 |
| `G` | 50 | 53 | 115 |
| `H` | 52 | 46 | 87 |
| `s` | 0 | 13 | 69 |

**239 productos, 3,596 piezas, 164 productos distintos afectados, 1,873 piezas y
573 combinaciones producto × talla.** Los 239 SKUs llevan el marcador `T`
(`1-ARO-MC-AMAR-T`), así que `BARCODES.codeOf` imprime hoy `…-0` en la etiqueta de
una prenda talla 38.

El código es la identidad con la que el inventario localiza sus piezas
(`ADR-011`), de modo que no existía forma de corregirlo: `updateItem` no toca
`code` por diseño, y borrar y recrear desconecta las existencias.

Reproducción: `node test-h74-codigos-de-talla.mjs` → **4 pasaron, 16 fallaron**
(4/20) antes del cambio.

## Causa raíz

Un solo campo cumple tres funciones —identidad técnica, valor de intercambio y
etiqueta de importación—, que es exactamente el diagnóstico de H-66 (`FF-02`).
H-64 demostró el mapa correcto por la posición que cada código ocupaba en el
catálogo original y corrigió **las etiquetas**, dejando los códigos intactos
porque cambiarlos era una migración física.

Esta historia hace esa migración. **No cierra H-66:** la causa de fondo persiste y
la próxima corrección de un código volverá a ser una migración con reimpresión de
etiquetas. H-66 sigue con su diseño aceptado y sin implementar.

## Diseño

**Contrato.** Renombrar un código de talla es cambiar una identidad, así que el
renombre y la reescritura de todas sus referencias son **una sola operación**. La
huella del inventario —total de piezas, total por producto y número de renglones—
debe ser **idéntica** antes y después: se renombra, no se reubica.

**Autoridades nuevas, mínimas:**

- `CONFIG.renameSizeCodes(kind, pairs, { reorder })` — única puerta que toca
  `code`. Valida orígenes y destinos, **resuelve el orden por sí misma** (aplica
  primero los pares cuyo destino ya está libre y repite; sin avance en una pasada
  hay ciclo y rechaza), y opcionalmente reordena por etiqueta numérica.
- `DATA.migrateSizeCodes({ kind, map, reorder })` — orquesta: guardas, reversa,
  catálogo, inventario y verificación.
- `DATA.liveDocumentCounts()` — cuántos documentos vivos hay y de qué tipo.

**Guardas, en este orden.** Documentos vivos (`DOCUMENTS_PRESENT`, con el desglose),
caché por reconciliar (`RESYNC_REQUIRED`), cola pendiente (`QUEUE_PENDING`), mapa
imposible (`TARGET_TAKEN`, `SOURCE_MISSING`, `DUPLICATE_TARGET`, `RENAME_CYCLE`) e
invariante rota (`INVARIANT_BROKEN`). Cualquiera de ellas **revierte todo**:
catálogo, productos y promociones se restauran desde una copia tomada antes de
empezar.

**Colisión resuelta.** `s → 0` colisiona con el código `0` (la talla 38). Se aplica
`0 → 38` primero, lo que libera `0`, y después `s → 0`.

**Sobrante bien definido.** Un código puede ser origen y destino a la vez, así que
un renglón que quede con `0` **no** es un sobrante: sólo lo es el que conserve un
código de origen que no sea destino de ningún par.

**No alcance.** Migrar documentos —la herramienta se niega si existen—, tocar
cantidades, `size_letter` en producción, los códigos cuya etiqueta no es numérica
(`PZ`, `CH`, `M`, `GR`, `XG`…: son nombres, no códigos equivocados), y H-66.

## Solución

- `balam/config.jsx`: `renameSizeCodes()` y su exportación.
- `balam/data.jsx`: `migrateSizeCodes()`, `liveDocumentCounts()`,
  `sizeMigrationFingerprint()`; reescribe `stock[].talla`, las claves de
  `preciosTalla` y `barcodeUrls`, y `promo.scope.tallas`.
- `balam/settings.jsx`: tarjeta **«Corregir códigos de talla»** en Configuración →
  Catálogos, que propone el mapa sola (sólo tallas con etiqueta numérica), muestra
  los pares, bloquea el botón si hay documentos vivos explicando cuántos, confirma
  antes de aplicar y publica el resultado con cifras, incluidas las etiquetas a
  reimprimir.
- Artefactos regenerados con `node build-offline.mjs`.

## Pruebas

    node test-h74-codigos-de-talla.mjs   25/25   (previo 4 pasaron, 16 fallaron)

Cubre: renombre sin mover piezas; remapeo de precios por talla, códigos de barras
y promociones; resolución de la colisión `s→0`; reordenamiento; que el código de
barras imprima `…-38` y `…-40`; rechazo con documentos vivos **sin tocar nada**;
rechazo de un mapa imposible **sin tocar nada**; y el **recorrido real** por
Configuración → Catálogos accionando el botón.

Regresión ejecutada, toda en verde:

    test-h63-size-protection 34/34 · test-h63-e2e 58/58 · test-h59-size-persistence 12/12
    test-h67-size-headers 27/27 · test-product-sizes 9/9 · test-pos-size-filter-groups 19/19
    test-size-categories-audit 23/23 · test-h71 29/29 · test-h72 16/16 · test-h73 29/29
    test-store-queue 159/159 · test-module-contracts 41/41 · test-precio-talla-e2e 19/19
    test-variant-price 38/38 · test-filtros-inventario 18/18 · test-h68-purga 53/53
    test-reset-pruebas 19/19 · test-benefit-settings-ui 7/7 · test-permission-admin-ui 21/21
    test-discounts 43/43 · test-smoke 15/15 · test-ui-navigation 15/15
    test-build-reproducibility 8/8 · test-ux-metrics sin retroceso

## Riesgo residual y pendientes

- **La ejecución sobre producción no la hace esta sesión.** La base sólo acepta
  escrituras de un administrador con sesión; el dueño pulsa el botón. La
  herramienta comprueba sus premisas contra los datos reales en ese momento.
- **Reimpresión de etiquetas: 573** combinaciones producto × talla (o 1,873 si se
  etiqueta por pieza). Hasta reimprimirlas, esas prendas no se escanean en caja.
- Las imágenes de códigos de barras ya subidas a Storage quedan huérfanas: los
  nombres de archivo se derivan del código. No hay pérdida de datos.
- `promo.scope.tallas` no distingue escala; con los diez códigos migrados no hay
  colisión con `size_letter`, pero la limitación queda registrada.
- **H-66 sigue abierta.** Esta historia corrige el dato, no la causa.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-74
- Antecedentes: `docs/fixes/talla-mal-codificada-en-catalogo.md` (H-64) ·
  `docs/fixes/columnas-de-talla-en-excel.md` (H-67) · H-66 (diseño aceptado)
- Decisión: `ADR-011` · Reglas: `R-DOM-01`, `R-DOM-05`, `R-DEL-05`, `R-DEL-10`,
  `R-DEL-11`, `R-CLI-06`
