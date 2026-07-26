# Desacoplar DATA de STORE

**Riesgo:** H-22
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`DATA` tenía 13 referencias directas a `window.STORE` para snapshots, ventas,
devoluciones, eliminaciones y limpieza de cola. `STORE` consulta y aplica
resultados sobre `DATA`, formando un ciclo global.

Antes del cambio, `node test-module-contracts.mjs` aprobó 20/24: fallaron la
ausencia de dependencia, el gateway único, su no-op y el reenvío.

## Causa raíz

Cada mutación de dominio comprobaba individualmente si `STORE` y su método
existían. La disponibilidad tardía se resolvía en cada llamada en vez de una
frontera compartida, duplicando conocimiento de la API de persistencia dentro
del dominio.

## Diseño

- `CORE` conserva sólo la referencia al adaptador registrado.
- Antes de registrar `STORE`, una invocación devuelve `undefined`, equivalente
  a las guardas históricas.
- Reenviar método, argumentos, contexto y valor de retorno sin transformarlos.
- Mantener los `try/catch` del dominio y el orden guardar-local/después-encolar.
- `STORE` continúa aplicando resultados a `DATA`; queda una sola dirección.

## Solución

`CORE` publica `registerSyncGateway()` e `invokeSync()`. `STORE` registra su API
después de publicar `window.STORE`. `DATA` invoca exclusivamente el gateway y
ya no contiene referencias a `window.STORE`.

No cambiaron payloads, operaciones de cola, formatos, idempotencia, datos,
Supabase ni reglas financieras.

## Pruebas

- Reproducción anterior: 20/24.
- `node test-module-contracts.mjs`: 24/24.
- Gateway sin STORE y reenvío de argumentos/resultado: aprobados.
- `node test-store-queue.mjs`: 97/97.
- `node test-sale-coherence.mjs`: 17/17.
- `node test-returns.mjs`: 17/17.
- `node test-concurrency.mjs`: 9/9.
- `node test-folio-concurrency.mjs`: 4/4.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `git diff --check`: correcto.

## Riesgo residual y pendientes

`DATA → STORE` quedó eliminado. `STORE → DATA` permanece intencional y
unidireccional: la capa de persistencia necesita leer snapshots y aplicar
confirmaciones remotas al modelo local-first. Cambiar esa dirección exigiría
un puerto de dominio más amplio y no aporta una corrección adicional al ciclo.

`CONFIG → STORE` y `STORE → CONFIG` continúan como relación separada para
sincronización de configuración; no se mezclaron con H-22.

La reversión restaura las guardas directas y elimina el gateway, sin migraciones
ni transformación de datos.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-22--ciclo-directo-data--store-en-sincronización`
- Arquitectura: `docs/02-architecture.md#core`

