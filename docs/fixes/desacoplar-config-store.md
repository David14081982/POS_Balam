# Desacoplar CONFIG de STORE

**Riesgo:** H-23
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `85385aa`

## Problema y reproducción

`CONFIG.emit()` persistía la configuración, emitía `configchange` y después
consultaba e invocaba directamente `window.STORE.pushConfig(state)`. Como
`STORE` también lee y carga `CONFIG`, ambos módulos conocían mutuamente sus APIs.

Antes del cambio, `node test-module-contracts.mjs` aprobó 24/27: fallaron la
ausencia de dependencia directa, el uso del gateway y el reenvío del estado.

## Causa raíz

La disponibilidad tardía de `STORE` se resolvía con una guarda global dentro de
`CONFIG`, aunque `CORE` ya ofrecía una frontera de sincronización con el mismo
comportamiento no-op antes del registro.

## Diseño

- Conservar el orden: persistir localmente, emitir `configchange` y solicitar
  sincronización.
- Reenviar el mismo objeto de estado y el mismo método `pushConfig`.
- Conservar el `try/catch` offline y el no-op previo al registro de `STORE`.
- No cambiar formatos, cola, reconciliación, Supabase ni interfaz.
- Mantener `STORE → CONFIG` como dependencia unidireccional de persistencia.

## Solución

`CONFIG.emit()` usa `window.CORE.invokeSync('pushConfig', state)`. La API de
`STORE` y su registro existente en el gateway no cambiaron. La prueba de
contrato verifica tanto la ausencia de `window.STORE` en `CONFIG` como que el
estado persistido sea el mismo que recibe el adaptador.

Se regeneraron `index.html` y `POS Balam (offline).html` desde `balam/`.

## Pruebas

- Reproducción anterior: 24/27.
- `node test-module-contracts.mjs`: 27/27.
- `node test-discounts.mjs`: 43/43.
- `node test-store-queue.mjs`: 97/97.
- `node test-concurrency.mjs`: 9/9.
- `node test-role-access.mjs`: 10/10.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.

## Riesgo residual y pendientes

Riesgo bajo: una llamada anterior al registro del gateway es no-op, como la
guarda histórica cuando `STORE` aún no existía. El estado ya quedó persistido
localmente y la inicialización posterior de `STORE` conserva la recuperación
por cola.

`STORE → CONFIG` permanece intencional para aplicar configuración remota y leer
`sync.salesWindowDays`; ya no existe la dirección inversa.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-23--ciclo-directo-config--store-al-sincronizar-configuración`
- Arquitectura: `docs/02-architecture.md#core`
- Corrección previa: `docs/fixes/desacoplar-data-store.md`
