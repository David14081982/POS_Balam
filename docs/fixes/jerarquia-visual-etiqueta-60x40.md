# Jerarquía visual de la etiqueta 60×40

**Riesgo:** H-99
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 13/08/2026
**Commits:** `c1ed627` (jerarquía), `1f5785e` (paridad) y `4e0ff31`
  (cierre documental)

## Problema y reproducción

La referencia `C:\Users\david\Downloads\Etiquetas Balam.pdf` presenta nombre,
barcode, SKU y precio con jerarquía progresiva y distribución equilibrada. La
plantilla vigente mantenía la identidad V2 correcta, pero usaba nombre 9 pt,
SKU 8 pt y precio 12 pt; el SKU largo podía envolver y todo el bloque estaba
centrado verticalmente.

La revisión posterior del sitio publicado encontró una segunda causa: el modal
de Inventario no consume la plantilla imprimible. Recrea la etiqueta con un
árbol React/Tailwind independiente, con padding, `gap`, barcode y tipografías
propios. Por ello el render aislado aprobado puede ser correcto mientras la
vista previa mantiene proporciones distintas. El arnés original no comparaba
ambas superficies y no detectó la divergencia.

El arnés H-99 recorrió Inventario → detalle → Imprimir etiqueta → vista
imprimible con tres referencias V2 sintéticas ADRIANO/$1,150. La línea base
pasó **4/9**: conservaba 60×40, orden e identidades ocultas, pero fallaba
jerarquía, tamaño, ajuste de SKU y protagonismo del barcode.

## Causa raíz

El defecto estaba exclusivamente en `buildLabelDocument()` y su CSS. Las
constantes 9/8/12 pt, `overflow-wrap:anywhere`, barcode de 60 px y
`justify-content:center` producían la composición observada. `BARCODES.codeOf`,
`barcode_code`, Code128, SKU, precio y stock llegaban correctamente.

## Diseño

- conservar 60×40 mm, 56 mm útiles, quiet zones, `object-fit:contain` y
  `displayValue:false`;
- asignar a nombre, barcode, SKU y precio zonas verticales independientes;
- calcular sólo la tipografía del SKU según su longitud y el ancho físico útil;
- prohibir wrap, truncamiento y ellipsis; el precio nunca depende del SKU;
- conservar toda autoridad de datos e identidad H-94 sin mutaciones.

## Solución

`balam/inventory.jsx` usa nombre 14 pt, barcode 15 mm, SKU hasta 12.5 pt con
reducción proporcional y precio 20 pt/900. `LABEL_LAYOUT_CSS` y
`labelMarkup()` son la autoridad única para preview, documento imprimible,
descarga y compartir. El preview renderiza exactamente ese `.bx-label` físico
60×40 y únicamente escala el bloque completo para caber en pantalla mediante
`transform`; no contiene reglas visuales propias. `labelItem()` comparte
también la proyección de los datos. No se modificó `balam/barcodes.jsx` ni otra
lógica.

## Pruebas

- `node test-h99-label-visual.mjs`: contrato original verde **9/9** y paridad
  preview/impresión **3/3**; total **12/12**;
- SKU corto **12.5 pt**, típico **12.5 pt** y largo **5.57 pt**, todos completos
  y en una línea; precio constante **20 pt**;
- H-88B **19/19** y H-94 **49/49**;
- navegación **15/15**, smoke bundle **17/17**;
- `node build-offline.mjs`: correcto.

La ampliación del arnés compara posiciones normalizadas de nombre, barcode,
SKU y precio, proporción 3:2 y jerarquía tipográfica entre preview e impresión
para las tres longitudes.

La comparativa A/B/C y los renders están en `.evidence-label-visual/`.

## Riesgo residual y pendientes

La impresión física depende de driver, calibración y densidad de la impresora.
Se conservó la guarda mínima Code128 de H-88B; conviene validar una muestra
física antes de imprimir un lote real.

## Publicación

Pages sirve el blob Git exacto `36753c63213031d2aac5d6a9caed0a641a7a1ae8`:
8,970,967 bytes y SHA-256
`c1adc6242a909bebea1ccff4bd7a046c22f1f34951e755db170443fa2fddaa8c`.
Sobre la descarga pública, H-99 pasó **9/9** y H-88B **19/19**.

La corrección de paridad quedó publicada en `1f5785e`. `origin/main` apunta a
ese SHA y Pages entrega el blob Git exacto
`a87db4da74fc262586d955667342b0eeb5b9ad07` (8,971,523 bytes de transferencia;
SHA-256 `c86f019e5d318bfcdcb7ebdd3491a16b95ae1ed434fe9e943a39b6c65c863e4e`).
Sobre esos bytes públicos, el H-99 ampliado pasó **12/12**: contrato maestro
**9/9** y paridad preview/impresión **3/3** para SKU corto, típico y largo.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-99
- `docs/fixes/impresion-etiquetas-movil.md`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
