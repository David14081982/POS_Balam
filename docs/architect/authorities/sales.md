---
capa: conocimiento
applies_to: [domain]
related_histories: [H-02, H-03, H-29, H-31, H-32, H-33, H-34, H-35]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Venta y posventa

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Cuántas unidades de este renglón siguen disponibles?
**Autoridad:** `pos.sale_line_balance()` · espejo local `DATA.saleLineBalance()`
**Definición:** `supabase/migrations/20260728004700_pos_h35_line_balance.sql`
**Creada por:** H-35 · **Decisión:** `ADR-003`
**Consumidores:** `grep -rn "sale_line_balance\|saleLineBalance" supabase/ balam/`

## ¿A qué producto pertenece este renglón devuelto?
**Autoridad:** `resolveReturnProduct(sale, line)` — interna a `balam/data.jsx`,
como `resolveLayawayProduct`; no se exporta en `window.DATA`. Identidad tomada del
renglón **congelado en la venta**; el SKU sólo adopta documentos históricos y
únicamente si identifica un producto único. **Consume** `resolveLayawayProduct()`
(H-65) en vez de reimplementar la regla: sólo traduce el mensaje y conserva su
`code`. Sin identidad resoluble la devolución se rechaza entera
**Definición:** `balam/data.jsx` · `docs/fixes/devolucion-por-identidad.md`
**Creada por:** H-71 · **Ampliada por:** H-72 — la línea de la venta tiene
precedencia sobre el `productId` que envíe el llamador, y `saleLineProduct()` es
la misma resolución **sin lanzar** (devuelve `null`) para que la interfaz pinte un
renglón sin poder mover existencias. Consumida también por `recordExchange`
**Decisiones:** `ADR-011`, `ADR-002`
**Consumidores:** `grep -rn "resolveReturnProduct\|saleLineProduct" balam/ test-*.mjs`

## ¿A qué renglón de existencias regresa esta pieza?
**Autoridad:** `resolveReturnStockEntry(product, talla)` — interna a
`balam/data.jsx`. `stockVariantOf()` primero y `stockEntryByIdentity()` como
respaldo, que localiza el renglón por el valor **crudo** de talla y no depende del
catálogo vigente. Cero o varias coincidencias equivalentes ⇒ bloqueo
`STOCK_IDENTITY_AMBIGUOUS`; nunca se elige una en silencio
**Definición:** `balam/data.jsx` · `docs/fixes/identidad-en-posventa.md`
**Creada por:** H-72 · **Decisión:** `ADR-011`
**Consumidores:** `grep -rn "resolveReturnStockEntry" balam/ test-*.mjs`

## ¿Qué valor histórico se le reconoce a la pieza que el cliente entrega?
**Autoridad:** pendiente de implementar en C4 — una sola, consumida por SQL,
cliente e interfaz. Debe resolver tanto piezas provenientes de `pos.sale_items`
como piezas entregadas en un cambio anterior, que adquieren valor histórico
propio (`docs/04-contrato-del-cambio.md` § 3)
**Definición:** `docs/04-contrato-del-cambio.md` § 3 · `ADR-010`
**Creada por:** C4
**Consumidores:** `grep -rn "valorReconocido\|recognized" balam/ supabase/`

## ¿Hasta cuándo admite devolución esta venta?
**Autoridad:** `DATA.returnDeadline()`
**Definición:** `balam/data.jsx` · `docs/02-architecture.md` § Plazo de posventa
**Creada por:** H-34 · **Decisión:** `ADR-002`
**Consumidores:** `grep -rn "returnDeadline" balam/ test-*.mjs`

## ¿Puede devolverse esta venta por su estado?
**Autoridad:** `DATA.isReturnable()` — compuerta **ortogonal** al plazo
**Definición:** `balam/data.jsx`
**Creada por:** anterior a H-34; su ortogonalidad se fijó en H-34
**Consumidores:** `grep -rn "isReturnable" balam/ test-*.mjs`

## ¿Qué folio comercial lleva esta venta?
**Autoridad:** `DATA.nextFolio()` · unicidad en `pos.folio_counters`
**Definición:** `docs/02-architecture.md` § Identidad y folio de venta
**Creada por:** H-02 → H-33 · **Decisión:** `ADR-001`
**Consumidores:** `grep -rn "nextFolio\|reserve_folio_block" balam/ supabase/`

## ¿A qué venta corresponde este folio impreso?
**Autoridad:** `DATA.findSaleByFolio()` — folio vigente primero, alias después
**Definición:** `balam/data.jsx` · `docs/02-architecture.md` § El folio impreso no cambia
**Creada por:** H-33 · **Decisión:** `ADR-001`
**Consumidores:** `grep -rn "findSaleByFolio\|folioAliases" balam/`

## ¿Qué precio tiene este renglón y por qué?
**Autoridad:** `DATA.resolveLineDiscount()` — el renglón es dueño de su precio
**Definición:** `balam/data.jsx` · evidencia en `pos.sale_items.promos`
**Creada por:** H-32 · **Decisión:** `ADR-002`
**Consumidores:** `grep -rn "resolveLineDiscount" balam/`

## ¿Cuánto debe pagar esta venta después de todos sus descuentos?
**Autoridad:** `DATA.saleQuote(ticket, applications)`
**Definición:** `balam/data.jsx` · snapshot en
`pos.sales.descuentos_adicionales` y `pos.sale_items.descuento_adicional`
**Creada por:** H-52 · **Decisiones:** `ADR-002`, `ADR-003`
**Consumidores:** `grep -rn "saleQuote" balam/ test-*.mjs`

## ¿Cuánto se cobró realmente por esta venta?
**Autoridad:** snapshot financiero de `pos.sales` + `pos.sale_payments`
**Definición:** `docs/trazabilidad-financiera.md` · `docs/H-03-coherencia-cobro.md`
**Creada por:** H-03 · **Decisión:** `ADR-002`
**Consumidores:** `grep -rn "subtotal\|saldo\|sale_payments" balam/ supabase/`

## ¿Qué comisión le corresponde a este vendedor?
**Autoridad:** `DATA.resolveSellerCommission()` — existe, pero por alcance de
H-31 todavía no gobierna los cálculos financieros
**Definición:** `docs/02-architecture.md` § Autoridad de comisión efectiva
**Creada por:** H-31
**Consumidores:** `grep -rn "resolveSellerCommission" balam/`

## ¿Quién puede ser vendedor de una venta?
**Autoridad:** `DATA.isEligibleSeller()`
**Definición:** `docs/02-architecture.md` § Personal y elegibilidad comercial
**Creada por:** H-29
**Consumidores:** `grep -rn "isEligibleSeller" balam/`

## ¿Qué mercancía salió y entró en una venta cambiada?
**Autoridad:** `DATA.exchangeReport()`
**Definición:** evidencia congelada en `DATA.exchanges`
**Creada por:** H-51
**Consumidores:** `grep -rn "exchangeReport" balam/ test-*.mjs`

## ¿Cuánta comisión proviene de ventas y cuánta de cambios?
**Autoridad:** `DATA.sellerCommissionReport()`
**Definición:** comisión congelada en ventas y cambios; el reparto histórico de
una venta con varios vendedores se identifica expresamente como estimado
**Creada por:** H-51
**Consumidores:** `grep -rn "sellerCommissionReport" balam/ test-*.mjs`
