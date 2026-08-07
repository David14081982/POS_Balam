# Revisión administrativa de cuarentena

**Riesgo:** H-81
**Estado:** RESUELTO
**Fecha:** 07/08/2026
**Commit:** `0fabf4d`

## Problema y reproducción

Una reinicialización por cambio de época apartaba correctamente la cola y
permitía exportar JSON, pero el administrador no podía saber qué representaba
cada operación ni decidir desde el Centro de equipos. La línea base de
`test-h81-quarantine-review.mjs` fue 2/15: faltaron 13 contratos.

## Causa raíz

H-77 definió protección y H-79 observabilidad resumida, no un expediente de
recuperación. `rebootstrapFromCloud()` movía las operaciones a una clave local
sin proyectarlas a una autoridad remota de decisiones. `sync_activity` no puede
resolverlo porque deliberadamente no conserva detalle comercial.

## Diseño

La operación completa continúa exclusivamente en el JSON y archivo local. La
nube recibe un resumen limitado, artículos, épocas y huella SHA-256. La decisión
es auditable, pero no es una escritura comercial: aprobar ordena al equipo
origen restaurar la operación exacta en la cola. `flushQueue()` y la RPC que ya
corresponda conservan permisos, inventario, concurrencia e idempotencia.

## Solución

- Tabla protegida `pos.sync_quarantine_cases` y cuatro RPC acotadas para
  reportar, decidir, consumir y completar.
- `STORE` crea la huella, conserva el archivo local, consume aprobaciones y
  reactiva la operación original exclusivamente por `flushQueue()`.
- El Centro de equipos incorpora la pestaña Cuarentena, decisiones con nota y
  Excel con Resumen, Operaciones y Artículos.
- El JSON técnico continúa disponible y no se sustituye.

## Pruebas

H-81 15/15 (línea base 2/15); migraciones 31/31; cola 162/162; concurrencia
15/15; H-77 20/20; H-79 17/17; H-80 7/7; módulos 41/41; AUTH 19/19; roles
15/15; build reproducible 8/8; navegación 15/15 y smoke bundle 17/17.
`20260807012400/12500` se aplicaron en producción, la verificación SQL pasó y
el dry-run posterior informó `Remote database is up to date`.

## Riesgo residual y pendientes

Una operación rechazada conserva su evidencia local y remota, pero no se
ejecuta. Una aprobada todavía puede fallar correctamente si la RPC detecta
stock insuficiente, conflicto, permiso revocado o dato incompatible.
El resumen remoto no reemplaza al JSON: si se pierden simultáneamente el equipo
y ese archivo, no existe payload suficiente para reconstruir la operación.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-81---la-cuarentena-carece-de-expediente-legible-y-resolución-administrativa`.
- `docs/02-architecture.md` § Sincronización.
- `docs/architect/decisions/ADR-006-local-first-y-transaccion-sql.md`.
