# Permisos de visualización por usuario

**Riesgo:** H-56
**Estado:** PARCIALMENTE RESUELTO - FASES 1 Y 2
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Las pantallas principales se declaraban tres veces en `balam/app.jsx`: menú,
títulos y render. Configuración mantenía una cuarta lista para sus secciones.
Una pantalla nueva podía quedar fuera de alguno de esos consumidores.

Antes del cambio, `node test-screen-registry.mjs` produjo 2 aprobaciones
vacuamente ciertas y 10 fallos: no existía registro, App conservaba sus
catálogos y el build no cargaba una autoridad compartida.

## Causa raíz

El shell creció como un selector local de componentes y no como un router. El
contrato fijo de H-08 no necesitaba descubrir pantallas, por lo que navegación,
presentación y montaje evolucionaron como listas independientes.

## Diseño

`window.SCREENS` es una API inmutable con identidad estable, relación
padre-hijo, presentación, componente y propiedades de montaje. Resuelve los
componentes de forma tardía para conservar el orden de carga existente.

Fase 1 no cambia `AUTH.canAccess()`, caché, datos ni RLS. Administrador conserva
todas las rutas principales y vendedor conserva únicamente `pos`.

## Solución

- `balam/screens.jsx` registra 11 pantallas principales y 11 secciones hijas de
  Configuración.
- App deriva menú, título y montaje del registro.
- Configuración deriva su navegación interna del mismo registro.
- Las entradas de desarrollo y producción cargan el nuevo módulo en el mismo
  orden.
- El build incluye y precompila el registro en ambos artefactos.

No se creó ninguna migración.

### Fase 2 — modelo y resolución efectiva

Las migraciones `20260730007000` y `20260730007100` crean y verifican un
modelo relacional separado del perfil comercial:

- roles base y permisos de pantalla por rol;
- asignación opcional de rol a `auth.users.id`;
- overrides `allow` / `deny`;
- auditoría por lote;
- resolución override → rol → denegación;
- RPC administrativas atómicas;
- RLS y privilegios mínimos sobre las cinco tablas nuevas.

`config.permisos` queda reservada como hoja deshabilitada en el registro. No
aparece todavía en Configuración ni participa en `AUTH.canAccess()`.

La primera versión de la verificación pretendía crear identidades temporales.
El control previo al push la rechazó por escribir transitoriamente tablas
existentes. Se sustituyó antes de desplegar: la versión aplicada sólo lee
`auth.users`/`pos.sellers` y escribe/limpia el modelo nuevo. La precedencia se
extrae a una función pura para verificar inactivos sin fabricar perfiles.

## Pruebas

- Línea base: `node test-screen-registry.mjs` — 2/12, 10 fallos.
- Registro final: `node test-screen-registry.mjs` — 12/12.
- Roles: `node test-role-access.mjs` — 15/15.
- Contratos: `node test-module-contracts.mjs` — 39/39.
- Reproducibilidad: `node test-build-reproducibility.mjs` — 8/8.
- Smoke del bundle: `node test-smoke.mjs bundle` — 17/17.
- Navegación del bundle: `node test-ui-navigation.mjs` — 15/15.
- `node build-offline.mjs` — correcto, 70 assets.

Fase 2:

- Línea base `node test-permissions-model.mjs` — 0/13.
- Modelo final — 13/13.
- Migraciones — 31/31.
- Registro — 12/12.
- Roles — 15/15.
- Contratos — 39/39.
- Cola offline — 115/115.
- Reproducibilidad — 8/8.
- Smoke bundle — 17/17.
- Navegación bundle — 15/15.
- Push remoto: `007000` y `007100` aplicadas; dry-run posterior sin pendientes.

## Riesgo residual y pendientes

Fases 3 a 6 permanecen abiertas. El modelo por usuario ya existe, pero el
cliente sigue usando los roles fijos de H-08; todavía no existen caché
versionada conectada, editor triestado ni capacidades operativas del dominio.

La reversión de Fase 1 consiste en retirar `screens.jsx`, restaurar las listas
anteriores en App y Configuración y regenerar los artefactos. No requiere
revertir datos ni migraciones.

La reversión de Fase 2 se hace hacia adelante con una migración nueva:
revoca primero las seis RPC públicas, elimina las cinco policies, retira las
funciones internas en orden de dependencia y finalmente elimina las cinco
tablas nuevas en orden inverso de FK. No toca ninguna tabla comercial. Como el
último paso elimina auditoría y configuración de permisos, requiere
autorización destructiva expresa; la reversión operativa preferida sólo revoca
RPC/policies y conserva las tablas.

## Referencias

- Riesgo: `docs/03-known-risks.md` — H-56.
- Arquitectura: `docs/02-architecture.md` — autorización del esquema `pos`.
- Decisión: `docs/architect/decisions/ADR-005-autorizacion-en-rls.md`.
