# Recuperación geométrica de etiquetas V1 densas sin cambiar identidad

**Riesgo:** H-128
**Estado:** RESUELTO — PENDIENTE DE PUBLICACIÓN
**Fecha:** 28/08/2026
**Commit funcional:** Pendiente de commit

## Problema y reproducción

H-127 clasificó el export vigente de 960 combinaciones con existencia: V1
contiene 828 etiquetas `DENSE` y cuatro `ENCODING_ERROR`; V2 contiene 23 `OK`,
105 `NEAR` y cero `DENSE`. H-128 debía determinar si las 828 V1 podían salir de
`DENSE` exclusivamente cambiando la geometría física 60×40, sin alterar SKU,
barcode, `products.id`, stock, modelo V1/V2 ni Supabase.

La auditoría read-only volvió a leer
`Inventario_Balam_2026-08-19.xlsx` —1,257,788 bytes, SHA-256
`1e6b87a1b184c8d3797273785e3ce0d4b4fd21336deb0fecd3d8137dc9c745b2`—
mediante `XLSXIO.readWorkbook()` y la autoridad `BARCODES`. No invoca import,
guardado, STORE ni red. El detalle real queda fuera de Git; el arnés
`audit-h128-v1-layout-recovery.mjs` reproduce los JSON/CSV privados.

### Límite físico

Los 828 símbolos V1 densos tienen de 233 a 310 módulos. H-128 conserva X
≥ 0.25 mm y usa 10X por lado como criterio conservador de quiet zone. El ancho
mínimo es:

`(módulos + 10 + 10) × 0.25 mm`

Una etiqueta completa de 60 mm admite como máximo
`floor(60 / 0.25 - 20) = 220` módulos. El caso real menos denso ya tiene 233 y
necesita 63.25 mm; el extremo de 310 necesita 82.5 mm. Esto demuestra, antes de
considerar tolerancia de corte, que ninguna de las 828 cabe de forma conforme.

ISO mantiene Code 128 en ISO/IEC 15417:2007. BALAM no declara que estos SKU
sean GS1-128; se toma 10X como criterio conservador publicado por GS1 para
símbolos Code 128/GS1-128, no como permiso para reducir X.

### Resultado por variante

La tabla clasifica las 832 combinaciones V1 con existencia. En todas las filas
admisibles `OK + NEAR + DENSE + ENCODING_ERROR = 832`.

| Layout | OK | NEAR | DENSE | ENCODING_ERROR | Quiet zones | Recuperadas conformes |
|---|---:|---:|---:|---:|---|---:|
| H-127 PNG/PDF JPEG · 56 mm · h60 | 0 | 0 | 828 | 4 | válidas; mínimo 10.464X total | 0 |
| PNG · 56 mm · h80 | 0 | 0 | 828 | 4 | válidas; mínimo 10.464X total | 0 |
| H-128 PNG/PDF JPEG · 56 mm · h100 | 0 | 0 | 828 | 4 | válidas; mínimo 10.464X total | 0 |
| PNG · 59 mm · h100 · 10X internas | 0 | 0 | 828 | 4 | válidas; mínimo 12.144X total | 0 |
| PNG · 60 mm · h100 · 10X internas | 0 | 0 | 828 | 4 | válidas; 10X exactas, sin tolerancia de corte | 0 |
| SVG/vector · 60 mm · h100 · 10X | 0 | 0 | 828 | 4 | válidas; 10X exactas | 0 |
| PDF vector, equivalencia geométrica · 60 mm · h100 · 10X | 0 | 0 | 828 | 4 | válidas; 10X exactas | 0 |
| **Inadmisible:** 60 mm · h100 · 2X | 0 | 42 | 786 | 4 | **inválidas; 2X** | **0** |

La última fila es un control negativo: aparentemente mueve 42 casos de DENSE a
NEAR porque X sube a 0.253165 mm, pero elimina la quiet zone. No es una
alternativa productiva y no cuenta como recuperación.

PNG, SVG o PDF vectorial cambian la fidelidad del borde, no el número de
módulos ni el ancho físico requerido. JsBarcode ya puede generar el mismo
símbolo como SVG. El PDF vigente, en cambio, rasteriza el SVG maestro completo
a JPEG 720×480; hacerlo vectorial exigiría una segunda ruta PDF o un traductor
de barras y pondría en riesgo la autoridad visual única H-99. Como recuperaría
0/828 por geometría, no se implementó ese refactor.

### Casos reales y muestra de densidades

| Caso | Texto codificado | Módulos | X 56 mm | Barra h60 → h100 | X máximo 60 mm + 10X | Resultado |
|---|---|---:|---:|---:|---:|---|
| 769 | `8-769-PIL-NA-CF-27` | 233 | 0.236287 mm | 7.089 → 11.814 mm | 0.237154 mm | DENSE |
| 752 | `8-752-PIL-NA-CF-27` | 233 | 0.236287 mm | 7.089 → 11.814 mm | 0.237154 mm | DENSE |
| PVC10 | `5-PVC10-R/P-NA-VCLA-32` | 277 | 0.199288 mm | 5.979 → 9.964 mm | 0.202020 mm | DENSE |
| V1 típico, mediana | `1-ADR-ML-ALG-TRA-NEG-36` | 288 | 0.191781 mm | 5.753 → 9.589 mm | 0.194805 mm | DENSE |
| V1 largo extremo | `1-LUC-MC-ALG-TRA-VMENF-38` | 310 | 0.178344 mm | 5.350 → 8.917 mm | 0.181818 mm | DENSE |

Distribución completa: 42 etiquetas con 233 módulos, 52 con 244, 27 con 255,
44 con 266, 223 con 277, 210 con 288, 207 con 299 y 23 con 310; total 828.

## Causa raíz

No existe una causa de layout recuperable. El texto V1 materializado produce
más módulos de los que 60 mm pueden contener simultáneamente con X ≥ 0.25 mm y
quiet zones de 10X. Altura, raster/vector y resolución no pueden compensar un
déficit horizontal. La aparente recuperación sólo aparece al violar quiet zones
o el umbral X.

Los cuatro `ENCODING_ERROR` son una causa distinta: contienen literalmente
`Ñ` (`U+00D1`) y JsBarcode 3.11.6 falla antes de producir el símbolo. Code 128
puede representar caracteres extendidos mediante el mecanismo FNC4, pero la
ruta JsBarcode actual no lo implementa de forma utilizable para estos textos.

## Diseño y decisión

La identidad sigue siendo autoridad y no se reescribe. H-128 mantiene:

- etiqueta 60×40 y caja horizontal H-99 x=2, ancho=56 mm;
- X mínimo 0.25 mm y diagnóstico H-127 sin reclasificar;
- quiet zones horizontales actuales;
- SKU materializado H-100 y `barcode_code` V2;
- un mismo SVG maestro para preview, impresión y PDF;
- cero persistencia, cola offline, stock o Supabase en auditoría/pruebas.

La mejora autorizada usa `height=100`, `marginTop=0` y `marginBottom=0`. En los
828 densos aumenta las barras de 5.350–7.089 mm a 8.917–11.814 mm, sin cambiar
módulos, X, quiet zones, estado ni texto. Para símbolos cortos, la caja de
15 mm limita X a 0.30 mm, todavía por encima de la banda `OK` de 0.275 mm.

## Los cuatro casos con `Ñ`

| Producto | Talla | Texto literal | Stock | Resultado actual |
|---|---|---|---:|---|
| TIRA BORDADA (`0TB`) | CH | `3-TB-MC-MNT-MAO-AAÑ-CH` | 1 | ENCODING_ERROR |
| HUGO (`HUG`) | 36 | `1-HUG-MC-ALG-TRA-AAÑ-36` | 2 | ENCODING_ERROR |
| HUGO (`HUG`) | 38 | `1-HUG-MC-ALG-TRA-AAÑ-38` | 3 | ENCODING_ERROR |
| HUGO (`HUG`) | 42 | `1-HUG-MC-ALG-TRA-AAÑ-42` | 2 | ENCODING_ERROR |

Se revisaron read-only 28 exports entre junio y agosto: `AAÑ` está presente en
23 desde el export 11/07; `AAN` aparece en 0/28. No existe precedente histórico
para afirmar que `Ñ→N` conserve identidad.

Decisión:

1. No normalizar ni imprimir un texto diferente silenciosamente.
2. Una historia futura puede evaluar un encoder Code 128 con FNC4 que preserve
   `Ñ`, pero debe certificar bytes/salida HID con el lector real.
3. Cambiar `AAÑ` por `AAN`, asignar otro barcode o convertir V1/V2 requiere
   decisión de negocio y **HARD STOP**.

Por tanto los cuatro no están demostrados como “requieren cambiar identidad”:
podrían requerir sólo otro encoder, pero hoy no son imprimibles con JsBarcode y
no pueden cerrarse sin hardware o autoridad de negocio.

## Hardware y lectura física

La inspección read-only encontró impresoras de oficina HP Smart Tank 510,
Brother DCP-L2540DW y destinos PDF/XPS/OneNote; no encontró impresora térmica de
etiquetas. Los dispositivos HID enumerados fueron teclado, pantalla táctil y
un `USB Gaming Mouse`; no apareció lector de códigos de barras. No se enviaron
trabajos ni se cambió configuración.

| Categoría solicitada | Muestras físicas | Lecturas | Tasa |
|---|---:|---:|---|
| OK | 0 | 0 | NO MEDIDA |
| NEAR | 0 | 0 | NO MEDIDA |
| DENSE moderado | 0 | 0 | NO MEDIDA |
| DENSE severo | 0 | 0 | NO MEDIDA |
| ENCODING_ERROR corregible | 0 | 0 | NO MEDIDA |

`NO MEDIDA` no significa 0% ni aprobación: no existe certificación física.

## Solución

- `balam/barcodes.jsx`: sólo aumenta la altura fuente de 60 a 100 y elimina
  márgenes verticales; el contrato horizontal queda intacto.
- `audit-h128-v1-layout-recovery.mjs`: reproduce las ocho simulaciones y emite
  CSV/JSON fuera de Git.
- `test-h128-v1-layout-recovery.mjs`: fija capacidad, identidad, quiet zones,
  `Ñ`, SVG y mejora vertical.
- `test-h128-label-height-qa.mjs`: BALAM QA sintético sobre 752, 769, PVC10,
  LUCAS, HUGO y V2, con matriz 320–1440 y capturas privadas.
- `test-h127-label-diagnostics.mjs`: actualiza únicamente el alto esperado de
  PVC10, de 6.0 a 10.0 mm.
- `index.html`, `POS Balam (offline).html` y PWA se regeneran desde `balam/`.

No se modificó SKU, barcode, `products.id`, stock, V1/V2, datos históricos,
cola offline ni Supabase comercial.

## Pruebas

- H-128 recuperación geométrica: rojo 8/11; verde 11/11.
- Auditoría vigente: 960/960 combinaciones; ocho layouts; 0 recuperadas,
  828 DENSE al máximo seguro y cuatro ENCODING_ERROR.
- BALAM QA etiquetas: 9/9; 320, 360, 390, 430, 768, 1024, 1280 y 1440 px;
  capturas de modal y cuatro previews en 360/1280; cero escrituras comerciales.
- H-127 autoridad: 9/9; diagnóstico UI: 11/11.
- H-99 visual: 12/12; PDF: 23/23.
- H-100 SKU materializado: 10/10; H-88B móvil: 19/19.
- H-94 referencia V2: 49/49; CONFIG: 30/30.
- H-126 lector: 8/8; E2E POS/Préstamos/Cambios: 37/37.
- Contratos de módulos: 42/42; responsive global: 492/492.
- Smoke bundle publicado: 17/17; navegación: 15/15.
- Build reproducible: 8/8; `node build-offline.mjs` correcto.
- El smoke de desarrollo con Babel agotó su espera de 30 s tanto en H-128 como
  en el commit H-127 intacto; el bundle precompilado arrancó en 3.44 s y pasó.

## Riesgo de alternativas y pendientes

| Alternativa | Beneficio | Riesgo | Decisión H-128 |
|---|---|---|---|
| h100 en 56 mm | barras +66.7%, misma identidad/geometría X | no resuelve densidad; falta lector real | implementada |
| 60 mm con 2X | 42 pasan visualmente a NEAR | quiet zones inválidas y cero tolerancia | prohibida |
| 60 mm con 10X | máximo matemático | recupera 0 y no tolera corte | no implementar |
| SVG | bordes vectoriales en preview/print | recupera 0; puede bifurcar H-99 | viable, diferida |
| PDF vector | evita JPEG | recupera 0; requiere nueva autoridad/renderizador | diferida |
| etiqueta mayor | puede preservar texto e identidad | cambia consumible/impresora/layout | decisión operativa futura |
| texto más corto/barcode nuevo/V2 | reduce módulos | cambia identidad y contratos históricos | HARD STOP |
| encoder FNC4 para `Ñ` | podría conservar el texto | compatibilidad lector/HID no probada | historia técnica futura |

Con la restricción 60×40, las 828 requieren un texto codificado más corto u otra
solución física/simbología; no pueden resolverse por layout. Las cuatro `Ñ`
requieren encoder + hardware o decisión de negocio, no sustitución automática.

BALAM QA observó fuera de alcance que el selector de una impresión
multiproducto V1 muestra `undefined · SKU` porque proyecta `product.sizeCode`.
No afecta la geometría ni fue corregido en H-128; debe registrarse y tratarse en
una historia independiente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-128--la-geometría-6040-puede-no-recuperar-etiquetas-v1-densas-sin-cambiar-identidad`
- [ISO/IEC 15417:2007 — Code 128](https://www.iso.org/standard/43896.html)
- [GS1 General Specifications — quiet zones](https://ref.gs1.org/standards/genspecs/)
- `docs/fixes/autoridad-fisica-code128-h127.md`
- `docs/fixes/jerarquia-visual-etiqueta-60x40.md`
- `docs/fixes/sku-materializado-en-etiquetas.md`
