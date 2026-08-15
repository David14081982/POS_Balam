# Catálogo Color de ornamento sin alias activos

**Riesgo:** H-105
**Estado:** RESUELTO
**Fecha:** 15/08/2026
**Commit técnico:** `395f1d0`

## Problema y reproducción

`ornament_color` ofrecía AZL/NE junto a AZ/NEG, aunque representan Azul y
Negro. AZL forma parte de 15 identidades V2 en cuatro familias; NE no tenía uso.
El selector leía `CONFIG.all()`, por lo que un código inactivo seguía disponible
para referencias nuevas.

## Causa raíz

La lectura administrativa completa del catálogo se reutilizaba como autoridad
de captura. Excel también resolvía cualquier código encontrado, sin distinguir
si estaba activo o sólo debía conservarse históricamente.

## Diseño

`color` y `ornament_color` siguen siendo catálogos independientes. La proyección
copia código, etiqueta, `active`, `sort_order` y `meta` del primero al segundo.
AZL permanece inactivo y resoluble sólo para una referencia que ya lo contenía;
NE se elimina tras comprobar uso cero. No existe conversión AZL→AZ.

## Solución

- `CONFIG.selectable()` publica activos más los códigos históricos explícitos.
- Nuevo producto y variantes nuevas sólo materializan activos.
- Editar muestra AZL seleccionado como `Histórico` y permite guardarlo intacto.
- Excel considera un `ornament_color` inactivo como incidencia histórica: el
  mismo producto puede conservarlo, pero una referencia nueva no lo acepta.
- Las migraciones `20260815014700`/`14800` sincronizan de forma transaccional e
  idempotente. Una huella JSON completa de `pos.products` aborta ante cualquier
  cambio y la verificación exige espejo exacto, AZL inactivo y NE ausente.

## Pruebas

- Línea roja: `CONFIG.selectable is not a function`.
- H-105: 6/6.
- H-101 autoridad: 26/26; UI: 12/12; mixtas: 10/10; UX V1: 10/10.
- Excel H-86: 42/42.
- `supabase db push --linked --dry-run`: exclusivamente 14700/14800.
- `supabase db push --linked`: ambas aplicadas; verificación remota aprobada.
- `supabase migration list --linked`: local/remoto alineados hasta 14800.
- H-102 15/15 + 16/16; H-103 15/15; responsive H-87 492/492;
  smoke del bundle 17/17. El smoke del archivo de desarrollo agotó su espera de
  bootstrap; el bundle publicado, que es el artefacto entregable, quedó verde.
- El bundle H-105 quedó integrado en `origin/main` mediante `ee8ddc6`. Pages sirve 8,988,041 bytes,
  SHA-256 `d6ea77bd88d710f1cbe2e328107cf83dd0b642389dea29ebf1993cc3acd3223b`;
  son exactamente `index.html` tras normalizar CRLF→LF.

## Riesgo residual y pendientes

Ninguno conocido dentro del contrato. AZL continúa siendo identidad histórica y
debe permanecer resoluble mientras existan las 15 referencias que lo contienen.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-105--alias-activos-duplican-colores-de-ornamento`
- `docs/architect/authorities/inventory.md`
- `docs/architect/decisions/ADR-013-physical-reference-identity.md`
