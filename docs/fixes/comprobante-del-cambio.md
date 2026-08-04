# El comprobante habla del tipo real de operación

**Riesgo:** H-73
**Estado:** RESUELTO
**Fecha:** 03/08/2026
**Commit:** `b266ef5`
**Artefacto publicado:** sha256
`7f85b7b2195ead06e6a8f19700e51af0cff83a6ff35ff68470d5c57bc0cacd5c`
(8 836 728 bytes), idéntico byte a byte al `index.html` del commit y verificado
por ejecución sobre `https://david14081982.github.io/POS_Balam/`
(`verify-h73-publicado.mjs` 9/9).

## Problema y reproducción

Una venta de contado con un cambio de mercancía cobrado salía impresa con
vocabulario de apartado. Reproducido sobre el artefacto publicado, imprimiendo el
comprobante de una venta en efectivo con un cambio de $500 de diferencia:

    … DIFERENCIA … | APARTADO | BG-260803-0001 | FECHA | … |
    MERCANCÍA ENTREGADA | … | Pagado a la fecha | $1,000.00 |
    Saldo pendiente | LIQUIDADO | HISTORIAL DE PAGOS …

Cuatro defectos de presentación en un solo documento:

1. el renglón de la transacción se rotulaba **APARTADO** en vez de «Transacción»;
2. el detalle se titulaba **MERCANCÍA ENTREGADA** en vez de «Detalle de compra»;
3. aparecían **Pagado a la fecha**, **Saldo pendiente** y **LIQUIDADO**, que no
   significan nada en una venta ya pagada;
4. se **ocultaba el bloque «Método de pago»** de la venta.

El cliente recibía un papel que decía que su compra de contado era un apartado
liquidado.

Reproducción previa: `test-h73-comprobante-del-cambio.mjs` → **25 pasaron, 4
fallaron** (25/29). Los cuatro fallos son el caso 1 —cambio con diferencia a favor
del negocio—; los casos de apartado y de venta simple ya pasaban y actúan de
guarda.

## Causa raíz

`balam/pos-ticket.jsx` § `BalamTicket`. El documento decidía su vocabulario por la
**presencia** de la costura `payment`, no por lo que esa costura significaba:

    const conCobranza = esApartado || !!payment;
    …
    info(payment ? 'Apartado' : 'Transacción', sale.folio, 'font-medium')
    …
    payment ? null : /* bloque Método de pago */

La costura nació en H-40 para la cobranza de apartados y C6 la reutilizó para
acusar la diferencia de un cambio, que es un hecho distinto. Al no existir
discriminación por tipo, el acuse del cambio heredó todo el vocabulario del
apartado.

El dato para distinguirlos **ya viajaba en el documento** y nadie lo miraba: el
apartado etiqueta sus pagos como `anticipo`, `abono` y `liquidacion`
(`balam/data.jsx` § `salePaymentDraft`), y el cambio como `cambio`
(`balam/data.jsx` § `recordExchange`).

## Diseño

**Contrato.** El vocabulario del comprobante lo decide el **tipo real de la
operación**, no la presencia de una costura. Sólo la cobranza de un apartado
—`anticipo`, `abono`, `liquidacion`— justifica el lenguaje de apartado.

**Alcance.** Únicamente presentación. No se tocó ningún importe, ninguna
autoridad de negocio, ningún documento persistido ni el modelo del cambio. Un
comprobante ya emitido que se reimprima muestra el mismo contenido con el rótulo
correcto.

**Extensión, no modificación.** `CONCEPTO` gana la entrada `cambio` en vez de caer
al genérico «Pago recibido», de modo que el acuse declara el sentido del dinero:
**«Diferencia de cambio cobrada»**. Un tipo desconocido sigue cayendo al genérico
y no adopta vocabulario de apartado.

## Solución

`balam/pos-ticket.jsx`, tres cambios:

- `COBRANZA_APARTADO = ['anticipo','abono','liquidacion']` y
  `esCobranzaApartado`; `conCobranza = esApartado || esCobranzaApartado`.
- El rótulo de la transacción pasa a decidirse con `conCobranza`.
- El bloque «Método de pago» se oculta sólo en una cobranza de apartado, no en
  cualquier acuse: en un cambio, el método de la venta y el de la diferencia son
  dos hechos distintos y ambos interesan.
- `CONCEPTO.cambio = 'Diferencia de cambio cobrada'`.

Artefactos regenerados con `node build-offline.mjs`.

### Resultado impreso

    DIFERENCIA DE CAMBIO COBRADA | $500.00 | Recibido en Efectivo · fecha
    CAMBIO DE MERCANCIA | CMB-1 | Sobre la venta BG-260803-0001
    ENTREGA | 1 × GUAYABERA · talla S · $1,000.00
    RECIBE  | 1 × OTRA · talla M · $1,500.00 | Diferencia pagada · $500.00
    TRANSACCIÓN | BG-260803-0001 | FECHA | … | DETALLE DE COMPRA | …
    MÉTODO DE PAGO | Efectivo

## Pruebas

    node test-h73-comprobante-del-cambio.mjs   29/29   (previo 25 pasaron, 4 fallaron)

Cubre los tres cambios que pidió el dueño del producto y el guarda del apartado:

| Caso | Qué afirma |
|---|---|
| Diferencia a favor del negocio | dice CAMBIO, importe, sentido del pago, método, «Transacción», «Detalle de compra» y **cero** vocabulario de apartado |
| Diferencia a favor del cliente | declara el saldo no aprovechado y que no se reembolsa; sin vocabulario de apartado |
| Cambio sin diferencia | no anuncia diferencia ni sobrante; sin vocabulario de apartado |
| Anticipo · abono · liquidación | conservan «Anticipo/Abono/Liquidación de apartado», APARTADO, «Mercancía apartada», «Saldo pendiente», «Mercancía entregada» y LIQUIDADO |
| Venta de contado | «Transacción», «Detalle de compra» y su método de pago |

Regresión ejecutada, toda en verde:

    node test-ticket-print.mjs             23/23
    node test-cambio-e2e.mjs               37/37
    node test-layaway-screen.mjs           55/55
    node test-h65-layaway-e2e.mjs          28/28
    node test-exchange-screen.mjs          45/45
    node test-exchange-reports.mjs         24/24
    node test-liquidations.mjs             12/12
    node test-h72-identidad-posventa.mjs   16/16
    node test-h71-devolucion-identidad.mjs 29/29
    node test-smoke.mjs                    15/15
    node test-ui-navigation.mjs            15/15
    node test-module-contracts.mjs         41/41
    node test-build-reproducibility.mjs      8/8
    node test-ux-metrics.mjs               sin retroceso (11 interacciones, 2 validaciones)

## Riesgo residual y pendientes

- Un pago con un `tipo` no previsto sigue cayendo al genérico «Pago recibido», que
  es el comportamiento deseado: no adopta vocabulario ajeno.
- D-3 (un comprobante emitido cambia si después se edita el producto) y D-5
  (imprimir en Reportes saca hoja en blanco) siguen abiertos y fuera de alcance.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-73
- Costuras del comprobante: `docs/fixes/pantalla-apartados.md` (H-40) ·
  `docs/fixes/pantalla-del-cambio.md` (H-42)
- Decisión: `ADR-003` · Reglas: `R-DEL-05`, `R-DEL-11`, `R-CLI-06`, `R-DOM-05`
