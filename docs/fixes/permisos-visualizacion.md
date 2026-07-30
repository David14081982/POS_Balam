# Permisos de visualización por usuario

**Riesgo:** H-56
**Estado:** PARCIALMENTE RESUELTO - FASES 1 A 4
**Fecha:** 30/07/2026
**Commits:** Fase 1 `a04b2c3`; Fase 2 `0b9c933`; Fase 3 `b20bcc8`;
soporte servidor Fase 4 `17df782`, `06d4eaa`, `d35b3ea`; interfaz Fase 4 este
commit

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

### Fase 4 — editor administrativo

`balam/permissions.jsx` deriva módulos y hojas exclusivamente de `SCREENS`,
sin catálogo visual duplicado. Sincroniza la estructura con versión
optimista, pagina y busca cuentas Auth, explica el origen del permiso y permite
heredar, permitir o denegar cada hoja. Los módulos reflejan activado,
desactivado o parcial y aplican cambios a sus descendientes visibles.

El borrador sobrevive a errores y conflictos; cambiar de usuario exige guardar,
descartar o cancelar mediante un modal propio. El guardado usa una sola RPC
atómica y después relee el snapshot remoto. Si el usuario modificado es el
actual, refresca `AUTH`.

Los padres no persisten permisos: `AUTH.permissionReason()` deriva su acceso de
las hojas. El registro sube a `h56-screen-registry-v2`, invalidando de forma
fail-closed las cachés offline anteriores.

Pruebas: editor 21/21; API 30/30; modelo 13/13; AUTH 18/18; migraciones 31/31;
registro 12/12; roles 15/15; contratos 40/40; cola 115/115; build 8/8; smoke
17/17; navegación 15/15. Los artefactos se regeneraron con 71 assets.

### Fase 5 — capacidades operativas, grupo 1

La visualización y la operación ya tienen autoridades distintas. Las
migraciones `20260730008000/08100` crean y verifican un catálogo estable de
capacidades, permisos heredados por rol, overrides individuales y auditoría.
La resolución efectiva es override → rol → denegado; una clave desconocida o
una cuenta inactiva nunca obtiene autorización.

`20260730008200/08300` protegen `commissions.settle` y
`commissions.close_period`. Liquidar y cerrar usan RPC transaccionales,
idempotencia estable, bloqueo acotado y auditoría atómica. La escritura directa
de acumuladores y liquidaciones queda denegada a clientes autenticados. El
cliente primero conserva la operación en la cola offline y después invoca
exclusivamente esas RPC.

Pruebas: capacidades 17/17; migraciones 31/31; cola 115/115; roles 15/15; AUTH
18/18; contratos 40/40; build 8/8; smoke 17/17; navegación 15/15. Las cuatro
migraciones están aplicadas remotamente, el historial está en paridad y el
dry-run posterior no tiene pendientes.

El grupo 2 protege devoluciones y cambios sin copiar sus extensas funciones
transaccionales. `20260730008400` retira la ejecución pública de las RPC
históricas y expone wrappers que exigen `sales.refund` o `sales.exchange`;
`20260730008500` verifica el JWT sintético completo, compatibilidad de
administrador/vendedor, denegaciones por override e identidad inconsistente,
ACL y limpieza. El cliente usa exclusivamente los wrappers y conserva la misma
cola e identidad idempotente. No hay hoy una acción de cancelación: el valor
`Cancelado` es únicamente estado histórico, por lo que no se inventó una
mutación sin contrato de producto.

Pruebas del grupo 2: capacidades 21/21; migraciones 31/31; cola 115/115; roles
15/15; AUTH 18/18; contratos 40/40; build 8/8; smoke bundle 17/17; navegación
15/15. Historial remoto en paridad y dry-run vacío.

Los grupos 3 a 5 añaden `08600` a `09100`: inventario deja de aceptar escritura
directa y usa RPC auditadas; configuración y permisos tienen capacidades
distintas; ventas pasan por wrappers `sales.create`; clientes, promociones y
vendedores reciben policies por acción. La Edge Function `admin-users` fue
desplegada con una guarda `sellers.manage` resuelta mediante el JWT del actor.
El mapa versionado está en `docs/05-operational-capabilities.md`.

Regresión final: capacidades 32/32; migraciones 31/31; cola 115/115; roles
15/15; AUTH 18/18; contratos 40/40; build 8/8; smoke 17/17; navegación 15/15.
Migraciones locales/remotas en paridad hasta `09100`; dry-run vacío.

`09200/09300/09400` completan `sales.collect`: el cobro inicial con dinero
requiere crear y cobrar; el anticipo sigue la misma regla; un abono o
liquidación de apartado remoto exige sólo cobrar. La transacción comercial y
la cola no cambian. No existe edición de método ni reversión de cobro, por lo
que ambas quedan explícitamente fuera.

`09500/09600` completan la frontera `inventory.loan`. El cliente conserva el
documento en la cola local-first y el servidor serializa por préstamo, valida
versión, capacidad y transición, guarda un tombstone para la baja y audita en
la misma transacción. `edit` y `delete` sólo aceptan un préstamo pendiente sin
eventos; `return` exige además `close` cuando completa la devolución;
`shortage` siempre exige `close`; `reopen` sólo acepta `no_devuelto`. El cierre
sigue siendo automático. La RPC no escribe productos ni movimientos.

La verificación remota pasó transiciones, denegación sin escritura parcial,
auditoría y limpieza sintética. Regresión específica: capacidades 40/40,
migraciones 31/31, cola 115/115 y préstamos 117/117. El barrido global también
detectó seis arneses históricos incompatibles con cambios anteriores de Fase 5
o dependientes de estado compartido; ninguno recorre la frontera de préstamos
y se conservan declarados como riesgo de infraestructura de prueba.

## Riesgo residual y pendientes

La terminación de Fase 5 y la Fase 6 permanecen abiertas. El modelo, la
autoridad cliente, el editor triestado, comisiones, posventa, inventario,
configuración, cobros y préstamos ya tienen fronteras operativas. Persisten
las bajas específicas de clientes, promociones y vendedores descritas en el
mapa; cancelación carece de contrato funcional.

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

La reversión de Fase 4 publica nuevamente el cliente del commit `d35b3ea`,
desactiva `config.permisos` en el registro y regenera los artefactos. Las RPC
de lectura `007600` y `007800` pueden conservarse sin efecto; retirarlas exige
una migración forward que revoque y elimine sólo esas funciones.

La reversión del grupo 1 de Fase 5 requiere publicar el cliente previo y crear
una migración hacia adelante que retire el trigger de acumuladores, restaure
los privilegios históricos estrictamente necesarios y revoque las RPC de
comisiones. Las tablas de capacidades y auditoría pueden conservarse inertes;
eliminarlas sería destructivo y requiere autorización separada.

## Referencias

- Riesgo: `docs/03-known-risks.md` — H-56.
- Arquitectura: `docs/02-architecture.md` — autorización del esquema `pos`.
- Decisión: `docs/architect/decisions/ADR-005-autorizacion-en-rls.md`.
