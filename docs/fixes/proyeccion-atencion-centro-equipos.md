# Proyeccion vigente de atencion en Centro de equipos

**Riesgo:** H-125
**Estado:** RESUELTO - SERVIDOR Y CLIENTE PUBLICADOS
**Fecha:** 20/08/2026
**Commit:** `dc66c31`

## Problema y reproduccion

El Centro de equipos contaba como accionable la proyeccion historica
`BG-260812-0006`: mostraba `commit_mismatch`, `Requiere atencion`,
`Autorizar reintento` y `Revisado`, aunque Equipo David declaraba
`queue_pending=0` y `queue_blocked=0`.

La prueba roja H-125 obtuvo 1/10. La comprobacion remota final encontro dos
filas con esa referencia y cero filas accionables bajo el contrato vigente.

## Causa raiz

`syncFleetStatus()` devolvia `sync_activity.requires_action` sin cruzarlo con
la cola declarada por `sync_devices`. `settings.jsx` consumia directamente
esa bandera. Ademas, revisar una incidencia no cerraba `requires_action`, y
los RPC de solicitud y entrega no volvian a validar que existiera cola local
pendiente y bloqueada.

## Diseno

`sync_activity` conserva la historia resumida; no contiene el payload durable.
Una fila solo requiere intervencion operativa si no fue revisada y el heartbeat
del equipo declara al menos una operacion pendiente y bloqueada. La historia sin
cola sigue visible en Actividad reciente como `Incidencia historica`, pero no
cuenta ni ofrece reintento.

El servidor aplica la misma condicion al crear y entregar ordenes. Marcar una
incidencia como revisada cierra `requires_action`. No cambian cola local,
idempotencia, datos comerciales, stock, ventas, pagos, comisiones ni cuarentena.

## Solucion

- `balam/store.jsx` deriva `requires_attention` e
  `historical_incident` al cruzar actividad, revision y conteos del equipo.
- `balam/settings.jsx` cuenta solo la proyeccion vigente y conserva la
  incidencia historica sin controles operativos.
- Migracion 168 endurece revisar, solicitar y entregar reintentos.
- Migraciones 169-171 verifican forma, fixture exacto y estado real; las
  verificaciones terminan en `ROLLBACK`.

## Pruebas

- H-125 contrato 10/10 y E2E exacto 10/10.
- H-79 17/17; H-80 7/7; H-116 20/20; H-118 10/10.
- Cola 186/186; modulos 42/42; migraciones 31/31.
- Navegacion 15/15; roles 15/15; responsive 492/492.
- Supabase dry-run exclusivo 168/169, luego 170 y 171.
- Fixture remoto 170 verde con rollback.
- Verificacion real 171:
  `H125_REAL_BG_260812_0006_OK rows=2 actionable=0`.

## Riesgo residual y pendientes

Ninguno conocido dentro de H-125. No se modificaron filas comerciales ni se
borro actividad historica. GitHub Pages run `32445237525` termino en `success`.
El blob crudo de `dc66c31:index.html` y Pages coinciden: 9,015,331 bytes,
SHA-256 `adafcbc28bd301b8cac50928abf017aed3963924aae44ca437f4bd16f030722c`.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-125---incidencia-historica-revisada-sigue-como-atencion-accionable`
- `docs/fixes/reconciliacion-sync-activity-historica.md`
- `docs/architect/authorities/synchronization.md`
