# H-03 — Coherencia de cobro, IVA, apartados y devoluciones

## Reproducción previa (CASO 2)

Configuración: precio/subtotal `$1,000.00`, IVA `16%`, `tax.included=false`.

| Capa | Valor antes |
|---|---:|
| `pos.jsx` subtotal | $1,000.00 |
| `pos.jsx` IVA calculado | $160.00 |
| `pos.jsx` grandTotal | $1,160.00 |
| modal de cobro | $1,160.00 |
| total enviado a `recordSale()` | **$1,000.00** |
| `DATA.sales.total` | **$1,000.00** |
| `STORE.pushSale()` / `pos.sales.total` | **$1,000.00** |
| ticket (reaplica IVA vigente) | $1,160.00 |
| cliente/reportes | **$1,000.00** |
| devolución completa (precio base de renglón) | **$1,000.00** |

La pantalla cobraba $1,160.00, pero la fuente persistida decía $1,000.00.

## Pérdida exacta

1. `balam/pos.jsx:onSellerConfirm` enviaba `total: subtotal`, aunque el modal
   había recibido `grandTotal`.
2. `balam/pos-ticket.jsx:CheckoutModal` conservaba `anticipo` únicamente en
   estado React y llamaba `onConfirm(metodo)`. El valor se perdía al cerrar el
   modal, antes de llegar a `pos.jsx`.
3. `recordSale`, `STORE.pushSale` y `MAP.sales.fromRow` no tenían un contrato
   completo para subtotal, IVA, anticipo, saldo ni desglose mixto.
4. El ticket reconstruía impuestos con la configuración actual y la devolución
   confiaba en el precio base recibido desde UI, no en el snapshot de la venta.

## Contrato corregido

Las ventas nuevas guardan `subtotal`, `iva`, `total`, `ivaPct`, `ivaIncluded`,
`anticipo`, `saldo` y, cuando aplica, `pagoEfectivo`/`pagoOtro`. `total` siempre
es el total final de la operación; un apartado conserva por separado lo pagado
y lo pendiente. El ticket y las devoluciones leen el snapshot histórico.

Las ventas anteriores siguen siendo legibles: si faltan los campos nuevos se
usan los campos existentes y el total persistido, sin migrarlas ni reescribirlas.
