# El comprobante impreso se cortaba en la primera hoja

**Riesgo:** H-41
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** `ce235ff`

**Actualización 05/09/2026 — H-135:** se conserva la solución de H-41 contra
recortes, pero su contrato de paginación fue reemplazado por una página térmica
de altura medida. La afirmación histórica de que `size: 80mm auto` produce una
tira continua era incorrecta: el PDF real cae en carta. Ver
`ticket-termico-continuo-h135.md` para la evidencia y el contrato vigente.

## Problema y reproducción

Reportado por el dueño tras usar la cobranza de apartados en producción: al imprimir
el comprobante de un segundo abono, el historial de pagos no aparecía, y dos
comprobantes del mismo apartado «se veían diferentes».

Reproducción sobre el bundle (`index.html`), en medio `print` y con impresión real a
PDF:

1. Apartado de 3 piezas, total `$5,800`, anticipo `$1,000`.
2. Abonar `$1,500` con tarjeta e imprimir. Abonar `$1,200` por transferencia e
   imprimir. Abonar `$900` en efectivo e imprimir.
3. Medir el comprobante montado y contar las hojas del PDF.

| | alto del comprobante | alto imprimible | hojas del PDF |
|---|---|---|---|
| 1er abono | 1543 px | **950 px** | **1** |
| 2º abono | 1587 px | **950 px** | **1** |
| 3er abono | 1606 px | **950 px** | **1** |

El papel sólo recibía los primeros ~1056 px. El corte caía justo después de «Pagado
a la fecha»: **el saldo pendiente y el historial de pagos completo quedaban fuera**,
igual que el pie con el código de barras. Y como el comprobante crece con cada
abono, el corte caía en un sitio distinto cada vez: de ahí que dos tickets del mismo
apartado no se parecieran.

El defecto no es de la cobranza. Una **venta** de 6 renglones mide 1628 px y se
cortaba exactamente igual desde siempre; sólo que un ticket de venta corriente cabía
y nadie lo había notado.

## Causa raíz

`POS Balam.html` montaba el comprobante así:

```css
#balam-ticket { position: fixed; left: -99999px; top: 0; width: 80mm; }
@media print {
  body * { visibility: hidden !important; }
  #balam-ticket, #balam-ticket * { visibility: visible !important; }
  #balam-ticket { left: 0 !important; top: 0 !important; }
  @page { size: 80mm auto; margin: 0; }
}
```

Dos decisiones se combinan y rompen la paginación:

1. **`position: fixed` saca al comprobante del flujo del documento.** Un elemento
   fijo no aporta altura, así que el documento a imprimir seguía midiendo lo que la
   ventana (950 px). El navegador no tenía motivo para generar una segunda hoja y
   todo lo que excedía la primera se descartaba. `@page { size: 80mm auto }` no lo
   salva: `auto` dimensiona la hoja, no inventa hojas para contenido fuera de flujo.
2. **`visibility: hidden` oculta pero no colapsa.** Las cajas de la aplicación
   seguían ocupando su sitio, de modo que el documento tampoco podía encogerse a la
   altura del comprobante.

A esto se sumaba que el comprobante se renderizaba **dentro del árbol de la
pantalla**, atrapado en contenedores con `overflow-y: auto` y altura de ventana, que
lo habrían recortado igualmente al devolverlo al flujo.

## Diseño

Contrato correcto: **al imprimir, el comprobante es el documento**. Si mide más que
una hoja, el navegador reparte el contenido en las que hagan falta.

1. **Portal a `<body>`.** `BalamTicket` se monta con `ReactDOM.createPortal` como
   hijo directo de `<body>`, fuera de cualquier contenedor con scroll. En pantalla
   sigue escondido (`position: absolute; left: -99999px`), como antes.
2. **En `@media print` el comprobante vuelve al flujo:** `position: static`, y la
   aplicación sale del layout con `#root { display: none }` —no `visibility`, que
   dejaba las cajas ocupando espacio—. Así la altura del documento pasa a ser
   exactamente la del comprobante y la paginación es la del navegador, sin trucos.
3. **Nada se parte por la mitad.** Los bloques del comprobante —encabezado, acuse del
   pago, datos, cada renglón de mercancía, totales, historial de pagos y pie— llevan
   la clase `tk-block` con `break-inside: avoid`. Si el corte cae dentro de un
   bloque, el bloque entero baja a la hoja siguiente.
4. **Sin glifos frágiles.** El marcador del pago actual pasó de `←` a `(este pago)`:
   una impresora térmica no siempre tiene la flecha en su juego de caracteres.

### Sobre imprimir en una segunda hoja

La pregunta del dueño era si el sobrante puede continuar «como hoja 2» en vez de
perderse. Con este cambio, sí: es exactamente lo que hace ahora el navegador. Dos
matices que conviene tener escritos:

- **Supuesto original, corregido por H-135:** `@page { size: 80mm auto }` no
  garantiza una tira continua; el PDF observado usa páginas carta. H-135 fija
  ancho y altura explícitos a partir del comprobante renderizado.
- **En impresora de hojas** (o «Guardar como PDF») el comprobante continúa en la hoja
  siguiente sin cortar ningún bloque. Lo que **no** se puede hacer con CSS soportado
  por el navegador es numerar las hojas («Hoja 2 de 2») ni repetir el encabezado sólo
  a partir de la segunda: las cajas de margen de `@page` y los contadores de página
  no están implementados en Chrome. Si el negocio necesita esa numeración, la vía es
  la misma que ya usa el listado de apartados —construir el documento en una ventana
  propia con su maquetación— y queda fuera del alcance de esta corrección.

## Solución

| Archivo | Cambio |
|---|---|
| `POS Balam.html` | Regla de impresión reescrita: `#balam-ticket` en `position: absolute` fuera de pantalla y `static` al imprimir; `#root` se retira del layout con `display: none`; `html, body` con altura automática; clase `.tk-block` con `break-inside: avoid`. |
| `balam/pos-ticket.jsx` | `BalamTicket` se monta con `ReactDOM.createPortal` en `<body>`; ocho bloques marcados `tk-block`; el marcador del pago actual deja de usar `←`. |
| `test-ticket-print.mjs` | **Nuevo.** Arnés de impresión: mide en medio `print` e imprime a PDF real. |
| `index.html`, `POS Balam (offline).html` | Regenerados con `node build-offline.mjs`. |

Ningún cambio en datos, dominio, sincronización ni en el contenido del comprobante:
lo que se imprimía correctamente sigue idéntico; lo que se perdía ahora llega al
papel.

## Pruebas

```
node build-offline.mjs                 OK -> index.html (copia para deploy)
node test-ticket-print.mjs             23/23 verificaciones
node test-layaway-screen.mjs           55/55 verificaciones
node test-smoke.mjs                    15 pasaron, 0 fallaron
node test-ui-navigation.mjs            14 pasaron, 0 fallaron
node test-module-contracts.mjs         37 pasaron, 0 fallaron
node test-folio-concurrency.mjs        12 pasaron, 0 fallaron
node test-discount-trace.mjs           65 pasaron, 0 fallaron
node test-precio-talla-e2e.mjs         19 pasaron, 0 fallaron
node test-returns.mjs                  17 pasaron, 0 fallaron
node test-store-queue.mjs             115 pasaron, 0 fallaron
node test-sale-coherence.mjs           17 pasaron, 0 fallaron
node test-build-reproducibility.mjs     8 pasaron, 0 fallaron
```

`test-ticket-print.mjs` es la reproducción convertida en arnés permanente. Mide el
comprobante en medio `print` y lo imprime a PDF con `page.pdf()`, comprobando que:

- el comprobante cuelga directo de `<body>` y no es `position: fixed` al imprimir;
- la aplicación no se imprime;
- la altura del documento coincide con la del comprobante (±2 px);
- el comprobante mide **más** que una hoja —el caso exacto del defecto— y el PDF trae
  hojas suficientes para contenerlo entero;
- el historial de pagos y el pie llegan a lo impreso en el 1er, 2º y 3er abono, con
  sus movimientos, su suma y el pago del día marcado;
- el ticket de venta del POS hereda el arreglo: una venta de 6 renglones (1628 px)
  cabe entera y conserva «Detalle de compra», «Total a pagar» y «Método de pago» sin
  rastro del lenguaje de cobranza.

Antes del cambio, con la misma reproducción: 1 hoja para 1543 px, historial fuera del
papel.

## Despliegue

- Artefactos regenerados con `node build-offline.mjs` antes del commit.
- Sin migraciones: la corrección no toca el esquema.
- Publicado por el hook `post-commit` en `https://david14081982.github.io/POS_Balam/`.
- Artefacto servido verificado contra el `index.html` del commit `ce235ff`:
  idéntico byte a byte, SHA-256
  `7466A9A493569A89B0C06E079A4A0148D0CD05A40B078E0785BEF416BE71A6C0`
  (mismo hash en `index.html` y en `POS Balam (offline).html`).

## Riesgo residual y pendientes

- **No hay numeración de hojas.** Descrito arriba: el navegador no lo permite con CSS
  soportado. Si aparecen comprobantes de dos hojas con frecuencia, la alternativa es
  compactar el comprobante para impresión —márgenes y pie— o generarlo en ventana
  propia con maquetación paginada.
- **La altura de hoja de referencia del arnés (1056 px) es la de Chrome** cuando
  `@page` usa altura `auto`. Si el navegador cambiara ese valor, el arnés seguiría
  siendo válido —compara papel disponible contra alto del comprobante—, pero el
  número de hojas esperado variaría.
- **El botón «Imprimir» de Reportes sigue sacando hoja en blanco**, porque fuera del
  Punto de venta y de Apartados no hay comprobante montado. Es el mismo defecto
  previo ya declarado en H-40; este cambio no lo agrava ni lo corrige.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-41
- Historia que expuso el defecto: `docs/fixes/pantalla-apartados.md` (H-40)
- Autoridad del comprobante: `balam/pos-ticket.jsx` § `BalamTicket`
