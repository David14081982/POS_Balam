# H164 — inventario CONFIG y administración versionado

**Fecha del corte documental:** 12/09/2026, Hermosillo. **Estado:** EN IMPLEMENTACIÓN; NO CERTIFICADO.

Copia del inventario inicial `.evidence-h164/config-mutation-inventory.md`,
seguida abajo por su cuerpo histórico intacto. Las líneas iniciales y frases
«actualmente», «debe» o «propuesta» de ese cuerpo describen la fuente anterior.
El informe vigente es [online-only-h164.md](../online-only-h164.md).

## Contrato implementado

- CONFIG tiene 14 mutadores públicos: addItem, updateItem, setActive, removeItem,
  move, setCatalogMeta, moveSkuOrder, addCatalog, removeCatalog, importCatalogs,
  setSetting, setSettings, renameSizeCodes y reset. Preparan copias mediante
  prepareMutation y esperan CORE.execute/config antes de devolver éxito.
  load aplica snapshot remoto y clearRemote retira memoria al cambiar sesión;
  no son escrituras comerciales ni almacenan configuración en localStorage.
- removeCatalog envía productUpdates junto a config en una transacción.
  La migración de tallas confirma configuración, productos y promociones
  conjuntamente. Los lectores CONFIG devuelven copias.
- Settings espera CONFIG/DATA/Edge; no mantiene alta de cuentas, demo ni reset
  comercial offline. Fotografías/URLs de etiquetas se confirman como metadatos
  por saveProductRows después de cargar el recurso técnico. Los formularios
  conservan diseño, clases y composición visual.
- Permisos envía únicamente admin_sync_screen_permission_catalog y
  admin_apply_user_screen_permissions_checked por el gateway permitido.
  AUTH reconstruye perfil y permisos desde Supabase; no habilita escritura
  con balam_auth_access_v2 ni con un host de desarrollo.
- admin-users coordina Auth/perfil con recibo servidor, intención de perfil
  congelada y marcador Auth verificado. No persiste contraseñas. El usuario
  expectedActorId debe coincidir con el JWT antes de Auth y también en SQL.
- El Centro conserva su composición y separa equipos activos de instalaciones
  retiradas. Se retiran controles de queue, blocked, epoch, dominios y
  rebootstrap. Un heartbeat false no es aceptación.
- La guarda PWA exige diálogo abierto; los drawers cerrados son inert y
  aria-hidden. Se conserva el bloqueo de actividad real y resultado incierto.
  Mensajes exactos de conexión y confirmación tienen prioridad sobre causas
  genéricas que antes sugerían sincronizar/reintentar.
- localStorage sólo conserva preferencias, recursos técnicos, tokens y una
  identidad estable del equipo. La imposibilidad de persistir identidad no
  genera otra instalación volátil. No hay almacenamiento comercial autorizado.

## Evidencia registrada

- test-h164-online-config.mjs: tres escenarios CONFIG/AUTH/PWA PASS.
- test-h164-online-account.mjs: pérdida de respuesta tras commit se resuelve
  con una escritura Auth y una de perfil; sesión cruzada crea cero escrituras
  y cero recibos. PASS tras el cambio específico expectedActorId.
- test-h164-online-messages.mjs: precedencia de mensajes exactos PASS.
- test-h164-online-settings.mjs: una regresión focalizada PASS; Enter devuelve
  la promesa de CONFIG al wrapper común, presenta un único rechazo y mantiene
  borrador. Se corrigieron sólo tres returns; composición y estilos preservados.
- Revisión final posterior: LogoUploader conserva el error original para que
  el mensaje online no se convierta en error de imagen. El Centro reconoce
  sólo status=revoked conforme al CHECK real y devuelve la promesa de
  reactivación con false. Un equipo online con metadata.retired_at histórica
  sigue activo. La selección fleet fue ajustada al esquema real antes de
  certificarse; la hipótesis inicial de otros estados no es evidencia del
  servidor. Logo y fleet finales PASS, sin repetir teclado.
- STORE conserva sort_order remoto cuando códigos/orden no cambian, evitando
  normalizaciones comerciales al guardar un ajuste ajeno al catálogo. El
  propietario del transporte registró PASS del único caso afectado.
- No se ejecutaron otra vez estos escenarios para copiar el inventario.
  Pruebas finales del artefacto, identidad, PWA y A/B/C se incorporan al informe
  central al quedar verificadas; este documento no las acredita por anticipado.

## Inventario inicial conservado por histórico


Fecha: 2026-09-11. Alcance: lectura de fuente; no ejecución comercial remota ni modificación funcional. Ubicación de trabajo: `.h164-sync-evaluation`.

El contrato solicitado sustituye expresamente los requisitos local-first de ADR-006/012/014. Se conserva UI visual vigente; sólo cambian handlers, atributos funcionales, estados y mensajes indispensables. Las líneas corresponden a la fuente inicial de esta evaluación.

## CONFIG: frontera única actualmente optimista

`balam/config.jsx:298-390` carga `balam_config_v1`, aplica backfills, persiste y emite `configchange` antes de llamar `CORE.invokeSync('pushConfig', state)`. Captura el error como `offline`. El retorno actual acredita almacenamiento local, no confirmación remota.

Las siguientes mutaciones comparten esa frontera y deben preparar un draft aislado y esperar una transacción remota antes de modificar `state` o emitir:

| Mutación | Línea inicial | Dominio/efecto |
|---|---:|---|
| addItem | 585 | Catálogo: añade código/etiqueta/meta |
| updateItem / setActive | 594 / 609 | Catálogo: etiqueta, meta y activación |
| renameSizeCodes | 622 | Cambia identidad de talla; consumidor exclusivo de migración conjunta inventario+config |
| removeItem | 654 | Baja de elemento, protege referencias a través de guardas locales |
| move | 663 | Orden de catálogo |
| setCatalogMeta | 675 | Regla de referencia, formulario, SKU, obligatoriedad, filtros |
| moveSkuOrder | 695 | Orden de receta SKU |
| addCatalog | 719 | Crea catálogo custom y metadatos |
| removeCatalog | 731 | Baja catálogo y borra attrs de productos reales; actualmente DOS escrituras separadas |
| importCatalogs | 770 | Excel; upsert y desactivación de códigos ausentes |
| setSetting / setSettings | 825 / 826 | Toda configuración comercial, financiera, recibos y opciones POS |
| reset | 829 | Sustituye configuración por semilla |
| load | 833 | Aplicación remota; no debe persistir ni publicar backfills automáticamente |

`all`, `list`, `find`, `catalogMeta` retornan referencias superficiales/mutables; no deben permitir escribir estado confirmado fuera del contrato. `snapshot`, `settings`, `allCatalogMeta` sí clonan.

`removeCatalog` modifica `CORE.catalogProducts()` por referencia y llama `saveCatalogProducts` antes de borrar la configuración; se necesita operación SQL atómica para ambos efectos. `renameSizeCodes` es parte de `DATA.migrateSizeCodes`; no convertirla aisladamente en dos commits.

Backfill actual agrega valores comerciales faltantes, métodos de pago, beneficios, nombres y metadatos. Un lector online debe consumir autoridad; cualquier reparación persistente requiere migración/operación explícita en servidor. Semilla de presentación no puede convertirse silenciosamente en configuración actual.

## Consumidores de CONFIG en Settings

Archivo `balam/settings.jsx`; alias `C`.

| Superficie | Funciones/ubicaciones | Contrato pendiente |
|---|---|---|
| CatalogEditor | add 130; commitLabel/commitMeta 137-138; del 139; toggle 142; setMeta 146; delCatalog 165 | Await resultado; no limpiar formulario ni anunciar eliminación hasta confirmar |
| Cambios rápidos catálogo | blur 206; move 257-258 | Capturar rechazo/espera, mantener último valor confirmado |
| SkuBuilder | regenerateSkus 285; moveSkuOrder 301/303 | Await DATA y CONFIG |
| SizeCodeMigration | migrateSizeCodes 367 | Una RPC conjunta, no timers con mutación síncrona |
| FixControl | applyOrphanFix 585 | Await antes de toast/onDone |
| ColorHexFixCard | importCatalogs 663 | Await antes de contar como corregido |
| CatalogXlsxCard | importCatalogs 791 | Callback de readWorkbook async; rechazo remoto conserva preview y no informa importado |
| NewCatalogCard | addCatalog 879 | Await antes de vaciar captura |
| CfgText/FolioPrefixField | setSetting 919/950 | Await remoto, restaurar valor visible ante rechazo |
| CfgToggle/CfgSeg | setSetting 970/986 | No optimismo |
| LogoUploader | setSetting 1006/1022 | No anunciar actualizado/eliminado antes de commit CONFIG |
| BenefitEditor | update 1102, add 1128, remove 1142, duplicate 1150, moves 1159/1228/1229, active 1288 | Await; duplicar+reordenar preferiblemente una transacción de configuración |
| Ticket footer/tagline | setSetting 1747/1751 | Await y error consistente |

## Personal y cuentas

`settings.jsx:1776` activa/desactiva personal con `D.updateUser` y refresca inmediatamente.

`UserForm.submit` (2887+) presenta tres rutas:

1. Perfil sin cambio de correo/password: `D.updateUser`, toast y cierre sin await.
2. Cuenta Auth: `STORE.callFunction('admin-users')`, pull sellers, `D.updateUser` para comisión sin await, toast y cierre. La creación Auth y perfil comercial se separan; la pérdida de respuesta requiere consultar por identidad estable. Correo por sí solo no sustituye recibo de operación.
3. Sin sesión: `D.addUser/updateUser`, éxito explícitamente local. Este fallback debe retirarse.

`UserForm.eliminar` (2930+) usa Edge Function online y `D.removeUser` local. Retirar la alternativa local. La política/porcentaje/metas deben seguir la autoridad comercial vigente; no trasladarlos a la Edge sin contrato.

## Permisos y AUTH

`balam/permissions.jsx:8-13` tiene una ruta RPC directa fuera de STORE. Consultas:

- admin_screen_permission_catalog_snapshot;
- admin_permission_users;
- admin_user_permission_editor_snapshot.

Mutaciones:

- admin_sync_screen_permission_catalog (59), automática al abrir si difiere registro;
- admin_apply_user_screen_permissions_checked (263), ya espera resultado/versiona.

Mantener defensas SQL/versiones y dirigir escrituras por la frontera online común. La política de red debe mostrar el mensaje solicitado y evitar tratar resultado incierto como un nuevo guardado. Los borradores React de permisos son válidos mientras no se apliquen.

`balam/auth.jsx`: `saveAccess` (124) persiste perfil/permisos en `balam_auth_access_v2`; `cachedAccess` (131) puede autorizar pantallas tras falla de red; `resolveProfile` (188) adopta `offline_cache`; `refreshPermissions` (293) conserva autorizaciones cacheadas; `permissionReason` permite `localDevelopmentMode` sin sesión (336). Retirar autoridad offline y bypass de host en cliente productivo. Mantener tokens SDK para autenticar y reconstruir permisos remotamente. `resolveSeq` ya evita aplicación fuera de orden y debe conservarse. Logout usa scope local deliberadamente para no expulsar otras cajas.

## Inventario e imágenes (hallazgos para agente DATA)

`inventory.jsx:170 confirmImport`: XLSXIO aplica plan directamente sobre `D.products`, `saveProducts` acredita persistencia local, muestra éxito y cierra preview. Pasar copia aislada a la RPC de importación, confirmar antes de aplicar.

`inventory.jsx:205 saveProduct`: familia modifica/push a `D.products`, persiste y dispara `pushProductFamilyBatch` sin await; individual modifica referencia/push y `saveProducts` sin await. Ambos cierran formulario y abren etiquetas anticipadamente. `applyDeletion:264` también asume resultado síncrono.

`inventory.jsx:1003 onPickImg`: preview dataURL es borrador válido, upload Storage remoto no confirma producto. No convertir fallo de upload en persistencia comercial local. Mensaje Foto guardada en nube sólo acredita asset; guardar producto requiere RPC.

`inventory.jsx:2004 saveToSupabase`: genera/sube PNG, modifica `s.p.barcodeUrls` y llama `D.saveProducts` sin await. Preparar URLs en draft y confirmar metadata remota antes de contar el guardado completo.

`settings.jsx:1041 PhotoMigrationCard.migrar`: después de subir un asset escribe `p.imagen` por referencia, acumula 5 IDs y `saveProducts` sin await. Eliminar batching optimista y automática en STORE; confirmar URL de producto con base/version antes de aplicarla. Las cargas Storage de recursos no son cola comercial.

`xlsx-io.jsx` no hace llamadas Supabase ni persistencia por sí mismo; sus transformadores sólo deben recibir copias de preparación, nunca colección autoritativa mutable.

`discounts.jsx:177/179/300`: pausar/eliminar/guardar promoción muestra éxito sin await y debe convertirse junto a DATA.

## Simulación y mantenimiento

`settings.jsx:2607 DemoPanel`: `seedDemo` genera operación comercial completa local sin sesión y `resetEmpty` vacía realidad local. Son rutas local-first que deben retirarse del producto; no mantenerlas como excepción de desarrollo. Limpiezas remotas ya invocan STORE y esperan; necesitan adaptarse al contrato sin rebootstrap/cola y conservar conciliación existente.

`SyncHealthCard:1304-1556`: consume synchronized, recoveryPending, staleEpoch, incompatible, queue_pending/blocked, cuarentena/reintento/rebootstrap. `deviceState` clasifica retirado primero, pero el conjunto de tarjetas/conteo mezcla instalaciones. Conservar composición visual; datos operativos limitados a equipo actual/retirado y conexión real, historia separada. No conservar controles cuyo servicio se retira.

## Mecanismos y clasificación

| Mecanismo | Clasificación | Motivo/acción |
|---|---|---|
| balam_config_v1 como estado al iniciar | SE ELIMINA | Conciliar legado antes de retirar clave; no cargar autoridad comercial local |
| balam_auth_access_v2 | SE ELIMINA | Permisos/perfil vigentes se comprueban remotamente |
| bypass AUTH localDevelopmentMode | SE ELIMINA | No capacidad comercial sin sesión/Internet en ningún host |
| DemoPanel seedDemo/resetEmpty | SE ELIMINA | Escritura comercial local completa |
| cache DATA y cola | SE ELIMINA | Cobertura de agente DATA/STORE; no limpiar indiscriminadamente |
| balam_device_id | SIGUE SIENDO NECESARIO | Identidad técnica estable, no autoridad comercial |
| balam-page / balam-sidebar | SIGUE SIENDO NECESARIO | Preferencias UI |
| returns OP_KEY | SIGUE SIENDO NECESARIO | Preferencia de pestaña de posventa |
| SDK auth token | SIGUE SIENDO NECESARIO | Credencial técnica; siempre verificar permisos remotos |
| balam_pwa_brand_v1 | SIGUE SIENDO NECESARIO | Índice de assets visuales, no datos comerciales |
| Cache Storage balam-pwa-brand-v1 / shell | SIGUE SIENDO NECESARIO | Sólo recursos estáticos/branding |
| pwa-sw interceptación | SIGUE SIENDO NECESARIO | Mantener lista explícita shell/assets y exclusión APIs |
| actividad/instalaciones retiradas | SE CONSERVA POR HISTÓRICO | No determina bloqueo ni autoridad de documento |
| heartbeat/version/última conexión | SE CONSERVA SÓLO PARA TELEMETRÍA | Respuesta data:false nunca equivale a aceptación |
| flags cola/rebootstrap de UI | SE ELIMINA | No consumidores comerciales después del corte |
| borradores React / preview Excel / imagen | SIGUE SIENDO NECESARIO | Intención sin efectos; no anuncian confirmación comercial |

## Diálogo fantasma y PWA

`pwa.jsx:244 reloadSafety` usa `querySelector('[role="dialog"][aria-modal="true"]')` sin comprobar apertura. Inventario (494) y Clientes (190) conservan paneles montados `translate-x-full` con role dialog y aria-modal true. Corregir atributos según `open` y guarda de diálogo realmente visible; conservar diseño/transiciones. La guarda de actividad de CORE preserva borradores reales. La guarda `queue.durability==='memory'` pierde consumidor al retirar la cola; resultados inciertos necesitan identidad técnica durable, no payload comercial.

## Verificación propuesta, una ejecución por escenario

- CONFIG: remoto retrasado/rechazado no modifica estado ni almacenamiento; confirmación aplica una vez; conflicto preserva autoridad.
- Una importación de catálogo: commit completo, error conserva preview.
- Un perfil de usuario: no toast/cierre antes de confirmar; sin sesión no fallback.
- Permisos: pérdida de red no recupera autorizaciones desde localStorage.
- PWA: panel cerrado no bloquea; diálogo abierto sí bloquea.
- PWA cache: no Response de Supabase/API en Cache Storage.

No se ejecutaron estos casos todavía. Este inventario es evidencia de caminos de ejecución, no certificación A/B/C.
