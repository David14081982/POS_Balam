# Convergencia del Centro de equipos

**Riesgo:** H-80
**Estado:** RESUELTO
**Fecha:** 07/08/2026
**Commit:** `e8768f9`

## Problema y reproducción

Con una operación local pendiente o bloqueada, el indicador alternaba durante
minutos entre «Reconciliando» y «Este equipo sincronizado». El arnés
`test-h80-device-convergence.mjs` inició con 0/7: demostró reproyección desde
el heartbeat, invalidación por cambios idénticos y acoplamiento del dominio
operativo con la reconciliación comercial.

## Causa raíz

`heartbeatDevice()` llamaba `reportQueueActivity()`. Cada `upsert` asignaba un
`updated_at` nuevo y el trigger por sentencia de `sync_activity` incrementaba
`devices` ante cualquier `UPDATE`. Realtime recibía la versión, ejecutaba
`reconcileDomains()`, cuyo cierre emitía otro heartbeat y reiniciaba el ciclo.

## Diseño

La proyección de actividad sólo cambia al cambiar su significado operativo. El
heartbeat conserva presencia, conteos y órdenes remotas, pero no vuelve a
publicar toda la cola. `devices` es observabilidad: actualiza su cursor y su
vista sin alterar el estado de reconciliación comercial. Las autoridades de
cola, documentos, inventario y sus RPC permanecen intactas.

## Solución

- `balam/store.jsx` elimina la reproyección periódica, omite latidos oculto/sin
  red y aplica las invalidaciones de flota fuera del reconciliador comercial.
- `20260807012200_pos_h80_device_activity_convergence.sql` reemplaza el trigger
  por una comparación material que ignora actualizaciones exclusivas de tiempo.
- `20260807012300_pos_h80_device_activity_convergence_verification.sql` prueba
  insert, actualización idéntica, cambio material y borrado dentro de `ROLLBACK`.
- Se regeneraron `index.html` y `POS Balam (offline).html` desde la fuente.

## Pruebas

H-80 7/7 (línea base 0/7); H-79 17/17; migraciones 31/31; cola 162/162;
concurrencia 15/15; H-77 20/20; módulos 41/41; AUTH 19/19; roles 15/15;
build reproducible 8/8; navegación 15/15; smoke bundle 17/17. Las migraciones
se aplicaron en producción, su verificación pasó y el dry-run posterior informó
`Remote database is up to date`.

GitHub Pages completó correctamente el despliegue del commit documental
`1d396d4`. El `index.html` público coincide con el blob normalizado de `main`:
SHA-256 `F48690222328F8EE0CEE960AD5AF5CAFDA9BB79E52E52E7F846C4AED0CCEE357`
y 8,864,440 bytes. El archivo de trabajo tiene finales de línea CRLF y por eso
su hash directo de Windows no es una comparación válida con el blob publicado.

## Riesgo residual y pendientes

Un heartbeat por minuto continúa mientras el POS está visible y en línea. Es
tráfico acotado y necesario para distinguir un equipo conectado de uno apagado;
ya no reproyecta cada operación ni produce invalidaciones autorreferentes.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-80---el-historial-de-equipos-se-invalida-a-sí-mismo-sin-converger`.
- `docs/fixes/centro-de-equipos.md`.
- `docs/architect/decisions/ADR-012-protocolo-evolutivo-de-sincronizacion.md`.
