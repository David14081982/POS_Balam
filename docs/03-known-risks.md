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

## Regla de actualización

Al cerrar cualquier trabajo:

1. Actualizar la entrada, incluso si quedó parcialmente resuelta.
2. Registrar commit, fecha y pruebas realmente ejecutadas.
3. Expresar el pendiente y riesgo residual; usar `Ninguno conocido` solo con
   evidencia suficiente.
4. Enlazar el archivo correspondiente de `docs/fixes/`.
5. No comenzar otro riesgo hasta completar esta actualización.
