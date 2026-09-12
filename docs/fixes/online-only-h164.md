# BALAM comercial online-only: una autoridad y confirmación remota

**Riesgo:** H-164

**Estado:** IMPLEMENTADO Y PUBLICADO; CERTIFICACIÓN FÍSICA PENDIENTE

**Fecha:** 12/09/2026, Hermosillo

**Commit de implementación base:** `95714cfdcb5324fe71dd23f9bf4a57632bfb325b`

**Commit técnico publicado:** `df4965b1269239665594eca722c38c9adb86cb68`

**Corrección histórica del arnés PDF:** `0f05350fd286f175fce7bfcab5c04159cc01cb02`

**Evidencia documental:** referida al commit técnico publicado; entrega documental separada

**Publicado:** SÍ; Pages y activación Supabase verificadas

**Certificación técnica A/B/C:** PASS; 20/20 escenarios y retiro QA completos

**Certificación de los equipos físicos:** NO CERTIFICADO

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

La lista comercial explícita del usuario contiene 18 ámbitos, cubiertos por
12 de esas familias. Las otras siete incorporan perfiles/vendedores, Auth,
folios, tarjeta física, permisos, equipos y limpieza administrativa. Por tanto,
**18/18 ámbitos solicitados tienen ruta online**, dentro de **19/19 familias
de alcance**; no son 19 RPC individuales ni 19 escenarios. Esta cobertura de
código no sustituye las pruebas ni la conciliación física.

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

«SE ELIMINA» describe el runtime publicado y el retiro remoto activado. No se
afirma que los navegadores físicos ya hayan sido inventariados o migrados.

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
tablas y funciones por firma. La activación verificada retiró 19 funciones,
26 triggers de cursores y EXECUTE público de 31 nombres de RPC mutadores;
revocó toda escritura directa de clientes en tablas `pos`. Conserva tablas y
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
209/211 pasaron mediante `db push`. `admin-users` está desplegada mediante la
API, con verificación JWT habilitada. Después de verificar los bytes de Pages,
se activó el cerco online-only en Supabase; una transacción independiente de
sólo lectura confirmó su estado y las revocaciones. Los datos exactos están
en la sección de entrega verificada.

El fallo inicial de 209 quedó reproducido con un migrador NOINHERIT:
`RESET ROLE` perdía el rol efectivo de migración. La corrección conserva
`migration_owner:=current_user` y restaura ese rol exacto tras cada fixture.
No cambia ACL para obtener un PASS. La lectura previa a activar confirmó cero
requests, archivos legacy, operaciones archivadas y fixtures filtrados.

CI reemplaza los workflows activos H148/H132 y la publicación H157 por H164;
conserva pruebas históricas útiles. Valida arquitectura, SQL, transporte,
dominios, configuración, Auth, mensajes y artefacto UI. Publicación y A/B/C
consumen el artefacto construido y probado. El retiro y sus límites están en
[la evidencia CI](evidence/h164-ci-retirement.md).

### Entrega verificada

El commit base `95714cf` contiene la conversión; `0f05350` corrigió la espera
del arnés PDF y su CI 34681857847 pasó. El commit técnico definitivo publicado
es **`df4965b1269239665594eca722c38c9adb86cb68`**, que incorpora 212/213 y el
cierre del arnés. [CI 34683481979](https://github.com/David14081982/POS_Balam/actions/runs/34683481979)
terminó con regresiones y despliegue **SUCCESS**. UI 6/6 y PWA 2/2 pasaron
con el artefacto generado y el Service Worker final
(`activationUsesSource:false`). El job live se omitió intencionalmente:
su matriz certificada ya había terminado y no se repitieron los 20 escenarios.

La verificación de [Pages](https://david14081982.github.io/POS_Balam/) del
12/09/2026 a las **08:34:42.109 UTC** comprobó igualdad exacta entre commit y
publicación. La [evidencia original](evidence/h164-online-pages.json) se conserva
sin transformar:

| Archivo | SHA-256 publicado y esperado | Resultado |
|---|---|---|
| `index.html` | `25bc985dce9bbe92e83f8dc9c61c6f1cf90fd0b1904dfe09d7bdfd594201d96f` | MATCH |
| `sw.js` | `5b43e72ad8fe5ca2a398f75530057010420ddfbdb4ccf730fcc4f535424d06b1` | MATCH |

Supabase activó online-only a las **07:56:55.112624 UTC**. La comprobación
independiente de las **07:57:26.320080 UTC** confirmó `onlineOnly:true`,
contrato 1, 35 guardas de gateway, 19 funciones retiradas, 26 triggers de
cursores retirados, cero grants de escritura directa y cero grants de RPC
legacy para navegadores. Permanecen 63 tablas y 152 funciones `pos`.
La [evidencia de activación](evidence/h164-server-activation.json) registra
cero fuentes legacy recibidas: **no demuestra cero pendientes locales**.
La publicación y la activación técnica no certifican por sí solas los tres
equipos físicos ni la matriz comercial A/B/C.

La [inspección final del servidor](evidence/h164-server-final-verification.json)
de las **08:22:40.462767 UTC**, posterior a 212/213, volvió a confirmar
online-only activo, las seis migraciones 208–213, cero grants comerciales
directos/legacy y las cuatro conversiones JSON opcionales. No ejecutó ninguna
operación comercial. Conserva el mismo límite: cero fuentes recibidas no
certifica el contenido de los navegadores físicos.

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
| `node test-migrations.mjs`, después de 212/213 | 31 comprobaciones PASS | Cuenta comprobaciones de cadena, no migraciones ni dominios |
| PostgreSQL PGlite reconstruido desde catálogo real, CI 34683481979 | PASS de 208–213, con ACL reales de esquema y funciones | Sin filas productivas; separado de la verificación Supabase real |
| Migraciones remotas 208/209/210/211 | APLICADAS por `db push`; verificaciones 209/211 PASS | La activación posterior se verifica por separado |
| Migraciones remotas 212/213 | APLICADAS; corrección y verificación de objetos JSON opcionales PASS | Corrigen el gateway SQL sin cambiar el HTML publicado; no amplían permisos |
| Regresión de contexto de migración | Fallo inicial reproducido con migrador NOINHERIT; restauración exacta del rol efectiva en 209/211 | Se corrigió la verificación sin ampliar ACL |
| Inspección remota previa a activar | 0 requests, 0 archives, 0 operaciones legacy y 0 fixtures filtrados | Corte histórico de preparación; no acredita archivo de navegadores físicos |
| Edge `admin-users` | DESPLEGADA con JWT habilitado; alta exacta y permiso QA comprobados en la matriz real | Los escenarios remotos y los de ACK perdido controlado conservan alcances distintos |
| `node test-h164-online-ui.mjs`, CI 34683481979 | 6/6 PASS sobre el HTML publicado: drawer, V2, Excel, clientes, reportes y conservación del formulario | Fixture de lectura; sin escrituras reales ni impresora física |
| `node test-h164-online-pwa.mjs`, CI 34683481979 | 2/2 PASS con HTML y SW publicados: ciclo de conexión y conservación de evidencia legacy al activar | Chromium y API de prueba; no es una operación comercial Supabase |
| CI 34683481979 | Regresiones y despliegue SUCCESS; live omitido intencionalmente | Matriz live certificada conservada, sin repetir sus 20 escenarios |
| Bytes de Pages | HTML y SW MATCH con commit técnico publicado | Verificación independiente 08:34:42.109 UTC |
| Activación remota e inspección independiente | PASS: online-only activo, grants directos/legacy 0; 19 funciones y 26 triggers retirados | Cero archivos recibidos no significa cero pendientes legacy |
| Inspección final de servidor, 08:22:40.462767 UTC | PASS de sólo lectura: 208–213, autoridad activa, ACL y cuatro conversiones opcionales | Sin operaciones comerciales; inventario físico pendiente |
| Matriz comercial A/B/C real, posterior a 212/213 | 20/20 escenarios PASS y `certified:true`; retiro QA terminado; se conserva el rechazo inicial de abonos | Tres contextos Chromium independientes; adopción física NO CERTIFICADA |

La matriz acredita **MULTITERMINAL PASS** y comparación de autoridad sin
divergencias dentro de los tres contextos QA ejecutados. No acredita
«PENDIENTES FANTASMA 0» ni ausencia de divergencias en equipos físicos no
inspeccionados. El historial de DATA está registrado en su inventario; no se
inventa un stdout adicional. CI conserva salidas y hashes en sus artifacts;
`.evidence-h164/ci-34683481979/` contiene la copia de la ejecución final y
`.evidence-h164/ci-34681857847/`, la de la entrega anterior.

El corte UI/PWA histórico de las selecciones iniciales corresponde al HTML
`8ba81e3071422f64f4924a2d72c06f3b6ae03786ed6c41f1cc0d7a55adf603b1`.
Las salidas `online-ui-2026-09-12T07-03-55-166Z.json`,
`online-ui-2026-09-12T07-05-38-848Z.json`,
`online-ui-2026-09-12T07-07-52-748Z.json` y
`online-pwa-2026-09-12T07-06-49-551Z.json` están en `.evidence-h164/`.
Conservan también los fallos intermedios del arnés y los hashes de módulos.
No se usa ese corte como certificado de un artefacto posterior o de Pages.
La regeneración posterior y CI 34681857847 sustituyen ese corte para la entrega;
no se atribuyen las correcciones de callbacks a los bytes anteriores.
`online-pwa-2026-09-12T07-17-40-994Z.json` registra el segundo escenario:
activación con `activationUsesSource:true`, para verificar la fuente nueva
sin repetir el caso general que ya había pasado.

El run CI `34681661766` del commit `95714cf` detectó una espera insuficiente
del arnés V2: se comprobaba `isEnabled()` inmediatamente después de que el
botón de PDF fuera visible. `LabelModal` prepara el PDF mediante
`buildLabelPdf(...).then(...)`; mientras tanto muestra «Generando PDF…» y
mantiene el botón deshabilitado. La captura de CI conservó ese estado, el
barcode visible y `errors: []`. Se corrigió únicamente el arnés para esperar
hasta 30 segundos a que el botón real esté habilitado, manteniendo las
aserciones de certificación, identidad, PNG, encabezado PDF y SKU contenido.
La ejecución focalizada `BALAM_UI_CASE=V2/barcode` obtuvo **1 PASS** sobre el
HTML `25bc985dce9bbe92e83f8dc9c61c6f1cf90fd0b1904dfe09d7bdfd594201d96f`,
sin build ni cambio comercial. Evidencia:
`.evidence-h164/online-ui-2026-09-12T07-50-42-130Z.json`; el fallo de CI se
conserva en `.evidence-h164/ci-34681661766/`. Este PASS focalizado no acredita
por sí solo el resto del pipeline ni la matriz remota A/B/C. El pipeline
posterior 34681857847 sí terminó aprobado sobre el mismo HTML.

### Verificación comercial posterior a activar

La primera invocación live se detuvo antes de Auth por su comprobación del
marcador de build comprimido. Corregido el arnés, la ejecución posterior
registró **14 casos PASS**. El caso 15, competencia entre abonos de apartado,
rechazó las dos solicitudes; no confirmó ningún cobro en ese escenario.

El diagnóstico SQL comprobó una diferencia entre `null` JSONB y `NULL` SQL
en el parámetro opcional `p_client_effect` del gateway. El cliente sí existe;
el rechazo no demuestra ausencia del cliente ni duplicidad de cobro. La
migración [212](../../supabase/migrations/20260912021200_pos_h164_optional_json_null.sql)
normaliza únicamente los cuatro parámetros de objeto cuyo contrato SQL ya
admitía ausencia: tres efectos de cliente y el pago opcional del cambio.
Los arrays obligatorios, pago de liquidación, hashes, recibos, CAS y ACL
conservan sus contratos. [213](../../supabase/migrations/20260912021300_pos_h164_optional_json_null_verification.sql)
verifica esa frontera con autoridades financieras reales y fixtures revertidos.
**212 y 213 están aplicadas en Supabase y sus comprobaciones pasaron**.
La corrección no cambió el cliente publicado ni requirió regenerar su HTML.

La continuación conservó y omitió los 14 escenarios ya aprobados. Repitió
únicamente el caso afectado: apartado, competencia entre abonos y liquidación
**PASS**. El siguiente caso, liquidación de comisión, también obtuvo **PASS**.
Después pasaron corte de Internet/reconexión, recarga/reapertura, conservación
de historia y separación de instalaciones QA retiradas: **20/20 escenarios
funcionales PASS**. El historial privado contiene 21 filas porque conserva el primer
rechazo de abonos; no son 21 escenarios distintos.

El bloque final de retiro de perfiles QA falló por el permiso del helper
`is_active_seller` bajo `service_role`. Se corrigió únicamente esa finalización
y se completó el retiro exacto, sin repetir los 20 escenarios, abrir otro
navegador ni modificar permisos del producto. El recibo confirma cinco perfiles
QA desactivados, otros perfiles e historia financiera sin cambios y dos cuentas
Auth bloqueadas. No hubo rotación de credenciales ni reactivación de cuentas.
El resultado final es **`certified:true`**.

El [resumen público de la matriz](evidence/h164-live-online.json) contiene
build, hash del artefacto, fecha, nombres y resultados de los 20 escenarios,
el rechazo inicial resuelto y los conteos de retiro QA; declara
`scope.physical:false`. Los recibos, identificadores internos, comparaciones
detalladas y las 21 entradas originales permanecen en evidencia local privada.
La certificación técnica usa A/B/C Chromium contra Supabase real, con el HTML publicado
`25bc985dce9bbe92e83f8dc9c61c6f1cf90fd0b1904dfe09d7bdfd594201d96f`.

212/213 y el cierre del arnés están incluidos en el commit técnico publicado
`df4965b1269239665594eca722c38c9adb86cb68`. Su CI y verificación Pages pasaron;
el HTML comercial conserva los mismos bytes certificados por la matriz.

## Riesgo residual y pendientes

La [lectura de adopción](evidence/h164-device-adoption.json) de las
**08:32:19.260578 UTC** encontró 14 instalaciones comerciales registradas:
13 retiradas y una no retirada. **Ninguna había declarado el build online
nuevo**; las instalaciones QA activas y los archivos legacy recibidos eran cero.
Estos números describen registros, no identifican los tres puestos físicos.

El cliente nuevo sólo opera online y el cerco Supabase impide las RPC
comerciales antiguas. Sin embargo, una copia H163/PWA física todavía abierta
puede conservar su código y almacenamiento anteriores. Sin adoptarla e
inventariarla no se puede afirmar que produzca cero colas o cero mensajes de
éxito locales. El despliegue físico completo sigue pendiente.

1. Comprobar adopción del archivo legacy en navegadores reales. SQL 210/211 ya
   exige IDs capturados/descartados y revisión explícita de fuentes no
   interpretables; ese PASS no clasifica las colas físicas aún no inspeccionadas.
2. Inspeccionar y archivar las colas de los tres equipos reales. Una operación
   confirmada requiere recibo coincidente; un descarte requiere autorización
   específica. Si existe operación real no reconciliable, detener sólo esa
   operación para decisión. No vaciar el navegador indiscriminadamente.
3. Completar la adopción y comprobación de los puestos físicos A/B/C sobre el
   artefacto publicado y Supabase. La matriz técnica independiente ya pasó sus
   20 escenarios; no demuestra acceso a los navegadores reales ausentes.
4. Identificar y adoptar los tres puestos físicos. Tres contextos QA no prueban
   qué instalaciones antiguas corresponden a esos puestos ni resuelven sus
   datos locales por sí solos. El intento de acceso de sólo lectura al navegador
   físico mediante CDP no encontró un endpoint accesible. No se inventariaron
   sus almacenamientos ni se acredita la adopción de ninguno de los tres.
   Cargar el build publicado en cada puesto, archivar y conciliar su evidencia
   mediante el procedimiento implementado; no borrar almacenamiento manualmente.

La matriz verificó que las filas originales de su baseline permanecieran
sin cambios y conservó la historia comercial QA. Ese resultado no inspecciona
los originales legacy de los puestos físicos. Sin ese inventario,
**DATOS PERDIDOS: 0** global y **COLAS LEGACY RESUELTAS** siguen sin certificarse.
El objetivo de cierre continúa siendo online-only completo, autoridad Supabase
y cero divergencias demostradas; **BALAM CERRABLE: NO** en este corte.

## Referencias

- [H-164 en riesgos conocidos](../03-known-risks.md#h-164--estados-de-equipos-y-recuperación-sin-salida-operativa).
- [Arquitectura vigente](../02-architecture.md), [autoridad](../architect/authorities/synchronization.md) y [certificación A/B/C](../architect/playbooks/synchronization.md).
- [Inventario DATA](evidence/h164-data-inventory.md), [CONFIG](evidence/h164-config-inventory.md), [SQL](evidence/h164-server-retirement.md) y [CI](evidence/h164-ci-retirement.md).
- [Evaluación inicial histórica](evaluacion-arquitectura-sincronizacion-h164.md).
