# Permisos de visualización por usuario

**Riesgo:** H-56
**Estado:** PARCIALMENTE RESUELTO - FASES 1 A 3
**Fecha:** 30/07/2026
**Commits:** Fase 1 `a04b2c3`; Fase 2 `0b9c933`; Fase 3 este commit

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

### Fase 3 — autoridad del cliente y caché restrictiva

`pos.current_permission_snapshot(text[])` entrega en una sola lectura el
perfil, rol base, permisos efectivos, origen, versión y fecha de verificación
de `auth.uid()`. Su firma no admite otra identidad; usa las funciones de
resolución de Fase 2, `SECURITY DEFINER` con `search_path` fijo y sólo concede
`EXECUTE` a `authenticated`.

`AUTH.canAccess()` es ahora la autoridad única. El menú, navegación interna,
pantalla persistida, destino inicial y montaje consultan sus métodos públicos.
Una revocación desmonta la pantalla activa; si no existe otro destino se
muestra acceso restringido.

La caché `balam_auth_access_v2` valida esquema, versión del modelo, versión del
registro, identidad y estructura. Sólo conserva permisos previamente
verificados y cualquier pantalla ausente o nueva se deniega. Supabase reemplaza
la caché atómicamente al recuperar conexión.

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

Fase 3:

- Línea base `node test-auth-permissions.mjs` — 2/17, 15 fallos.
- AUTH y caché — 17/17.
- Modelo — 13/13; migraciones — 31/31; registro — 12/12.
- Roles Administrador/Vendedor — 15/15.
- Contratos — 39/39; cola offline — 115/115.
- Reproducibilidad — 8/8; smoke — 17/17; navegación — 15/15.
- Build — correcto, 70 assets y artefactos idénticos.
- Push remoto: `007200` y `007300` aplicadas; historial local/remoto en paridad
  y dry-run posterior sin pendientes.
- ACL remota del snapshot: `public=f`, `anon=f`, `authenticated=t`,
  `service_role=f`.

Preparación de Fase 4:

- La RPC de escritura de Fase 2 no recibe una versión esperada y no puede
  detectar una edición concurrente.
- `20260730007400` añade listado paginable de identidades Auth, snapshot
  administrativo, token estable y guardado atómico con bloqueo y versión.
- `20260730007500` verifica autorización, ACL, pantalla desconocida, conflicto,
  atomicidad, auditoría y protección del último administrador.
- Ambas migraciones quedaron aplicadas y verificadas remotamente.
- Contrato inicial: 0/13; contrato propuesto: 13/13. Migraciones generales:
  31/31.

Revisión ampliada antes del push:

- El catálogo servidor persiste sólo identidad, jerarquía, condición de hoja,
  actividad y versión; una sincronización administrativa atómica lo actualiza
  desde `screens.jsx` sin borrar filas retiradas.
- El token incorpora perfil, asignación activa, rol activo, permisos del rol,
  overrides y versión global del catálogo.
- Triggers diferidos protegen el último administrador ante cambios de perfil,
  asignación, rol, permisos de rol, overrides y catálogo.
- La verificación usa UUID y perfiles sintéticos reservados, aborta ante
  colisión y limpia/restaura todos los fixtures antes del commit.
- Contrato ampliado: 10 fallos iniciales sobre 23; resultado final 23/23.
  Cadena de migraciones: 31/31. Historial local/remoto en paridad y dry-run
  posterior vacío.
- `007600/007700` añaden y verifican la lectura administrativa de versión,
  actividad y jerarquía del catálogo, necesaria para sincronización optimista
  desde más de una terminal. Contrato servidor final: 26/26.
- `007800/007900` añaden y verifican el snapshot de edición con permiso
  heredado y catálogo de roles activos. No modifican datos y dejan
  `public`/`anon` sin acceso. Contrato servidor final: 30/30; historial remoto
  en paridad y dry-run posterior vacío.

## Riesgo residual y pendientes

Fases 4 a 6 permanecen abiertas. El modelo y el cliente ya resuelven permisos
por usuario con caché versionada; todavía no existen el editor triestado ni la
migración de capacidades operativas del dominio.

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

La reversión de Fase 3 requiere primero publicar el cliente de Fase 2 y después
una migración hacia adelante que revoque y elimine
`pos.current_permission_snapshot(text[])`. La migración `007300` sólo verifica
y no tiene objetos que revertir.

## Referencias

- Riesgo: `docs/03-known-risks.md` — H-56.
- Arquitectura: `docs/02-architecture.md` — autorización del esquema `pos`.
- Decisión: `docs/architect/decisions/ADR-005-autorizacion-en-rls.md`.
