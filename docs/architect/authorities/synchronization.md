---
capa: conocimiento
applies_to: [client, database]
related_histories: [H-04, H-09, H-14, H-18]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Sincronización e identidad

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

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
