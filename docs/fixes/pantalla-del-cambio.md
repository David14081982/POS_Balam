# Pantalla del cambio, atribución y comprobante (C6)

**Riesgo:** H-42
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** `779b607`

Fase C6 del módulo de Cambios, gobernada por `docs/04-contrato-del-cambio.md` y
`ADR-010`. Hace alcanzable lo que C4 y C5 dejaron construido.

## Problema y reproducción

`recordExchange` y `pos.commit_exchange()` funcionaban, pero ninguna pantalla los
invocaba. Además `base_comision` se calculaba sin poder atribuirse a nadie y no
existía rastro de la revisión que el Contrato §5 exige para recibir la prenda.

`node test-exchange-screen.mjs` antes del cambio: **29 fallos**.

## Diseño

**El tipo de operación se elige al inicio**, sobre la venta ya localizada. El
buscador, la resolución por alias y la etiqueta de plazo se reutilizan tal cual.

**Devoluciones queda intacta.** `ReturnDetail` no cambia una línea: el cambio
vive en `ExchangeDetail`, un componente aparte. El motivo se reutiliza en ambos
flujos; el método de reembolso sigue siendo exclusivo de Devoluciones.

**La pantalla consume autoridades y no reimplementa reglas.** Lo disponible sale
de `saleLineBalance`, el valor reconocido de `recognizedValue`, el precio de lo
que se lleva de `listPrice` y `priceRange`, el plazo de `returnDeadline`, y el
registro pasa **sólo** por `recordExchange`. El dinero lo recalcula el servidor.

**La diferencia usa el checkout completo del POS** y el vendedor se confirma como
en una venta, porque la comisión del excedente es suya (§7). Cuando el cliente se
lleva menos valor del que entrega, la pantalla **exige una confirmación
explícita** antes de cerrar: es dinero que pierde y es la reclamación más
probable del mostrador.

## Por qué una segunda costura en el ticket

La costura `payment` de H-40 acusa **dinero recibido**: concepto, monto, método y
fecha. Un cambio acusa **mercancía intercambiada** —qué entrega y qué recibe—,
que es un hecho distinto y no cabe en esa forma. Reutilizarla habría obligado a
disfrazar el intercambio de pago, y en un cambio sin diferencia no hay pago
alguno que mostrar.

Se añadió `exchange` como segunda costura, hermana de la primera y con la misma
disciplina: añade su bloque y **conserva intacto el resto del documento**
—tienda, transacción, renglones vendidos, desglose fiscal—. Sigue habiendo un
solo formato impreso y una sola autoridad. Sin `exchange` el ticket es
exactamente el de siempre, y la costura de apartados no se tocó.

H-41 llegó justo a tiempo: el comprobante de un cambio es más largo que una
venta y, con el ticket en `position: fixed`, habría nacido cortado.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/returns.jsx` | Selector de operación; `ExchangeDetail`, `ExchangeSizeModal`, `SellerModal` y `ExchangeReceipt`. |
| `balam/pos-ticket.jsx` | `BalamTicket` acepta `exchange` como segunda costura. |
| `balam/data.jsx` | `recordExchange` acepta vendedor, revisor y condición por renglón. |
| `balam/store.jsx` | Transporte de los tres campos. |
| `…006300_pos_h42_exchange_seller_review.sql` | Tres columnas aditivas y `commit_exchange` aditiva. |
| `…006400_…_verification.sql` | Verificación autocontenida. |
| `test-exchange-screen.mjs` | Arnés nuevo, 29 casos. |

La migración se generó desde el texto vigente de `commit_exchange` aplicando sólo
dos ediciones (`R-DB-03`): el diff son **10 líneas en dos bloques**.

## Pruebas

Reproducción previa 29 fallos; después **29/29**. Regresión completa en verde,
incluidos los arneses de las historias concurrentes —apartados 55/55— y
`test-discounts.mjs` 43/43 **sin modificar**. Build offline correcto.

## Despliegue

`006300` y `006400` aplicadas y registradas en `Balam` el 29/07/2026, **a la
primera**:

```
NOTICE: H-42: tres columnas aditivas y nullable
NOTICE: H-42: vendedor, revisor y condicion conservados · lo entregado sin condicion
NOTICE: H-42: un cambio sin los campos nuevos conserva el comportamiento previo
NOTICE: H-42: verificacion completa · columnas, transporte, compatibilidad y limpieza
```

## Riesgo residual y pendientes

- **C7 sigue pendiente**: reportes, liquidación de la comisión del segundo
  vendedor y el desglose de cobrado, que no cuadra con un pago de cambio.
- El catálogo de la pantalla lista los primeros 24 artículos filtrados por
  búsqueda, sin paginación. Suficiente para el mostrador; revisable si crece.
- La revisión de la prenda es **texto libre**, no un catálogo administrable.
  Convertirla en catálogo sería una historia propia.
- El cambio no se probó con dos terminales simultáneas; se apoya en el bloqueo
  estable de `commit_exchange`, ya verificado.
- El arnés de C6 es de contrato sobre la fuente, no un recorrido E2E en el
  navegador como el de precio por talla. La pantalla se ejercita en el bundle
  por `test-ui-navigation` y `test-smoke`, pero el flujo completo del cambio
  —marcar, elegir, cobrar, confirmar, imprimir— no tiene todavía su E2E.

## Referencias

- Contrato: `docs/04-contrato-del-cambio.md`
- Decisión: `docs/architect/decisions/ADR-010-materializacion-del-cambio.md`
- Fases previas: C1 `plazo-posventa.md`, C2 `saldo-por-renglon.md`,
  C4 `modelo-del-cambio.md`, C5 `commit-transaccional-cambio.md`
