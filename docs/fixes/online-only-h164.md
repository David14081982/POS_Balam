# BALAM comercial online-only: una autoridad y confirmación remota

**Riesgo:** H-164

**Estado:** EN IMPLEMENTACIÓN

**Fecha:** 12/09/2026, Hermosillo

**Commit:** Pendiente de commit

**Publicado:** NO

**Certificación distribuida:** NO CERTIFICADO

## Problema y reproducción

El usuario reportó 14 equipos para tres puestos operativos, un pendiente y un
bloqueado después de Punto Cero, un aviso de cliente antiguo y una actualización
impedida por un diálogo invisible. La lectura inicial de Supabase encontró
14 instalaciones, 13 retiradas y una no retirada. La restante declaraba cola
1/1 y recuperación pendiente, aunque su protocolo y esquema eran compatibles.
Ese dato remoto no demuestra qué contiene el navegador físico ni permite
calificar la operación como fantasma.

Las sondas sobre las funciones existentes y el artefacto H163 reprodujeron el
ciclo de reactivación y la guarda de diálogo cerrado. La evidencia inicial se
conserva en [la evaluación histórica](evaluacion-arquitectura-sincronizacion-h164.md)
y [su resumen](evidence/h164-diagnostic-summary.json).

El propietario aprobó expresamente retirar toda capacidad comercial offline y
autorizar código, SQL, migraciones aditivas, pruebas, CI y publicación. Su última
instrucción exige conservar la presentación visual. La comparación inicial
entre local-first, cloud-first y online-only es historia; la decisión vigente
es [ADR-015](../architect/decisions/ADR-015-autoridad-comercial-online.md).

## Causa raíz

La arquitectura anterior admitía una confirmación local distinta de la
confirmación comercial remota. DATA y varios consumidores modificaban objetos
vigentes, persistían colecciones y mostraban éxito antes de que Supabase
aceptara la operación. CONFIG publicaba cambios y backfills locales; AUTH podía
recuperar permisos cacheados. Hacer async únicamente el botón no corregía las
referencias vivas ya modificadas.

La recuperación añadía un ciclo comprobado: SQL exigía reconstruir antes de
escribir; el heartbeat exigía cola vacía para liberar la reactivación; una
intención pendiente impedía aplicar ese dominio durante la reconstrucción.
El Centro mezclaba instalaciones retiradas con equipos y el cliente no trataba
`data:false` como rechazo de presencia. La guarda PWA encontraba drawers
montados con `role=dialog` aun estando cerrados.

Los inventarios versionados distinguen expresamente los hallazgos de la fuente
inicial y el contrato implementado: [DATA](evidence/h164-data-inventory.md),
[CONFIG y consumidores](evidence/h164-config-inventory.md) y
[autoridad SQL](evidence/h164-server-retirement.md).

## Diseño

La única confirmación comercial procede de Supabase:

`usuario → solicitud → Supabase/RPC → recibo → lectura autoritativa → UI → éxito`.

STORE ejecuta comandos con UUID estable, usuario esperado y dispositivo activo.
El servidor valida permisos, versiones, existencias y cotización antes de
confirmar. Un rechazo revierte los efectos; una respuesta perdida se consulta
por el mismo UUID. Si el UUID no llegó, el resolvedor registra su cancelación
atómica para impedir que una solicitud atrasada confirme después.

El navegador sólo conserva referencias técnicas de resultado
(`requestId`, `userId`, `kind`, `fingerprint`), sin payload para reproducción.
La promesa original del formulario espera la resolución autoritativa; el
mensaje es «Estamos confirmando la operación. No la repitas.». Los cambios de
sesión invalidan callbacks y el servidor exige `expectedActorId=auth.uid()`.

DATA y CONFIG se reconstruyen desde un snapshot remoto completo. Sus
colecciones son efímeras; sus lectores no entregan referencias con las que
un consumidor pueda modificar la proyección confirmada. Los borradores no
producen efectos comerciales. Perder Realtime sólo retrasa la lectura: foco,
reconexión, recarga y consulta periódica vuelven a la misma autoridad.

Sin conectividad real con Supabase se deshabilitan escrituras y se muestra
«Sin conexión. BALAM necesita internet para continuar.». Reconectar exige
presencia aceptada, permisos remotos y reconstrucción del estado antes de
habilitar la operación. No existe cola offline nueva ni fallback comercial.

Auth y PostgreSQL necesitan un recibo de coordinación en servidor porque son
servicios distintos. La cuenta se reserva antes de Auth; el marcador verificado
y el comando de perfil congelado permiten resolver el resultado. Una cuenta
incierta queda aislada sin reproducir una cola ni bloquear otros dominios.
Las contraseñas no se guardan en el recibo.

Se preservan fórmulas y documentos históricos, RLS, permisos, folios y aliases,
inventario V1/V2, barcode V3, precios y comisiones congelados, Excel, reportes,
etiquetas e impresión. Los préstamos conservan su contrato existente sin
movimiento de stock. Los cambios visuales se limitan al comportamiento de
guardas, accesibilidad, disponibilidad y contenido técnico obsoleto dentro de
la composición existente.

## Solución

### Matriz de alcance implementado

Se convirtieron **19/19 familias de comandos previstas en servidor**. Son
familias de responsabilidad, no 19 pruebas ni un conteo de pantallas. DATA
expone **32 entradas comerciales convertidas**, más dos asignadores de folio,
un helper de liquidación y una frontera interna de confirmación: 36 funciones
async. CONFIG tiene **14 mutadores públicos** preparados en borrador y
confirmados por la misma frontera. Estos conteos se superponen y no se suman.

| Familia | Ruta online implementada | Protección principal |
|---|---|---|
| Productos e inventario V1/V2/V3 | `upsert/products`, bajas y vaciado autorizado | CAS, identidad, familia/barcode y restricciones históricas |
| Clientes | `upsert/clients`, `softDelete/clients` | CAS y agregados de compras protegidos |
| Promociones y descuentos | Promoción versionada y cotización de venta/cambio | Configuración, ventanas y promociones vigentes |
| Perfiles y vendedores | `profileUpdate`, baja de perfil | CAS, última administración y agregados financieros |
| Cuentas Auth | `admin-users` y perfil por gateway | Recibo servidor sin secretos y objetivo reservado |
| Configuración y catálogos | `config`, `sizeMigration` | Versión remota y cambios conjuntos atómicos |
| Ventas y partidas | `sale` | Documento, producto/versiones, importes y reserva SQL |
| Pagos y abonos | `sale` en modo pago | Identidad propia y versión del documento bajo lock |
| Apartados | Alta por `sale`, liquidación checked | Recibo de liquidación distinto del apartado |
| Devoluciones | `return` checked | Saldo retornable y documento; replay legacy rechazado |
| Cambios | `exchange` checked | Saldos, productos y cotización vigentes |
| Préstamos | `loanOperation` | Versión del documento y referencias activas |
| Stock, movimientos y reclasificaciones | Efectos transaccionales y `referenceReclassification` | Servidor decide existencias y registra movimientos |
| Comisiones y liquidaciones | Settlement, cierre, ajuste y documentos | Autoridades financieras y base remota del período |
| Folios | `folio` | Reserva remota individual y formato histórico |
| Tarjeta física | Consulta y claim remoto | Idempotencia y validación existente |
| Permisos | `permissions` | Dos RPC nominales permitidas, controles existentes |
| Equipos | `deviceUpdate`, `deviceRetire` | Administración y presencia sin reactivar por heartbeat |
| Limpieza administrativa autorizada | Respaldo, Punto Cero y limpieza selectiva | Preview, respaldo, confirmaciones y preproducción |

Los 14 mutadores CONFIG son `addItem`, `updateItem`, `setActive`, `removeItem`,
`move`, `setCatalogMeta`, `moveSkuOrder`, `addCatalog`, `removeCatalog`,
`importCatalogs`, `setSetting`, `setSettings`, `renameSizeCodes` y `reset`.
`load`, `clearRemote` y `prepareMutation` aplican o preparan estado; no confirman
por sí mismos una operación. El detalle nominal de las 32 entradas DATA está
en su inventario versionado.

### Clasificación de mecanismos

«SE ELIMINA» describe el runtime final preparado. El retiro remoto aún necesita
activación; no se afirma que los navegadores físicos ya hayan sido migrados.

| Mecanismo | Clasificación | Tratamiento |
|---|---|---|
| Sync Engine comercial, replay, reintento offline y escritor local | SE ELIMINA | STORE sustituido por coordinación online; sin fallback |
| Colas comerciales nuevas, pending, blocked y shadow writes | SE ELIMINA | No se crean operaciones comerciales locales |
| `save*`, persistencia DATA y colecciones comerciales localStorage | SE ELIMINA | Arranque remoto; originales legacy sólo se retiran tras ACK de archivo |
| IndexedDB `balam_sync/durable_queue` | SE ELIMINA | Leer/archivar evidencia exacta; retirar sólo registros iguales al original archivado |
| Journals de venta y locks locales de apartado | SE ELIMINA | Recibo idempotente y exclusión en servidor |
| Reservas de folios y período comercial local | SE ELIMINA | Asignación y período derivados de autoridad remota |
| Caché CONFIG y permisos comerciales persistidos | SE ELIMINA | Configuración y acceso se consultan remotamente |
| Demo, seeds y resets comerciales locales | SE ELIMINA | Sin capacidad comercial offline en hosts de desarrollo |
| Cursores, epochs, protocol y rebootstrap del navegador | SE ELIMINA | No gobiernan lecturas ni escrituras online |
| `applyRemote`, `mergeRemote` y reconciliación local parcial | SE ELIMINA | Reemplazo completo de proyección desde snapshot |
| Tombstones y avisos stale como proyección local | SE ELIMINA | Eliminación y vigencia proceden del snapshot remoto |
| PWA caches con respuestas comerciales | SE ELIMINA | APIs excluidas; archivo conservador de respuestas legacy legibles |
| UI de queue, dominios, rebootstrap y falsos avisos de actualización | SE ELIMINA | Centro existente muestra estado de conexión y equipos |
| Heartbeat, build, usuario y última conexión | SE CONSERVA SÓLO PARA TELEMETRÍA | ACK `false` nunca equivale a presencia aceptada |
| Instalaciones retiradas y antiguos estados de flota | SE CONSERVA POR HISTÓRICO | Separados de equipos activos; no cuentan como puestos operativos |
| `sync_activity`, quarantine, conflictos y recovery evidence | SE CONSERVA POR HISTÓRICO | Evidencia para conciliar; sin consumidor de replay |
| Originales locales archivados y decisiones por operación | SE CONSERVA POR HISTÓRICO | Hash/original verificables; confirmado, descarte autorizado o revisión |
| Migraciones previas, respaldos, comprobantes y aliases | SE CONSERVA POR HISTÓRICO | Compatibilidad y trazabilidad; no reconstruyen una realidad local |
| Identidad técnica del dispositivo, preferencias y tokens SDK | SIGUE SIENDO NECESARIO | No contienen autoridad comercial; permisos se revalidan |
| Borradores React, preview Excel e imágenes sin guardar | SIGUE SIENDO NECESARIO | Sin efectos; éxito sólo después de confirmación |
| HTML, JS, CSS, iconos, fuentes y recursos de impresión | SIGUE SIENDO NECESARIO | PWA estática; la cola técnica de impresión no es cola comercial |
| Proyección completa en memoria y Realtime | SIGUE SIENDO NECESARIO | Rendimiento visual; nunca sustituyen validación remota |
| Recibos online, CAS, locks SQL, reservas de stock y saldo por renglón | SIGUE SIENDO NECESARIO | Concurrencia, idempotencia y autoridad servidor |
| `sync_devices` como registro administrativo de retiro | SIGUE SIENDO NECESARIO | La exclusión del dispositivo se valida en servidor |
| Versiones SQL de configuración y manifiesto de esquema/V3 | SIGUE SIENDO NECESARIO | Contrato interno de autoridades; sin cursor comercial local |

El [inventario SQL exhaustivo](evidence/h164-server-retirement.md) clasifica las
tablas y funciones por firma. La activación prevista retira 19 funciones,
26 triggers de cursores y EXECUTE público de 31 nombres de RPC mutadores;
revoca toda escritura directa de clientes en tablas `pos`. Conserva tablas y
filas comerciales. Esos conteos corresponden al catálogo auditado hasta 207 y
a 208; las correcciones aditivas posteriores deben mantener el inventario.

### Archivos y entrega

`balam/data.jsx`, `store.jsx` y `core.jsx` definen preparación, transporte y
proyección. Los consumidores de POS, inventario, Excel, clientes, vendedores,
devoluciones/cambios, apartados, préstamos y promociones esperan confirmación.
`config.jsx`, `auth.jsx`, `settings.jsx` y `permissions.jsx` retiran persistencia
y autorizaciones locales. `pwa.jsx`, `shared.jsx`, `app.jsx` y los drawers
corrigen disponibilidad, mensajes y diálogo huérfano. `admin-users/index.ts`
coordina Auth/perfil con recibo e identidad de usuario esperada.

La revisión final corrigió tres grupos de defectos adicionales: callbacks de
teclado CONFIG y formularios de cliente que perdían su promesa; un guardado de
ajuste que normalizaba sin intención el orden del catálogo remoto; el error de
logo que ocultaba el rechazo online bajo un mensaje de lectura de imagen.
Ahora se preserva `sort_order` para códigos y orden sin cambios, el error
original llega al mensaje común y los callbacks conservan su confirmación.
La revisión de flota contrastó el CHECK real: sólo `status='revoked'` indica
retiro; `metadata.retired_at` permanece como histórico después de reactivar.
El Centro conserva ese criterio y devuelve la promesa de reactivación con
`retired=false`. La regresión usa dos registros revoked y uno online con fecha
histórica de retiro; no inventa columnas ni estados del servidor.
No se modifican estilos ni composición visual.

La migración 208 añade autoridad y activación; 209 contiene verificación con
rollback. 210 corrige clasificación y descarte legacy; 211 verifica esos casos.
Las cuatro migraciones están aplicadas en Supabase y las verificaciones reales
209/211 pasaron mediante `db push`. El cerco permanece `enabled=false` hasta
la activación de entrega. `admin-users` está desplegada mediante la API, con
verificación JWT habilitada; eso no equivale a publicar el cliente Pages.

El fallo inicial de 209 quedó reproducido con un migrador NOINHERIT:
`RESET ROLE` perdía el rol efectivo de migración. La corrección conserva
`migration_owner:=current_user` y restaura ese rol exacto tras cada fixture.
No cambia ACL para obtener un PASS. La lectura posterior confirmó cero
requests, archivos legacy, operaciones archivadas y fixtures filtrados.

CI reemplaza los workflows activos H148/H132 y la publicación H157 por H164;
conserva pruebas históricas útiles. Valida arquitectura, SQL, transporte,
dominios, configuración, Auth, mensajes y artefacto UI. Publicación y A/B/C
consumen el artefacto construido y probado. El retiro y sus límites están en
[la evidencia CI](evidence/h164-ci-retirement.md).

## Pruebas

No se ejecutaron suites durante esta actualización documental. Se registra
la evidencia ya producida, con una ejecución por escenario distinto; sólo los
casos afectados se repiten cuando cambia su contrato o aparece un fallo.

| Evidencia | Resultado registrado | Límite |
|---|---|---|
| `node test-h164-data-online.mjs` y selecciones afectadas | 34 casos distintos PASS; almacenamiento comercial 0 accesos | Frontera DATA con transporte controlado, no A/B/C real |
| `node test-h164-online-transport.mjs`, selecciones afectadas | 13 casos finales registrados PASS; preservación de catálogo verificada en el caso afectado | Transporte controlado; no reemplaza certificación real |
| `node test-h164-online-config.mjs` | CONFIG, AUTH y PWA: 3 escenarios PASS | No acredita adopción de equipos físicos |
| `node test-h164-online-account.mjs` | PASS: Auth/perfil una escritura tras ACK perdido; sesión cruzada 0 escrituras | Servicios controlados, no saga remota certificada |
| `node test-h164-online-messages.mjs` | PASS | Clasificación y mensajes exactos |
| `node test-h164-online-identity.mjs` | 1 PASS | Persistencia de identidad técnica, sin instalación volátil |
| `node test-h164-online-settings.mjs`, selecciones `keyboard`, `logo`, `fleet` | 3 escenarios distintos PASS: feedback Enter, error original de logo y retiro/reactivación | Se ejecutó una vez cada caso afectado; handlers reales y frontera async controlada |
| `node test-h164-ui-callbacks.mjs` | 1 PASS registrado por propietario DATA: formularios cliente conservan Promise | Frontera de callbacks; sin repetir suite UI general |
| `node test-h164-online-architecture.mjs` | PASS sobre módulos runtime, consumidores y guardas de almacenamiento | Análisis estático; no demuestra comportamiento remoto |
| YAML, scripts package y correspondencia lock | PASS de validación CI | No equivale a una ejecución de GitHub Actions |
| PostgreSQL PGlite reconstruido desde catálogo real | PASS de 208→209 corregida→210→211, con ACL reales de esquema y funciones | Sin filas productivas ni certificado de servidor publicado |
| Migraciones remotas 208/209/210/211 | APLICADAS por `db push`; verificaciones 209/211 PASS | Autoridad preparada; `online_runtime.enabled=false` |
| Regresión de contexto de migración | Fallo inicial reproducido con migrador NOINHERIT; restauración exacta del rol efectiva en 209/211 | Se corrigió la verificación sin ampliar ACL |
| Inspección remota posterior | 0 requests, 0 archives, 0 operaciones legacy y 0 fixtures filtrados | No acredita archivo de los tres navegadores físicos |
| Edge `admin-users` | DESPLEGADA mediante API; verificación JWT habilitada | Saga real A/B/C pendiente de certificar |
| `node test-h164-online-ui.mjs`, selecciones de escenario | Drawer, V2, Excel, clientes, reportes y conservación del formulario: PASS registrados por selección | Fixture de lectura; fallos de aislamiento del arnés corregidos sin repetir escenarios aprobados |
| `node test-h164-online-pwa.mjs` | 2 escenarios distintos PASS: ciclo general y activación que conserva evidencia comercial legacy | Ciclo general con SW generado; activación adicional con fuente actual; artefacto final pendiente |
| Artefacto final y matriz A/B/C real | PENDIENTES de incorporar evidencia final | NO CERTIFICADO |

No hay un resultado «MULTITERMINAL PASS», «DIVERGENCIAS 0» ni «PENDIENTES
FANTASMA 0» acreditado en esta versión del informe. El historial de ejecuciones
DATA está registrado en el inventario; no se inventa un archivo de stdout que
no se conservó. Raíz incorporará las salidas finales y hashes antes de cierre.

El corte UI/PWA de las selecciones terminadas corresponde al HTML
`8ba81e3071422f64f4924a2d72c06f3b6ae03786ed6c41f1cc0d7a55adf603b1`.
Las salidas `online-ui-2026-09-12T07-03-55-166Z.json`,
`online-ui-2026-09-12T07-05-38-848Z.json`,
`online-ui-2026-09-12T07-07-52-748Z.json` y
`online-pwa-2026-09-12T07-06-49-551Z.json` están en `.evidence-h164/`.
Conservan también los fallos intermedios del arnés y los hashes de módulos.
No se usa ese corte como certificado de un artefacto posterior o de Pages.
La regeneración final vuelve a quedar pendiente después de corregir los
callbacks de teclado CONFIG y formularios de cliente; no se atribuye esa
corrección de fuente a los bytes anteriores.
`online-pwa-2026-09-12T07-17-40-994Z.json` registra el segundo escenario:
activación con `activationUsesSource:true`, para verificar la fuente nueva
sin repetir el caso general que ya había pasado.

## Riesgo residual y pendientes

1. Activar el cerco y publicar después de completar la entrega del artefacto
   probado. 208/209/210/211 están aplicadas y verificadas; los clientes antiguos
   todavía no se consideran retirados remotamente.
2. Comprobar adopción del archivo legacy en navegadores reales. SQL 210/211 ya
   exige IDs capturados/descartados y revisión explícita de fuentes no
   interpretables; ese PASS no clasifica las colas físicas aún no inspeccionadas.
3. Inspeccionar y archivar las colas de los tres equipos reales. Una operación
   confirmada requiere recibo coincidente; un descarte requiere autorización
   específica. Si existe operación real no reconciliable, detener sólo esa
   operación para decisión. No vaciar el navegador indiscriminadamente.
4. Ejecutar una matriz A/B/C independiente sobre artefacto final y Supabase
   real, con una muestra de cada escenario requerido: dominios, última pieza,
   versiones/devolución/cambio/préstamo/apartado concurrentes, recarga,
   reapertura, Realtime ausente, Internet perdido/restaurado y ACK perdido.
   Conservar comparación de autoridad, recibos, stock y ausencia de nueva cola.
5. Identificar y adoptar los tres puestos físicos. Tres contextos QA no prueban
   qué instalaciones antiguas corresponden a esos puestos ni resuelven sus
   datos locales por sí solos.
6. Verificar artefacto publicado, versión activa y resultado de CI; registrar
   commit y Pages exactos. No reemplazar esas verificaciones con prueba aislada
   de fuente ni declarar que un build local está publicado.

No se ha detectado pérdida física por la clasificación legacy: los originales
se conservan en archivo remoto antes de retirar la copia. Sin inventario real
de A/B/C, **DATOS PERDIDOS: 0** y **COLAS LEGACY RESUELTAS** siguen sin certificarse.
El objetivo de cierre continúa siendo online-only completo, autoridad Supabase
y cero divergencias demostradas; **BALAM CERRABLE: NO** en este corte.

## Referencias

- [H-164 en riesgos conocidos](../03-known-risks.md#h-164--estados-de-equipos-y-recuperación-sin-salida-operativa).
- [Arquitectura vigente](../02-architecture.md), [autoridad](../architect/authorities/synchronization.md) y [certificación A/B/C](../architect/playbooks/synchronization.md).
- [Inventario DATA](evidence/h164-data-inventory.md), [CONFIG](evidence/h164-config-inventory.md), [SQL](evidence/h164-server-retirement.md) y [CI](evidence/h164-ci-retirement.md).
- [Evaluación inicial histórica](evaluacion-arquitectura-sincronizacion-h164.md).
