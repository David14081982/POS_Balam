# Ticket de venta más corto

**Riesgo:** H-178
**Estado:** RESUELTO EN CÓDIGO — confirmación en papel pendiente
**Fecha:** 25/09/2026
**Commit:** `e9b4dfbaea87e2e19725a5fc9822aaffb1491e07`; corrección: `20c6719761b763e83a1add8d87bbacf375b62bd7`

## Corrección del dueño (25/09/2026)

Tras ver la primera versión publicada, el dueño pidió **conservar el recuadro
«Método de pago» con su icono** en la venta normal. Siguen fuera sólo el
historial de pagos y las barras decorativas. La prueba se actualizó primero:
sobre `4827953` dio **9/12** (faltaba el método en contado, mixta y
reimpresión) y con la corrección **12/12**. PNG RawBT de la venta:
2537 → **2088 px** (−449 px, unos 5.6 cm). El icono es el configurado en
`payment_method.meta.icon`; no cambió.

## Problema y reproducción

El dueño mostró dos tickets de venta (BG-260922-0002 y -0003) y marcó tres
partes que no quiere imprimir, porque alargan el rollo sin servir al cliente:

- el recuadro «Método de pago»;
- el recuadro «Historial de pagos» con «Total pagado»;
- el código de barras del pie. Es decorativo: se deriva del folio y ningún
  lector lo interpreta.

Alcance decidido por el dueño: **sólo la venta normal y su reimpresión**.
Apartados, abonos, liquidaciones y cambios quedan como estaban.

`node test-h178-sale-ticket-trim.mjs` sobre `HEAD` (`e7c05ea`): **9/12**. Fallan
venta de contado, venta mixta y reimpresión de venta; pasan los siete
documentos que no deben cambiar. PNG RawBT de la venta: 2537 px de alto.

## Causa raíz

No es un defecto: es un contrato de presentación ausente. `BalamTicket` es la
única plantilla de venta, apartado, cobranza, cambio y reimpresión. Los tres
bloques se imprimían para todo documento que no fuera cobranza de apartado
(`pos-ticket.jsx`, método de pago, historial y barras del pie).

## Diseño

`ventaNormal` se decide con datos que ya viajan en el documento:

- sin costura `payment` (no es acuse de cobranza ni diferencia de cambio);
- sin costura `exchange`;
- estado distinto de `Apartado`;
- no es cortesía (`valorRegalado`): ahí «Cortesía» explica el total $0;
- ningún pago del folio es `anticipo`, `abono` o `liquidacion`. Así un
  apartado ya liquidado y reimpreso sigue siendo un documento de apartado.

Una venta con un cambio posterior, reimpresa desde Reportes, es el ticket de la
venta: se imprime corto. El comprobante del cambio conserva su documento.

Sólo cambia lo impreso: método y pagos siguen guardados y alimentan Reportes y
el ticket por método. Los importes, el snapshot `receiptSnapshot`, el
transporte (RawBT y diálogo del sistema) y el pie con la página web no cambian.

## Solución

- `balam/pos-ticket.jsx`: `ventaNormal` omite historial y barras (tras la
  corrección, el método de pago se conserva).
- `test-h178-sale-ticket-trim.mjs`, añadida al workflow.

## Pruebas

- H-178: 9/12 → **12/12**. Venta de contado, mixta y reimpresión con cambio
  sin los tres bloques. Conservan contenido: encabezado, detalle, SKU,
  ornamento, importe, IVA, total, pie y página web. Anticipo, abono,
  liquidación, apartado liquidado reimpreso, cambio y cortesía sin cambios.
- PNG RawBT de la venta: 2537 → **1893 px** (−644 px, unos 8 cm de rollo).
- Regresiones: H-177 8/8, H-173 28/28, H-168 41/41, H-153 80/80, 12/12 y
  3/3, UI 6/6 y PWA 2/2.
- Inspección visual del PNG de la venta BG-260922-0003.
- `test-h73-comprobante-del-cambio.mjs` y `test-ticket-print.mjs` afirmaban
  «Método de pago» en la venta; no se ejecutan desde H-164 (fallan igual
  sobre `HEAD` al preparar datos local-first) y no se modificaron.

## Publicación

Actions 36169219922 SUCCESS; `index.html` y `sw.js` públicos idénticos al commit.
SHA-256 `index.html`: `EA3D9AEC6C1DB974EB7054906653C29D44E73D81D48BAB0A37D16D2F8FBF0DEB`;
`node test-h178-sale-ticket-trim.mjs <Pages>` 12/12.

Corrección: Actions 36172033017 SUCCESS tras reintentar el job; el primer intento
falló en `test-h167-label-performance.mjs` 154/155 (PDF de 10 etiquetas), prueba
ajena al ticket que dio 155/155 local y en el reintento. HTML/SW públicos
idénticos; SHA-256 `index.html`: `C20527CDF6D2CC52C239B7F1DFB26BB8756DE57E5E40A15CBCD89CCB0212CE83`;
Pages 12/12.

## Riesgo residual y pendientes

- Papel NOT_TESTED: falta imprimir una venta real en la impresora Bluetooth.
- El ticket de venta ya no lista los movimientos de pago; el método sí se
  imprime y el detalle está en Reportes.
- Pendiente de decisión aparte: imprimir dos copias (tienda y cliente).

## Referencias

- Riesgo: `docs/03-known-risks.md#h-178`
- `comprobante-del-cambio.md` (H-73), `ticket-bluetooth-energia-h177.md`
