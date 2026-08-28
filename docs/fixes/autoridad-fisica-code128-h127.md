# Autoridad física Code128 para etiquetas 60×40

**Riesgo:** H-127
**Estado:** RESUELTO LOCALMENTE — PENDIENTE DE PUBLICACIÓN
**Fecha:** 28/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Inventario → Etiquetas mostraba una advertencia universal de códigos
«demasiado largos». El mensaje mezclaba cuatro contratos distintos:

- V1 imprime y codifica el SKU materializado por talla.
- V2 muestra el SKU comercial, pero codifica exclusivamente `barcode_code`.
- JsBarcode cambia el número de módulos según el contenido, no sólo según la
  cantidad de caracteres.
- Preview, PDF e impresión contenían un PNG `width=2`, `margin=4` en una caja
  56×15 mm, mientras el validador medía otro canvas `width=1`, `margin=0`.

La prueba roja fijó `ABCDEFGHIJKLMNOPQ`: 17 caracteres, 222 módulos. El
cálculo anterior informaba 0.252252 mm y lo aceptaba; el PNG real mide 452 px,
por lo que `meet` deja X = 0.247788 mm. H-127 inició 3/9 y terminó 9/9.

### Auditoría read-only del inventario vigente

Se leyó `Inventario_Balam_2026-08-19.xlsx`, no el snapshot del 17/08. El
archivo declara `balam.inventory` v3, 370 filas y fecha
`2026-08-19T05:27:30.281Z`; mide 1,257,788 bytes y su SHA-256 es
`1e6b87a1b184c8d3797273785e3ce0d4b4fd21336deb0fecd3d8137dc9c745b2`.
El arnés usa `XLSXIO.readWorkbook()`, el mapa técnico de tallas embebido y la
autoridad Code128 ejecutable. No llama `planImport()`, `applyImportPlan()`,
DATA.saveProducts, STORE ni Supabase.

Resultado sobre cada producto/talla con existencia:

| Clasificación | Etiquetas base | Piezas en stock | Modelo |
|---|---:|---:|---|
| OK | 23 | 60 | V2 |
| NEAR | 105 | 270 | V2 |
| DENSE | 828 | 3,246 | V1 legacy |
| ENCODING_ERROR | 4 | 8 | V1 legacy |
| Total | 960 | 3,584 | 832 V1 + 128 V2 |

Hay 960 textos Code128 únicos. Las 832 etiquetas base V1 quedan en riesgo:
828 por densidad y cuatro por codificación; equivalen a 3,254 etiquetas si se
imprime una por pieza. No hay barcode faltante, ambigüedad, barcode V2 anómalo
ni fallo de generación en el export auditado. Las cuatro codificaciones no
representables son TIRA BORDADA talla CH
`3-TB-MC-MNT-MAO-AAÑ-CH` y HUGO tallas 36/38/42
`1-HUG-MC-ALG-TRA-AAÑ-<talla>`.

El detalle completo de 960 renglones y su resumen se entregan como archivos
locales fuera de Git porque contienen IDs, stock y barcodes reales. El generador
reproducible `audit-h127-current-inventory.mjs` emite ambos bajo
`.evidence-h127/` cuando recibe expresamente un export local.

### Correspondencia exacta con las fotografías

| Fotografía | Code128 real | Módulos | X efectivo | Alto | Quiet zone total por lado | Resultado |
|---|---|---:|---:|---:|---:|---|
| 769, tallas 27/28/29 | `8-769-PIL-NA-CF-<talla>` | 233 | 0.236287 mm | 7.0886 mm | 2.4726 mm | 3 DENSE |
| 752, tallas 27/29/30/31 | `8-752-PIL-NA-CF-<talla>` | 233 | 0.236287 mm | 7.0886 mm | 2.4726 mm | 4 DENSE |
| PVC10, tallas 32/36 | `5-PVC10-R/P-NA-VCLA-<talla>` | 277 | 0.199288 mm | 5.9786 mm | 2.3986 mm | 2 DENSE |
| VICTOR V2, talla 44 | `B40728BF7CF1B48A` | 211 | 0.260465 mm | 7.8140 mm | 2.5209 mm | 1 NEAR |

Los tres avisos de la primera fotografía son exactamente 769 tallas 27, 28 y
29. VICTOR 44 demuestra por qué el texto visible no permite diagnosticar V2:
el SKU `1-VIC-ML-ALG-TRA-BL-44` no es el texto codificado.

## Causa raíz

`BARCODES.validateLabelCode()` renderizaba una representación auxiliar sin los
márgenes reales y dividía 56 mm entre esa anchura. En cambio, la etiqueta
generaba un PNG con el contrato de impresión y lo escalaba proporcionalmente
dentro de 56×15 mm. La diferencia de ocho píxeles crea falsos negativos cerca
del umbral; en 222 módulos basta para declarar apto un X real menor de 0.25 mm.
La UI sólo conservaba un conteo agregado y atribuía cualquier fallo a longitud.

## Diseño

`BARCODES.LABEL_60X40` es la autoridad física única:

- etiqueta 60×40 mm;
- caja Code128 x=2, y=7.3, 56×15 mm, `xMidYMid meet`;
- Code128, X fuente 2 px, barras 60 px, margen 4 px, valor oculto;
- raster PDF 720×480 JPEG 0.96, equivalente a 304.8 DPI;
- X mínimo 0.25 mm y banda preventiva NEAR hasta 0.275 mm.

El inspector renderiza ese mismo canvas y deriva módulos reales, escala, X,
alto, anchura codificada, márgenes internos, espacio exterior, quiet zones
totales y densidad PDF. `OK` y `NEAR` nunca aceptan X < 0.25 mm. NEAR es una
banda preventiva, no una certificación de hardware.

## Solución

- `balam/barcodes.jsx` publica el contrato y `inspectLabelCode()`; el nombre
  histórico `validateLabelCode()` delega a la misma autoridad.
- `balam/inventory.jsx` deriva del contrato el PNG, SVG maestro, página física,
  raster PDF y diagnóstico.
- La UI enumera producto/modelo, talla, SKU visible, Code128 V2 cuando difiere,
  X, módulos y alto. No expone UUID.
- Densidad, banda preventiva, codificación, barcode faltante, ambigüedad,
  barcode V2 anómalo y generación tienen causas distintas.
- Los conteos usan copias reales y sólo agregan «códigos únicos» cuando
  difieren; el caso sintético verificó `3 etiquetas · 2 códigos únicos`.
- Se eliminó «demasiado largo» y cualquier recomendación de acortar SKU.

No se cambió SKU, `products.id`, `barcode_code`, modelo V1/V2, stock, datos
históricos ni Supabase.

## Pruebas

- H-127 autoridad física: rojo 3/9; verde 9/9.
- H-127 diagnóstico UI: 11/11, incluidas dos tallas, copias por stock,
  ambigüedad, no codificable, faltante, personalizado, generación y 360 px.
- Auditoría vigente: 960/960 renglones clasificados y dos artefactos emitidos.
- H-94 referencia V2: 49/49; CONFIG objetivo: 30/30.
- H-126 lector: 8/8; E2E POS/Préstamos/Cambios: 37/37.
- H-88B etiquetas móviles: 19/19.
- H-99 visual: 12/12; PDF: 23/23.
- H-100 SKU materializado: 10/10.
- Contratos de módulos: 42/42.
- Responsive global: 492/492.
- Smoke del bundle: 17/17; navegación: 15/15.
- Reproducibilidad del build: 8/8; sintaxis de los tres arneses H-127 correcta.
- `node build-offline.mjs`: correcto; artefactos regenerados desde `balam/`.

## Riesgo residual y pendientes

La validación de software demuestra geometría y paridad del render, no lectura
en papel. No se probó una impresora, ribbon/papel, temperatura, velocidad ni un
lector físico; por tanto no existe certificación de hardware. Las 832 etiquetas
V1 en riesgo y las 105 V2 NEAR siguen conservando su identidad real por diseño;
esta corrección las informa y no las reescribe. Publicación y validación de
GitHub Pages quedan pendientes.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-127--la-validación-code128-no-representa-la-geometría-impresa`
- `docs/fixes/jerarquia-visual-etiqueta-60x40.md`
- `docs/fixes/sku-materializado-en-etiquetas.md`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
