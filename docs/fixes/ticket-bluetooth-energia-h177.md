# Tickets cortados a la mitad en la impresora Bluetooth

**Riesgo:** H-177
**Estado:** RESUELTO EN CÓDIGO — confirmación en papel pendiente
**Fecha:** 19/09/2026
**Commit:** `ab083bed14da1142850b4bea90365053b6505cde`

## Problema y reproducción

La tablet usa RawBT directo. Estas fotos son evidencia de papel del dueño del
19/09/2026:

- El ticket de venta sale a 80 mm y en negro, pero se detiene tras
  «Detalle de compra».
- Con la impresora en su cargador llega hasta «Total a pagar».
- El siguiente trabajo arranca con el resto pendiente del anterior.
- El logo sale con rayas.
- El reporte por método sale completo.

El PNG que BALAM genera está completo, y su generación y envío son idénticos
a los del 05/09, cuando la impresión se aceptó en papel (`8a11d74`). El corte
ocurre en la impresora.

Medición del PNG real, en puntos negros:

| Documento | Tinta total | Peor franja de 8 mm |
|---|---|---|
| Venta de 3 prendas | 107,608 | 14,464 |
| Reporte que salió completo | 70,101 | 9,667 |

Puntos de corte en papel: ~38,500 sin cargador y ~71,200 con cargador.

`node test-h177-thermal-ink.mjs` sobre `HEAD`: **3/8**.

## Causa raíz

La impresora no sostiene la energía del ticket de venta. Dos elementos lo
agravan:

- El umbral 200 de H-145 engruesa todo el texto.
- Las superficies sólidas se imprimen como bloques negros: el logo al 96 % y
  las barras decorativas en una franja de 14,464 puntos.

Aparte, la línea de ornamento unía con `' Â· '`, un separador con mala
codificación.

## Diseño

Sólo el PNG RawBT:

- El texto usa umbral de luminancia 128.
- Las imágenes y los fondos oscuros se traman con Bayer 4×4, con un máximo
  del 50 % de tinta.

El diseño, el contenido, los 576 puntos, el formato 0/255 y la impresión del
sistema (H-173) no cambian. El separador de ornamento pasa a `' · '`.

## Solución

- `balam/shared.jsx`: máscara de superficies y umbral en `receiptGraphic`.
- `balam/pos-ticket.jsx`: separador de ornamento.
- `test-h177-thermal-ink.mjs`, añadida al workflow.

## Pruebas

- H-177: 3/8 → **8/8**.
  - Venta: 67,537 puntos, menor que los 70,101 del reporte que salió completo.
  - Peor franja por debajo de 9,667.
  - Reporte también más ligero.
  - Logo tramado a ≤55 % de tinta.
  - Contenido completo hasta el pie y ornamento sin «Â».
- Regresiones: H-173 28/28, H-153 80/80, 12/12 y 3/3, H-168 41/41, UI 6/6 y
  PWA 2/2.
- Inspección visual del PNG simulado: texto negro legible, logo y barras
  tramados.

## Publicación

Actions 35460161544 SUCCESS; `index.html` y `sw.js` públicos idénticos al
commit; `node test-h177-thermal-ink.mjs <Pages>` 8/8.

## Riesgo residual y pendientes

- Papel NOT_TESTED: la tinta total queda un 5 % por debajo del punto donde se
  detuvo con cargador. Si se sigue cortando, la causa es la capacidad física
  de la impresora: batería o densidad configurada en la impresora o en RawBT.
- Tickets más largos (muchas prendas o abonos) piden más tinta por
  naturaleza.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-177`
- `ticket-termico-negro-ancho-h173.md`, `ancho-contraste-ticket-android-h145.md`
