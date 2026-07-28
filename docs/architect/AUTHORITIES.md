---
capa: conocimiento
applies_to: [domain, database, security]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Registro de autoridades

La clave es **la pregunta de negocio**, no la función. Las funciones de BALAM
han cambiado varias veces; las preguntas, casi nunca.

Dos reglas de mantenimiento:

- Si cambia la función, se edita la fila. **Si cambia la pregunta, es una
  autoridad nueva.**
- **Dos entradas con la misma pregunta son, por definición, `AP-01`.** Este
  archivo es también un detector de fórmulas duplicadas.

Los consumidores no se mantienen: se descubren. Las historias que modificaron
una autoridad se recuperan con `grep -rn "<autoridad>" docs/03-known-risks.md`.

---

## ¿Cuántas unidades de este renglón siguen disponibles?
**Autoridad:** `pos.sale_line_balance()` · espejo local `DATA.saleLineBalance()`
**Definición:** `supabase/migrations/20260728004700_pos_h35_line_balance.sql`
**Creada por:** H-35 · **Decisión:** `ADR-003`
**Consumidores:** `grep -rn "sale_line_balance\|saleLineBalance" supabase/ balam/`

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

## ¿Esta sesión puede ver esta pantalla?
**Autoridad:** `AUTH.canAccess()`
**Definición:** `balam/auth.jsx` · `docs/02-architecture.md` § Autorización del esquema pos
**Creada por:** H-08 · **Decisión:** `ADR-005`
**Consumidores:** `grep -rn "canAccess" balam/`

## ¿Esta cuenta puede tocar el esquema `pos`?
**Autoridad:** RLS del esquema, vía `pos.is_active_admin()` / `pos.is_active_seller()`
**Definición:** migraciones `20260725001400`, `20260725001500`, `20260725001600`
**Creada por:** H-07, H-08 · **Decisión:** `ADR-005`
**Consumidores:** `grep -rn "is_active_admin\|is_active_seller" supabase/`

## ¿Hay inventario para esta venta?
**Autoridad:** `pos.reserve_sale_stock()`, invocada dentro de `pos.commit_sale()`
**Definición:** migraciones `20260725001700`, `20260725001800`
**Creada por:** H-01 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "reserve_sale_stock" supabase/ balam/`

## ¿Esta operación ya se aplicó?
**Autoridad:** `pos.sale_commits` / `pos.return_commits`, por clave + hash del payload
**Definición:** migraciones `20260725001900`, `20260725002100`
**Creada por:** H-04 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "sale_commits\|return_commits" supabase/ balam/`

## ¿Qué falta por sincronizar y en qué orden?
**Autoridad:** `STORE.flushQueue()` — ejecutor único, con candado
**Definición:** `docs/02-architecture.md` § Cola offline
**Creada por:** H-09, H-14 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "flushQueue\|queueStatus" balam/`

## ¿Cuál es esta terminal?
**Autoridad:** `CORE.getDeviceId()` — clave histórica `balam_device_id`
**Definición:** `balam/core.jsx` · `docs/02-architecture.md` § CORE
**Creada por:** H-18
**Consumidores:** `grep -rn "getDeviceId" balam/`
