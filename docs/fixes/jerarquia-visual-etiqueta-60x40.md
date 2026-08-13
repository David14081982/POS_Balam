# Jerarquía visual de la etiqueta 60×40

**Riesgo:** H-99
**Estado:** RESUELTO, PENDIENTE DE PUBLICACIÓN
**Fecha:** 13/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

La referencia `C:\Users\david\Downloads\Etiquetas Balam.pdf` presenta nombre,
barcode, SKU y precio con jerarquía progresiva y distribución equilibrada. La
plantilla vigente mantenía la identidad V2 correcta, pero usaba nombre 9 pt,
SKU 8 pt y precio 12 pt; el SKU largo podía envolver y todo el bloque estaba
centrado verticalmente.

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
reducción proporcional y precio 20 pt/900. La misma estrategia se refleja en
el preview del modal. No se modificó `balam/barcodes.jsx` ni otra lógica.

## Pruebas

- `node test-h99-label-visual.mjs`: roja **4/9**, verde **9/9**;
- SKU corto **12.5 pt**, típico **12.5 pt** y largo **5.57 pt**, todos completos
  y en una línea; precio constante **20 pt**;
- H-88B **19/19**, H-94 **49/49**, H-83 E2E **17/17**;
- navegación **15/15**, smoke bundle **17/17**;
- `node build-offline.mjs`: correcto.

La comparativa A/B/C y los renders están en `.evidence-label-visual/`.

## Riesgo residual y pendientes

La impresión física depende de driver, calibración y densidad de la impresora.
Se conservó la guarda mínima Code128 de H-88B; conviene validar una muestra
física antes de imprimir un lote real. Falta publicar y comprobar los bytes de
Pages.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-99
- `docs/fixes/impresion-etiquetas-movil.md`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
