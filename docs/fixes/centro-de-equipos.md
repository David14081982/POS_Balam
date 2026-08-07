# Centro administrativo de equipos

**Riesgo:** H-79
**Estado:** MIGRACIONES DESPLEGADAS / CLIENTE PENDIENTE
**Fecha:** 07/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El panel H-77 sólo mostraba la salud de la instalación abierta y dos conteos de
flota. Para saber qué ocurría era necesario revisar físicamente cada equipo; no
existían nombre legible, tipo PC/laptop, historial central ni una forma segura
de solicitar el reintento de una excepción remota.

`node test-h79-device-center.mjs` reprodujo el contrato ausente con 0
aprobaciones y 17 fallos.

## Causa raíz

H-77 implementó convergencia y protección, no observabilidad operativa. La
autoridad de pendientes permanecía correctamente en cada cola local, mientras
`pos.sync_devices` sólo conservaba heartbeat, versión, época y un total. No
había una proyección central que explicara el ciclo de las operaciones.

## Diseño

- La identidad continúa siendo `CORE.getDeviceId()`; nombre y tipo son metadatos
  administrativos y no cambian la instalación.
- `pos.sync_activity` guarda únicamente resumen, referencia y diagnóstico; no
  recibe payloads de ventas, inventario, clientes ni documentos.
- Sin heartbeat reciente el estado es «desconectado» o «desconocido», nunca
  «sincronizado».
- Una autorización remota sólo solicita reintentar la misma operación durable.
  No concede permisos, no modifica datos de negocio y no evita RLS/RPC.
- Ventas y demás operaciones normales continúan sincronizándose automáticamente.

## Solución

Las migraciones `20260807012000/12100` amplían el registro de equipos, crean el
historial con RLS, incorporan el dominio `devices` y publican RPC acotadas para
nombrar equipos, solicitar/consumir reintentos y marcar incidencias revisadas.

`STORE` reporta heartbeat cada minuto, proyecta pending/synced/blocked sin
payload comercial, conserva la cola como autoridad y consume órdenes sólo en el
equipo de origen. Configuración → Negocio presenta resumen, equipos, actividad,
atención e identificación PC/laptop; las herramientas H-77 quedan en un bloque
avanzado y conservan su comportamiento.

## Pruebas

- Contrato H-79: 17/17 (línea base 0/17).
- Cola offline: 162/162.
- Concurrencia: 15/15 (9 base + 6 H-77).
- H-77: 20/20.
- Migraciones: 31/31.
- Módulos: 41/41.
- AUTH: 19/19; roles: 15/15.
- Build reproducible: 8/8; navegación: 15/15; smoke bundle: 17/17.
- `supabase db push --dry-run`: detectó exclusivamente `12000/12100`, sin aplicar.

## Riesgo residual y pendientes

Las migraciones `12000/12100` quedaron aplicadas y su verificación SQL pasó; el
dry-run posterior quedó vacío. El cliente todavía no está publicado. Un
equipo apagado sólo puede declarar sus operaciones cuando vuelva a conectarse;
el centro lo muestra como estado desconocido. El reintento administrativo puede
volver a fallar si la causa real —permiso, dato o conflicto— sigue vigente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-79---no-existe-supervisión-central-por-equipo`.
- `docs/02-architecture.md` § Sincronización.
- `docs/architect/decisions/ADR-012-protocolo-evolutivo-de-sincronizacion.md`.
