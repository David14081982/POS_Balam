# Dos copias de cada comprobante: cliente y tienda

**Riesgo:** H-179
**Estado:** RESUELTO EN CÓDIGO — confirmación en papel pendiente
**Fecha:** 25/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Cada comprobante salía una sola vez. El dueño pidió una copia para el cliente y
otra para la tienda, en todos los comprobantes: venta, apartado, abono,
liquidación, cambio, devolución y sus reimpresiones.

`node test-h179-receipt-copies.mjs` sobre `HEAD` (`9cf7bc5`): **5/13**. Pasan
el ajuste apagado, los reportes y la ausencia de errores; fallan los cinco
comprobantes con dos copias en computadora, la autoimpresión y los dos pasos
de RawBT.

## Causa raíz

Contrato ausente. `PrintManager.enqueue()` ya aceptaba `copies` (1–50), pero
ningún consumidor lo pedía y todas las copias compartían un único documento
congelado, así que no podían marcarse de forma distinta.

## Diseño

- Ajuste `print.twoCopies` (CONFIG, default `false`), en Configuración →
  Impresión con el `CfgToggle` existente. Sin migración, como `ticket.website`
  (H-168).
- `UI.printReceipt()` es el único punto de decisión. Si el documento es
  `#balam-ticket` o `#balam-return-receipt` y el ajuste está activo, pide dos
  copias con etiquetas `COPIA CLIENTE` y `COPIA TIENDA`. Reportes A4, listados,
  vale de préstamo y ticket por método no cambian: salen una vez.
- `captureReceipt(element, copyLabel)` añade la marca sólo a la copia congelada
  (bloque con borde negro al inicio). El documento en pantalla, los importes y
  `receiptSnapshot` no cambian.
- `prepareReceipt(element, copyLabel)` guarda un PNG RawBT por etiqueta.
  `ReceiptPrintHelp` anticipa la primera copia, porque el intent exige que el
  PNG esté listo en el mismo toque.
- La cola H-153 no cambia de ciclo: cada copia es un trabajo con su documento,
  sus hashes y `copyLabel` en la auditoría. En computadora la segunda se envía
  al cerrar el primer diálogo. En Android cada intent exige un gesto: al
  regresar de RawBT el aviso dice «COPIA TIENDA · 2 de 2» y ofrece «Imprimir
  ticket».
- No se unen las dos copias en un solo PNG: duplicaría el largo y la tinta,
  justo lo que cortaba la impresora Bluetooth (H-177).

## Solución

- `balam/config.jsx`: `print.twoCopies: false`.
- `balam/settings.jsx`: interruptor «Imprimir dos copias (cliente y tienda)».
- `balam/shared.jsx`: etiquetas, marca en la captura, PNG por etiqueta,
  decisión en `printReceipt()` y preparación anticipada.
- `balam/print-manager.jsx`: documento congelado por copia, `copyLabel` en la
  auditoría y copia visible en el aviso.
- `test-h179-receipt-copies.mjs`, añadida al workflow.

## Pruebas

- H-179: 5/13 → **13/13**. Computadora: apagado una impresión sin marca;
  venta, anticipo, abono, cambio y devolución en dos impresiones, COPIA
  CLIENTE y luego COPIA TIENDA, idénticas salvo la marca; autoimpresión con
  dos copias; A4 y ticket por método una vez y sin marca. Tablet: apagado un
  intent; encendido, el primer toque envía sólo COPIA CLIENTE, la segunda no
  sale sin gesto, el aviso nombra COPIA TIENDA y el segundo toque la envía.
  Los PNG enviados coinciden con su hash preparado, difieren entre sí y miden
  576 puntos. Sin errores de página.
- Regresiones: H-178 12/12, H-177 8/8, H-173 28/28, H-168 41/41, H-153
  80/80, 12/12 y 3/3, H-171 controles PASS, ajustes PASS, UI 6/6 y PWA 2/2.
- `test-h90-payment-method-ticket.mjs` da 6/17 igual sobre `HEAD`: arnés fuera
  del workflow y no relacionado.
- Inspección visual del PNG RawBT de COPIA TIENDA.

## Riesgo residual y pendientes

- Papel NOT_TESTED: falta imprimir las dos copias en la impresora Bluetooth.
- En la tablet la segunda copia requiere otro toque; Android no permite abrir
  RawBT sin gesto.
- Con el ajuste activo se usa el doble de papel.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-179`
- `arquitectura-impresion-confiable-h153.md`, `ticket-bluetooth-energia-h177.md`,
  `pagina-web-tickets-h168.md`
