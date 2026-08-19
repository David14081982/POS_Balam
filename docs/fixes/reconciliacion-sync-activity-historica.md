# Reconciliación de actividad histórica para H-113

**Riesgo:** H-118
**Estado:** EN CORRECCIÓN
**Fecha:** 19/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Equipo David declara cola actual y bloqueada en cero, protocolo 2, esquema
H-116 y época vigente. Sin embargo, dos proyecciones antiguas de Cambios en
`pos.sync_activity` hacen que el preview H-113 bloquee Ventas/Cambios como si
todavía existiera una operación local reproducible.

## Causa raíz

`pos.test_data_cleanup_fleet_risk()` cuenta toda fila activa de
`pos.sync_activity` como pendiente actual. Esa tabla es observabilidad resumida
y no contiene el payload durable; `STORE.flushQueue()` sólo puede ejecutar la
cola local, cuyo conteo más reciente vive en `pos.sync_devices.queue_pending`.

## Diseño

Pendiente de cerrar tras fijar los casos A–F y revisar las invariantes de cola,
cuarentena, protocolo, época, idempotencia y tombstones.

## Solución

Pendiente.

## Pruebas

Pendiente.

## Riesgo residual y pendientes

Pendiente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-118--sync_activity-histórica-bloquea-h-113-sin-cola-reproducible`
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`
- `docs/architect/authorities/synchronization.md`
