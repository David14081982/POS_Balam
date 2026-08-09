# Impresión de etiquetas desde móvil

**Riesgo:** H-88B
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 09/08/2026
**Commit técnico:** `e1238e1`

## Problema, causa y solución

La generación, apertura e impresión estaban acopladas: un popup ejecutaba
`window.print()` en `onload` y se cerraba 400 ms después. El flujo confundía
HTML generado, diálogo invocado e impresión física, y dependía de permisos de
popup especialmente frágiles en móvil.

La generación produce ahora un documento estable 60×40 mm. La vista imprimible
ofrece Imprimir mediante gesto directo, Descargar y Compartir cuando el
navegador acepta archivos; no autoimprime ni se autocierra. Si el popup se
bloquea, el modal conserva Descargar y explica el fallback. `BARCODES` valida
el ancho físico estimado de los módulos Code128 y advierte por debajo de
0.25 mm. Edición ofrece “Guardar y abrir etiquetas” y sólo abre después de una
persistencia local exitosa.

No cambiaron SKU, `product_id`, `variant_id`, precios, stock ni la arquitectura
del código de barras.

## Pruebas y publicación

- H-88B: **19/19**: móvil/tablet/escritorio, tres tallas, H83, precio especial,
  SKU largo, 60×40 mm, cero autoimpresión, impresión repetida, popup bloqueado,
  descarga y guardado previo.
- H83 **32/32 + 17/17**; H84 **19/19** y métrica verde; precios por talla
  **38/38**; Inventario **18/18**; responsive **492/492**; smoke **17/17**;
  build reproducible **8/8**.
- Build final SHA-256
  `10D45BB1C3ABFFF2715809BD269D120719B029F45208EC02868A828063B7DFE5`;
  bytes públicos normalizados
  `637C9DFAAE2A40A070EEA81C440E5CDEC3890998F16C1F882E4CA187D683ADED`.
- Sobre esos bytes: H-88B **19/19** y regresión H-88A **30/30**.

## Riesgo residual

La suite demuestra generación, preview e invocación. La impresión física sigue
dependiendo del servicio, driver, impresora y calibración del dispositivo. Los
códigos advertidos requieren una muestra física antes de producir un lote.

