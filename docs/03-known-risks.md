# Registro de riesgos conocidos

Este archivo evita reinvestigar problemas ya identificados. Antes de trabajar
un riesgo se debe leer su evidencia y las correcciones relacionadas. Los
estados válidos son: `ABIERTO`, `EN CURSO`, `PARCIALMENTE RESUELTO`, `RESUELTO`
y `BLOQUEADO`.

## Resumen

| ID | Riesgo | Estado | Área |
|---|---|---|---|
| H-01 | Inventario concurrente | RESUELTO | Inventario / sincronización |
| H-02 | Folios generados localmente | RESUELTO | Ventas |
| H-03 | Coherencia de cobros | RESUELTO | Ventas / finanzas |
| H-04 | Escrituras sin transacción única | RESUELTO | Supabase / cola offline |
| H-05 | Autorización de administración de usuarios | RESUELTO | Auth / Edge Function |
| H-06 | Sobrescritura multi-terminal de entidades | RESUELTO | Sincronización / dominio |
| H-07 | Acceso excesivo de cualquier autenticado | RESUELTO | RLS / autorización |
| H-08 | Vendedor sin confinamiento al Punto de Venta | RESUELTO | Auth / navegación / RLS |
| H-09 | Cambio de sesión reutiliza estado y cola globales | RESUELTO | Auth / sincronización / localStorage |
| H-10 | Cadena de migraciones no reconstruye el esquema | RESUELTO | Supabase / migraciones |
| H-11 | Margen mínimo configurado pero no aplicado | RESUELTO | Promociones / precios |
| H-12 | Lector Excel vulnerable y sin límites explícitos | RESUELTO | Importación Excel / dependencias |
| H-13 | Terminal nueva no recupera movimientos remotos | RESUELTO | Sincronización / kardex |
| H-14 | Cola offline sin diagnóstico ni política de recuperación | RESUELTO | Sincronización / almacenamiento local |
| H-15 | Smoke E2E produce falsos negativos y no libera recursos al fallar | RESUELTO | Pruebas / bundle |
| H-16 | Pulls truncados por límite de PostgREST | RESUELTO | Sincronización / rendimiento |
| H-17 | Código y estilos heredados sin consumidores | RESUELTO | Frontend / build |

## H-01 — Inventario concurrente

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Evidencia:** `DATA` modifica existencias localmente y `STORE` sincroniza
colecciones mediante `upsert`. No existe una operación SQL atómica que valide y
descuente stock frente a ventas concurrentes de dos terminales.
**Reproducción remota:** dos vendedores temporales leyeron la misma última
pieza en `sync_version=1`. Ambas ventas fueron aceptadas; el primer snapshot
dejó stock 0 y versión 2, mientras el segundo conflicto conservó esa fila sin
invalidar su venta. Resultado: dos ventas autoritativas para una pieza.
**Impacto:** sobreventa, último escritor gana o divergencia temporal entre
terminales.
**Corrección:** `pos.reserve_sale_stock()` bloquea productos en orden estable,
agrupa cantidades por talla, valida disponibilidad y descuenta dentro de una
transacción. `operation_id` vuelve idempotente cada reintento. Una venta nueva
cobrada sólo puede insertarse si el trigger encuentra su reserva confirmada.
El vendedor perdió el permiso de actualizar productos directamente.
**Despliegue:** migraciones local/remota `20260725001700` y
`20260725001800`.
**Pruebas:** la concurrencia real de dos sesiones sobre la última pieza produjo
una reserva aceptada y otra `insufficient_stock`; sólo una venta fue insertada,
el reintento fue idempotente, el PATCH directo no cambió stock y terminaron
stock 0, versión 2 y una venta autoritativa. Regresiones:
`test-store-queue.mjs` 42/42, `test-concurrency.mjs` 9/9,
`test-sale-coherence.mjs` 15/15, `test-commission.mjs` 10/10 y
`test-role-access.mjs` 10/10.
**Riesgo residual:** una venta capturada offline puede quedar
`stock_pending` hasta que exista inventario remoto; permanece en la cola y no
se crea como venta autoritativa. Las transacciones completas de venta y
devolución quedaron integradas en H-04. La unicidad del folio visible quedó
resuelta posteriormente en H-02.
**Corrección documentada:** `docs/fixes/inventario-concurrente.md`.

## H-02 — Folios generados localmente

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Fecha de corrección/despliegue:** 25/07/2026
**Commit:** `23bec3b`
**Evidencia:** la secuencia se lee y escribe en `localStorage`; terminales o
perfiles distintos pueden generar el mismo prefijo y número.
**Impacto:** colisión de folios, asociación incorrecta de renglones/pagos o
rechazo durante sincronización.
**Reproducción:** dos navegadores aislados y offline, ambos con contador vacío,
generaron `BG-1`; borrar `localStorage` volvió a producir `BG-1`.
**Causa raíz:** `DATA.nextFolio()` concatenaba únicamente prefijo y contador
local. El `operation_id` inmutable ya existente no participaba en el folio.
**Corrección:** las ventas generan primero su UUID de operación y el folio
conserva el consecutivo legible seguido de una representación base 36 de sus
128 bits. Los folios históricos permanecen válidos. Si una operación antigua
encolada recibe `folio_conflict`, `STORE` reidentifica cabecera, renglones,
pagos, movimientos, devoluciones pendientes y cola antes de reintentar con los
mismos `operation_id` y `commit_id`; una venta confirmada nunca se renombra.
**Despliegue:** migración local/remota
`20260725002500_pos_h02_folio_verification.sql`.
**Pruebas:** `test-folio-concurrency.mjs` 4/4,
`test-store-queue.mjs` 55/55, `test-sale-coherence.mjs` 17/17,
`test-returns.mjs` 17/17, `test-concurrency.mjs` 9/9,
`test-role-access.mjs` 10/10 y `test-commission.mjs` 10/10. La verificación
remota confirmó rechazo limpio del folio duplicado, reconciliación con la misma
identidad, dos ventas independientes y limpieza de temporales.
**Pendiente:** ninguno dentro del contrato multi-terminal actual.
**Riesgo residual:** `crypto.randomUUID()` aporta la identidad normal. El
fallback de navegadores antiguos combina terminal, tiempo y aleatoriedad; la
colisión es extremadamente improbable, aunque no matemáticamente imposible.
Supabase conserva `folio_conflict` como última defensa y no sobrescribe otra
venta.
**Corrección documentada:** `docs/fixes/folios-multi-terminal.md`.

## H-03 — Coherencia de cobros

**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commits:** `159ba95`, `223acab`, `7f9c28b`
**Causa raíz:** el total cobrado, el total persistido y los consumidores
posteriores no compartían un contrato; anticipo y pago mixto perdían datos, y
ticket/devolución reconstruían importes con información vigente.
**Solución:** contrato financiero persistente para subtotal, IVA, total,
anticipo, saldo y componentes de pago; IVA incluido obligatorio; trazabilidad
mediante movimientos de pago y snapshots históricos.
**Pruebas:** las pruebas exactas y su conteo deben consultarse en los documentos
de corrección y en los commits; no se infiere un total agregado no registrado.
**Documentación:** `docs/H-03-coherencia-cobro.md` y
`docs/trazabilidad-financiera.md`.
**Riesgo residual:** H-01, H-04 y H-02 resolvieron posteriormente concurrencia
de stock, atomicidad compuesta y folios multi-terminal, respectivamente.

## H-04 — Escrituras sin transacción única

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Fecha de corrección/despliegue de venta:** 25/07/2026
**Fecha de corrección/despliegue de devolución:** 25/07/2026
**Commit:** `23bec3b`
**Evidencia:** una venta o devolución se traduce en cabecera, renglones,
movimientos y pagos procesados desde la cola; estas escrituras no forman una
única transacción SQL de dominio.
**Impacto:** un fallo parcial puede dejar cabecera sin detalles, inventario sin
movimiento o pagos incompletos hasta un reintento; un error no recuperable puede
requerir reconciliación.
**Reproducción:** `test-store-queue.mjs` prueba 14 inyecta un fallo en
`sale_items` después de aceptar la reserva H-01 y la cabecera. El resultado
actual conserva stock/cabecera remotos, no guarda renglones y deja el reintento
en cola.
**Causa raíz:** `STORE.applyOp()` ejecuta reserva, cabecera, renglones y
movimientos mediante solicitudes independientes; `DATA` además encola pagos y
agregados de cliente/vendedor por separado. No existe una frontera SQL que
confirme o revierta la operación lógica completa.
**Solución de venta:** `pos.commit_sale()` confirma en una sola transacción
reserva, cabecera, renglones, movimientos, pagos y deltas de cliente/vendedores.
`pos.sale_commits` hace el reintento idempotente por hash; la cola conserva el
commit completo y los apartados generan un commit por abono.
**Solución de devolución:** `pos.commit_return()` bloquea la venta, valida
cantidades vendidas menos devoluciones confirmadas y confirma conjuntamente
cabecera, renglones, stock, movimiento, estado y reversos. `return_id` evita
que devoluciones parciales borren movimientos ajenos y `pos.return_commits`
hace idempotente cada operación.
**Despliegue:** migraciones local/remota `20260725001900`,
`20260725002000`, `20260725002100`, `20260725002200`, `20260725002300` y
`20260725002400`.
**Adopción de cola antigua:** `pos.commit_legacy_return()` recibe objetivos
exactos con versión base. Los aplica una sola vez si la entidad sigue en esa
versión, reconoce el mismo objetivo en la versión siguiente y rechaza cualquier
estado posterior con `legacy_version_conflict`, sin escrituras parciales.
**Pruebas:** verificación remota con rollback total ante fallo inyectado, commit
válido completo, reintento sin duplicados, rechazo `commit_mismatch` y limpieza
de temporales. Regresiones: `test-store-queue.mjs` 52/52,
`test-sale-coherence.mjs` 17/17, `test-returns.mjs` 17/17,
`test-concurrency.mjs` 9/9, `test-role-access.mjs` 10/10 y
`test-commission.mjs` 10/10. La verificación remota de devolución confirmó
rollback total, reintento sin duplicados, rechazo de sobredevolución, dos
devoluciones parciales sin pérdida de movimientos y limpieza de temporales.
**Pendiente:** ninguno dentro del contrato de escrituras compuestas identificado
por H-04.
**Riesgo residual:** ninguno conocido dentro de H-04. Una cola incompleta queda
pendiente con error explícito en vez de producir una escritura parcial. La
colisión del folio visible quedó resuelta posteriormente en H-02.
**Corrección documentada:** `docs/fixes/venta-transaccional-idempotente.md`.

## H-05 — Autorización de administración de usuarios

**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit de corrección:** `407ce14`
**Commit de verificación:** `d6537c4`
**Causa raíz:** `service_role` se usaba para consultar el esquema personalizado
`pos` sin configurarlo correctamente para la validación del administrador.
**Solución:** validar y operar `pos.sellers` con el cliente del usuario,
configurado para `pos`, y reservar `service_role` para Supabase Auth.
**Pruebas:** rechazo sin sesión, creación/edición/eliminación manual de usuario
temporal y `test-store-queue.mjs` con 29 pruebas aprobadas. La verificación
final contra `admin-users` versión 8 aprobó 9/9: creación de cuenta temporal,
login con contraseña inicial, cambio real, rechazo de la contraseña anterior,
login con la nueva, eliminación y rechazo posterior. Las migraciones
local/remota `20260725002700` y `20260725002800` prepararon y eliminaron la
identidad administrativa auxiliar; no quedaron cuentas ni perfiles temporales.
Regresiones: `test-store-queue.mjs` 55/55, `test-role-access.mjs` 10/10 y
`test-concurrency.mjs` 9/9.
**Documentación:** `docs/fixes/admin-users-auth.md`.
**Riesgo residual:** ninguno conocido dentro del flujo administrativo probado.

## H-06 — Sobrescritura multi-terminal de entidades

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Fecha de corrección local:** 25/07/2026
**Fecha de despliegue Supabase:** 25/07/2026
**Commit de corrección:** `23bec3b`
**Commit de verificación:** `d6537c4`
**Evidencia:** `DATA.saveProducts()`, `saveClients()`, `saveSellers()` y
`savePromos()` entregan colecciones completas a `STORE.pushRows()`. Los
`upsert` usan únicamente el identificador y no comparan la versión que la
terminal leyó. Una terminal desactualizada puede sobrescribir una edición más
reciente; una eliminación física puede revivir cuando otra terminal vuelve a
enviar la fila antigua.
**Impacto:** stock, datos de clientes, vendedores y promociones pueden
retroceder silenciosamente. La información mostrada deja de representar una
secuencia determinista de cambios.
**Solución local:** `supabase/migrations/20260725001300_pos_013_concurrency.sql`
agrega versión optimista,
tombstones y auditoría. `STORE` envía la versión leída, verifica la fila
devuelta, conserva la cola offline y avisa/restaura cuando el servidor rechaza
una versión antigua.
**Pruebas:** `test-concurrency.mjs` 9/9,
`test-store-queue.mjs` 55/55, `test-role-access.mjs` 10/10,
`test-sale-coherence.mjs` 17/17, `test-returns.mjs` 17/17 y
`test-folio-concurrency.mjs` 4/4.
**Documentación:** `docs/fixes/concurrencia-multi-terminal.md`.
**Despliegue:** Supabase registró la versión local/remota `20260725001300` en el
proyecto Balam (`telohdbvbvsfmwyriflz`); la inspección remota confirmó la tabla
`pos.sync_conflicts`.
**Verificación remota:** la migración local/remota `20260725002600` representó
dos terminales con versiones y `device_id` distintos. A confirmó cambios sobre
producto, cliente, vendedor y promoción; los cuatro snapshots obsoletos de B
conservaron A. Una promoción eliminada tampoco revivió. La auditoría registró
exactamente cinco conflictos con versiones y terminal correctas, y todas las
fixtures y auditorías temporales se eliminaron.
**Pendiente:** ninguno dentro del contrato de las cuatro entidades protegidas.
La fusión automática de intenciones no forma parte de la política; primera
escritura confirmada gana.
**Riesgo residual:** no queda sobrescritura silenciosa conocida. Los snapshots
completos son ineficientes y, tras un conflicto visible, la segunda terminal
debe reaplicar manualmente su intención si todavía corresponde. El descuento
concurrente de ventas quedó resuelto en H-01 mediante reserva atómica.

## H-07 — Acceso excesivo de cualquier autenticado

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Evidencia remota:** `anon` recibe `401/42501` al intentar acceder al esquema
`pos`, pero una cuenta temporal de Supabase Auth sin fila en `pos.sellers`
obtuvo SELECT, UPDATE y DELETE en las 14 tablas probadas. En 13 tablas el INSERT
alcanzó las restricciones de datos, demostrando que RLS permitió la operación;
`sync_conflicts` rechazó INSERT por su policy específica.
**Causa identificada:** las policies `auth_all` aplican `using (true)` y
`with check (true)` a todo rol `authenticated`; no verifican perfil, estado ni
rol de negocio.
**Impacto:** cualquier cuenta Auth válida, incluso huérfana o inactiva, puede
leer, alterar o borrar información comercial mediante PostgREST directo.
**Alcance de contención:** el producto actual reserva el login al administrador;
el acceso directo a `pos` debe exigir una fila activa con `role='admin'`.
**Corrección:** las migraciones `20260725001400_pos_admin_rls.sql` y
`20260725001500_pos_service_role_grants.sql` reemplazan `auth_all` por una
policy que exige perfil de administrador activo y conservan acceso técnico
exclusivo de `service_role`.
**Despliegue:** Supabase registra las versiones local/remota
`20260725001400` y `20260725001500`.
**Pruebas:** `anon` fue rechazado en 14/14 tablas. Administrador activo leyó
14/14 y completó crear, actualizar y eliminar un cliente temporal.
Administrador inactivo, vendedor y cuenta sin perfil vieron cero filas y
recibieron `42501` al escribir en 14/14 tablas. Un intento de vendedor de
editar y borrar su propio perfil no produjo cambios. Las cuatro identidades
temporales y sus perfiles fueron eliminados al terminar. Regresiones locales:
`test-store-queue.mjs`, 34/34; `test-concurrency.mjs`, 9/9.
**Riesgo residual:** la autorización configurable por pantalla y el acceso de
vendedores al Punto de Venta no forman parte de esta contención. Requieren un
contrato de permisos y una corrección separada antes de habilitar login no
administrativo.
**Corrección documentada:** `docs/fixes/rls-administrador-activo.md`.

## H-08 — Vendedor sin confinamiento al Punto de Venta

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Evidencia inicial:** `AUTH.isAdmin()` devuelve verdadero ante cualquier
sesión; `AUTH.current()` asigna rol `admin` cuando no encuentra perfil local.
En `app.jsx`, sólo cuatro entradas tienen marca administrativa, la marca no
impide navegar y una página persistida en `balam-page` no se valida por rol.
Además, H-07 bloquea actualmente todo el esquema para vendedores, por lo que
un vendedor autenticado no puede sincronizar siquiera el Punto de Venta.
**Impacto:** la interfaz no distingue administrador y vendedor de manera
confiable; al habilitar cuentas de vendedor podrían mostrarse pantallas fuera
de su función o, con las policies actuales, trabajar sólo sobre datos locales
sin respaldo remoto.
**Alcance aprobado:** administrador con acceso completo; vendedor activo
limitado a la pantalla Punto de Venta. Cuenta inactiva o sin perfil no obtiene
acceso.
**Pruebas requeridas:** restauración de página prohibida, navegación directa,
menú por rol, perfil ausente/inactivo, administrador sin regresión y venta
sincronizada por un vendedor contra Supabase.
**Corrección:** `AUTH` resuelve el perfil activo desde Supabase y expone un
contrato único `canAccess`; la aplicación filtra navegación y redirige páginas
persistidas. La migración `20260725001600_pos_seller_pos_access.sql` permite al
vendedor sólo lecturas y escrituras operativas del POS, con triggers que
impiden cambiar atributos administrativos de productos o vendedores.
**Despliegue:** Supabase registra la versión local/remota `20260725001600`.
**Pruebas:** `test-role-access.mjs` 10/10,
`test-store-queue.mjs` 42/42, `test-concurrency.mjs` 9/9,
`test-sale-coherence.mjs` 15/15 y `test-commission.mjs` 10/10. La matriz remota
confirmó vendedor operativo, administrador sin regresión, inactivo y huérfano
sin acceso, y rechazo `42501` de cambios administrativos. No quedaron cuentas
ni filas temporales.
**Riesgo residual:** la sesión offline usa únicamente el último perfil
verificado para el mismo correo; una desactivación remota se hace efectiva en
esa terminal al recuperar conexión. Venta y devolución quedaron
transaccionales en H-04 y la concurrencia de stock quedó resuelta en H-01.
**Corrección documentada:** `docs/fixes/vendedor-solo-punto-venta.md`.

## H-09 — Cambio de sesión reutiliza estado y cola globales

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Commit:** `d6537c4`
**Evidencia previa:** `STORE.enabled` quedaba verdadero después del primer login
y `app.jsx` sólo ejecutaba `STORE.init({ pull: true })` cuando esa bandera era
falsa. Un logout seguido de otro login sin recargar no realizaba un pull nuevo.
Las operaciones de `balam_sync_queue` tampoco conservaban propietario.
**Impacto:** una cuenta nueva puede usar una copia local preparada bajo otra
sesión y una operación pendiente puede enviarse con una identidad distinta de
la que la creó.
**Origen de auditoría:** Fase 4, hallazgo original H-11.
**Corrección:** `AUTH` entrega cada `authchange` a `STORE.setSession()`. Cada
operación nueva conserva `ownerId`; el drenado, la compactación, la detección de
tablas pendientes y el reajuste de versiones quedan limitados a la identidad
activa. Logout suspende `STORE` sin borrar la cola y un login distinto ejecuta
un ciclo nuevo de drenado y pull. Las operaciones históricas sin propietario se
ponen en cuarentena y sólo un administrador puede reclamarlas expresamente.
**Pruebas:** reproducción estática previa 4 fallos; después,
`node test-store-queue.mjs` 62/62, `node test-role-access.mjs` sin fallos y
`node test-smoke.mjs` 13/13. El
escenario dinámico A→logout→B conserva la operación de A, permite sincronizar B
sin reemplazarla y la reanuda al volver A. La cola histórica no se envía al
primer login, muestra aviso y sólo se procesa tras reclamación administrativa.
**Riesgo residual:** una cola creada antes de H-09 no contiene evidencia para
identificar automáticamente a su autor. Se conserva íntegra en cuarentena y
requiere revisión administrativa; no puede cruzarse de sesión silenciosamente.
**Corrección documentada:** `docs/fixes/aislamiento-cola-por-sesion.md`.

## H-10 — Cadena de migraciones no reconstruye el esquema

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Commit:** `41dac52`
**Evidencia inicial:** `supabase/migrations/` comienza en
`20260725001300_pos_013_concurrency.sql`; las definiciones base 001–012 sólo
existen como scripts manuales en la raíz de `supabase/`. Tampoco existe
`supabase/config.toml`. Una instalación formal desde cero intenta aplicar 013
sin haber creado previamente el esquema ni sus tablas.
**Impacto:** una versión del repositorio no determina por sí sola un esquema,
conjunto de funciones, grants y policies. Un entorno nuevo depende de orden y
ejecuciones manuales no registrados.
**Origen de auditoría:** Fase 6, hallazgo original H-20 y partes de H-15/H-22.
**Causa raíz:** los scripts 001–012 se ejecutaban manualmente y nunca se
incorporaron a `supabase_migrations.schema_migrations`; la carpeta formal y el
proyecto enlazado empezaban en 013. Además, el orden numérico aparente era
inválido para una instalación limpia: 004 requiere que 005 haya creado
`promotions`.
**Corrección:** `supabase/config.toml` formaliza PostgreSQL 17 y expone `pos`.
Las copias históricas inmutables 001–012 viven ahora en `supabase/migrations/`
con el orden de dependencia correcto. El historial remoto fue reconciliado
como aplicado sin reejecutar SQL ni tocar datos. La migración 029 comprueba
tablas, columnas, funciones, RLS, policies, acceso `anon` y Storage. Las
migraciones 01950 y 030 crean y eliminan semillas reservadas que permiten
ejecutar las verificaciones históricas 020–026 en una base vacía. La migración
031 compara una huella semántica estable entre PostgreSQL 17 y 18.
**Despliegue:** historial local/remoto 001–031 idéntico en
`telohdbvbvsfmwyriflz`; `db push --dry-run` no reporta pendientes.
**Pruebas:** dos clústeres lógicos vacíos e independientes ejecutaron 001–031
desde cero sobre PostgreSQL 18.4; ambos terminaron con 17 tablas, 191 columnas,
11 funciones, 30 policies, sin semillas reservadas y con huella
`a7d720a0d8a5f6ae5d33c5c1f61f3e49`. Sus dumps normalizados fueron idénticos
(SHA-256 `E101689C7A0F5F45A8A05A6C9052F5F4B2B949121C1FEE39C77862B84727CA66`).
Producción aprobó la misma huella mediante 031. `node test-migrations.mjs`
23/23; cola 89/89, concurrencia 9/9, roles 10/10, coherencia de venta 17/17,
devoluciones 17/17 y folios 4/4. `db lint` no reportó errores y sí dos
advertencias preexistentes de variables PL/pgSQL no leídas. El smoke de UI
agotó la espera de arranque, sin aserciones ejecutadas y sin relación con SQL.
**Riesgo residual:** bajo. La huella omite deliberadamente el orden físico de
columnas, la representación textual de defaults y las restricciones internas
`NOT NULL`, que cambian entre PostgreSQL 17/18; conserva nombres y tipos de
columnas, nulabilidad, restricciones funcionales, índices, funciones y RLS.
**Corrección documentada:** `docs/fixes/migraciones-reproducibles.md`.

## H-11 — Margen mínimo configurado pero no aplicado

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Commit:** `56b3d37`
**Evidencia:** `CONFIG` define `discount.minMarginPct=45`, pero
`PROMOS.applyStack()` sólo suma porcentajes y montos fijos, limita el resultado
a cero y nunca consulta costo ni configuración. Con precio $1,000, costo $450 y
descuento 40%, devuelve $600 en lugar del piso $818.18; tampoco devuelve
`capped=true`.
**Impacto:** promociones activas pueden vender por debajo del margen comercial
configurado y la vista previa muestra el mismo precio incorrecto.
**Origen de auditoría:** Fase 8, hallazgo original H-13.
**Causa raíz:** `applyStack()` recibía sólo precio y promociones; costo y
`discount.minMarginPct` nunca llegaban al cálculo. `lineUnit()` y
`previewDraft()` llamaban esa misma función incompleta.
**Corrección:** el motor central recibe el producto, calcula el piso
`costo/(1-margen)` y lo limita al precio de lista. POS y vista previa entregan
el mismo producto y exponen `capped`. Configuración muestra el margen,
restringido a 0–100. Costos cero/ausentes y margen 0 conservan compatibilidad
histórica.
**Pruebas:** reproducción previa 30 pasaron/2 fallaron. Después,
`test-discounts.mjs` 43/43, `test-sale-coherence.mjs` 17/17,
`test-commission.mjs` 10/10, `test-returns.mjs` 17/17,
`test-store-queue.mjs` 62/62 y `test-smoke.mjs` 13/13.
**Riesgo residual:** un producto sin costo positivo no permite calcular margen
y conserva el descuento histórico. Las ventas anteriores no se recalculan; sus
precios y descuentos permanecen como snapshot.
**Corrección documentada:** `docs/fixes/margen-minimo-promociones.md`.

## H-12 — Lector Excel vulnerable y sin límites explícitos

**Estado:** RESUELTO
**Fecha de registro:** 25/07/2026
**Fecha de corrección:** 25/07/2026
**Commit:** `70c3114`
**Evidencia:** `POS Balam.html` y `balam/_source.html` cargan
`xlsx@0.18.5` desde un CDN. Tanto `XLSXIO.parseFile()` como la importación de
catálogos en `settings.jsx` entregan directamente el contenido completo de un
archivo elegido por el administrador a `XLSX.read()`, sin límite previo de
tamaño, hojas ni dimensiones.
**Impacto:** un libro manipulado puede alcanzar vulnerabilidades conocidas del
lector y un archivo desproporcionado puede bloquear la interfaz. La dependencia
no forma parte de `package.json`, por lo que las auditorías npm no la detectan;
el artefacto offline incorpora la misma versión vulnerable durante el build.
**Origen de auditoría:** Fase 9, hallazgo original H-12 y parte de H-22.
**Causa raíz:** la biblioteca se consumía fuera del inventario npm y desde un
CDN, sin control propio de versión/integridad. Inventario y Configuración
implementaban lectores separados sin una frontera común de validación.
**Corrección:** la distribución oficial SheetJS 0.20.3 quedó fijada localmente
con SHA-256 verificable. `XLSXIO.readWorkbook()` centraliza ambos caminos,
rechaza archivos vacíos o mayores de 10 MB y limita libros a 32 hojas; cada
hoja admite como máximo 50 000 filas, 256 columnas y 1 000 000 de celdas
declaradas. El lector omite fórmulas, HTML y estilos. El build incorpora la
copia local al artefacto offline.
**Pruebas:** `test-xlsx-security.mjs` 17/17,
`test-import-fotos.mjs` 23/23, `test-export-modelo.mjs` 14/14 y
`test-smoke.mjs` 13/13. `build-offline.mjs` regeneró los artefactos y la prueba
offline confirmó SheetJS 0.20.3 sin solicitudes externas. Se conservaron
lecturas válidas XLSX, XLS y CSV; se rechazaron todos los límites declarados y
una cabecera `__proto__` no contaminó `Object.prototype`.
**Pendiente:** ninguno dentro de H-12.
**Riesgo residual:** futuras vulnerabilidades del parser requieren actualizar
la copia fijada y su hash. Un libro legítimo que exceda los límites debe
dividirse; se rechaza completo antes de modificar datos.
**Corrección documentada:** `docs/fixes/lector-excel-seguro.md`.

## H-13 — Terminal nueva no recupera movimientos remotos

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de corrección:** 26/07/2026
**Commit:** `1e52750`
**Evidencia:** las ventas y devoluciones envían sus movimientos a
`pos.commit_sale()` y `pos.commit_return()`, que los persisten en
`pos.movements`. Sin embargo, `STORE.MAP` no contiene el dominio `movements` y
`STORE.init({ pull: true })` no lo incluye entre los dominios administrativos.
`DATA.applyRemote()` sí sabe recibirlos, pero ese camino nunca se invoca.
**Impacto:** una terminal limpia puede reconstruir cabeceras, renglones y pagos
recientes desde Supabase, pero conserva `DATA.movements` vacío. Kardex,
trazabilidad de inventario y cualquier reporte que consuma movimientos difieren
entre computadoras.
**Origen de auditoría:** Fase 12, hallazgo original H-14. La omisión financiera
original H-06 ya quedó atendida por H-03/H-04 y se verificará como regresión.
**Causa raíz:** `DATA.applyRemote()` aceptaba movimientos, pero `STORE.MAP` no
definía la tabla y el arranque no solicitaba ese dominio. El flujo remoto
quedaba desconectado después de persistir correctamente.
**Corrección:** `STORE` incorpora un mapper de sólo lectura y el administrador
recupera el kardex al arrancar. La lectura pagina por `id` en bloques de 1 000 y
sólo aplica el conjunto completo. Una venta o devolución pendiente protege los
movimientos locales y omite el pull hasta confirmar la cola.
**Pruebas:** reproducción previa 62 pasaron/2 fallaron. Después,
`test-store-queue.mjs` 73/73, `test-sale-coherence.mjs` 17/17,
`test-returns.mjs` 17/17, `test-role-access.mjs` sin fallos,
`test-concurrency.mjs` 9/9 y `test-smoke.mjs` 13/13. La recuperación simuló una
terminal vacía con venta, renglón, snapshot financiero, pago, devolución,
renglón devuelto y movimiento; otra prueba recuperó 1 001 movimientos sin
duplicados ni omisiones.
**Pendiente:** ninguno dentro de la omisión de movimientos H-13.
**Riesgo residual:** movimientos históricos nunca persistidos en Supabase no se
inventan. La ventana de ventas sigue siendo 365 días configurables más
apartados, con búsqueda por folio para históricos. Volumen, índices y
paginación de los demás dominios permanecen separados para la Fase 14.
**Corrección documentada:** `docs/fixes/recuperacion-movimientos-terminal.md`.

## H-14 — Cola offline sin diagnóstico ni política de recuperación

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Evidencia:** `STORE.applyOp()` devuelve únicamente `true` o `false` y su
`catch` descarta la excepción. `flushQueue()` sólo agrega `retry=true`; no
conserva código, mensaje, categoría, número de intentos ni fecha. Red, sesión,
RLS, esquema, constraints y conflictos de dominio quedan indistinguibles. Toda
operación fallida vuelve a intentarse en cada drenado, aunque requiera una
acción administrativa. Si `saveQ()` falla por cuota, `run()` intenta directo y
no conserva diagnóstico si ese intento también falla.
**Impacto:** una cola puede permanecer atascada indefinidamente sin explicar
cómo recuperarla; el usuario sólo conoce el número pendiente. Errores
permanentes generan tráfico repetido y un fallo de persistencia puede dejar una
operación sin respaldo durable.
**Origen de auditoría:** Fase 13, hallazgo original H-15 y parte de H-16.
**Pruebas requeridas:** reproducir red, 401, 403/RLS, esquema, constraint,
conflicto de dominio y cuota; verificar que cada operación conserva causa,
estado y política; comprobar que una fallida no bloquea operaciones
independientes; reiniciar y releer el diagnóstico sin perder formatos de cola
anteriores.
**Corrección:** cada operación conserva estado, intentos, fechas, causa y
política. Red/servidor siguen en reintento; autenticación, permisos, esquema,
restricciones, inventario y conflictos se distinguen. Los bloqueos permanentes
requieren reintento explícito y la campana administrativa muestra la causa.
El candado se adquiere antes de esperar el cliente de Supabase, evitando dos
ejecutores simultáneos. Las colas históricas se migran de forma aditiva.
**Pruebas ejecutadas:** `node test-store-queue.mjs`: 89 pasaron, 0 fallaron
(red, 401, 403/RLS, esquema, constraint, inventario, cuota, independencia,
reinicio, reintento explícito y compatibilidad histórica).
El residual de cuota quedó cerrado con un espejo serializado en IndexedDB. El
arranque lo recupera antes de sincronizar; liberar cuota devuelve la autoridad
a `localStorage` y elimina el espejo. La primera escritura espera la
persistencia durable antes de intentar Supabase.
**Regresiones finales:** concurrencia 9/9, roles 10/10, coherencia de venta
17/17, devoluciones 17/17, smoke bundle 17/17 y build offline correcto.
**Riesgo residual:** si un navegador niega simultáneamente `localStorage` e
IndexedDB, no existe almacenamiento web durable disponible. La operación
permanece en memoria y la interfaz advierte que no se cierre la pestaña; no se
declara falsamente como persistida.
**Corrección documentada:** `docs/fixes/diagnostico-cola-offline.md`.
**Commit inicial:** `cabfccf`.
**Commit de cierre:** `6f6a874`.

## H-15 — Smoke E2E produce falsos negativos y no libera recursos al fallar

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Evidencia:** `node test-smoke.mjs bundle` arranca la aplicación y aprueba las
primeras siete verificaciones, pero termina por timeout al pulsar `Cancelar`.
Playwright informa que `#__bundler_err` intercepta el clic. El bundle registra
en ese panel eventos genéricos de recursos que no son excepciones JavaScript y
no aparecen como `pageerror`; aun con una imagen válida y cero solicitudes
Supabase aparecen 12 entradas genéricas. El cierre de Chrome y del servidor
sólo existe al final feliz, por lo que una excepción puede dejar recursos
abiertos.
**Impacto:** un recurso inválido del propio fixture se reporta como fallo del
producto y bloquea el recorrido. Las fases de limpieza o consolidación no
disponen de una señal E2E confiable, y un fallo temprano puede contaminar
ejecuciones posteriores.
**Pruebas requeridas:** demostrar el fallo actual; usar una imagen embebida
válida; simular Supabase sin tráfico real; comprobar arranque, navegación,
migración de foto, recuperación histórica y cero excepciones; garantizar el
cierre de navegador y servidor también ante errores.
**Causa raíz:** el arnés no aislaba la superficie interactiva del panel
diagnóstico del bundle y no tenía `try/finally`. También abortaba las peticiones
Supabase sin demostrar mediante una respuesta controlada que la jaula operara.
**Corrección:** el fixture de imagen ahora es válido; el panel permanece visible
pero usa `pointer-events:none` sólo dentro de la prueba; `pageerror` continúa
siendo la autoridad para excepciones JavaScript. Supabase se responde
localmente con HTTP 401, una sonda confirma la intercepción y `try/finally`
cierra navegador y servidor en cualquier salida.
**Pruebas:** `node --check test-smoke.mjs` correcto. Dos ejecuciones consecutivas
de `node test-smoke.mjs bundle`: 17/17 cada una; la sonda Supabase fue
interceptada en ambas y la segunda ejecución reutilizó el puerto sin conflicto.
**Riesgo residual:** el panel del bundle conserva 12 mensajes genéricos de
recursos sin URL. No bloquean el smoke ni ocultan excepciones `pageerror`, pero
mejorar el diagnóstico del bundler sería una tarea distinta.
**Corrección documentada:** `docs/fixes/arnes-smoke-confiable.md`.
**Commit:** `8f6ce90`.

## H-16 — Pulls truncados por límite de PostgREST

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `276f6c1`
**Evidencia:** `pullSales()` afirma ser paginado, pero sus consultas por fecha y
apartados no usan `range()` ni `limit()`. `pull()`, `pullDomain()` y
`fetchItemsIn()` también leen conjuntos completos sin recorrer páginas.
PostgREST puede limitar cada respuesta aunque existan más filas, por lo que una
terminal interpreta la primera página como el conjunto completo.
**Volumen real:** diagnóstico transaccional y revertido en producción:
`lookup` 453 filas, `products` 240, `sales` 4, `sale_items` 4,
`sale_payments` 3, `movements` 3 y el resto de dominios con 0–9 filas. El
problema todavía no se activa con esos volúmenes, pero `lookup` ya se acerca a
una página y los historiales crecen sin límite.
**Origen de auditoría:** Fase 14, hallazgo original H-18 y coste de snapshots.
**Reproducción:** el arnés impuso el límite de 1 000 filas con 1 001 productos y
1 001 ventas: 89 pruebas pasaron y cuatro nuevas fallaron porque sólo se hizo
una consulta y se aplicaron 1 000 filas. El mismo contrato afectaba catálogos y
lotes de renglones.
**Causa raíz:** los pulls no diferenciaban una respuesta completa de una página
llena. Sólo movimientos usaba `range()`; el comentario de `pullSales()` decía
“paginado”, pero sus dos consultas no recorrían páginas.
**Corrección:** `fetchPages()` centraliza páginas ordenadas de 1 000 filas para
configuración, dominios, movimientos, ventas y renglones. Las consultas de
ventas recientes y apartados reciben los únicos dos índices justificados por
`EXPLAIN ANALYZE`, desplegados en la migración 032.
**Pruebas:** con 100 000 ventas, 500 000 renglones y 100 000 movimientos, la
primera página reciente bajó de ~105 ms (sequential scan) a ~2.8 ms (index
scan); apartados de ~32 ms a ~1.8 ms. Renglones (~3.9 ms) y movimientos
(~0.75 ms) ya usaban índices y no recibieron nuevos. Insertar 100 000 filas
sintéticas pasó de ~1.96 s a ~4.15 s, costo incremental aproximado de 0.022 ms
por fila. `test-store-queue.mjs` 97/97, migraciones 24/24, concurrencia 9/9,
coherencia financiera 17/17, devoluciones 17/17, roles 10/10 y smoke del bundle
17/17. Build offline correcto. El smoke de desarrollo no arrancó por sus
dependencias CDN en el entorno restringido; el bundle distribuido sí se probó.
**Despliegue:** migración local/remota 032 aplicada en
`telohdbvbvsfmwyriflz`; dry-run sin pendientes y lint sin errores.
**Riesgo residual:** bajo. La paginación por offset supone un conjunto estable
durante cada pull; una escritura concurrente puede cambiar páginas, pero la
sincronización es eventual y el siguiente pull converge. Migrar a cursores se
justificará sólo si mediciones futuras muestran churn o páginas profundas.
**Corrección documentada:** `docs/fixes/paginacion-volumen-sincronizacion.md`.

## H-17 — Código y estilos heredados sin consumidores

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `3458efd`
**Evidencia:** `balam/styles.css`, `balam/modules.css` y `balam/light.css`
permanecen en el repositorio, pero ninguna entrada HTML los enlaza y
`build-offline.mjs` sólo incorpora recursos locales presentes en `src` o
`href`. `app.jsx` recibe `setTweak` sin usarlo; `discounts.jsx` importa
`ToastHost` y declara `inDim` sin consumidores.
**Origen de auditoría:** Fase 15, parte del hallazgo original H-19.
**Límite de seguridad:** `useTweaks` sí se usa y `tweaks-panel.jsx` implementa
un protocolo `postMessage` expresamente destinado a un editor externo. Sus
exports `Tweak*` no se considerarán eliminables sólo por carecer de consumidores
internos.
**Reproducción/evidencia equivalente:** búsqueda en entrada, build, módulos y
pruebas produjo cero referencias a los tres CSS. El build anterior enumeró 65
assets y ninguno era esos archivos. Búsqueda léxica confirmó que `setTweak`,
`ToastHost` local e `inDim` sólo aparecían en sus declaraciones. La navegación
de referencia cargó las nueve pantallas sin excepciones.
**Causa raíz:** la migración visual a Tailwind dejó tres hojas antiguas en el
repositorio y refactors posteriores dejaron bindings locales sin uso. La mera
presencia hacía ambiguo cuál estilo era vigente aunque el navegador no los
solicitara.
**Corrección:** se eliminaron `styles.css`, `modules.css` y `light.css`
(29 490 bytes), además de los tres símbolos locales sin consumidores. Se
preservaron `useTweaks`, todos los exports `Tweak*` y el protocolo `postMessage`.
**Pruebas:** `test-ui-navigation.mjs` 13/13 recorre Panel, POS, Inventario,
Clientes, Devoluciones, Descuentos, Vendedores, Reportes y Configuración,
comprueba exports de editor y ausencia de CSS heredado. Comparación estabilizada
contra el commit anterior: 21/21, las nueve capturas idénticas píxel por píxel.
Smoke bundle 17/17, descuentos 43/43, roles 10/10, cola 97/97, coherencia
financiera 17/17, devoluciones 17/17, filtros de Inventario 18/18 y migraciones
24/24. `build-offline.mjs` regeneró correctamente los artefactos con 65 assets.
**Pendiente:** ninguno dentro de la limpieza demostrada.
**Riesgo residual:** bajo. No es posible inventariar consumidores externos
fuera del repositorio; por ello se conservó íntegro el contrato del editor.
Componentes/utilidades duplicados pertenecen a la Fase 16 y no se mezclaron.
**Corrección documentada:** `docs/fixes/limpieza-codigo-recursos.md`.

## H-18 — Identidad de terminal duplicada entre dominio y sincronización

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `06d0454`
**Evidencia:** `balam/data.jsx` y `balam/store.jsx` implementan por separado
`getDeviceId()` y la clave `balam_device_id`. En la ruta de error de
`localStorage`, `DATA` devuelve un identificador volátil nuevo en cada llamada,
mientras `STORE` conserva otro identificador en memoria.
**Origen de auditoría:** Fase 16, resto de H-19 y contrato global H-21.
**Reproducción:** `test-module-contracts.mjs` produjo 11 pruebas aprobadas y 5
fallidas antes del cambio: faltaban el módulo y su orden de carga, permanecían
las dos implementaciones y no existía una identidad volátil compartida.
**Riesgo:** una venta y sus escrituras/conflictos remotos pueden quedar
atribuidos a identidades de terminal distintas cuando el almacenamiento local
no está disponible.
**Corrección:** `balam/core.jsx` es el único propietario de
`window.CORE.getDeviceId()`, carga antes de `CONFIG`/`DATA`/`STORE`, conserva la
clave histórica y memoriza también la alternativa volátil. Los dos módulos
consumen ese contrato sin cambiar payloads ni datos.
**Pruebas:** contratos 16/16, concurrencia 9/9, cola 97/97, descuentos 43/43,
migraciones 24/24, roles 10/10, comisiones 10/10, smoke bundle 17/17,
navegación 13/13 y build offline correcto con 66 assets.
**Pendiente:** ninguno para la identidad de terminal. Las demás consolidaciones
de la Fase 16 permanecen separadas por la regla de un problema por corrección.
**Riesgo residual:** bajo. Sin almacenamiento la identidad sólo puede durar la
sesión de página, pero ya es única para todos los módulos durante ella.
**Corrección documentada:** `docs/fixes/identidad-terminal-compartida.md`.

## H-19 — Bundle no reproducible por identificadores aleatorios

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `a117267`
**Evidencia:** `build-offline.mjs` importa `randomUUID()` y asigna un UUID nuevo
a cada entrada del manifiesto. Dos ejecuciones con las mismas fuentes y
dependencias producen referencias distintas y, por tanto, hashes distintos de
`index.html` y `POS Balam (offline).html`.
**Origen de auditoría:** Fase 16, parte de H-22 sobre verificación build/fuente.
**Riesgo:** un cambio de hash no permite distinguir una modificación real de
una reconstrucción equivalente, dificulta revisar despliegues y oculta deriva.
**Reproducción:** `test-build-reproducibility.mjs` aprobó 1/4 antes del cambio:
los artefactos de una ejecución coincidían entre sí, pero la aleatoriedad, la
identidad por contenido y el formato determinista fallaron.
**Corrección:** cada asset usa SHA-256 sobre MIME, modo de compresión y bytes,
truncado a 128 bits y presentado con el formato UUID compatible con el loader.
**Pruebas:** reproducción final 4/4; dos builds consecutivos produjeron 66
assets y el mismo SHA-256
`73F36BE13792E6483F673D157457D1296EC0138DFFF23398E96A8FA41C93E05D`
en ambos artefactos; smoke bundle 17/17, navegación 13/13 y contratos 16/16.
**Pendiente:** ninguno para la aleatoriedad del manifiesto.
**Riesgo residual:** bajo. Recursos remotos no fijados pueden cambiar en su
origen y producir legítimamente otro hash; fijarlos localmente es una
corrección separada.
**Corrección documentada:** `docs/fixes/bundle-reproducible.md`.

## H-20 — Build depende de red y recursos externos mutables

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `1ac12dc`
**Evidencia:** `build-offline.mjs` descarga Babel, React, JsBarcode, CSS,
fuentes e imágenes durante cada ejecución y usa
`npx --yes tailwindcss@3.4.17`. En el entorno sin red, Babel degradó a runtime y
Tailwind terminó el build con `EACCES/fetch failed`.
**Origen de auditoría:** residual explícito de H-19 y Fase 16/H-22.
**Riesgo:** el artefacto puede cambiar, degradarse o dejar de construirse por
estado externo aun cuando el repositorio no cambió.
**Reproducción:** la prueba de build aprobó 4/7 antes del cambio; faltaban
ausencia de red, Tailwind fijado y recursos íntegros. La ejecución restringida
previa confirmó `fetch failed` y terminación en Tailwind.
**Corrección:** 46 respuestas externas quedaron versionadas con SHA-256;
el build normal sólo las lee y verifica. La actualización remota requiere
`BALAM_REFRESH_BUILD_RESOURCES=1`. Tailwind 3.4.17 es dependencia exacta del
lockfile y cualquier recurso ausente/corrupto aborta el proceso.
**Pruebas:** build 8/8, caché 46/46, prueba negativa de caché aprobada, build
normal 66 assets, mismo SHA-256
`73F36BE13792E6483F673D157457D1296EC0138DFFF23398E96A8FA41C93E05D`,
smoke 17/17, navegación 13/13, contratos 16/16 y auditoría npm sin
vulnerabilidades.
**Pendiente:** ninguno para las respuestas externas del build normal.
**Riesgo residual:** bajo. Actualizar intencionalmente el caché requiere red y
revisión; una instalación nueva requiere `npm ci` para dependencias de
desarrollo fijadas.
**Corrección documentada:** `docs/fixes/build-sin-dependencias-remotas.md`.

## H-21 — Ciclo directo CONFIG ↔ DATA para uso de catálogos

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `d4d7e68`
**Evidencia:** `DATA` captura `window.CONFIG` al cargar y lo usa para catálogos
y reglas. A su vez, `CONFIG.inUse()` y `CONFIG.removeCatalog()` consultan
`window.DATA.products`; el segundo también invoca `DATA.saveProducts()`.
**Origen de auditoría:** Fase 16, hallazgo original H-21.
**Riesgo:** el contrato de configuración depende del orden y de la forma
interna del dominio, impide probarlo aisladamente y convierte cambios de
productos/configuración en una dependencia circular implícita.
**Reproducción:** contratos 16/18 antes del cambio; fallaron la ausencia de
dependencia directa y el adaptador único.
**Corrección:** `CORE` publica un adaptador de listado/persistencia que `DATA`
registra sobre su arreglo real. `CONFIG` ya no referencia `window.DATA` y
conserva las mismas guardas y limpieza.
**Pruebas:** contratos 20/20, guarda de código usado y limpieza/persistencia
custom aprobadas, concurrencia 9/9, descuentos 43/43, cola 97/97, roles 10/10,
smoke 17/17, navegación 13/13 y build de 66 assets correcto.
**Pendiente:** ninguno para `CONFIG ↔ DATA`. La relación `DATA ↔ STORE` se
mantiene separada.
**Riesgo residual:** bajo. `CORE` depende de que `DATA` registre el adaptador,
protegido por orden de carga y prueba; antes del registro devuelve lista vacía,
igual que el comportamiento histórico.
**Corrección documentada:** `docs/fixes/desacoplar-config-data.md`.

## H-22 — Ciclo directo DATA ↔ STORE en sincronización

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `678a0bd`
**Evidencia:** `DATA` contiene 13 referencias que consultan o invocan directamente
`window.STORE` para snapshots, ventas, devoluciones, eliminaciones y cola.
`STORE`, a su vez, consulta y aplica resultados sobre `window.DATA`.
**Origen de auditoría:** Fase 16, residual documentado de H-21 y hallazgo
original H-21.
**Riesgo:** dominio y persistencia conocen mutuamente sus APIs globales; una
variación de carga o firma puede romper mutaciones locales, reintentos o
reconciliación sin una frontera única verificable.
**Reproducción:** contratos 20/24 antes del cambio; fallaron la ausencia de
dependencia, el gateway único, su no-op y el reenvío.
**Corrección:** `CORE` publica un gateway sin estado; `STORE` registra su API y
`DATA` reenvía métodos/argumentos exclusivamente por esa frontera. `DATA` ya no
referencia `window.STORE`.
**Pruebas:** contratos 24/24, cola 97/97, venta 17/17, devoluciones 17/17,
concurrencia 9/9, folios 4/4, build 8/8, smoke 17/17 y navegación 13/13.
**Pendiente:** ninguno para `DATA ↔ STORE`. `STORE → DATA` queda como
dependencia unidireccional intencional. `CONFIG ↔ STORE` permanece separado.
**Riesgo residual:** bajo. El gateway depende del orden de carga ya congelado;
antes del registro conserva el no-op histórico.
**Corrección documentada:** `docs/fixes/desacoplar-data-store.md`.

## H-23 — Ciclo directo CONFIG ↔ STORE al sincronizar configuración

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `85385aa`
**Evidencia:** `CONFIG.emit()` consulta e invoca directamente
`window.STORE.pushConfig(state)`. `STORE`, a su vez, consulta y carga
`window.CONFIG` durante la reconciliación y al calcular la ventana de ventas.
**Origen de auditoría:** Fase 16, residual documentado de H-22.
**Riesgo:** configuración y persistencia conocen mutuamente sus APIs globales;
el envío de ajustes depende del orden de carga y mantiene una dependencia
circular fuera del gateway de sincronización ya establecido.
**Reproducción:** contratos 24/27 antes del cambio; fallaron la ausencia de
dependencia directa, el uso del gateway y el reenvío de la configuración.
**Corrección:** `CONFIG.emit()` conserva persistencia local y evento, pero
solicita `pushConfig` exclusivamente mediante `CORE.invokeSync()`. `STORE`
continúa registrando el único adaptador del gateway.
**Pruebas:** contratos 27/27, descuentos 43/43, cola 97/97, concurrencia 9/9,
roles 10/10, build reproducible 8/8, smoke del bundle 17/17 y navegación 13/13.
**Pendiente:** ninguno para `CONFIG ↔ STORE`. `STORE → CONFIG` queda como
dependencia unidireccional intencional para cargar configuración remota y
consultar la ventana de ventas.
**Riesgo residual:** bajo. Antes de que `STORE` registre el gateway, el envío es
no-op, equivalente a la guarda histórica; la configuración permanece local y
se sincroniza por la cola en una inicialización posterior.
**Corrección documentada:** `docs/fixes/desacoplar-config-store.md`.

## H-24 — Ciclo directo AUTH ↔ STORE al obtener el cliente Supabase

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `04f960c`
**Evidencia:** `AUTH.client()` consulta e invoca directamente
`window.STORE.getClient()`. `STORE`, a su vez, consulta `window.AUTH` para
resolver propietario, rol y reclamación de cola histórica.
**Origen de auditoría:** Fase 16, residual posterior a H-23.
**Riesgo:** autenticación y persistencia conocen mutuamente sus APIs globales;
la inicialización de sesión depende de la forma concreta de `STORE` y conserva
otro ciclo fuera de la frontera de sincronización existente.
**Reproducción:** contratos 27/29 antes del cambio; fallaron la ausencia de
dependencia directa y la obtención del cliente mediante el gateway.
**Corrección:** `AUTH.client()` obtiene `getClient` exclusivamente mediante
`CORE.invokeSync()`. `STORE` continúa registrando su API en el gateway y conserva
la lectura unidireccional de rol, perfil y propietario efectivo.
**Pruebas:** contratos 29/29, roles 10/10, cola 97/97, build reproducible 8/8,
smoke del bundle 17/17 y navegación 13/13.
**Pendiente:** ninguno para `AUTH ↔ STORE`. `STORE → AUTH` queda como dependencia
unidireccional intencional para aplicar permisos y aislar la cola por sesión.
**Riesgo residual:** bajo. Antes de que `STORE` registre el gateway no hay
cliente y `AUTH.init()` conserva su salida local histórica; `App` inicializa
autenticación después de cargar ambos módulos.
**Corrección documentada:** `docs/fixes/desacoplar-auth-store.md`.

## H-25 — Selector segmentado duplicado en Clientes e Inventario

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `1fbe437`
**Evidencia:** `balam/clients.jsx` y `balam/inventory.jsx` declaran por separado
`Segment()` con la misma estructura, estados y tokens. La variante de Inventario
añade además protección responsiva mediante desplazamiento horizontal.
**Origen de auditoría:** Fase 16, residual explícito documentado en H-17.
**Riesgo:** correcciones visuales o de accesibilidad pueden aplicarse a una
pantalla y no a la otra; Clientes ya carece de la defensa responsiva presente
en Inventario.
**Reproducción:** contratos 29/32 antes del cambio; fallaron el export
compartido y la eliminación de las dos declaraciones locales.
**Corrección:** `window.UI.Segment` publica la variante responsiva canónica;
Clientes e Inventario la importan y conservan intactas sus llamadas, opciones,
callbacks y estado.
**Pruebas:** contratos 32/32, comparación visual 22/22 con las nueve pantallas
idénticas, build reproducible 8/8 y smoke del bundle 17/17. El arnés de filtros
de desarrollo no inició por depender de CDN en el entorno restringido.
**Pendiente:** ninguno para las dos implementaciones de `Segment`.
**Riesgo residual:** bajo. El componente sigue siendo una API global por la
arquitectura actual; orden de carga y consumidores están cubiertos por contrato
y navegación del bundle.
**Corrección documentada:** `docs/fixes/selector-segmentado-compartido.md`.

## H-26 — Procesamiento de imágenes duplicado en tres formularios

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `95fc44f`
**Evidencia:** logo de tienda, avatar de usuario y foto de producto implementan
por separado `FileReader`, decodificación con `Image`, cálculo proporcional,
canvas y `toDataURL`. Las dos primeras rutas generan PNG a 256 px; producto
genera JPEG 0.85 a 600 px.
**Origen de auditoría:** Fase 16, residual de utilidades duplicadas de H-17.
**Riesgo:** validación y manejo de archivos dañados pueden divergir entre
formularios; cualquier defensa debe mantenerse en tres implementaciones.
**Reproducción:** contratos 32/36 antes del cambio; fallaron el export
compartido, sus tres consumos y la implementación única de `FileReader`.
**Corrección:** `window.UI.resizeImageFile()` concentra validación, lectura,
decodificación, escala y codificación parametrizada. Los tres formularios
conservan dimensiones, formato/calidad, mensajes y acciones posteriores.
**Pruebas:** contratos 36/36, procesador 5/5, comparación visual 22/22 con nueve
pantallas idénticas, build reproducible 8/8 y smoke del bundle 17/17. El arnés
de importación de desarrollo no inició por depender de CDN en el entorno
restringido.
**Pendiente:** ninguno para los tres pipelines de procesamiento local.
**Riesgo residual:** bajo. Canvas aún depende de capacidades normales del
navegador; errores de lectura, decodificación o codificación se rechazan y cada
consumidor conserva su aviso.
**Corrección documentada:** `docs/fixes/procesamiento-imagenes-compartido.md`.

## H-27 — Ocho arneses E2E dependen de Babel y CDN

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `d4a0c13`
**Evidencia:** ocho pruebas Playwright abren `POS Balam.html`, que carga React,
Babel y otros recursos de CDN. En el entorno restringido,
`test-filtros-inventario.mjs` y `test-import-fotos.mjs` agotaron su timeout
antes de ejecutar casos, mientras el mismo bundle local arrancó correctamente.
**Origen de auditoría:** limitación residual documentada por H-25 y H-26,
relacionada con H-15/H-20.
**Riesgo:** pruebas funcionales producen falsos negativos por disponibilidad de
Internet aunque `index.html`, el artefacto realmente distribuido, sea autónomo.
Esto deja rutas sin validar en CI o terminales restringidas.
**Reproducción:** `test-browser-harness-entry.mjs` aprobó 0/8 antes del cambio;
todos servían y visitaban la entrada Babel/CDN.
**Corrección:** los ocho servidores y recorridos usan `index.html`. Fotos
automáticas instala un cliente Supabase controlado; propagación de reset usa un
adaptador PostgREST local y simula los efectos transaccionales de venta,
devolución y stock. Las lecturas estáticas y el smoke dual se conservaron.
**Pruebas:** contrato de entradas 8/8; fotos automáticas 11/11, exportación
14/14, filtros 18/18, importación 23/23, liquidaciones 10/10, propagación de
reset 21/21, reset local 19/19 y XLSX 17/17. Además, contratos 36/36, build
reproducible 8/8 y smoke bundle 17/17.
**Pendiente:** ninguno para los ocho arneses inventariados.
**Riesgo residual:** bajo. `test-smoke.mjs` conserva intencionalmente un modo de
desarrollo que requiere CDN cuando se invoca sin `bundle`; su modo distribuido
es local y forma parte de la regresión obligatoria.
**Corrección documentada:** `docs/fixes/arneses-e2e-sin-cdn.md`.

## H-28 — SDK Supabase mutable y descargado en runtime

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `1cb05b2`
**Evidencia:** `STORE.ensureClient()` crea dinámicamente un `<script>` con
`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js`.
La versión mayor es mutable y el SDK no está en la entrada, el almacén de
recursos del build ni el lockfile.
**Origen de auditoría:** dependencia externa expuesta al aislar arneses en H-27;
residual de runtime separado de H-20.
**Riesgo:** autenticación y sincronización dependen de disponibilidad y bytes
externos no fijados; un cambio upstream puede alterar producción sin commit, y
una terminal sin acceso a jsDelivr no puede crear el cliente aunque el bundle
se haya cargado localmente.
**Reproducción:** `node test-supabase-sdk.mjs` aprobó 0/4 antes del cambio:
permanecían la descarga dinámica, la ausencia de una entrada local, la ausencia
del archivo y la falta de un hash documentado.
**Causa raíz:** el cliente se resolvía tarde desde una URL que sólo fijaba la
versión mayor; por ello ni Git, ni el lockfile ni el build eran autoridad sobre
los bytes ejecutados por Auth y sincronización.
**Corrección:** `@supabase/supabase-js` 2.110.8 quedó como dependencia exacta y
su UMD de 207 904 bytes se versionó en `balam/vendor`. Las dos entradas lo
cargan antes de los módulos y registran SHA-256
`913f94db33b394a97d34c058347009053ac2d9534459c0990eb08594a108d2ee`.
`STORE.ensureClient()` sólo consume ese global validado y conserva la salida
local cuando no existe; ya no crea scripts ni usa red.
**Pruebas:** contrato Supabase 4/4, contratos de módulos 36/36, roles 10/10,
cola 97/97, build reproducible 8/8, build offline correcto con 67 assets, smoke
del bundle 17/17, navegación 13/13, contrato de arneses 8/8, fotos automáticas
11/11 y propagación de reset 21/21.
**Pendiente:** ninguno para la entrega del SDK del navegador.
**Riesgo residual:** bajo. Una actualización futura del SDK requiere cambiar
versión, archivo, hash y lockfile conjuntamente y repetir las pruebas; si el
archivo local se elimina fuera del build, la aplicación continúa local-first
pero Auth y sincronización no se habilitan.
**Corrección documentada:** `docs/fixes/sdk-supabase-local-fijado.md`.

## H-29 — Personal no elegible participa como vendedor

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** `ce200af`
**Evidencia:** Configuración → Usuarios administra el arreglo completo
`DATA.sellers`, pero la pantalla lateral Vendedores también calcula y renderiza
directamente esa colección. El selector del POS sólo excluye
`active === false`; no exige rol vendedor ni ausencia de tombstone.
**Origen de auditoría:** UV-03 / UV-04 de la auditoría Usuarios/Vendedores.
**Riesgo:** administradores, otros roles, inactivos o perfiles eliminados pueden
aparecer como vendedores y ser seleccionados para atribuir una venta.
**Reproducción:** `node test-eligible-sellers.mjs` antes del cambio: 6
verificaciones correctas y 4 fallidas; el administrador, gerente, inactivo y
perfil eliminado entraban a la pantalla comercial, y el selector POS sólo
excluía al inactivo.
**Causa raíz:** no existe una regla compartida de elegibilidad comercial; cada
consumidor interpreta el catálogo de personal con un filtro distinto.
**Corrección:** `DATA.isEligibleSeller()` exige `active === true`, rol
`vendedor` y ausencia de tombstone local o remoto. Vendedores y el selector
POS consumen la colección filtrada; Usuarios conserva el catálogo completo.
**Pruebas:** contrato 10/10; contratos de módulos 36/36; roles 10/10;
liquidaciones 10/10; navegación 13/13; smoke bundle 17/17; coherencia de venta
17/17; devoluciones 17/17; cola 97/97; reproducibilidad 8/8.
**Pendiente:** ninguno dentro de la pantalla Vendedores y el selector POS.
**Riesgo residual:** funciones financieras internas y el módulo Reportes
mantienen sus filtros históricos porque fueron excluidos expresamente de esta
corrección. Se documentan sin modificarlos.
**Corrección documentada:** `docs/fixes/eligible-active-sellers.md`.

## H-30 — Fotografías de vendedores ignoradas por la pantalla comercial

**Estado:** RESUELTO
**Fecha de registro:** 26/07/2026
**Fecha de resolución:** 26/07/2026
**Commit:** df1f074
**Evidencia:** Configuración → Usuarios guarda y renderiza `seller.avatar`;
`STORE` conserva el mapeo bidireccional con `pos.sellers.avatar_url` y el
selector POS también consume el campo. Sin embargo, resumen, tarjetas, lista y
detalle de `balam/sellers.jsx` renderizan siempre `seller.iniciales` sin
consultar `seller.avatar`.
**Origen de auditoría:** UV-05 de la auditoría Usuarios/Vendedores.
**Riesgo:** la fotografía configurada existe y se sincroniza, pero la pantalla
comercial presenta una identidad visual distinta e incompleta.
**Reproducción:** `node test-seller-avatars.mjs` antes del cambio: 4/10. DATA,
Configuración y STORE conservaron el avatar; fallaron los seis contratos de
presentación de Vendedores.
**Causa raíz:** el flujo de datos es correcto; los cuatro consumidores visuales
de la pantalla Vendedores omiten el campo disponible.
**Corrección:** `SellerAvatar` renderiza la fotografía disponible y conserva
iniciales/color como respaldo. Resumen, tarjetas, lista y detalle reutilizan la
misma representación local.
**Pruebas:** avatar 13/13; elegibilidad H-29 10/10; contratos de módulos 36/36;
build reproducible 8/8; navegación 13/13; smoke bundle 17/17.
**Pendiente:** ninguno para fotografías disponibles o ausentes en Vendedores.
**Riesgo residual:** una fuente corrupta o inaccesible conserva el
comportamiento nativo de imagen rota; la carga y reducción del archivo
permanecen cubiertas por H-26.
**Corrección documentada:** `docs/fixes/fotografias-vendedores.md`.

## H-31 — Autoridad de comisión efectiva del vendedor

**Estado:** PARCIALMENTE RESUELTO
**Fecha de registro:** 26/07/2026
**Commit:** eacfff7
**Evidencia:** `commission.basePct` se administra como ajuste global, pero el
modelo comercial y los cálculos existentes consultan directamente
`seller.comisionPct`. El catálogo `seller_role` sólo se usa para inferir una
etiqueta visual a partir de `meta.minPct`; no existe asignación persistida de
nivel ni una regla compartida de precedencia.
**Origen de auditoría:** UV-06 / UV-07 de la auditoría Usuarios/Vendedores y
contrato funcional aprobado para H-31.
**Riesgo:** distintos consumidores pueden elegir porcentajes diferentes; el
respaldo global no es autoridad real y una migración ingenua confundiría 0%
intencional con ausencia, alterando silenciosamente vendedores existentes.
**Reproducción:** `node test-effective-commission.mjs` antes de la corrección:
6/22. Pasaron las invariantes de H-29, H-30 y módulos financieros excluidos;
fallaron la autoridad, todas sus fuentes, los casos 0%, compatibilidad y
persistencia.
**Causa raíz:** configuración global, nivel comercial y porcentaje del perfil
son datos independientes sin una función que establezca precedencia. Además,
el modelo no distingue un `comisionPct` histórico de una ausencia intencional.
**Corrección:** `DATA.resolveSellerCommission()` centraliza personalizada →
nivel → general y conserva versión 0 como `heredada`. STORE, altas locales,
Edge Function y migración 033 persisten override nullable, nivel y versión sin
inferir ni reescribir datos existentes.
**Pruebas:** contrato H-31 22/22; elegibilidad H-29 10/10; fotografías H-30
13/13; contratos de módulos 36/36; migraciones 24/24; cola 97/97; build
reproducible 8/8; smoke bundle 17/17. Una corrida encadenada de cola produjo
92/97; el diagnóstico descartó contaminación, estado global, temporizadores y
orden, y localizó la causa en las esperas de reloj de `test-store-queue.mjs`
frente a stubs que avanzan por turnos del bucle de eventos. Se reprodujo a
demanda saturando la CPU, también sobre `HEAD` sin H-31, por lo que no es
regresión. Con las esperas hechas deterministas la cola aprueba 97/97 aislada,
encadenada y bajo carga.
**Despliegue:** la migración `20260726003300_pos_h31_effective_commission.sql`
se aplicó el 27/07/2026 (28/07/2026 UTC), arrastrada por el `db push` de H-32
al detectarse que seguía pendiente pese a haberse dado por desplegada. Agregó
`commission_override_pct`, `seller_level_code` y `commission_policy_version` a
`pos.sellers`, con sus dos restricciones. No alteró datos: los tres perfiles
conservan `comision_pct = 0.00` y quedaron en versión 0 (`heredada`).
Detalle completo en `docs/fixes/trazabilidad-descuento-ticket.md`.
**Pendiente:** desplegar la Edge Function `admin-users`, que sigue en la
versión 8 anterior a H-31. Ya no es bloqueante: la función vigente omite las
tres columnas y los valores por defecto del esquema producen exactamente el
mismo resultado que la versión nueva escribe de forma explícita —versión 1,
override nulo y nivel nulo—, así que un alta nueva nace correcta con o sin el
despliegue. Conectar la autoridad a cálculos financieros y a una interfaz de
asignación queda expresamente fuera de H-31.
**Riesgo residual:** bajo. El esquema ya está en producción y el motor
histórico continúa consultando `comisionPct` por alcance aprobado, por lo que
la autoridad existe pero aún no cambia ventas, devoluciones, liquidaciones ni
cierres.
**Corrección documentada:** `docs/fixes/autoridad-comision-efectiva.md`.

## H-32 — Trazabilidad del descuento y presentación del ticket

**Estado:** RESUELTO
**Fecha de registro:** 27/07/2026
**Fecha de resolución:** 27/07/2026
**Commit:** 9170011
**Evidencia:** `PROMOS.lineUnit()` devolvía las promociones aplicadas a cada
renglón, pero `recordSale` descartaba esa lista y guardaba sólo `precio`,
`precioBase` y `precioOrig`. La venta perdía la identidad de la promoción al
guardarse. Además, el resumen y el ticket calculaban importe e IVA sobre el
total cobrado y colocaban el descuento antes del importe, en desacuerdo con el
formato aprobado por Finanzas.
**Origen de auditoría:** requerimiento de Finanzas sobre el formato del ticket.
**Riesgo:** sin evidencia persistida, el único camino para mostrar el
porcentaje era derivarlo dividiendo descuento entre precio, lo que produce
números que ningún administrador configuró: 7.14% con artículos elegibles y no
elegibles, 4.8% con descuento de monto fijo, 15% con dos promociones
acumuladas.
**Reproducción:** `node test-discount-trace.mjs` sobre el código anterior — el
renglón persistido no contenía ningún campo que identificara la promoción, ni
localmente ni en `pos.sale_items`.
**Causa raíz:** la evidencia existía en memoria y moría en `recordSale`; el
renglón guardaba el resultado del cálculo pero no su justificación. `pos.jsx` y
`data.jsx` además evaluaban el motor por separado para el mismo renglón.
**Corrección:** cada renglón persiste `promos`, una copia congelada
`[{ id, nombre, tipo, valor }]`. `DATA.resolveLineDiscount()` es la única
fuente de la resolución: el POS la calcula una vez y `recordSale` la consume.
El porcentaje se imprime sólo con evidencia suficiente y nunca se deriva. El
motor de promociones no se modificó y ningún importe guardado cambia.
**Pruebas:** trazabilidad H-32 65/65; descuentos 43/43 sin modificar; cola
97/97; coherencia de venta 17/17; devoluciones 17/17; liquidaciones 10/10;
comisiones 10/10; contratos de módulos 36/36; migraciones 24/24; comisión
efectiva 22/22; y el resto de la suite E2E en verde. Build reproducible 8/8 y
smoke bundle 17/17. Verificación visual en Chrome real: resumen y ticket
idénticos al formato pedido, con la evidencia persistida en la venta.
**Despliegue:** migración `20260727004000_pos_h32_discount_trace.sql` aplicada
al proyecto `Balam` el 27/07/2026, antes de publicar el cliente. Verificado en
la base: `pos.sale_items.promos` existe y `commit_sale` lo declara e inserta.
Venta controlada por el RPC real con `precio_original` 1250.00, `precio_base`
1125.00 y evidencia `{id, nombre, tipo pct, valor 10}`; reimpresión simulada
desde otra terminal con el código real del cliente imprimió 10%, y las cinco
ventas históricas reales no imprimieron ningún porcentaje. La venta de
validación se eliminó y la base quedó en su estado exacto previo.
**Pendiente:** ninguno.
**Riesgo residual:** bajo. Las ventas anteriores a H-32 nunca imprimirán
porcentaje, por diseño. Bajo el formato aprobado
`Importe + IVA = Precio original`, que no coincide con el total cuando hay
descuento; es lo solicitado por Finanzas.
**Corrección documentada:** `docs/fixes/trazabilidad-descuento-ticket.md`.

## H-33 — Folio comercial largo por identidad técnica expuesta

**Estado:** RESUELTO
**Fecha de registro:** 27/07/2026
**Fecha de resolución:** 27/07/2026
**Commit:** `f6ced07`
**Evidencia:** las cinco ventas reales de producción tienen folios como
`BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H`, de 29 caracteres. El valor sobresale del
ticket impreso, se parte en varias líneas en Devoluciones y estira columnas en
Reportes y en el historial.
**Origen de auditoría:** requerimiento de operación sobre el folio visible.
**Riesgo:** el folio es la referencia que el cliente y el mostrador usan para
buscar, devolver y reimprimir; un valor ilegible degrada la operación diaria y
no se corrige con recortes visuales.
**Reproducción:** `node test-folio-diario.mjs` (nuevo) no existía antes del
cambio; la evidencia directa son los cinco folios reales y la captura de
Devoluciones partiendo el folio en tres renglones.
**Causa raíz:** H-02 resolvió la unicidad multi-terminal adosando al folio la
representación en base 36 de los 128 bits del `operation_id`. El identificador
técnico quedó expuesto dentro del folio comercial: un solo campo cumplía dos
funciones incompatibles.
**Corrección:** el folio pasa a `{PREFIJO}-{AAMMDD}-{0001}` y la identidad
técnica permanece exclusivamente en `operation_id`. La unicidad la aporta
`pos.folio_counters` mediante `pos.reserve_folio_block()`: cada terminal reserva
un bloque diario y lo consume sin red. **El folio impreso no cambia nunca**: sin
bloque, el folio incorpora el código corto de la terminal
(`BG-260727-0001-K7Q`) y con eso ya es definitivo. Para el residuo —dos
terminales con el mismo código, u operaciones heredadas de H-02— sobrevive
`folio_conflict`, y entonces el folio impreso se conserva para siempre en
`sale.folioAliases` / `pos.sales.folio_aliases`, resolviendo búsqueda,
devolución y reimpresión desde cualquier terminal, con aviso explícito en la
interfaz. Una devolución no se envía mientras su venta siga en cola. Los folios
históricos no se migran.
**Despliegue:** migraciones `20260727004100_pos_h33_daily_folio.sql`,
`20260727004200_pos_h33_daily_folio_verification.sql`,
`20260727004300_pos_h33_folio_aliases.sql` y
`20260727004400_pos_h33_folio_aliases_verification.sql` aplicadas al proyecto
`Balam` el 27/07/2026; `db push --dry-run` posterior sin pendientes.
**Pruebas:** folio diario 60/60; folios multi-terminal 12/12; cola 115/115;
migraciones 29/29; coherencia de venta 17/17; devoluciones 17/17; descuentos
43/43; trazabilidad H-32 65/65; comisión efectiva 22/22; contratos de módulos
36/36; smoke bundle 17/17; navegación 13/13; y el resto de la suite en verde.
Build offline correcto con 67 assets. Verificación remota: bloques disjuntos
1..10 y 11..20, venta aceptada con `BG-260727-0001`, `folio_conflict` limpio en
la segunda terminal con reconciliación a `BG-260727-0022`, cinco folios
históricos intactos, alias `H33ALS-260727-0001-K7Q` localizando su venta por
`folio_aliases @>` y limpieza total de temporales. En Chrome real el ticket
imprime `TRANSACCIÓN — BG-260727-0001` en una línea y, al reimprimir una venta
reidentificada, añade «Ticket impreso» con el folio del cliente.
**Pendiente:** ninguno dentro del formato, la unicidad y la permanencia del
folio comercial.
**Riesgo residual:** dos tickets sólo pueden compartir cadena si dos terminales
generan el mismo código de tres caracteres (1 en 46 656) estando ambas sin
bloque, el mismo día y en el mismo consecutivo; ese residuo se rechaza en la
nube y el folio impreso sobrevive como alias permanente. Un folio provisional es
más largo (18 caracteres) mientras la terminal no conecte en el día. Con dos
terminales los bloques son disjuntos, así que la segunda empieza en `0011`. Las
ventas anteriores a H-33 conservan su folio largo por diseño.
**Corrección documentada:** `docs/fixes/folio-comercial-diario.md`.

## H-34 — Plazo de posventa inexistente y no congelable

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `59a16c9`
**Evidencia:** ninguna venta conserva hasta cuándo admite devolución.
`DATA.isReturnable()` sólo consulta el estado y `recordReturn()` no evalúa
tiempo, así que una venta de 2019 se devuelve igual que una de hoy. La única
política de devoluciones persistida es `returns.reverseCommission`, que se lee
vigente en cada operación.
**Origen de auditoría:** Fase 1 del módulo de Cambios de productos, contrato
funcional aprobado el 28/07/2026.
**Riesgo:** implementar el límite leyendo la configuración vigente haría que
activarlo venciera retroactivamente ventas ya emitidas y que cambiar los días
alterara el pasado. El plazo es una condición comercial pactada al vender: debe
vivir en el documento, como el folio (H-33), el desglose financiero (H-03) y la
evidencia del descuento (H-32).
**Reproducción:** `node test-return-deadline.mjs` (nuevo) antes del cambio: 7
pasaron, 31 fallaron. Los 7 que pasaban son los casos «sin límite», que
coinciden con el comportamiento histórico.
**Causa raíz:** contrato ausente, no defecto. La venta no tenía ningún campo
capaz de expresar la política de posventa aplicada.
**Corrección:** `pos.sales` gana `return_limit_days` y `return_expires_at` con
restricciones que impiden un vencimiento sin política que lo explique.
`DATA.returnDeadline()` es la autoridad única de los cuatro estados —sin
límite, pendiente, vigente, vencido— y de su etiqueta. El plazo cuenta desde la
misma fecha guardada en la venta; los apartados lo arrancan al liquidarse. La
pantalla de Devoluciones filtra y explica el plazo, pero no oculta las ventas
vencidas: bloquea la confirmación. `commit_sale` se redefine de forma
estrictamente aditiva, generada a partir del texto vigente para evitar deriva.
**Despliegue:** migraciones `20260728004500_pos_h34_return_deadline.sql` y
`20260728004600_pos_h34_return_deadline_verification.sql` aplicadas al proyecto
`Balam` (`telohdbvbvsfmwyriflz`) el 28/07/2026, antes de publicar el cliente. La
verificación emitió sus cinco avisos de éxito y no dejó filas temporales. La
comprobación posterior confirmó columnas nullable sin default, las dos
restricciones, el índice parcial, 6 ventas reales con 0 plazos y una
`commit_sale` desplegada que transporta el plazo conservando
`is distinct from p_operation_id` y `coalesce(v_stock -> 'products', …)`. El
artefacto publicado en GitHub Pages coincide byte por byte con el `index.html`
del commit (SHA-256 `7b6d102b…`).
**Pruebas:** plazo de posventa 38/38; migraciones 29/29; coherencia de venta
17/17; devoluciones 17/17; folio diario 60/60; folios multi-terminal 12/12;
trazabilidad H-32 65/65; cola 115/115; contratos de módulos 36/36; comisión
efectiva 22/22; comisiones 10/10; liquidaciones 10/10; descuentos 43/43; build
reproducible 8/8; smoke bundle 17/17; navegación 13/13; roles 10/10;
concurrencia 9/9; propagación de reset 21/21; elegibilidad 10/10; avatares
13/13. Build offline correcto con 67 assets. El diff de `commit_sale` contra la
versión de H-32 contiene exactamente los tres bloques aditivos previstos.
**Pendiente:** ninguno en esta fase. La
política «conservar / reiniciar plazo después de un cambio» pertenece a fases
posteriores del módulo de Cambios.
**Riesgo residual:** bajo. Todas las ventas existentes quedan sin límite y no
cambian de comportamiento. Una venta vencida sólo puede devolverse desactivando
el límite en Configuración: no existe autorización administrativa puntual con
justificación registrada.
**Corrección documentada:** `docs/fixes/plazo-posventa.md`.

## H-35 — Saldo por renglón sin autoridad única

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `c10920e`
**Evidencia:** «cuántas unidades quedan disponibles» se calcula tres veces con
la misma fórmula copiada —validación de `commit_return`, cálculo de estado de
`commit_return` y `DATA.returnedQty()`—, y las tres consultan directamente
`pos.return_items`, es decir, la tabla de una sola clase de documento.
**Origen de auditoría:** Fase 2 del módulo de Cambios de productos.
**Riesgo:** en cuanto exista un segundo documento que consuma unidades de una
venta, bastaría con que una de esas fórmulas lo omitiera para que la misma
pieza se devolviera y se cambiara: doble reingreso de stock y doble efecto
financiero, sin restricción en la base que lo impida.
**Reproducción:** `node test-line-balance.mjs` (nuevo) antes del cambio: 7
pasaron, 27 fallaron.
**Causa raíz:** ausencia de una autoridad única y de un punto de extensión, no
una consulta equivocada.
**Corrección:** la vista `pos.line_consumption` enumera los consumos con su
origen y la función `pos.sale_line_balance()` responde vendida / consumida /
disponible por `(sku, talla)`, con exclusión opcional del documento que se
reescribe. `commit_return` consume esa autoridad en sus dos bloques de
cantidades sin cambiar firma, orden de validaciones, códigos de error, reglas
de inventario, importes, comisiones ni respuesta. En el cliente,
`DATA.saleLineBalance()` es el espejo local y `consumptionSources()` la costura
por la que el módulo de Cambios entrará sin tocar a ningún consumidor.
**Despliegue:** migraciones `20260728004700_pos_h35_line_balance.sql`,
`20260728004900_pos_h35_line_balance_grants.sql` y
`20260728005000_pos_h35_line_balance_verification.sql` aplicadas al proyecto
`Balam` (`telohdbvbvsfmwyriflz`) el 28/07/2026, en ese orden. La verificación
emitió sus ocho avisos de éxito y no dejó filas temporales: 6 ventas reales
intactas y 0 registros `h35` en ventas, productos, vendedores, devoluciones y
commits.
**Incidencia durante el despliegue:** la verificación abortó la primera vez con
`H-35: line_consumption quedó legible por authenticated`. Su propia guarda
detectó que el privilegio por defecto del esquema `pos`
(`defaclobjtype 'r'` → `authenticated=arwdDxtm`) concede toda relación nueva a
ese rol, y que el `revoke ... from public` de `004700` no lo retira. Se corrigió
con `004900` antes de continuar: revoke nominal a `authenticated` y `anon`, más
`security_invoker = true` como defensa de fondo —sin ella la vista se ejecuta
con los permisos de su dueño y evita el RLS de `sale_items` y `return_items`—.
La verificación se endureció para exigir ambas condiciones y se renumeró de
`004800` a `005000`, porque las migraciones corren por orden de versión y la
verificación debe ser la última.
**Evidencia de permisos tras la corrección:** `anon` y `authenticated` con
`lee_vista=false` y `ejecuta_autoridad=false`; `service_role` con ambos en
`true`. Una sesión real `set role authenticated` recibe
`ERROR 42501: permission denied for view line_consumption`, mientras
`service_role` la lee con normalidad. `commit_return` sigue siendo ejecutable
sólo por `authenticated` —no por `service_role`—, que es la vía de producción.
**Evidencia funcional bajo `security_invoker`:** ciclo completo por la vía real
(`set role authenticated` + JWT de vendedor) con venta de 3 piezas, devolución
parcial de 1 → `ok`, `sale_state = Devolución parcial`, `disponible = 2`; y
sobredevolución de 5 → `invalid_return_quantity` con `available = 2`. La prueba
aborta su propia transacción al final, por lo que no dejó rastro.
**Pruebas:** saldo por renglón 38/38; devoluciones 17/17; plazo H-34 38/38;
coherencia de venta 17/17; cola 115/115; migraciones 29/29; trazabilidad H-32
65/65; contratos 36/36; folio diario 60/60; folios multi-terminal 12/12;
comisiones 10/10; comisión efectiva 22/22; liquidaciones 10/10; descuentos
43/43; elegibilidad 10/10; build reproducible 8/8; smoke bundle 17/17;
navegación 13/13; roles 10/10; concurrencia 9/9; propagación de reset 21/21;
avatares 13/13; SDK 4/4.
**Pendiente:** ninguno en esta fase. La
rama de cambios de la vista y su prueba en SQL pertenecen a la fase que cree las
tablas de cambios.
**Riesgo residual:** bajo. Con las tablas de cambios inexistentes la vista es
literalmente la consulta anterior, por lo que saldo, aceptaciones, rechazos,
importes, inventario, comisiones, estados y respuesta del RPC son idénticos. La
coexistencia devolución + cambio está probada en la autoridad local pero todavía
no en SQL.
**Corrección documentada:** `docs/fixes/saldo-por-renglon.md`.

## H-36 — Precio único por artículo cuando el negocio lo necesita por talla

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `c8e1778`
**Evidencia:** `pos.products.precio` es un único `numeric(10,2)` por artículo y
no existe ningún campo, columna ni pantalla que exprese un precio distinto por
talla: `precioTalla`, `precios_talla` y equivalentes no aparecen en `balam/`,
`supabase/` ni `docs/`. El negocio necesita que, dentro del mismo SKU, ciertas
tallas tengan un precio comercial normal distinto —M y L a $350, XL a $450—, y
eso no es una promoción temporal.
**Origen de auditoría:** requerimiento de operación sobre precios por talla,
28/07/2026.
**Riesgo:** implementar el precio por talla sin una autoridad previa corrompe
importes en silencio. `recordSale` calcula hoy el descuento con dos precios
distintos: `subtotalOrig` suma `l.p.precio` —el precio del **artículo**— y
`totalConDescuento` suma la resolución del renglón. En cuanto ambos dejen de
coincidir, `descuento` queda mal: se pierde cuando la talla vale más que el
artículo e **inventa un descuento que nadie concedió** en el caso inverso.
`assertSaleAmounts` no lo detecta porque valida `subtotal + iva = total` y nunca
el descuento. Además `precioOrig` congelaría el precio del artículo, es decir
evidencia histórica falsa.
**Duplicación existente:** la pregunta «cuánto cuesta esta variante antes de
promociones» está respondida seis veces leyendo `p.precio` directamente:
`PROMOS.lineUnit`, `DATA.resolveLineDiscount`, `subtotalOrig` y `precioOrig` de
`recordSale`, el impresor de etiquetas de Inventario —que ya itera por talla— y
los tres respaldos de `pos-ticket.jsx`. Es el mismo patrón que H-35 (`AP-01`),
detectado antes de que la función exista.
**Concepto adoptado:** en BALAM el SKU identifica el **modelo** y reserva un
marcador `T` en el segmento de talla; el identificador por pieza se deriva con
`BARCODES.codeOf(p, talla)` y no se persiste. La variante que ya usan
existencias, etiquetas, `sale_items`, la reserva de stock y `sale_line_balance`
es `(producto, talla)`. Por tanto «precio por SKU» y «precio por talla» son el
mismo eje: el modelo es **precio general del artículo con excepciones por
talla**, no una entidad genérica de variante comercial.
**Alcance aprobado:**
1. Autoridad `DATA.listPrice(producto, talla)`, que devuelve la excepción de la
   talla o el precio general. Con el catálogo actual el resultado es idéntico al
   de hoy, artículo por artículo.
2. Derivada `DATA.priceRange(producto)` para el catálogo del POS, calculada
   sobre las tallas con existencias porque son las que el POS deja vender.
3. Los seis lectores actuales pasan por la autoridad, incluidos los dos de
   `recordSale`.
4. `pos.products.precios_talla jsonb not null default '{}'`, con forma
   `{ "<talla>": <precio> }`, replicando el patrón ya existente de
   `barcode_urls`. `{}` significa «todas las tallas valen el precio general» y es
   el estado de los 240 artículos actuales.
5. Captura de excepciones en el formulario de producto y presentación del rango
   en catálogo, selector de talla y etiquetas.
**Flujo de captura, ajustado a las pantallas reales:** el formulario de producto
(`balam/inventory.jsx`, `ProductForm`, alta y edición comparten componente)
conserva su campo `Precio` sin cambios y no muestra nada más por omisión: la
mayoría de los artículos no tiene excepciones y no debe pedírsele ninguna. Un
control discreto agrega **una excepción por grupo de tallas**, reutilizando el
idioma que el producto ya usa para eso —los chips multi-selección con
interruptor «Todas» del Alcance de Descuentos, `balam/discounts.jsx`— acotados a
las tallas de la grilla «Existencias por talla», con `tallaLabel` y respetando
la escala desactivada. Se admiten varias filas —«XL, XXL → $450»— con resumen
textual al estilo de `scopeText`. **Nunca se muestran ni se exigen precios
individuales para todas las tallas.** El dato guardado es el mapa canónico por
talla; la agrupación vive sólo en la presentación y se reconstruye al abrir
agrupando tallas con el mismo precio.
**Pruebas requeridas:** arnés nuevo `test-variant-price.mjs`, escrito antes del
cambio y demostrando que falla. Debe cubrir: sin excepciones el precio no
cambia; excepción en una talla sin afectar a las demás; cambiar el precio
general no arrastra la excepción; rango único frente a `min–max`; rango sobre
tallas con existencias; venta de dos tallas con precios distintos con
`descuento` correcto; `precioOrig` congelado con el precio de su talla;
promoción porcentual y de monto fijo sobre la talla cara; piso de margen con
costo del artículo; venta histórica legible; reintento sin el campo que no borra
la excepción; talla inexistente podada al guardar y tolerada al leer; etiqueta
con el precio de su talla; agrupación al reabrir el formulario; rechazo de una
talla repetida entre filas; y contratos de `STORE`, migración e interfaz.
Regresión obligatoria por tocar precio y venta, incluyendo `test-discounts.mjs`
**sin modificar** como evidencia de que el motor de promociones no se tocó.
La verificación remota debe comprobar además que un vendedor recibe `42501` al
escribir la columna nueva contra la base real: el trigger
`pos.restrict_seller_product_update()` usa lista de exención por sustracción y
*debería* protegerla, pero eso se prueba, no se deduce.
**Exclusiones aprobadas:** costo por talla; precios por variante en la
importación y exportación de Excel; historial de precios; listas de precio por
cliente o sucursal; y la reimpresión de etiquetas ya emitidas, que es operativa.
`pos.commit_sale` **no se modifica**: `sale_items` ya transporta `precio`,
`precio_base` y `precio_original` de forma condicional y la función los trata
como valores opacos.
**Riesgos residuales previstos:**
1. **No existe un módulo de costos.** `pos.products.costo` es una sola columna
   cuyo único consumidor es el piso de margen de `applyStack`, y `data.jsx` la
   rellena como el 45 % del precio cuando no se captura. Con el costo a nivel de
   artículo, el piso subprotege a la talla cara: con precio general $350, costo
   automático $158 y margen 45 %, el piso queda en $287.27 y se aplicaría también
   a una talla de $450 cuyo costo real fuera mayor. Acotado y declarado; un
   módulo de costos real es una historia propia.
2. Las etiquetas ya impresas con el precio del artículo quedan incorrectas para
   las tallas que cambien de precio y deben reimprimirse.
3. `stockOf(p, talla)` busca sólo por `talla` ignorando `escala`, y un artículo
   puede manejar ambas escalas. El precio usa la misma clave para no introducir
   una tercera convención; la ambigüedad es preexistente.
4. Guardar el mapa canónico pierde la agrupación literal capturada: dos filas
   con el mismo precio se muestran como una sola al reabrir. Se prefirió a
   `[{tallas, precio}]`, que admite una talla en dos filas con precios distintos
   y obligaría a una regla de desempate dentro de la autoridad.
5. **La base valida la forma del mapa, no sus valores.** Un valor negativo o no
   numérico sería aceptado por PostgreSQL; la garantía vive en
   `DATA.sanitizePreciosTalla()`. Ninguna ruta del producto escribe esos valores
   —el cliente sanea antes de enviar—, pero la defensa de fondo no está en la
   base. Endurecerla exige validar `jsonb_path_exists` contra un motor real y es
   una historia posterior; la verificación deja constancia del residual en la
   salida del despliegue.
**Aportes al sistema arquitectónico:** esta historia ya produjo `FF-11`,
`R-CLI-08` y `AP-10` (commits `abb725d` y `aba6bb9`), porque el diseño inicial
de la captura se derivó del modelo de datos sin recorrer el flujo real. La
decisión de forma quedó en `docs/architect/decisions/ADR-009`.
**Reproducción:** `node test-variant-price.mjs` antes del cambio: **8 pasaron,
30 fallaron**. Los 8 que pasaban son el comportamiento actual que no debía
cambiar. Dos de los fallos reprodujeron el defecto financiero: con M a $350,
XL a $450 y una promoción del 10 %, la venta registraba `descuento = 70` en vez
de `80`, y `precioOrig` congelaba `350` en el renglón de XL.
**Corrección:** `DATA.listPrice()` es la autoridad única y `DATA.priceRange()`
su derivada para el catálogo. Los seis lectores pasan por ellas. La columna
`pos.products.precios_talla` guarda el mapa canónico de excepciones; la captura
usa filas «grupo de tallas → precio» con los chips del Alcance de Descuentos y
permanece invisible mientras no existan excepciones. `pos.commit_sale` y
`PROMOS.applyStack` quedaron intactas.
**Pruebas:** precio por talla 38/38; descuentos 43/43 **sin modificar**;
trazabilidad H-32 65/65; coherencia de venta 17/17; devoluciones 17/17; saldo por
renglón 38/38; plazo H-34 38/38; cola 115/115; migraciones 29/29; contratos
36/36; folio diario 60/60; folios multi-terminal 12/12; comisiones 10/10;
comisión efectiva 22/22; liquidaciones 10/10; elegibilidad 10/10; avatares
13/13; concurrencia 9/9; roles 10/10; build reproducible 8/8; SDK 4/4; entradas
de arnés 8/8; imágenes 5/5; XLSX 17/17; exportación 14/14; smoke bundle 17/17;
navegación 13/13; filtros 18/18; propagación de reset 21/21; reset local 19/19;
fotos automáticas 11/11; importación de fotos 23/23. Build offline correcto con
67 assets.
**Despliegue:** migraciones `20260728005100` y `20260728005200` aplicadas al
proyecto `Balam` (`telohdbvbvsfmwyriflz`) el 28/07/2026, en ese orden, y
registradas en `supabase_migrations.schema_migrations`. La verificación emitió
sus siete avisos: 240 artículos reales con 0 excepciones, excepción válida
conservada, rechazo de arreglo y de escalar, `precios_talla` no exenta del
trigger de vendedor, `commit_sale` intacta y limpieza total. El artefacto
servido por GitHub Pages coincide byte por byte con el `index.html` de
`c8e1778`, SHA-256 `61fb34dd…`, 8 655 603 bytes.
**Incidencia durante el despliegue:** el primer intento abortó con
`ERROR: cannot use subquery in check constraint (SQLSTATE 0A000)`. La
restricción validaba también el contenido del mapa con
`not exists (select … from jsonb_each(…))`, y un `CHECK` de PostgreSQL no admite
subconsultas. Ninguna de las dos versiones quedó registrada y el primer `NOTICE`
del despliegue correcto —«precios_talla no existia; se crea en esta
migracion»— probó que el intento fallido **no dejó residuo**. Conforme a
`R-DB-01`, al no estar registrada la versión se corrigió el propio archivo
`005100` en vez de crear una migración de parche. El arnés sólo comprobaba que
el texto de la migración contuviera las palabras correctas —el síntoma, no la
defensa (`AP-09`)— y se endureció para exigir que el `CHECK` sea escalar.
**Alcance real de la restricción:** la base valida la **forma** del mapa
(`jsonb_typeof(precios_talla) = 'object'`), único idioma `jsonb` ya probado en
producción en este esquema (`sales_folio_aliases_chk`, H-33). La alternativa
escalar `jsonb_path_exists` no pudo ejecutarse contra un motor PostgreSQL real
antes de desplegar —no hay Docker, y el PostgreSQL 18 local exige una
contraseña no disponible— y por decisión expresa no se desplegó sin validar.
**Prueba funcional en el bundle:** `test-precio-talla-e2e.mjs` 19/19 sobre
`index.html`, con Supabase interceptado: captura de la excepción por grupo de
tallas en el formulario real, persistencia local, reapertura agrupada, etiqueta
por talla, rango en el catálogo, precio por talla en el selector, carrito con
M a $450 y XS a $350, y venta con `total` 800, `descuento` 0 y `precioOrig`
congelado por talla. Cero excepciones de página.
**Pendiente:** ninguno dentro del alcance aprobado.
**Corrección documentada:** `docs/fixes/precio-por-talla.md`.

## H-37 — El modelo no puede representar un cambio de mercancía (C4)

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `d28e1b1`
**Evidencia:** el Contrato del Cambio está aprobado y registrado
(`docs/04-contrato-del-cambio.md`), pero el esquema no tiene dónde guardar un
cambio: no existen `pos.exchanges` ni `pos.exchange_items`, `DATA.exchanges` no
existe —la costura `consumptionSources()` de H-35 la busca y no la encuentra— y
`pos.sale_line_balance()` no puede reconocer como suministro una pieza entregada
en un cambio anterior, porque su bloque `sold` lee exclusivamente
`pos.sale_items` del folio.
**Origen de auditoría:** C4 del módulo de Cambios, según
`docs/04-contrato-del-cambio.md` § 13.
**Riesgo:** sin la costura de suministro, el contrato permite recambiar una
pieza recibida en un cambio anterior (§2) mientras la autoridad del saldo no
puede gobernarla. Sería posible consumir dos veces la misma unidad por caminos
distintos: exactamente el defecto que H-35 existe para prevenir, reintroducido
por un documento nuevo.
**Alcance aprobado:** tablas `pos.exchanges` y `pos.exchange_items` con `lado`;
vista `pos.line_supply`; extensión de `pos.sale_line_balance()` y de su espejo
local `DATA.saleLineBalance()`; colección `DATA.exchanges` alimentando la costura
de consumo ya existente; la autoridad única del valor histórico reconocido; y la
ampliación aditiva del `check` de `pos.sale_payments.tipo`.
**Exclusiones:** la interfaz del cambio pertenece a C6 y `pos.commit_exchange()`
a C5. Esta historia **no** implementa ninguno de los dos: prepara el modelo, tal
como H-35 preparó el terreno sin implementar cambios.
**Decisión de materialización:** `ADR-010`.
**Contrato de `pos.sale_payments` verificado antes de decidir:** `folio` es
`text not null` **sin clave foránea** —la relación con `pos.sales` es lógica—,
el índice es `(folio, fecha)`, `monto > 0` admite sólo entradas y `tipo` está
restringido por `check` a `('venta','anticipo','abono','liquidacion')`. El
mapeador de `STORE`, las policies RLS y el pull por dominio son genéricos, y
`reports.jsx` ya suma **todas** las filas como dinero cobrado real. La única
atadura estructural es el `check` de `tipo`; no hay referencia que se invalide.
Es **generalizable de forma limpia y aditiva**.
**Pruebas requeridas:** arnés nuevo demostrando el fallo antes del cambio;
saldo idéntico al actual con la tabla de cambios vacía; una pieza entregada en un
cambio entra como suministro y puede recambiarse una sola vez; la cadena A→B→C
permanece anclada al folio de origen; `paymentsForSale()` de la venta origen no
devuelve el pago del cambio; `commit_sale` sobre la venta origen no borra el pago
del cambio; regresión completa incluyendo saldo por renglón, devoluciones,
coherencia de venta y cola.
**Riesgo residual previsto:** el desglose de Reportes —anticipos y abonos— dejará
de sumar el total cobrado hasta que C7 lo actualice; queda declarado, no oculto.
**Reproducción:** `node test-exchange-model.mjs` antes del cambio: **4 pasaron,
23 fallaron**. Los 4 que pasaban son el comportamiento de H-35 que no debía
cambiar.
**Corrección:** `vendida = sale_items ∪ line_supply` y
`consumida = line_consumption`, que ahora abarca devoluciones y cambios. Una
cadena A→B→C queda anclada al folio de origen con **una sola** autoridad.
`DATA.recognizedValue()` nace como autoridad única del valor histórico
reconocido y nunca deriva del precio vigente. El cobro de la diferencia entra al
ledger único con el folio propio del cambio y `tipo = 'cambio'`.
**Despliegue:** migraciones `005300`, `005500` y `005600` aplicadas y registradas
en el proyecto `Balam` el 28/07/2026. La verificación emitió sus siete avisos y
no dejó filas temporales.
**Incidencia durante el despliegue:** el primer intento abortó con
`H-37: la pieza devuelta deberia quedar sin disponible (disponible=1)`. `005300`
creó la costura de suministro pero no añadió la rama de cambios a la de consumo:
`line_consumption` seguía leyendo sólo `return_items`. El espejo local no lo
reveló porque `consumptionSources()` ya traía esa rama desde H-35 — faltaba sólo
del lado SQL. Como `005300` ya estaba registrada, se corrigió hacia adelante con
`005500` (`R-DB-01`) y la verificación se renumeró de `005400` a `005600`
(`R-DB-02`); `005400` nunca llegó a registrarse. El arnés comprobaba la rama de
suministro pero no la de consumo —el síntoma y no la defensa, `AP-09`— y se
endureció.
**Pruebas:** modelo del cambio 28/28; saldo por renglón 38/38; devoluciones
17/17; coherencia de venta 17/17; plazo 38/38; precio por talla 38/38 y E2E
19/19; trazabilidad 65/65; cola 115/115; migraciones 29/29; contratos 36/36;
descuentos 43/43 sin modificar; folio diario 60/60; folios 12/12; comisiones
10/10; comisión efectiva 22/22; liquidaciones 10/10; elegibilidad 10/10;
avatares 13/13; concurrencia 9/9; roles 10/10; build 8/8; SDK 4/4; smoke bundle
17/17; navegación 13/13; propagación de reset 21/21; filtros 18/18.
**Pendiente:** C5 (`commit_exchange`), C6 (interfaz) y C7 (reportes).
**Corrección documentada:** `docs/fixes/modelo-del-cambio.md`.

## H-38 — El cambio no tiene autoridad transaccional (C5)

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `9906776`
**Evidencia:** C4 dejó el modelo del cambio pero nada podía escribir en él con
seguridad. Un cambio mueve inventario en dos sentidos, cobra dinero y consume
saldo; sin una frontera transaccional un fallo parcial dejaría stock descuadrado
o un documento a medias.
**Origen de auditoría:** C5 del módulo de Cambios,
`docs/04-contrato-del-cambio.md` § 13.
**Riesgo:** escritura parcial de una operación que toca dinero e inventario, y
cálculo del dinero en el cliente, donde una terminal manipulada podría fijar el
valor de lo que entrega o el precio de lo que recibe.
**Reproducción:** `node test-exchange-commit.mjs` contra el árbol previo:
**3 pasaron, 28 fallaron**.
**Corrección:** `pos.commit_exchange()` confirma o revierte en una transacción
permiso, forma, idempotencia por clave y hash, plazo (H-34), saldo (H-35/H-37),
valoración en el servidor, inventario en dos sentidos, documento y cobro. Las
autoridades de valoración `pos.line_recognized_value()` y `pos.list_price()` son
internas. El cambio **nunca devuelve efectivo**: el sobrante va a
`valor_no_aprovechado` y `base_comision` es sólo el excedente. En el cliente,
`DATA.recordExchange()` cierra el ciclo local y `STORE.pushExchange()` encola la
operación durable.
**Despliegue:** migraciones `005700`, `005900` y `006000` aplicadas y registradas
en `Balam` el 28/07/2026. La verificación emitió sus once avisos por la vía real
—`request.jwt.claims` con un perfil temporal— y no dejó filas.
**Incidencia durante el despliegue:** el primer intento abortó con
`acepto un cobro que no cuadra con la diferencia: exchange_id_conflict`.
`payment_required` y `payment_mismatch` retornaban **después** de insertar
cabecera, renglones y movimientos; un `return` de PL/pgSQL no aborta la
transacción, así que un cobro mal formado dejaba el documento a medias. Es la
escritura parcial que H-04 existe para impedir, reintroducida por una función
nueva. `005700` ya estaba registrada, así que se corrigió hacia adelante con
`005900` (`R-DB-01`), generada desde el texto vigente con exactamente dos bloques
de diferencia (`R-DB-03`), y la verificación se renumeró de `005800` a `006000`
(`R-DB-02`). El arnés comprobaba que los códigos existieran, no dónde se emiten
—el síntoma y no la defensa, `AP-09`— y se endureció.
**Pruebas:** commit del cambio 32/32; modelo del cambio 28/28; saldo por renglón
38/38; devoluciones 17/17; coherencia de venta 17/17; plazo 38/38; precio por
talla 38/38 y E2E 19/19; trazabilidad 65/65; cola 115/115; migraciones 29/29;
contratos 36/36; descuentos 43/43 sin modificar; folio diario 60/60; folios
12/12; comisiones 10/10; comisión efectiva 22/22; liquidaciones 10/10;
elegibilidad 10/10; avatares 13/13; concurrencia 9/9; roles 10/10; build 8/8;
SDK 4/4; entradas 8/8; smoke bundle 17/17; navegación 13/13; propagación de reset
21/21; filtros 18/18.
**Pendiente:** C6 (interfaz) y C7 (reportes y liquidación de la comisión del
segundo vendedor).
**Riesgo residual:** sin interfaz el cambio no es alcanzable por el usuario. La
concurrencia entre dos terminales sobre la última pieza se apoya en el bloqueo
estable dentro de la transacción, ya verificado en H-01, pero no se probó con dos
sesiones simultáneas.
**Corrección documentada:** `docs/fixes/commit-transaccional-cambio.md`.

## H-39 — Una aserción estática se estaba tomando por verificación

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `fd2aaaa`
**Evidencia:** `AP-09` reincidió **cinco veces en tres historias**: el `CHECK` con
subconsulta y la ventana corta de `recordSale` en H-36, el selector de talla del
E2E que pasaba porque la tarjeta ya mostraba las dos cifras, la rama de consumo
que faltaba en H-37 y los códigos de cobro de H-38 comprobados sin mirar dónde se
emiten. En los cinco casos el arnés afirmaba que el texto decía lo correcto y
nadie comprobaba que el comportamiento lo fuera.
**Origen de auditoría:** deuda del Sistema Operativo priorizada tras H-38.
**Riesgo:** falsa confianza. Ninguna de las cinco llegó a producción —dos
fallaron en el push y tres las detuvo la verificación— pero el patrón consume
rondas de despliegue y, sobre todo, hace que un arnés en verde no signifique lo
que aparenta.
**Reproducción:** el detector nuevo señala una función sin verificación en un
caso sintético; sin él, la cadena no tenía forma de exigirlo.
**Corrección:** dos reglas y un guardián mecánico.
`R-DB-09` (BLOCKING) fija que una aserción de texto sobre un `.sql` sólo prueba
**presencia**, nunca corrección: toda afirmación sobre comportamiento se prueba
ejecutando el SQL, y la verificación autocontenida es esa prueba.
`R-DB-10` (REQUIRED) exige que toda función o vista nueva de `pos` esté
ejercitada por una verificación que la nombre y aborte. `test-migrations.mjs`
lo mecaniza recorriendo la cadena, y **el propio detector se prueba contra un
caso sintético** para no ser otro verde sin defensa detrás.
**Alcance:** funciones y vistas. Las restricciones `check` quedan fuera del
automatismo porque se verifican por comportamiento y no por nombre; `R-DB-09`
les aplica igual.
**Pruebas:** `test-migrations.mjs` 31/31, con los dos checks nuevos. La cadena
completa —36 migraciones— pasa el guardián sin una sola excepción: todas las
funciones y vistas de `pos` ya estaban ejercitadas.
**Despliegue:** ninguno. La historia no toca el esquema.
**Pendiente:** **ejecutar el SQL contra un PostgreSQL real antes del push sigue
sin vía disponible.** Docker no está operativo y el PostgreSQL 18.4 instalado
exige `scram-sha-256` con una contraseña de la que no se dispone;
`supabase db lint --linked` funciona pero analiza el esquema **desplegado**, no
las migraciones pendientes, así que no habría atrapado ninguno de los cinco
casos. Habilitar esa vía —arrancar Docker o facilitar la credencial local— es lo
único que falta para cerrar `AP-09` por completo.
**Riesgo residual:** el automatismo garantiza que exista una verificación que
ejercite cada función y vista, no que esa verificación sea buena. La calidad de
la verificación sigue dependiendo de `FF-10`.
**Corrección documentada:** este registro; la historia no produjo documento de
corrección propio por su tamaño.

## H-40 — El apartado abierto no tiene superficie de gestión ni comprobante

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `2e57fbe`
**Evidencia:** el dominio del apartado estaba completo desde H-03 y H-04
—`DATA.registrarPagoApartado` asienta abono, liquidación, historial y push— pero
el producto no exponía el estado intermedio. Los apartados abiertos sólo se veían
como aviso de seis renglones en el panel, el abono se capturaba con dos
`window.prompt()` encadenados y ningún pago posterior al anticipo producía
comprobante: el cliente entregaba dinero y se iba sin papel.
**Origen de auditoría:** solicitud del dueño del producto tras recorrer el flujo
del apartado de extremo a extremo.
**Riesgo:** cobranza sin trazabilidad para el cliente y sin visión de cartera para
el negocio. Un abono sin comprobante es una disputa futura; una cartera sin
totales impide saber cuánto dinero está comprometido.
**Reproducción:** venta con método `Apartado` y anticipo parcial; el panel ofrece
«Abonar» → `prompt()` de monto → `prompt()` con menú numérico de forma de pago →
el abono queda asentado sin documento alguno.
**Corrección:** pantalla propia `Apartados` en el menú lateral
(`balam/layaway.jsx`) con cartera completa, cuatro indicadores, búsqueda por folio
o cliente, filtros, renglón con detalle desplegable —mercancía e historial de
pagos— y acciones de llamar, reimprimir y abonar; modal de abono con el mismo
lenguaje de la botonera de cobro del POS —incluido `Mixto`—, impresión del listado
en ventana propia y exportación a `.xlsx`. La captura por `prompt()` desaparece:
hay una sola forma de cobrar un abono. El comprobante **no es un formato nuevo**:
`BalamTicket` —el ticket del Punto de venta— gana la costura opcional `payment`
(`ADR-003`), que añade el acuse del pago, el estado de cobranza y el historial de
pagos al pie; sin ese parámetro el ticket de venta no cambia.
**Alcance:** superficie. No hay migración, campo nuevo ni cambio de contrato de
sincronización; `DATA` sigue siendo la autoridad única del abono y no se modificó.
**Pruebas:** `test-layaway-screen.mjs` 55/55 sobre el bundle distribuido, más la
regresión de cliente y ventas —`test-module-contracts.mjs` 37/37,
`test-smoke.mjs` 15/15, `test-ui-navigation.mjs` 14/14,
`test-folio-concurrency.mjs` 12/12, `test-discount-trace.mjs` 65/65,
`test-store-queue.mjs` 115/115, `test-precio-talla-e2e.mjs` 19/19,
`test-build-reproducibility.mjs` 8/8, `test-xlsx-security.mjs` 17/17,
`test-returns.mjs` 17/17, `test-sale-coherence.mjs` 17/17,
`test-line-balance.mjs` 38/38, `test-role-access.mjs` 10/10,
`test-liquidations.mjs` 10/10, `test-folio-diario.mjs` 60/60—. Las cuatro suites
que ejercitan el ticket impreso se corrieron después de abrir la costura para
demostrar que el comprobante de venta no cambió.
**Despliegue:** artefactos regenerados con `node build-offline.mjs` y publicados en
`https://david14081982.github.io/POS_Balam/`. El artefacto servido se verificó
idéntico byte a byte al `index.html` del commit, SHA-256
`0904AD7D57A67F6F432A1FD33F4EF02F78C62B6EB8E3D2E3615A6967DBE9AED4`. La historia no
toca el esquema, así que no hay migración que aplicar antes del cliente.
**Pendiente:** reservar inventario al apartar sigue sin resolverse —es una decisión
de negocio con impacto en el contrato remoto—; no existe cancelación de apartado ni
devolución de anticipo; el apartado no vence. Dos defectos previos quedaron
declarados sin corregir por alcance: `pos.allowLayaway` no tiene consumidores y el
botón «Imprimir» de Reportes imprime en blanco porque fuera del Punto de venta no
hay `#balam-ticket` montado.
**Riesgo residual:** la pantalla declara que la pieza no está reservada, pero no lo
impide. Un apartado cuya mercancía se vendió en piso seguirá fallando la reserva al
liquidarse, con el mismo comportamiento de antes de esta historia.
**Corrección documentada:** `docs/fixes/pantalla-apartados.md`.

## H-41 — El comprobante impreso se cortaba en la primera hoja

**Estado:** RESUELTO
**Fecha de registro:** 28/07/2026
**Fecha de resolución:** 28/07/2026
**Commit:** `ce235ff`
**Evidencia:** reportado por el dueño desde producción tras cobrar dos abonos: el
comprobante del segundo no mostraba el historial de pagos y los tickets del mismo
apartado «se veían diferentes». Medido sobre el bundle en medio `print`, el
comprobante mide 1543–1606 px y el documento imprimible medía 950 px: el papel
sólo recibía la primera hoja y el resto se descartaba. El corte caía después de
«Pagado a la fecha», así que el saldo, el historial completo y el pie quedaban
fuera; como el documento crece con cada abono, el corte se movía en cada
impresión.
**Origen de auditoría:** uso real de la cobranza de apartados entregada en H-40.
**Riesgo:** el cliente recibe un comprobante mutilado, sin la prueba de lo que
lleva pagado. En una disputa sobre un apartado, el papel es la evidencia.
**Reproducción:** apartado de 3 piezas con anticipo y tres abonos; imprimir a PDF
tras cada uno. Antes del cambio: 1 hoja para 1543 px, sin historial de pagos.
**Corrección:** el comprobante deja de ser un elemento fuera de flujo. Se monta con
`ReactDOM.createPortal` como hijo directo de `<body>` —fuera de los contenedores
con scroll de la aplicación— y en `@media print` vuelve al flujo (`position:
static`) mientras `#root` se retira del layout con `display: none`, no con
`visibility: hidden`, que dejaba las cajas ocupando espacio. Con el documento
midiendo lo que mide el comprobante, el navegador pagina solo. Los bloques llevan
`break-inside: avoid` para que ninguno se parta entre hojas.
**Alcance:** presentación e impresión. Sin cambios en datos, dominio,
sincronización ni en el contenido del comprobante. El ticket de venta del POS
hereda el arreglo: una venta de 6 renglones sufría el mismo corte.
**Pruebas:** `test-ticket-print.mjs` 23/23 —reproducción convertida en arnés, que
mide en medio `print` e imprime a PDF real—, `test-layaway-screen.mjs` 55/55, y la
regresión de cliente: `test-smoke.mjs` 15/15, `test-ui-navigation.mjs` 14/14,
`test-module-contracts.mjs` 37/37, `test-folio-concurrency.mjs` 12/12,
`test-discount-trace.mjs` 65/65, `test-precio-talla-e2e.mjs` 19/19,
`test-returns.mjs` 17/17, `test-store-queue.mjs` 115/115,
`test-sale-coherence.mjs` 17/17, `test-build-reproducibility.mjs` 8/8.
**Despliegue:** artefactos regenerados con `node build-offline.mjs` y publicados en
`https://david14081982.github.io/POS_Balam/`. El artefacto servido se verificó
idéntico byte a byte al `index.html` del commit, SHA-256
`7466A9A493569A89B0C06E079A4A0148D0CD05A40B078E0785BEF416BE71A6C0`. Sin migración.
**Pendiente:** no hay numeración de hojas («Hoja 2 de 2») ni encabezado repetido a
partir de la segunda: las cajas de margen de `@page` y los contadores de página no
están implementados en Chrome. En impresora térmica de rollo la cuestión no se
plantea —`size: 80mm auto` produce una tira continua—; en impresora de hojas el
comprobante continúa en la siguiente sin cortar bloques.
**Riesgo residual:** la altura de hoja de referencia del arnés (1056 px) es la que
Chrome usa con altura `auto`; si cambiara, el arnés sigue siendo válido —compara
papel disponible contra alto del comprobante— pero el número de hojas esperado
variaría.
**Corrección documentada:** `docs/fixes/ticket-impreso-paginado.md`.

## H-42 - El cambio no era alcanzable por el usuario (C6)

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `779b607`
**Evidencia:** C4 dejo el modelo y C5 la autoridad transaccional, pero ninguna
pantalla invocaba `recordExchange`. Ademas el modelo calculaba `base_comision`
sin poder atribuirla —`pos.exchanges` no tenia vendedor— y no guardaba rastro de
la revision de la prenda que el Contrato del Cambio, seccion 5, exige para
recibirla.
**Origen de auditoria:** C6 del modulo de Cambios,
`docs/04-contrato-del-cambio.md`, seccion 13.
**Riesgo:** una funcion completa e inalcanzable, y una comision calculada sin
dueno que C7 no habria podido liquidar.
**Reproduccion:** `node test-exchange-screen.mjs` antes del cambio: 29 fallos.
**Correccion:** el tipo de operacion se elige al inicio sobre la venta ya
localizada —Devolucion / Cambio— y **el flujo de Devoluciones queda intacto**:
`ReturnDetail` no cambia una linea y el cambio vive en `ExchangeDetail`. El
motivo se reutiliza en ambos; el metodo de reembolso sigue siendo exclusivo de
Devoluciones. La pantalla **consume autoridades y no reimplementa reglas**:
`saleLineBalance` para lo disponible, `recognizedValue` para lo que se reconoce,
`listPrice`/`priceRange` para lo que se lleva, `returnDeadline` para el plazo y
`recordExchange` como unica via de registro. La diferencia usa el
`CheckoutModal` completo del POS y el vendedor se confirma como en una venta.
Tres columnas aditivas —`vendedor_id`, `revisado_por`, `condicion`— cierran la
atribucion y la revision.
**El comprobante no estrena formato:** `window.BalamTicket` sigue siendo la
autoridad unica. Se anadio una **segunda costura**, hermana de la `payment` de
H-40: aquella acusa dinero recibido y esta acusa mercancia intercambiada, que es
un hecho distinto y no cabia en la primera. El resto del documento queda intacto.
H-41 lo hizo paginable justo a tiempo: el comprobante de un cambio es mas largo
que una venta.
**Despliegue:** migraciones `006300` y `006400` aplicadas y registradas en
`Balam` el 29/07/2026, a la primera. La verificacion emitio sus cuatro avisos y
no dejo filas.
**Pruebas:** pantalla del cambio 29/29; commit del cambio 32/32; modelo 28/28;
saldo por renglon 38/38; devoluciones 17/17; apartados 55/55; plazo 38/38;
precio por talla 38/38 y E2E 19/19; trazabilidad 65/65; coherencia de venta
17/17; cola 115/115; migraciones 31/31; contratos 37/37; descuentos 43/43 sin
modificar; folio diario 60/60; comisiones 10/10; comision efectiva 22/22;
liquidaciones 10/10; elegibilidad 10/10; concurrencia 9/9; roles 10/10; build
8/8; smoke bundle 17/17; navegacion 14/14.
**Pendiente:** C7 —reportes, liquidacion de la comision del segundo vendedor y
el desglose de cobrado que aun no cuadra con un pago de cambio—.
**Riesgo residual:** el catalogo de la pantalla lista los primeros 24 articulos
filtrados por busqueda, sin paginacion. La revision de la prenda es texto libre,
no un catalogo administrable. El cambio no se probo con dos terminales
simultaneas.
**Correccion documentada:** `docs/fixes/pantalla-del-cambio.md`.

## H-43 - Una mejora de UX se justificaba con estimaciones, no con medidas

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `07e6565` (instrumento) · `7306e20` (R-DEL-14) · `14d4958` (guardian)
**Evidencia:** al proponer las mejoras de la pantalla del cambio se enumeraron
las interacciones leyendo el codigo: 16. El instrumento midio 14. El autor del
cambio es quien peor puede juzgar cuanto cuesta su pantalla.
**Riesgo:** dos danos distintos. Una optimizacion sin medida no se puede
verificar; y una optimizacion que reduce clics retirando controles se lee como
mejora cuando es perdida de defensa disfrazada de agilidad.
**Reproduccion:** ninguna herramienta del repositorio media el recorrido.
**Correccion:** `test-ux-metrics.mjs` instrumenta el recorrido con escuchas en
fase de captura sobre el documento y cuenta clics, capturas de texto —una por
campo, no una por tecla—, menus aparte, tiempo y **validaciones de negocio
atravesadas** con su estado bloqueado y liberado. Localiza cada paso por
`data-testid` y solo entonces por texto.
Sobre esa medicion se hizo **mecanica** la regla: el instrumento compara contra
`ux-baseline.json` y **sale con codigo 1** si disminuyen las validaciones, si
aumentan las interacciones sin justificacion declarada o si el recorrido deja de
completarse. `--justifica` libera solo la columna de interacciones; las
validaciones no tienen valvula de escape. `--fijar` reescribe la linea base como
acto deliberado, con motivo y fecha dentro del propio fichero.
Sondear una defensa no es un gesto del cajero: `window.__pausa` detiene el
contador durante la prueba, para que probar mas garantias jamas encarezca
artificialmente el recorrido medido.
**Reglas nuevas:** `R-DEL-13`, `R-DEL-14` y `R-DEL-15` en
`docs/architect/playbooks/delivery.md`; principio 9 de
`docs/architect/PHILOSOPHY.md`.
**Pruebas:** guardian probado en los dos sentidos (`R-DEL-11`): verde contra su
propia linea base y **rojo con codigo 1** contra una linea base exigente,
marcando ambas columnas.
**Pendiente:** el mecanismo de `R-DEL-15` aun no tiene un guardian equivalente
para rendimiento ni para consultas; existe la forma, no la instancia.
**Riesgo residual:** la linea base cubre un escenario por flujo. Un recorrido no
instrumentado sigue sin proteccion.

## H-44 - El recorrido del cambio cobraba al cajero lo que ya sabia

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `9e8e5bc`
**Evidencia:** el instrumento de H-43 midio 14 interacciones para un cambio de
talla. Tres de ellas eran datos que el sistema ya conocia o podia proponer: el
tipo de operacion, el motivo y quien revisa. Ademas el boton principal quedaba
deshabilitado sin decir que faltaba, y el aviso del sobrante perdido se daba con
`window.confirm`, que no sabe pintar una cifra ni distinguir la accion
destructiva de la que sigue.
**Origen de auditoria:** revision manual de UX posterior a C6, sobre la
medicion instrumentada de H-43.
**Riesgo:** un mostrador lento en hora punta y un cajero que abandona la
pantalla sin entender por que no avanza.
**Reproduccion:** `node test-ux-metrics.mjs` antes del cambio: 14 interacciones,
1 validacion. `node test-exchange-screen.mjs`: 39/40 con el nuevo contrato.
**Correccion:** la operacion se declara **antes** de buscar la venta, y el equipo
recuerda la ultima en `localStorage` —preferencia del dispositivo, no dato del
negocio—: el buscador ya habla en el idioma de la operacion elegida y la venta
aterriza directamente en su pantalla. El selector del detalle sobrevive como
**correccion**, porque equivocarse de operacion no puede obligar a empezar.
Motivo y condicion llegan **preseleccionados y visibles en su propio control**,
nunca en silencio: el motivo mas frecuente del cambio es la talla y se lee en el
desplegable; la condicion trae cuatro acciones rapidas y sigue siendo texto
libre. El revisor se prellena con la sesion abierta y sigue editable, porque
revisar y cobrar pueden ser dos personas.
El boton principal **guia**: solo el plazo vencido lo deshabilita —ahi no hay
nada que guiar—, y en cualquier otro estado responde, dice que falta y lleva
hasta ahi. `validar()` sigue siendo la unica autoridad que decide si se registra:
la guia informa, no autoriza.
El aviso del sobrante perdido pasa al modal del sistema, con la cifra visible y
dos salidas distinguibles.
**Pruebas:** guardian de `R-DEL-14` **en verde sin intervencion manual**, corrida
reconfirmada sobre el arbol final (`R-DEL-02`): 14 -> 11 interacciones y 1 -> 2
validaciones, recorrido completado, codigo de salida 0. Escenario
`cambio-de-talla-repetido` —segundo cambio del turno, operacion recordada— en 10
interacciones y 2 validaciones; el escenario oficial se reejecuto despues y
siguio en 11 con `ux-baseline.json` intacto (SHA-256
`0e5f1b52f3b0a9d34c38db487844787b76da49a3b3329889569916d2f3ca6ebe`), prueba de
que el escenario repetido no altera el oficial.
E2E del cambio 34/34 con seis comprobaciones nuevas; pantalla del cambio 42/42;
devoluciones 17/17; plazo 38/38; saldo por renglon 38/38; modelo 28/28; commit
del cambio 32/32; apartados 55/55; ticket 23/23; precio por talla 38/38 y E2E
19/19; coherencia 17/17; contratos 37/37; migraciones 31/31; roles 10/10; build
8/8; smoke 15/15; navegacion 14/14; reproducibilidad 8/8. Cero fallos.
**Despliegue:** publicado en `https://david14081982.github.io/POS_Balam/`. El
artefacto servido se verifico identico byte a byte al `index.html` del commit
`9e8e5bc`, SHA-256
`DDFE83AAFB1B568A80870BF274E658776596BD18C580898E9234C1099132E93A`, 8 689 063
bytes (`R-DEL-07`). Sin migraciones que aplicar antes del cliente.
**Pendiente:** H-45 —camino rapido para el cambio de talla— y C7.
**Riesgo residual:** `window.confirm` sigue vivo **fuera** de esta pantalla
—`balam/clients.jsx`, `balam/discounts.jsx`, `balam/sellers.jsx` y
`balam/settings.jsx`—; H-44 no lo toco porque su alcance era el cambio. Queda
como **deuda tecnica con historia propia**: estandarizar los dialogos del
sistema, donde varios de esos avisos son destructivos —eliminar un cliente,
regenerar SKU, cerrar periodo— y el navegador no distingue la accion destructiva
de la que sigue ni sabe pintar la cifra en juego. El inventario vive en el
repositorio, no aqui: `grep -rn "window.confirm(" balam/*.jsx`.
La condicion de la prenda sigue siendo texto libre con atajos, no un catalogo
administrable.
**Correccion documentada:** `docs/fixes/recorrido-del-cambio.md`.

## H-45 - El cambio de talla obligaba a buscar la prenda que el cliente traia

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `449da80`
**Evidencia:** el cambio de talla es el caso mas frecuente del modulo y costaba
lo mismo que traer cualquier otro articulo, porque el cajero tenia que ENCONTRAR
en el catalogo la prenda que el cliente acababa de dejar en el mostrador. La
pantalla ya sabia cual era —esta en el renglon, con su SKU y su talla— y no
ofrecia ninguna forma de decir «esta misma, en otra medida».
**Origen de auditoria:** revision manual de UX posterior a C6; fase 1 medida con
el instrumento de H-43.
**Riesgo:** un mostrador lento en el caso mas comun, y la puerta abierta a elegir
otro modelo parecido al buscar a mano.
**Reproduccion:** el coste era invisible porque el escenario oficial siembra UN
solo producto (`R-DEL-12`). Con el escenario nuevo
`cambio-de-talla-catalogo-real` —61 articulos, rellenos sembrados primero para
que la prenda quede fuera de las 24 primeras tarjetas— aparecio: 12
interacciones frente a 11 del oficial, y la extra es teclear en el escaner.
**Correccion:** un boton «Misma prenda, otra talla» en el renglon marcado, que
abre el MISMO selector de tallas que usa el catalogo. No trae logica propia:
hace `setPicking(r.p)`, asi que talla, precio vigente de H-36 y existencias
siguen saliendo de una sola presentacion. Se ofrecen todas las tallas, incluida
la devuelta, porque un cambio por defecto de fabrica es la misma talla; se
oculta si la prenda ya no esta en el catalogo; y abrirlo no compromete nada.
**Alternativa descartada:** tallas en linea dentro del renglon. Ahorraba una
interaccion mas, pero duplicaba la presentacion de precio y existencias, cargaba
el renglon con una cuarta decision simultanea restando fuerza al boton guia de
H-44, y su ahorro era estimacion, no medida. Queda como refinamiento encima de
este, con 11 interacciones como linea base.
**Pruebas:** guardian de `R-DEL-14` en verde sin intervencion manual: 12 -> 11
interacciones, validaciones 2 -> 2, recorrido completado, codigo 0. Los otros dos
escenarios intactos: oficial 11/2 y repetido 10/2. Linea base refijada a 11/2 al
cerrar (`R-DEL-16`). E2E del cambio 37/37 con tres comprobaciones nuevas;
pantalla del cambio 45/45 con tres mas; regresion completa en verde.
**Pendiente:** C7 —reportes, liquidacion de la comision del segundo vendedor y
el desglose de cobrado que no cuadra con un pago de tipo cambio—.
**Riesgo residual:** el catalogo sigue sin paginacion; el atajo lo esquiva para
el caso de talla, no lo arregla. Sigue pendiente la deuda de estandarizacion de
dialogos.
**Despliegue:** artefacto servido por GitHub Pages verificado byte a byte
contra el `index.html` del commit: SHA-256 `ad7486dbfa1a86a6fd7d293afc0d51aa7e7cdfb8fa0c7143e81d0e33c0af90cb`,
8 689 492 bytes, a la primera (`R-DEL-07`).
**Correccion documentada:** `docs/fixes/camino-rapido-de-talla.md`.

## H-46 - La mercancia que sale temporalmente no se registra en ninguna parte

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `9387e62`
**Evidencia:** el producto sabia representar mercancia que se vende, que se
aparta, que se devuelve y que se cambia. No sabia representar mercancia que
**sale y tiene que volver**: una guayabera que un empleado se lleva puesta a un
evento, o varias piezas que un cliente se lleva a probar. `grep -rin "prestamo"`
sobre el repositorio completo no devolvia nada: ni coleccion, ni pantalla, ni
campo, ni catalogo.
**Origen de auditoria:** solicitud del dueno del producto.
**Riesgo:** mercancia fuera del negocio sin ningun documento que diga quien la
tiene, desde cuando y cuando la va a regresar. La perdida no se detecta —no hay
nada que vencer— y no existe evidencia con la que reclamarla.
**Reproduccion:** `node test-loans-screen.mjs` sobre el bundle previo al cambio:
**0 de 2 verificaciones**; se detiene en la primera porque no existe
`window.LoansScreen`.
**Correccion:** el prestamo pasa a ser un documento propio, no una venta de cero
ni un movimiento de inventario. `DATA.loans` congela la evidencia de la prenda
—nombre, SKU, talla, cantidad y precio de lista del dia— y una copia de la
persona que recibio; su referencia comercial es `PR-{AAMMDD}-{CONSECUTIVO}`, con
consecutivo propio que **no** gasta el contador diario de ventas; y tres
autoridades nuevas responden «cuantas unidades estan fuera»
(`DATA.loanedQty`), «cuantas faltan por regresar» (`DATA.prestamoPendientes`) y
«esta vencido y por cuantos dias» (`DATA.prestamoAtraso`). La pantalla
`balam/loans.jsx` reutiliza los idiomas ya establecidos: la cartera y los
indicadores de Apartados, el buscador y el selector de talla del Punto de venta,
el autocompletado de persona del ticket y el documento impreso en ventana propia
de Inventario. La devolucion admite parciales; la fecha real se fija con la
entrega que cierra el prestamo; la mercancia declarada perdida todavia puede
regresar. Los vencidos avisan en la campana administrativa.
**Alcance:** superficie y modelo local. Sin migracion, sin campo remoto y sin
cambio en el contrato de sincronizacion.
**No alcance declarado:** replicacion en la nube —exige una tabla `pos.loans`
con RLS, `grants` nominales y verificacion autocontenida, y aplicarla contra la
base real antes de publicar el cliente (`R-DEL-03`, `AP-08`), para lo que esta
sesion no tenia credenciales—; afectacion de inventario; deposito o garantia en
dinero; conversion de un prestamo en venta; presencia en Reportes.
**Pruebas:** `test-loans-screen.mjs` **99/99** sobre el bundle distribuido, con
cada validacion afirmada en los dos sentidos (`R-DEL-11`) y el rechazo de
devolver mas piezas de las que faltan comprobado contra la autoridad, no contra
el sintoma. Regresion completa en verde: contratos de modulo 38/38, navegacion
15/15, smoke 15/15, apartados 55/55, E2E del cambio 37/37, pantalla del cambio
45/45, ticket impreso 23/23, cola 115/115, folio diario 60/60, reinicios 19/19 y
21/21, migraciones 31/31, y las demas suites del repositorio. Guardian de
`R-DEL-14` sin intervencion: 11 interacciones, 2 validaciones, recorrido
completo. `R-DEL-13`, `R-DEL-15` y `R-DEL-16` se descartan por escrito: la
historia anade una capacidad, no promete ahorro, y no tiene metrica que refijar.
**Despliegue:** artefactos regenerados con `node build-offline.mjs` y publicados
en `https://david14081982.github.io/POS_Balam/`. El artefacto servido se verifico
identico byte a byte al `index.html` del commit: SHA-256
`BFF07979BB358B54808213BD42946CCAFF66743271BCDDB754CE54540591EE7C`, 8 716 917
bytes (`R-DEL-07`). La historia no toca el esquema, asi que no hay migracion que
aplicar antes del cliente.
**Pendiente:** lo declarado como no alcance. El consecutivo `PR-…` se deriva de
lo que conoce la terminal, asi que debe resolverse junto con la replicacion, no
despues.
**Riesgo residual:** los prestamos viven solo en esta terminal —borrar los datos
del navegador los pierde y una segunda terminal no los ve—, y el respaldo es la
exportacion a Excel o el listado impreso. Un prestamo no reserva ni descuenta
inventario: la pieza sigue contando como existencia y puede venderse en piso por
descuido, el mismo riesgo residual que H-40 registro para el apartado. La
decision esta razonada: como la coleccion no se replica, descontar stock —que si
viaja a `pos.products`— podria dejar un faltante sin explicacion en todas las
terminales si se pierde el registro local.
**Correccion documentada:** `docs/fixes/pantalla-prestamos.md`.

## H-48 - El prestamo obligaba a teclear la prenda que el lector ya sabe leer

**Estado:** RESUELTO
**Fecha de registro:** 29/07/2026
**Fecha de resolucion:** 29/07/2026
**Commit:** `c9618dd`
**Evidencia:** el negocio tiene lector de codigo de barras y toda la mercancia
lleva etiqueta `SKU-TALLA` (`balam/barcodes.jsx`). El Punto de venta lo aprovecha
por dos caminos —`onScan` en su campo de captura y una captura global HID con
heuristica de cadencia (`balam/pos.jsx`)— pero la captura del prestamo entregada
en H-46 solo aceptaba texto: habia que leer el nombre de la prenda y teclearlo.
**Origen de auditoria:** solicitud del dueno del producto tras usar la pantalla.
**Riesgo:** el mostrador paga dos veces por el mismo dato. Teclear el nombre
tambien admite equivocarse de prenda o de talla, y el prestamo congela esa
evidencia: un error de captura queda escrito en el documento que firma el cliente.
**Reproduccion:** `node test-loans-screen.mjs` con las comprobaciones de lector
sobre el bundle previo: la lectura del codigo no agrega ninguna pieza.
**Correccion:** los tres caminos de `onScan` del Punto de venta, en el mismo
orden: codigo completo → la pieza exacta entra sin preguntar la talla, porque ya
venia en la etiqueta; SKU exacto → abre el selector de talla; texto libre → abre
la primera coincidencia. El buscador nace enfocado y leer dos veces la misma
etiqueta suma cantidad en el renglon existente. Se replico tambien la captura
global HID con su heuristica de cadencia, con una defensa que el POS no necesita:
la captura del prestamo tiene tres campos de texto, asi que al reconocer el codigo
se retira del campo enfocado exactamente lo que el lector escribio —si no,
escanear con el foco en «quien recibe» dejaria el codigo dentro del nombre—. En el
buscador de la cartera una lectura responde «quien tiene esta prenda» y busca en
**todos** los estados, ignorando el filtro a proposito y diciendolo en pantalla.
**Alcance:** captura del prestamo y buscador de la cartera. Ninguna autoridad
nueva: se consume `window.BARCODES`, la misma del Punto de venta.
**Pruebas:** `test-loans-screen.mjs` **112/112** —ocho comprobaciones nuevas en la
captura y cuatro en la cartera, incluida la ráfaga que no debe quedar escrita en el
nombre de la persona—. Regresion de cliente en verde: contratos 38/38, navegacion
15/15, smoke 15/15, apartados 55/55, E2E del cambio 37/37, pantalla del cambio
45/45, ticket impreso 23/23, cola 115/115, folio diario 60/60, precio por talla
19/19, devoluciones 17/17, reinicio 19/19, inventario 18/18, coherencia de cobro
17/17, `.xlsx` 17/17, reproducibilidad 8/8. Guardian de `R-DEL-14` intacto.
**Despliegue:** el paquete publicado **no se vuelve a generar** en este cierre: se
commitea el que ya estaba construido y verificado sobre esta fuente, que contiene el
lector y **no** contiene el codigo cliente de H-47. Es deliberado. El artefacto
servido por GitHub Pages se verifico identico byte a byte al `index.html` del commit
`c9618dd`: SHA-256
`491086D1E500B2F3C6BE21950A5235EC3125F24D9F2C545E98917918960D1615`, 8 721 377 bytes
(`R-DEL-07`). H-47 —otra
historia, trabajada en paralelo sobre el mismo arbol— dejo commiteado en
`balam/store.jsx` y `balam/data.jsx` codigo que escribe `comision_monto`,
`comision_base`, `comision_pct` y `comision_revertida` en `pos.exchanges`, y sus
migraciones `20260730006500/6600/6700` **no estan aplicadas** en la base real. Como
el hook `post-commit` publica cada commit, regenerar aqui pondria en el mostrador un
cliente que escribe contra columnas inexistentes y el cambio quedaria bloqueado por
esquema en la cola: `R-DEL-03` y `AP-08`. La divergencia entre fuente y paquete es
la que H-47 ya declaro en su propio cierre; este cierre la conserva en vez de
resolverla publicando codigo sin su migracion.
**Pendiente:** dos cosas que se resuelven con la primera regeneracion **posterior**
a aplicar las migraciones de H-47: incorporar al paquete el codigo cliente de esa
historia, y corregir dos comentarios del paquete que todavia dicen `H-47` porque
esta historia se renumero a H-48 despues de construirlo —el numero vive en un
comentario, no en comportamiento—. Ademas, cuando el termino no resuelve a ninguna
prenda del catalogo, la
cartera lo trata como busqueda de texto normal. `BARCODES.parse()` es heuristico
—da positivo con cualquier cadena con un guion en medio— y en el POS solo elige el
texto de un aviso; aqui habria cambiado el mensaje de una lista vacia por una razon
adivinada. Se dejo fuera a proposito.
**Riesgo residual:** la heuristica de cadencia del lector es la misma del Punto de
venta y hereda su limite: un tecleo humano extraordinariamente rapido que resulte
ser un codigo valido se interpretaria como lectura. Nunca ha ocurrido y el efecto
seria agregar una pieza visible que se puede quitar antes de registrar.
**Correccion documentada:** `docs/fixes/pantalla-prestamos.md` § Lector de codigo
de barras.

## H-47 - La comision del excedente se calculaba, se atribuia y nunca se pagaba

**Estado:** RESUELTO
**Fecha de registro:** 30/07/2026
**Commit:** `be84e3c`
**Evidencia:** `recordExchange` calculaba `baseComision` —el excedente de valor—
y desde H-42 guardaba tambien a quien le correspondia, pero no acreditaba nada a
nadie: no tocaba a los vendedores en ningun punto. Y `pos.commit_exchange` no
PODIA acreditar, porque nacio sin parametro de efectos de vendedor, el que
`commit_sale` tiene desde `20260725001900`.
**Origen de auditoria:** C7 del modulo de Cambios; explicacion pedida por el
dueno el 30/07/2026 sobre lo que faltaba del modulo.
**Riesgo:** dinero que el negocio le debe a una persona. Quien atendia el cambio
hacia una venta nueva, el sistema la registraba con su nombre, y a fin de mes
cobraba como si no la hubiera hecho.
**Reproduccion:** `node test-exchange-commission.mjs` antes de la correccion:
8 pasaron, 21 fallaron.
**Decision del dueno:** la comision se acredita en el acto, igual que en una
venta, con una reversa preparada para cuando el cambio se cancele o se modifique.
**Correccion:** el excedente comisiona segun `commission.base` y el porcentaje
del vendedor, y se acredita al registrar. Un cambio NO es un pedido: se toca
`comisionAcum` y nada mas —ni `ventasMes` ni `ventasNum`—, asi que el conteo de
ventas, el ticket promedio y las metas no se mueven. Lo acreditado queda
congelado en el documento (monto, criterio y porcentaje) para que la reversa
reste lo que de verdad se pago y no un recalculo (ADR-002, `AP-06`).
`reverseExchangeCommission` es la reversa: idempotente, nunca deja el acumulado
en negativo, y es una COSTURA DECLARADA —hoy no existe forma de cancelar ni
modificar un cambio—, probada para que no sea codigo muerto (ADR-003).
`commit_exchange` gana `p_seller_effects` con la misma reconciliacion de version
que `commit_sale`, de modo que un reenvio de la cola durable no paga dos veces.
**Pruebas:** 30/30. Regresion completa en verde, con las rutas de dinero y
sincronizacion en foco: comisiones 10/10; comision efectiva 22/22; liquidaciones
10/10; cola 115/115; concurrencia 9/9; trazabilidad 65/65; folio diario 60/60;
coherencia 17/17; devoluciones 17/17; modelo 28/28; commit del cambio 32/32;
saldo 38/38; plazo 38/38; contratos 38/38; migraciones 31/31; E2E del cambio
37/37; pantalla 45/45; smoke 15/15; navegacion 15/15; roles 10/10; build 8/8.
Guardian de UX intacto en 11/11.
**Despliegue:** las tres migraciones aplicadas y registradas en `Balam` el
30/07/2026, autorizadas por el dueno al ser operacion destructiva en produccion.
La verificacion emitio sus ocho avisos y no dejo filas. Dos fallos, ambos de la
semilla y no de la funcion, corregidos en el sitio al no estar registrada aun
(`R-DB-01`): faltaba la reserva de inventario que una venta cobrada exige (H-01),
y la limpieza borraba de `line_consumption` y `line_supply`, que son VISTAS. El
`drop` es protector —mientras coexistan las firmas de cinco y
seis parametros, una llamada con cinco es ambigua y PostgreSQL la rechaza— y el
cliente no puede publicarse antes de las migraciones (`R-DEL-03`).
**Pendiente:** H-49 —el descuadre entre cobrado y vendido—, que hace visible en
los reportes el ingreso que esta historia empieza a acreditar.
**Riesgo residual:** la reversa no tiene camino que la invoque porque no existe
cancelar un cambio. El IVA al 16% se replica como criterio en `recordExchange`
porque `recordSale` lo fija asi (`AP-01`). La venta original sigue sin congelar
su porcentaje de comision: debilidad heredada, digna de historia propia.
**Publicacion:** el cliente salio en el commit `c9618dd` de la sesion de
Prestamos, que recompilo los artefactos sobre las fuentes ya commiteadas de esta
historia. GitHub Pages sirve `balam/data.jsx` identico a la fuente del
repositorio, con la acreditacion y la reversa dentro, y el `index.html` servido
coincide byte a byte: SHA-256 `491086d1e500b2f3c6be21950a5235ec3125f24d9f2c545e98917918960d1615`.
Nota para quien audite: `index.html` NO incrusta los `.jsx`, los carga en
ejecucion, y `POS Balam (offline).html` los guarda codificados (`atob`). Buscar
un identificador con grep en cualquiera de los dos da cero y **no** prueba que
falte: se comprueba contra el `.jsx` servido, o decodificando.
**Correccion documentada:** `docs/fixes/comision-del-excedente.md`.

## H-49 - El dinero cobrado no cuadra con el importe vendido

**Estado:** RESUELTO
**Fecha de registro:** 30/07/2026
**Commit:** `927eabf`
**Evidencia:** en `balam/reports.jsx`, «Dinero cobrado» suma TODOS los pagos
—incluidas las diferencias de cambios, que desde H-47 tienen su propio pago de
tipo `cambio`— mientras «Ventas brutas» suma el total de las VENTAS, y un cambio
no es una venta. Las dos cifras se leen juntas en la misma pantalla y no cuadran.
El desglose existente solo separa anticipos y abonos de apartados: no hay ningun
renglon que nombre las diferencias de cambios.
**Origen de auditoria:** C7 del modulo de Cambios.
**Riesgo:** con un cambio al mes no se nota; con veinte, al cerrar el mes hay un
hueco de miles de pesos y la pregunta «me falta dinero o falta un registro» no
tiene respuesta en pantalla.
**Decision del dueno (30/07/2026):** la diferencia pagada SI se suma al importe
de ventas, porque es ingreso adicional por entregar un producto de mayor valor.
Pero NO se contabiliza como pedido ni como venta nueva, porque proviene de una
operacion ya existente. Asi el cobrado cuadra con el vendido sin alterar
artificialmente el numero de pedidos, el ticket promedio ni las metas del equipo.
Ademas debe mostrarse un renglon propio, «Diferencias cobradas por cambios», para
que quede claro de donde viene ese ingreso.
**Reproduccion:** `node test-report-revenue.mjs` antes de la correccion: 2
pasaron, 22 fallaron. La comprobacion 15 mostro el descuadre con numeros:
`cobrado=450 vendido=undefined` sobre una venta de 350 y un cambio de 100.
**Correccion:** la aritmetica del ingreso pasa a UNA autoridad,
`DATA.revenueSummary`, porque la suma de ventas estaba escrita seis veces en
`balam/*.jsx` y anadir el cambio en una sola habria creado la septima divergencia
(`AP-01`, `ADR-003`). Devuelve `ventasSolas`, `difCambios`, `importeVendido`,
`noAprovechado`, `pedidos` y `ticketProm`. El reporte la consume y estrena la
tarjeta «Diferencias cobradas por cambios».
La consecuencia menos obvia de la decision del dueno esta resuelta dentro de la
autoridad: el ticket promedio se mide sobre VENTAS y no sobre el importe total,
porque si usara el importe un cambio lo inflaria sin que nadie hubiera comprado de
mas. Y la variacion mensual mide el mismo importe que el KPI, con el conteo
todavia de pedidos, para que la flecha de tendencia no mienta.
Un cambio a la baja no aporta ingreso ni positivo ni negativo: el sobrante que el
cliente pierde (Contrato § 4) se informa aparte en `noAprovechado`.
**Pruebas:** 24/24. Regresion completa en verde, incluido el arnes de la pantalla
de Prestamos de otra sesion (112/112) para comprobar que la recompilacion no
rompia su trabajo. Guardian de UX intacto en 11/11. Sin migraciones.
**Riesgo residual:** el dashboard y los apartados siguen sumando ventas por su
cuenta; no se tocaron porque sus cifras no son las senaladas y cambiarlas habria
movido numeros que nadie pidio mover. Migrar esas cinco sumas restantes es
trabajo con historia propia. La utilidad estimada se calcula ahora sobre el
importe que incluye los cambios: es coherente, pero es un numero que se movio sin
pedirse. «Dinero cobrado» seguira siendo menor que «Ventas brutas» cuando haya
apartados con saldo, y eso no es descuadre.
**Despliegue:** artefacto servido por GitHub Pages verificado byte a byte a la
primera: SHA-256 `12355d0b0db9481b6f64cacdbd68cf585235db820c0edc7f1ce19fdbb2b5b6ce`, 8 723 393 bytes. Comprobado
ademas contra el `.jsx` servido, donde el codigo vive de verdad.
**Pendiente:** H-50 —los tres reportes que exige el Contrato § 7—, donde se
mostrara `noAprovechado`.
**Correccion documentada:** `docs/fixes/ingreso-del-cambio-en-reportes.md`.

## Regla de actualización

Al cerrar cualquier trabajo:

1. Actualizar la entrada, incluso si quedó parcialmente resuelta.
2. Registrar commit, fecha y pruebas realmente ejecutadas.
3. Expresar el pendiente y riesgo residual; usar `Ninguno conocido` solo con
   evidencia suficiente.
4. Enlazar el archivo correspondiente de `docs/fixes/`.
5. No comenzar otro riesgo hasta completar esta actualización.
