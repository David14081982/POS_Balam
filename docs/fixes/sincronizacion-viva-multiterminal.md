# Sincronización viva multi-terminal

**Riesgo:** H-77  
**Estado:** PARCIALMENTE RESUELTO — código listo, despliegue pendiente  
**Fecha:** 06/08/2026  
**Commit:** `d6b8a8e`

## Problema y reproducción

A modifica un catálogo y B no lo recibe hasta recargar. Una computadora que
regresa de un periodo offline tampoco tenía una época que impidiera publicar una
línea base administrativa anterior.

## Causa raíz

`STORE.pull()` sólo se alcanzaba desde `init({pull:true})`. No existían contrato
entrante, invalidación, cursor, compuerta ni época. Configuración tampoco se
confirmaba atómicamente.

## Diseño

`ADR-012`: manifiesto evolutivo, registro de terminales, reloj por dominio,
Realtime como aviso, lectura autoritativa, cola primero, compuertas, época,
cuarentena y activación declarativa.

## Solución

- `system_manifest`, cursores por dominio y heartbeat de equipos.
- Realtime sólo invalida; sondeo, foco y reconexión recuperan eventos perdidos.
- Configuración usa `commit_config`, atómica, versionada e idempotente.
- Inventario administrativo exige protocolo y `data_epoch`; las RPC anteriores
  pierden permiso de cliente.
- Las pantallas registran actividad y difieren cambios remotos durante capturas.
- El punto cero firma conteos y huella. Equipos anteriores quedan bloqueados
  hasta exportar recuperación, cuarentenizar su cola y bajar la nube autoritativa.
- El panel muestra salud, época, dominios pendientes y estado de la flota.

## Pruebas

`test-store-queue.mjs` 159/159; `test-concurrency.mjs` 14/14, incluida recepción
sin recarga y compuerta; `test-h77-live-sync.mjs` 20/20;
`test-migrations.mjs` 31/31; `test-module-contracts.mjs` 41/41;
`test-reset-propaga.mjs` 21/21; `test-additional-discount.mjs` 27/27;
`test-build-reproducibility.mjs` 8/8; `test-smoke.mjs bundle` 17/17.

La corrida integral pasó 78 ejecutables. Dos harness históricos fueron alineados
y reejecutados. El smoke de fuente agotó tiempo por sus CDN; el bundle publicado
pasó sin errores. Docker no está instalado, por lo que PostgreSQL local no pudo
ejecutar la cadena; la verificación de migraciones fue estática.

## Riesgo residual y pendientes

No se aplicaron migraciones ni se publicó producción. La condición de detención
arquitectónica exige autorización expresa y respaldo antes del canario remoto,
punto cero real y observación de la flota. H-77 no se marca RESUELTO hasta ello.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-77---terminales-abiertas-no-convergen-y-una-linea-base-antigua-carece-de-cuarentena`
- Decisión: `docs/architect/decisions/ADR-012-protocolo-evolutivo-de-sincronizacion.md`
