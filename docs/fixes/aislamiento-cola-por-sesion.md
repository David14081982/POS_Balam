# Aislamiento de estado y cola por sesión

**Riesgo:** H-09
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Con una operación de A pendiente, cerrar sesión e iniciar B sin recargar
conservaba `STORE.enabled=true`, omitía un pull nuevo y dejaba la cola global
disponible para enviarse con B. Las comprobaciones añadidas a
`test-role-access.mjs` fallaron antes del cambio porque no existían
`setSession`, propietario ni filtro de sesión.

## Causa raíz

`STORE` tenía un ciclo de vida global independiente de `AUTH`: el logout no lo
suspendía y el segundo login dependía de una bandera ya activa. Además,
`balam_sync_queue` persistía operaciones sin identidad de origen y su
compactación sólo distinguía tipo y tabla.

## Diseño

La identidad efectiva es el correo normalizado del perfil verificado. Cada
operación queda ligada a ella y sólo esa misma sesión puede compactarla,
rebasarla o enviarla. Logout conserva los pendientes pero suspende
sincronización. Un cambio de identidad drena únicamente su cola y ejecuta un
pull nuevo. Una operación histórica sin propietario se conserva en cuarentena
hasta que un administrador la revise y reclame expresamente.

## Solución

- `balam/app.jsx` entrega todos los cambios de autenticación a
  `STORE.setSession()`.
- `balam/store.jsx` administra login/logout, evita listeners duplicados y
  separa cola, compactación, tablas pendientes y versiones por `ownerId`.
- `claimLegacyQueue()` exige rol administrador para atribuir una cola histórica
  a la sesión activa; antes de ello la terminal avisa y no la envía.
- `test-store-queue.mjs` reproduce el cambio A→B→A y la cuarentena histórica.
- `test-role-access.mjs` verifica el contrato estático entre `AUTH`, `app` y
  `STORE`.

## Pruebas

- Antes: `node test-role-access.mjs` — 4 comprobaciones H-09 fallaron.
- Después: `node test-store-queue.mjs` — 62 pasaron, 0 fallaron.
- Después: `node test-role-access.mjs` — 0 fallaron.
- `node test-smoke.mjs` — 13 pasaron, 0 fallaron.
- `node build-offline.mjs` — `index.html` y `POS Balam (offline).html`
  regenerados correctamente.
- Regresiones no relacionadas: `test-commission.mjs` 10/10 y
  `test-concurrency.mjs` 9/9. `test-discounts.mjs` conserva 2 fallos previos en
  el piso de margen, fuera del ciclo de sesión. Las pruebas de navegador no
  pudieron arrancar dentro del sandbox por sus CDN; `test-smoke.mjs` pasó al
  ejecutarse con acceso de red.

## Riesgo residual y pendientes

Las colas anteriores a H-09 no contienen autor verificable. Permanecen
recuperables, pero requieren que un administrador confirme su atribución; nunca
se envían automáticamente bajo otra cuenta.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-09--cambio-de-sesión-reutiliza-estado-y-cola-globales`
- Arquitectura: `docs/02-architecture.md#cola-offline`
