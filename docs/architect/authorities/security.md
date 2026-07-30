---
capa: conocimiento
applies_to: [security]
related_histories: [H-07, H-08]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe policies. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Autorización

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Esta sesión puede ver esta pantalla?
**Autoridad:** `AUTH.canAccess()`
**Definición:** `balam/auth.jsx` · `docs/02-architecture.md` § Autorización del esquema pos
**Creada por:** H-08 · **Evolucionada por:** H-56 Fase 3 · **Decisión:** `ADR-005`
**Consumidores:** `grep -rn "canAccess" balam/`

## ¿Esta cuenta puede tocar el esquema `pos`?
**Autoridad:** RLS del esquema, vía `pos.is_active_admin()` / `pos.is_active_seller()`
**Definición:** migraciones `20260725001400`, `20260725001500`, `20260725001600`
**Creada por:** H-07, H-08 · **Decisión:** `ADR-005`
**Consumidores:** `grep -rn "is_active_admin\|is_active_seller" supabase/`
