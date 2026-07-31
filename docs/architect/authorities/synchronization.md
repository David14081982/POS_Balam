---
capa: conocimiento
applies_to: [client, database]
related_histories: [H-04, H-09, H-14, H-18, H-62]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Sincronización e identidad

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Esta operación ya se aplicó?
**Autoridad:** `pos.sale_commits` / `pos.return_commits`, por clave + hash del
payload. Para préstamos y capacidades, `pos.capability_operation_audit` cumple el
mismo papel por (`operation_id`, capacidad, hash)
**Definición:** migraciones `20260725001900`, `20260725002100`, `20260730008000`
**Creada por:** H-04 · **Extendida por:** H-56 Fase 5 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "sale_commits\|return_commits\|capability_operation_audit" supabase/ balam/`

## ¿Qué falta por sincronizar y en qué orden?
**Autoridad:** `STORE.flushQueue()` — ejecutor único, con candado
**Definición:** `docs/02-architecture.md` § Cola offline
**Creada por:** H-09, H-14 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "flushQueue\|queueStatus" balam/`

## ¿Este préstamo ya está confirmado en la nube?
**Autoridad:** `loan._loanVersion` — la versión que devolvió el servidor. Ausente
significa «todavía no confirmado», y es el criterio que usa la migración de H-62
y la fusión del pull para no perder un documento local
**Definición:** `balam/data.jsx` § préstamos · `balam/store.jsx` § `applyOp`
**Creada por:** H-62 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "_loanVersion" balam/ test-*.mjs`

## ¿A qué préstamo corresponde este vale impreso?
**Autoridad:** `DATA.findLoanByFolio()` — folio vigente primero, alias después,
igual que `findSaleByFolio()`
**Definición:** `balam/data.jsx` · `docs/02-architecture.md` § Préstamos de mercancía
**Creada por:** H-62 · **Decisión:** `ADR-001`
**Consumidores:** `grep -rn "findLoanByFolio\|loanFolioAliases" balam/ test-*.mjs`

## ¿Cuál es esta terminal?
**Autoridad:** `CORE.getDeviceId()` — clave histórica `balam_device_id`
**Definición:** `balam/core.jsx` · `docs/02-architecture.md` § CORE
**Creada por:** H-18
**Consumidores:** `grep -rn "getDeviceId" balam/`
