---
capa: conocimiento
applies_to: [domain, database]
related_histories: [H-01, H-36]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Catálogo y existencias

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Cuánto cuesta esta talla antes de promociones?
**Autoridad:** `DATA.listPrice(producto, talla)`
**Definición:** `balam/data.jsx` · excepciones en `pos.products.precios_talla`
**Creada por:** H-36 · **Decisión:** `ADR-009`
**Consumidores:** `grep -rn "listPrice" balam/ test-*.mjs`

## ¿Qué precio muestra este artículo en el catálogo?
**Autoridad:** `DATA.priceRange(producto)` — **derivada** de `listPrice` sobre
las tallas con existencias; no reimplementa la resolución
**Definición:** `balam/data.jsx`
**Creada por:** H-36 · **Decisión:** `ADR-009`
**Consumidores:** `grep -rn "priceRange" balam/`

## ¿Hay inventario para esta venta?
**Autoridad:** `pos.reserve_sale_stock()`, invocada dentro de `pos.commit_sale()`
**Definición:** migraciones `20260725001700`, `20260725001800`
**Creada por:** H-01 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "reserve_sale_stock" supabase/ balam/`
