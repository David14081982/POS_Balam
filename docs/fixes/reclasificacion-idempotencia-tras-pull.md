# Reclasificacion idempotente despues de reconciliar Movimientos

**Riesgo:** H-97
**Estado:** RESUELTO Y PUBLICADO; PENDIENTE DE REVALIDACION EN H94-PILOT
**Fecha:** 12/08/2026
**Commit:** `ee1a236`

## Problema y reproduccion

En H94-PILOT se reclasifico una pieza de la referencia D a la E con un
`operationId` durable. El commit remoto dejo D 5→4, E 6→7 y exactamente dos
movimientos. Tras `pullDomain('movements')`, repetir la misma intencion ya no
devolvia `idempotent=true`. El piloto se detuvo antes de volver a mover stock o
ejecutar la reversa.

## Causa raiz

`pos.movements` conserva `operation_id` y `reversal_of`, pero
`STORE.MAP.movements.fromRow()` no los traducía a `operationId` y `reversalOf`.
La reconciliacion reemplazaba `DATA.movements` con filas sin identidad de
operacion. `DATA.reclassifyReference()` depende de esos campos para reconocer
el reintento exacto y autorizar una reversa.

## Diseño

La autoridad remota no cambia. El pull debe ser un round-trip sin perdida:

- `movements.operation_id` → `movement.operationId`;
- `movements.reversal_of` → `movement.reversalOf`.

No se resuelve por SKU, no se reescriben historicos y no se agrega migracion.

## Solucion

`balam/store.jsx` conserva ambos campos al mapear Movimientos remotos. Es un
cambio aditivo de lectura; no modifica RPC, tablas, filas V1 ni payloads.

## Pruebas

- Roja: `node test-h94-reference-model-v2.mjs` → 48/49; falla 19a.
- Verde: `node test-h94-reference-model-v2.mjs` → 49/49.
- Regresiones: cola 176/176; H96 36/36; Cambio E2E 37/37; pantalla
  45/45; H95 16/16; H86 17/17; contratos 42/42; migraciones 31/31;
  préstamos 69/69; H77 20/20; H80 7/7; navegación 15/15 y responsive
  492/492.
- Build regenerado y smoke del bundle publicado 17/17. El smoke de la fuente
  de desarrollo agotó su espera de arranque; no es el artefacto desplegable.
- Revalidacion remota: pendiente de recargar el cliente publicado y continuar
  el mismo `operationId` del manifiesto H94-PILOT.

## Riesgo residual y pendientes

El primer commit del piloto permanece aplicado una sola vez y registrado en el
manifiesto. Falta recargar el cliente publicado y completar el
reintento/reversa con esos mismos IDs; no debe recrearse la reclasificacion
original.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-97---el-pull-de-movimientos-retira-la-identidad-idempotente-de-reclasificacion`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
- `docs/fixes/recuperacion-movimientos-terminal.md`
