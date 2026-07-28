# ADR-010 — El cambio es un documento autónomo con liquidación económica propia

**Estado:** vigente · **Historias:** C4 (origen) · gobernado por `docs/04-contrato-del-cambio.md`

## Contexto

El Contrato del Cambio permite recambiar un artículo recibido en un cambio
anterior y le asigna valor histórico propio, exige que la venta origen conserve
intacta su evidencia financiera, prohíbe que el módulo devuelva efectivo, hereda
el plazo sin reiniciarlo y establece que el excedente de valor —no el artículo—
constituye la base de comisión del segundo vendedor. Había que decidir cómo se
materializa todo eso en el modelo.

## Decisión

Un documento propio, `pos.exchanges` + `pos.exchange_items`, cuyos renglones
llevan `lado` (`devuelto` / `entregado`), con su liquidación económica en la
cabecera: valor reconocido, valor entregado, diferencia, valor no aprovechado y
base de comisión. El cobro de la diferencia se registra en `pos.sale_payments`
con el **folio propio del cambio** y un `tipo` nuevo.

El saldo por renglón se generaliza por simetría: una vista `pos.line_supply`
—renglones `lado = 'entregado'`— se une a `pos.sale_items` dentro del bloque
`sold` de `pos.sale_line_balance()`, de modo que

```
vendida   = sale_items(folio)  ∪  line_supply(folio)
consumida = line_consumption(folio)
```

Una cadena A→B→C queda anclada al folio de la venta de origen y **una sola
autoridad** sigue respondiendo la pregunta.

## Trade-off

**Beneficio obtenido:** las tres autoridades vigentes sobreviven sin
modificarse en su contrato —`listPrice` valora lo entregado, `returnDeadline`
sigue siendo la compuerta, y el saldo se amplía por su propia costura en vez de
duplicarse—. La venta origen queda intacta porque `paymentsForSale(folioVenta)`
filtra por folio. Se conserva **un solo ledger de dinero que entra**, así que la
conciliación de caja sale correcta sin trabajo adicional. No se inventa una
venta artificial para un excedente que es una cifra, no mercancía.

**Costo aceptado:** `pos.sale_payments.folio` deja de significar siempre «folio
de venta» y pasa a significar «folio del documento que originó el cobro»,
desambiguado por `tipo`. Es una polisemia real que hay que documentar en la
columna y respetar en todo consumidor nuevo. Además el desglose de Reportes
—anticipos, abonos— deja de sumar el total cobrado hasta que C7 lo actualice.
Y el módulo suma dos tablas y una vista al esquema, con su verificación.

**Alternativas descartadas:**

- **Venta nueva ligada.** Una venta necesita renglones con cantidad positiva
  (`assertSaleAmounts`) y reserva de stock por renglón (H-01), pero el excedente
  es valor puro y el artículo pertenece al cambio, donde hereda su plazo. Habría
  que duplicar el artículo o crear una venta sin renglones. Además estrenaría
  plazo propio, contra el §6 del contrato.
- **Par devolución + venta.** Reutilizaría dos contratos ya verificados sin
  añadir tablas, pero la devolución mueve dinero y entra en
  `refund_exceeds_sale` —lo que H-35 registró que no debe ocurrir con un
  cambio—, la venta generaría comisión sobre el valor completo entregado en vez
  de sobre el excedente, y el cliente vería dos documentos en lugar de uno.
- **Extender `pos.returns` con un tipo.** `return_items` no tiene `lado` y
  `pos.line_consumption` cuenta **todas** sus filas como consumo: los artículos
  entregados restarían saldo que el cliente sí tiene. Filtrar volvería
  condicional el significado de la vista, que es justo lo que H-35 evitó.
- **Cobro contra el folio de la venta origen.** Rechazado por dos motivos, uno
  de contrato y otro mecánico: viola el §8 —`sum(pagos) > sale.total` y
  `paymentsForSale()` devolvería dinero ajeno a esa venta— y además
  `pos.commit_sale()` ejecuta `delete from pos.sale_payments where folio =
  v_folio` antes de reinsertar, así que **cualquier abono posterior de la venta
  borraría el pago del cambio**.

## Cómo se revierte y qué se rompería

Las tablas son aditivas y la extensión del saldo es compatible hacia atrás:
sin cambios registrados, `line_supply` está vacía y el saldo es idéntico al
actual. Revertir el ledger único —moviendo los pagos de cambio a una tabla
propia— abriría una segunda fuente de verdad del dinero que entra, contra
`docs/trazabilidad-financiera.md`.

## Referencias

`docs/04-contrato-del-cambio.md` · `docs/fixes/saldo-por-renglon.md` ·
`docs/trazabilidad-financiera.md` · `ADR-002`, `ADR-003`, `ADR-006`
