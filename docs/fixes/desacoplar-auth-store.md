# Desacoplar AUTH de STORE

**Riesgo:** H-24
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `04f960c`

## Problema y reproducción

`AUTH.client()` comprobaba e invocaba directamente
`window.STORE.getClient()`. `STORE` también consulta `AUTH` para conocer rol,
perfil y propietario de operaciones, formando un ciclo entre autenticación y
persistencia.

Antes del cambio, `node test-module-contracts.mjs` aprobó 27/29: fallaron la
ausencia de dependencia directa y la obtención del cliente por el gateway.

## Causa raíz

La obtención tardía del cliente Supabase se resolvía con una guarda global en
`AUTH`, aunque `CORE` ya podía reenviar métodos de la API registrada de `STORE`
y conservar el mismo resultado `undefined` antes del registro.

## Diseño

- Obtener exactamente el mismo cliente compartido mediante el gateway.
- Conservar `null` cuando el cliente no está disponible.
- No cambiar inicialización, login, logout, resolución de perfil ni caché
  offline.
- No cambiar tokens, RLS, cola, Supabase ni interfaz.
- Mantener `STORE → AUTH` como dependencia unidireccional para rol y sesión.

## Solución

`AUTH.client()` usa `window.CORE.invokeSync('getClient')` y normaliza la ausencia
a `null`. El arnés de roles entrega el cliente por esa frontera y verifica las
mismas identidades, permisos y recuperación offline.

Se regeneraron `index.html` y `POS Balam (offline).html` desde `balam/`.

## Pruebas

- Reproducción anterior: 27/29.
- `node test-module-contracts.mjs`: 29/29.
- `node test-role-access.mjs`: 10/10.
- `node test-store-queue.mjs`: 97/97.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.

## Riesgo residual y pendientes

Riesgo bajo: antes del registro de `STORE`, el gateway devuelve `undefined` y
`AUTH` conserva la salida local histórica. El orden de carga probado sitúa
`STORE` antes de que `App` invoque `AUTH.init()`.

`STORE → AUTH` permanece intencional para aplicar el rol efectivo, reclamar
colas históricas únicamente como administrador y asociar operaciones a la
sesión correcta; ya no existe la dirección inversa.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-24--ciclo-directo-auth--store-al-obtener-el-cliente-supabase`
- Arquitectura: `docs/02-architecture.md#core`
- Sesión y cola: `docs/fixes/aislamiento-cola-por-sesion.md`
