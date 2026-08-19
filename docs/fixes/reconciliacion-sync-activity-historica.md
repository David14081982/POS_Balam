# Reconciliación de actividad histórica para H-113

**Riesgo:** H-118
**Estado:** RESUELTO — SERVIDOR Y CLIENTE PUBLICADOS
**Fecha:** 19/08/2026
**Commit:** `73b5b98` (funcional); documentación final en commit posterior

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

La cola local conserva la autoridad durable. Si el heartbeat más reciente
declara `queue_pending=0`, las filas activas de `sync_activity` no tienen payload
ni ruta propia de replay y pasan a la proyección `historical_incidents`, visible
pero no bloqueante. Una cuarentena sí conserva una ruta de restauración y sigue
bloqueando cuando intersecta. Con cola mayor que cero, una correspondencia
incompleta con las proyecciones falla cerrada como `pending_scope_unknown`.

No cambian `STORE`, RPC comerciales, época, tombstones, idempotencia, stock ni
la ejecución H-113. El cliente sólo separa operaciones actuales de incidencias
históricas y muestra tipo, folio, fecha y estado disponibles.

## Solución

- `20260819015500_pos_h118_sync_activity_reconciliation.sql` reemplaza hacia
  adelante únicamente `pos.test_data_cleanup_fleet_risk()`; no actualiza filas.
- `20260819015600_pos_h118_sync_activity_reconciliation_verification.sql`
  prueba cola actual, historia sin payload, cuarentena reproducible, dominio
  ajeno, alcance desconocido y cliente no cercable; termina con rollback.
- `balam/settings.jsx` nombra una operación bloqueante con equipo, tipo y folio,
  y presenta por separado el conteo actual y las incidencias históricas.
- Los arneses H-116/H-117 incorporan Equipo David y el copy comercial exacto.

## Pruebas

- Rojo inicial H-118: 2/10 aprobadas, 8/10 fallidas. Verde: 10/10.
- PostgreSQL 18 temporal: H-116 A–D y H-118 A–F verdes; todos los fixtures
  terminaron con `ROLLBACK`.
- H-116 contrato 20/20 y UI 29/29; H-113 contrato 35/35 y UI 21/21;
  H-117 A–H 65/65.
- Migraciones 31/31; módulos 42/42; navegación 15/15; roles 15/15; smoke bundle
  17/17; build reproducible 8/8; responsive 320–1440 px sin overflow.
- El primer intento remoto del verificador 156 abortó antes de las aserciones
  porque el fixture omitía `user_id` y `payload_hash` obligatorios de la tabla
  real. La transacción revirtió las semillas. El arnés se alineó al esquema,
  PostgreSQL temporal volvió a pasar y el segundo intento remoto quedó aplicado.

## Riesgo residual y pendientes

Las proyecciones BG-260812-0003 y BG-260812-0006 permanecen intactas como
incidencias históricas; H-118 no decide si sus inconsistencias remotas requieren
una reparación administrativa futura. Si una cola actual tuviera exactamente
el mismo número de filas que proyecciones antiguas de otros dominios, H-116 no
dispone de una generación de snapshot para distinguir sustitución uno-a-uno;
resolver esa ambigüedad requeriría otro contrato y queda fuera de H-118.

Migraciones `15500/15600` aplicadas; dry-run final: base remota al día. GitHub
Pages run `32308874312` terminó en `success`. El blob `index.html` de `73b5b98`
y Pages coinciden: 9,008,167 bytes, SHA-256
`8f941529e958553a4b1664d7b0c31b98f6f5b7d92bd69ae74cb5009feaf4a1fe`.
No se ejecutó limpieza, heartbeat, reintento, descarte, cuarentena, retiro ni
mutación de datos comerciales reales.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-118--sync_activity-histórica-bloquea-h-113-sin-cola-reproducible`
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`
- `docs/architect/authorities/synchronization.md`
