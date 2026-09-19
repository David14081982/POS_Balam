# Tickets pequeños, recortados y grises

**Riesgo:** H-173
**Estado:** RESUELTO EN CÓDIGO — papel físico NOT_TESTED
**Fecha:** 19/09/2026
**Commit:** `4609a548776a45c75c399b4cc08fe9d25217eaa3`

## Problema y reproducción

El usuario fotografió dos tickets de 80 mm. El ticket de venta salió con el texto
en unos 4 cm de ancho, gris tramado y sin el código de barras del pie. El ticket
de Reportes → Ingreso por método salió negro y casi del ancho del papel. El
mismo problema afecta a venta, reimpresión, abono, cambio y devolución.

Medición en Chrome con `UI.receiptFrame()`, el camino de impresión del sistema:

| Documento | Alto de página |
|---|---|
| Reporte por método | 217 mm |
| Venta de 1 prenda | 238–274 mm |
| Venta de 6 prendas | 318 mm |
| Abono con 2 prendas | 310 mm |

En la foto, el reporte se imprimió a ~0.83 y la venta a ~0.65 de su escala.
Las dos escalas corresponden a encajar hojas de 217 y 274 mm en un medio de unos
180 mm (180/217 y 180/274). Si el ajuste fuera por ancho, las dos escalas serían
iguales. Con más renglones, el ticket sale más pequeño o el servicio lo recorta.

`node test-h173-ticket-thermal-output.mjs` antes del cambio: **15/28**. Fallan
las 13 comprobaciones del defecto:

- 2 de transporte: la tablet en sitio de escritorio no se reconoce como Android.
- 11 de tinta: hay texto, bordes y fondos grises en la impresión del sistema.

## Causa raíz

1. `usesBluetoothReceipt()` sólo buscaba `Android` en `navigator.userAgent`.
   Chrome para tablets Android abre por omisión el «sitio de escritorio»
   (`X11; Linux x86_64`). Así, la tablet usa `window.print()` en vez del PNG
   RawBT de H-143/H-145. Ese PNG no tiene límite de largo, ocupa 576 puntos y
   sólo contiene negro y blanco. El servicio de impresión encaja la página
   continua en su medio y la encoge.
2. La impresión del sistema conservaba los tonos de pantalla, por decisión
   explícita de H-145: `#475569` en 15 de ~27 textos, bordes `#E2E8F0`, fondos
   claros y dorado. La térmica los traza con puntos y el texto sale gris.

El papel que sale gris demuestra que la impresión no usó el PNG RawBT, porque
ese PNG sólo contiene los valores 0 y 255.

## Diseño

Cambio mínimo en `balam/shared.jsx`. No cambian las plantillas, las alturas, el
PNG RawBT ni los documentos A4.

- La autoridad del transporte reconoce como Android un agente `Linux` táctil
  (`maxTouchPoints > 0`) que no sea `CrOS`. Windows, Mac, Chromebook y Linux
  sin pantalla táctil siguen en la impresión del sistema.
- `receiptFrame()` aplica, sólo con `continuous && !thermal` (la impresión del
  sistema a 80 mm), el mismo umbral 200 del PNG:
  - Texto de luminancia menor a 200 → negro.
  - Bordes → negros.
  - Fondos lisos claros → transparentes.
  - Se conservan el texto claro sobre fondo oscuro, las barras y el logo.

## Solución

- `balam/shared.jsx`: `usesBluetoothReceipt()` y `receiptSolidInk()`, invocado
  desde `receiptFrame()`.
- Artefactos regenerados con `node build-offline.mjs`.
- `test-h173-ticket-thermal-output.mjs`, añadida al workflow de CI.

## Pruebas

- Reproducción: 15/28 antes y **28/28** después. Cubre 7 perfiles de equipo;
  venta de 1 y 6 prendas, abono y devolución; contenido, ancho de 80 mm y A4
  con sus tonos originales. Las alturas no cambian (238, 318, 318 y 198 mm).
- Regresiones verdes sobre el bundle final:
  - `test-h153-print-lifecycle.mjs` 80/80, `test-h153-print-errors.mjs` 12/12
    y `test-h153-print-races.mjs` 3/3.
  - `test-h168-ticket-website.mjs` 41/41.
  - `test-h164-online-ui.mjs` 6/6 y `test-h164-online-pwa.mjs` 2/2 (R-CLI-06).
- Fallos previos, idénticos contra el `index.html` de `HEAD` anterior:
  - `test-h135-continuous-ticket.mjs` 46/61 en los dos bundles.
  - `test-h90-payment-method-ticket-e2e.mjs` 16/21 en los dos bundles.
  - `test-h143`, `test-h144` y `test-h85`: la misma excepción en los dos
    bundles. Llaman a APIs local-first retiradas en H-164
    (`DATA.awaitLocalWriter`, entre otras).
  - `test-ticket-print.mjs` usa `D.saveProducts`, también retirada.
  - `test-h90-payment-method-ticket.mjs` 6/17 sólo lee `data.jsx` y
    `reports.jsx`, que no cambian.
  - Ninguno de estos arneses está en el workflow. No se reparan aquí porque
    quedan fuera del alcance quirúrgico.
- Self-review: el diff productivo se limita a `shared.jsx`. El PNG RawBT
  (`thermal`) y A4 (`continuous:false`) no entran en `receiptSolidInk()`.

## Publicación

- CI y despliegue: workflow `35449953351` SUCCESS (regression y deploy).
- `index.html` y `sw.js` públicos: HTTP 200 e idénticos byte a byte al commit.
  SHA-256 de `index.html`:
  `9f59f0a405faba0f001a22aefdd682babed8dbe13c06c7a431ba28a7adba5b1c`.
- `node test-h173-ticket-thermal-output.mjs <Pages>`: 28/28.

## Riesgo residual y pendientes

- Papel físico NOT_TESTED: no hay impresora térmica en el equipo de desarrollo.
  La prueba final es imprimir una venta en la tablet de la tienda: debe abrir
  RawBT directamente, sin vista previa.
- Una PC con un controlador térmico de largo máximo fijo seguirá encajando la
  página. El texto ya sale negro, pero el tamaño depende de ese controlador
  (papel de rollo continuo o escala 100 %).
- Un equipo Linux con pantalla táctil que no sea Android usaría RawBT. No es un
  equipo de la operación.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-173`
- `ancho-contraste-ticket-android-h145.md`, `salida-android-ancho-rawbt-h146.md`,
  `arquitectura-impresion-confiable-h153.md`
