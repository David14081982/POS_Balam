# H164 - Retiro de infraestructura comercial local-first en servidor

Fecha de evidencia: 2026-09-12 UTC. Fuente: catalogo pos del servidor hasta migracion 20260911020700, conservado como esquema sin filas comerciales en test-fixtures/h164/sql-authority-baseline.json, mas los ACL reales de pos/auth/extensions. Cambio y verificacion: migraciones 208, 209, 210 y 211. La entrega y activacion remotas estan verificadas en los registros enlazados; este inventario no certifica A/B/C ni adopcion fisica.

Estado remoto: online-only ACTIVO desde 07:56:55.112624 UTC, con verificacion independiente de solo lectura PASS a las 07:57:26.320080 UTC. Commit tecnico publicado final: `df4965b1269239665594eca722c38c9adb86cb68`, Pages verificado a las 08:34:42.109 UTC. Evidencias: [Pages](h164-online-pages.json) y [activacion Supabase](h164-server-activation.json). La activacion inicial uso el cliente `0f05350`, con los mismos bytes HTML/SW finales. La lectura encontro cero fuentes legacy recibidas; no equivale a cero pendientes en navegadores aun no inventariados.

Correccion posterior de gateway: 212/213 aplicadas y verificadas en Supabase. Normalizan cuatro objetos opcionales JSON null a SQL NULL conforme a contratos existentes, sin cambio del cliente publicado ni de grants. El caso live de apartado/abono concurrente/liquidacion, rechazado inicialmente sin confirmar cobros, paso despues de esta correccion. La [matriz tecnica live](h164-live-online.json) termino 20/20 PASS, certified=true y retiro QA completado; la adopcion fisica sigue pendiente.

La [verificacion final de solo lectura](h164-server-final-verification.json), a las 08:22:40.462767 UTC, comprobo 208-213 aplicadas, online-only activo, 35 guardas, 63 tablas/152 funciones, grants directos/legacy cero y exactamente cuatro conversiones JSON opcionales; no ejecuto operaciones comerciales. La certificacion de la matriz se informa en la correccion principal, separada de esta inspeccion de servidor.

## Alcance y conteos reproducibles

- Catalogo inicial: 58 tablas y 148 funciones pos.
- Adicion: 5 tablas tecnicas y 23 funciones; no se borra una tabla o fila comercial.
- Activacion: 19 funciones se eliminan con DROP sin CASCADE; 26 triggers que solo alimentaban cursores se eliminan. 31 nombres de RPC mutadores pierden EXECUTE para PUBLIC, anon y authenticated. Permanecen invocables internamente por autoridades SECURITY DEFINER o infraestructura service_role cuando corresponde.
- Resultado de esquema tras activacion: 63 tablas y 152 funciones. Estos conteos son del catalogo auditado, no el numero de dispositivos o documentos.
- Matriz de alcance: 19/19 familias de comandos contempladas en el servidor. Incluye administracion y Auth; no debe sumarse a la matriz de dominios de interfaz como si fueran dominios comerciales distintos.
- El cliente no tiene INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ni TRIGGER sobre ninguna tabla pos despues de activar. Se conservan SELECT/RLS existentes; los historicos privados no se abren para calcular comisiones.

## Rollout y reversibilidad

1. Instalar 208 crea online_runtime.enabled=false y APIs nuevas, preservando el servicio anterior durante la preparacion. No ejecuta limpieza, replay, recuperacion ni Punto Cero.
2. Ejecutar 209 comprueba la implementacion real con fixtures aislados y revierte por subtransaccion todos los fixtures, la activacion, sus DROP/REVOKE y sus cambios de estado. Ejecutar 210 precisa el alcance de descartes historicos y 211 lo verifica sin dejar fixtures. No es una prueba comercial sobre documentos existentes.
3. Preparar/publicar el artefacto nuevo y revisar compatibilidad antes de llamar activate_online_only() con autoridad de infraestructura. La activacion es una sola transaccion: si DROP encuentra una dependencia, toda la activacion falla y se revierte.
4. Activar elimina los endpoints y grants anteriores, retira los triggers de cursores y notifica recarga de esquema a PostgREST. La segunda llamada es idempotente. El cliente antiguo no puede volver a enviar operaciones: su RPC ya no existe o carece de EXECUTE y REST carece de escritura.
5. No existe rollback operativo hacia offline. Volver a enabled=false manualmente no recrea funciones ni grants retirados y no es un fallback soportado. Un rollback requiere una migracion correctiva revisada que preserve recibos y datos ya confirmados; no restaurar ciegamente un respaldo comercial.

La ejecucion revisable vive en [h164-activation.sql](h164-activation.sql): SQL puro para db query, sin instrucciones psql. Requiere reemplazar en memoria el marcador de SHA256 por el hash real de Pages ya contrastado, despues de verificar admin-users. Obtiene ACCESS EXCLUSIVE NOWAIT sobre las 63 tablas pos y luego el advisory comercial sin espera; si hay una consulta u operacion en curso, revierte inmediatamente y permite que esa operacion termine normalmente. Esto evita invertir el orden del gateway, que consulta perfil/equipo e inserta su recibo antes del advisory. No se cancelan sesiones ni se reintentan operaciones comerciales.

Una vez libre la ventana, activacion, revocaciones, retiros y comprobaciones ocurren en una transaccion, con timeout de sentencia de 30 segundos. Se verifica que los conteos de filas de las 63 tablas no cambien. Un error anterior a COMMIT revierte la activacion completa; una respuesta perdida se resuelve leyendo el estado, no repitiendo a ciegas. [h164-activation-verification.sql](h164-activation-verification.sql) ejecuta las comprobaciones independientes en BEGIN READ ONLY y reporta tambien operaciones/fuentes legadas y cuentas que aun necesitan revision.

El bloqueo puede pausar brevemente lecturas, reportes y presencia; no crea colas. Su semantica y liberacion al terminar la transaccion estan descritas en la documentacion de [bloqueos explicitos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html). La preparacion tecnica se verifico una vez en PostgreSQL local con el esquema/grants reales y sin fixtures o casos comerciales: PASS.

Despues se verificaron los bytes publicados en Pages y se ejecuto la activacion transaccional en Supabase. La comprobacion independiente de las 07:57:26.320080 UTC confirmo onlineOnly=true, contrato 1, 35 guardas de gateway, 19 funciones y 26 triggers retirados, 63 tablas y 152 funciones restantes, cero grants de escritura directa y cero grants de RPC legacy para navegadores. El registro [h164-server-activation.json](h164-server-activation.json) conserva ese resultado. Son pruebas del retiro tecnico activo, no una certificacion de concurrencia comercial A/B/C ni de colas fisicas conciliadas.

## Rutas permitidas y protecciones

| Familia | Entrada nominal | Proteccion relevante |
| --- | --- | --- |
| Productos e inventario V1/V2/V3 | upsert/products, productDeleteScope, softDelete/products, clearInventory | CAS, familia/barcode/identidad, uso historico y ultimo stock |
| Clientes | upsert/clients, softDelete/clients | CAS; compras/total/ultima nunca se sobrescriben desde perfil |
| Promociones y descuentos | upsert/promotions, softDelete/promotions; sale/exchange | CAS; quote de promociones, ventanas y configuracion vigente |
| Perfiles y vendedores | profileUpdate/staffUpdate/sellers, softDelete/sellers | CAS; agregados financieros preservados; ultima administracion protegida |
| Cuentas Auth | admin-users + perfil mediante execute_online_command | Recibo de saga sin contrasena; identidad Auth marcada y perfil exacto |
| Configuracion y catalogos editables | config, sizeMigration | Version CAS y cambios de productos atomicos; historia impide migrar tallas |
| Ventas y partidas | sale | Documento nuevo; productos/version, quote; RPC financiera y reserva atomica |
| Pagos y abonos | sale mode payment | Baseline completo del documento bajo lock; recibo idempotente |
| Apartados | sale; sale mode layaway_liquidation | Identidad del apartado separada del request de liquidacion; RPC H65 |
| Devoluciones | return | RPC checked; capacidad, saldo retornable y documentacion; legacy=false obligatorio |
| Cambios | exchange | RPC checked; bases del producto entregado y quote vigente |
| Prestamos | loanOperation | Version del documento; referencias activas; contrato sin movimiento de stock |
| Stock, movimientos y reclasificaciones | upsert/products; sale/return/exchange; referenceReclassification | Stock y movimientos dentro de la transaccion que produce el efecto |
| Comisiones y liquidaciones | commissionSettle, commissionClose, commissionAdjustment; documentos | RPC existentes; quote considera base del periodo y evidencia financiera |
| Folios | folio | Reserva remota de uno, identidad separada; venta 4 digitos/prestamo 3 |
| Tarjeta fisica | physicalCard, physicalCardClaim | Claim remoto idempotente y validacion existente |
| Permisos | permissions | Solo dos RPC nominales de catalogo/permisos; ultima administracion protegida |
| Equipos | deviceUpdate, deviceRetire | Administracion existente a traves del gateway; retirado nunca heartbeat exitoso |
| Limpieza administrativa autorizada | pointZeroBackup, pointZero, cleanupBackup, cleanup | Preview exacto, respaldo, confirmacion y entorno preproduccion preservados |

execute_online_command exige expectedActorId=auth.uid(), perfil activo y equipo no retirado. Un advisory lock por actor/request y otro comercial para las tres cajas cubren la transaccion. Se comprueban precondiciones de version y cotizacion antes de invocar autoridades existentes. Confirmaciones y rechazos son recibos terminales; los errores revierten los efectos de su subtransaccion. SET CONSTRAINTS ALL IMMEDIATE obliga a comprobar restricciones diferidas antes de reconocer exito.

resolve_online_request toma el mismo lock de request. Si la solicitud no existe, escribe una cancelacion terminal; una llegada tardia no puede confirmar despues. online_request_result solamente consulta found/receipt y no cancela. El navegador puede guardar la referencia tecnica UUID/actor/tipo/huella, nunca el payload comercial para reproducirlo.

Auth requiere una saga porque GoTrue y PostgreSQL no comparten transaccion. online_account_requests conserva solo intencion de perfil sin secretos y evidencia, sin temporizador o consumidor de replay. Se reserva el objetivo antes de Auth, se verifica su marcador inmutable y se confirma el perfil exacto por el mismo gateway. Se aisla el objetivo concreto si queda una confirmacion incierta.

## Archivos de esta unidad

| Archivo | Clasificacion | Motivo |
| --- | --- | --- |
| supabase/migrations/20260911020800_pos_h164_online_authority.sql | SIGUE SIENDO NECESARIO | Autoridad online, recibos, fences, archivo legado y activacion |
| supabase/migrations/20260911020900_pos_h164_online_authority_verification.sql | SIGUE SIENDO NECESARIO | Verificacion PostgreSQL con rollback de fixtures |
| supabase/migrations/20260912021000_pos_h164_legacy_exact_discard.sql | SIGUE SIENDO NECESARIO | Autorizar solo discarded_ids capturados/completados; fuentes desconocidas permanecen visibles en revision |
| supabase/migrations/20260912021100_pos_h164_legacy_exact_discard_verification.sql | SIGUE SIENDO NECESARIO | Candidato no capturado permanece needs_review y journal no reconocido no desaparece del contador |
| supabase/migrations/20260912021200_pos_h164_optional_json_null.sql | SIGUE SIENDO NECESARIO | Normaliza solo objetos SQL opcionales del gateway; conserva arrays, liquidacion obligatoria, hashes, CAS y ACL |
| supabase/migrations/20260912021300_pos_h164_optional_json_null_verification.sql | SIGUE SIENDO NECESARIO | Regresion focalizada con autoridades financieras reales y rollback de fixtures |
| docs/fixes/evidence/h164-activation.sql | SIGUE SIENDO NECESARIO | Cutover transaccional tras verificar Pages; locks NOWAIT y comprobaciones antes de COMMIT |
| docs/fixes/evidence/h164-activation-verification.sql | SIGUE SIENDO NECESARIO | Comprobacion independiente de solo lectura; no ejecuta activacion |
| test-h164-online-sql.mjs | SIGUE SIENDO NECESARIO | Reconstruye esquema real y ejecuta 208/209 en PostgreSQL PGlite sin datos productivos |
| test-fixtures/h164/sql-authority-baseline.json | SE CONSERVA POR HISTORICO | Esquema base reproducible hasta 207; sin filas comerciales o secretos |
| supabase/functions/admin-users/index.ts | SIGUE SIENDO NECESARIO | Saga online Auth/perfil; propiedad de la unidad config |
| balam/store.jsx, balam/core.jsx, balam/data.jsx | SIGUE SIENDO NECESARIO | Nueva ruta online/estado efimero; retiro JS documentado por las unidades propietarias |
| .evidence-h164/read-online-authorities.* | SE CONSERVA POR HISTORICO | Lectura de catalogo auditado; no consumidor del producto |
| Migraciones 001..207 | SE CONSERVA POR HISTORICO | Historial inmutable de base; que exista SQL historico no lo hace API activa |

## Tablas: clasificacion exhaustiva

Ninguna tabla comercial se elimina para adoptar online-only. "Historico" preserva evidencia y autorizaciones; no constituye una cola y ningun consumidor la reproduce. sync_devices es telemetria de instalaciones y tambien la lista administrativa de retiro; nunca guarda autoridad de stock/venta. Los recibos y restricciones de documento son necesarios aunque el cliente no tenga una cola.

| Tabla pos | Clasificacion | Uso tras activar |
| --- | --- | --- |
| barcode_aliases | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| capability_operation_audit | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| clients | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| commission_adjustments | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| config_commits | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| config_sync_state | SIGUE SIENDO NECESARIO | Version CAS de configuracion; se conserva version, no cursor de navegador |
| exchange_commits | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| exchange_items | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| exchanges | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| folio_counters | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| inventory_contract_state | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| inventory_sync_baselines | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| inventory_v1_v2_map | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| inventory_v3_backups | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| inventory_v3_operations | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| layaway_liquidation_commits | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| liquidations | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| loan_documents | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| lookup | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| movements | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| operational_capabilities | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| permission_change_audit | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| permission_roles | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| physical_card_redemptions | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| point_zero_backups | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| point_zero_operations | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| products | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| promotions | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| purged_documents | SIGUE SIENDO NECESARIO | Impide revivir documentos descartados por autorizacion; no proyeccion local |
| reference_reclassifications | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| return_commits | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| return_items | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| returns | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| role_capability_permissions | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| role_screen_permissions | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| sale_commits | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| sale_items | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| sale_payments | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| sales | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| screen_permission_catalog | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| screen_permission_catalog_state | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| selective_cleanup_events | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| sellers | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| settings | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| stock_reservations | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| sync_activity | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| sync_conflicts | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| sync_device_recoveries | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| sync_devices | SE CONSERVA SOLO PARA TELEMETRIA | Presencia real, nombre/version/usuario y retiro; metadata de antiguas colas queda historica |
| sync_domain_versions | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| sync_quarantine_cases | SE CONSERVA POR HISTORICO | Evidencia legada inmutable para reconciliar; sin ingreso/replay del cliente |
| system_manifest | SIGUE SIENDO NECESARIO | Contrato interno esquema/V3 usado por SQL; el navegador ya no decide epoch/protocol |
| test_data_cleanup_backups | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| test_data_cleanup_operations | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| test_data_purges | SE CONSERVA POR HISTORICO | Respaldo, recibo administrativo o auditoria; operaciones de mantenimiento siguen controles existentes |
| user_capability_overrides | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| user_permission_role_assignments | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| user_screen_permission_overrides | SIGUE SIENDO NECESARIO | Autoridad comercial, permiso, identidad o restriccion servidor vigente |
| online_runtime | SIGUE SIENDO NECESARIO | Control online/recibo servidor; sin capacidad offline |
| online_requests | SIGUE SIENDO NECESARIO | Control online/recibo servidor; sin capacidad offline |
| online_legacy_archives | SE CONSERVA POR HISTORICO | Original exacto y decisiones por operacion; SHA256 verificado antes de acuse; replay=0 |
| online_legacy_operations | SE CONSERVA POR HISTORICO | Original exacto y decisiones por operacion; SHA256 verificado antes de acuse; replay=0 |
| online_account_requests | SIGUE SIENDO NECESARIO | Control online/recibo servidor; sin capacidad offline |

## Funciones: clasificacion exhaustiva del catalogo 207

Las funciones financieras H65/H83/H94/H101/H133 se conservan porque hay llamadas verificables entre autoridades actuales: preservan validacion de documentos, importes congelados, identidad V2/V3, barcode, ornamentos y stock. No son un motor de sincronizacion. Sus wrappers mutadores pierden acceso desde navegador; solamente dispatch_online_command los invoca con la identidad/contexto de una solicitud activa. Las funciones SQL puras/lecturas y restricciones siguen necesarias bajo sus grants/RLS existentes.

assert_device_recovery_write y guard_device_recovery_row conservan nombre por dependencia de RPC/triggers vigentes, pero la rama online exige solicitud respaldada por recibo y equipo activo; rechaza identidades previamente descartadas, sin pedir rebootstrap/epoch del navegador. assert_sync_write_context verifica solo los valores del manifiesto que el gateway toma del propio servidor. bump_sync_domain retorna la version historica sin avanzar cursor cuando online esta activado; queda como compatibilidad de SQL administrativo que aun lo llama. admin_set_sync_device_retired reactiva como offline sin reactivation_requires_sync.

| Firma pos | Clasificacion | Acceso/comportamiento final |
| --- | --- | --- |
| pos.admin_apply_role_screen_permissions(text,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_apply_user_screen_permissions_checked(uuid,text,jsonb,text,text[]) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_apply_user_screen_permissions(uuid,text,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_decide_sync_quarantine(text,text,bigint,text,text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.admin_mark_sync_activity_reviewed(text,text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.admin_permission_users(text,integer,integer) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.admin_request_sync_retry(text,text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.admin_screen_permission_catalog_snapshot() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.admin_screen_permission(uuid,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.admin_set_sync_device_retired(text,boolean,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_sync_screen_permission_catalog(jsonb,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_update_sync_device(text,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.admin_user_permission_editor_snapshot(uuid,text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.admin_user_permission_snapshot(uuid,text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.apply_commission_adjustment_checked(uuid,jsonb,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.assert_device_recovery_write(text,text[]) | SIGUE SIENDO NECESARIO | Guard de request activo y descartes historicos; rama online no exige rebootstrap |
| pos.assert_permission_admin_survives_scope(uuid[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.assert_permission_admin_survives() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.assert_sync_write_context(integer,bigint) | SIGUE SIENDO NECESARIO | Contrato SQL/V3 interno, valores del servidor; sin autoridad de epoch cliente |
| pos.bump_sync_domain(text,text) | SIGUE SIENDO NECESARIO | Compatibilidad administrativa: online no incrementa el cursor historico |
| pos.can_manage_screen_permissions(uuid) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.capture_sync_device_recovery(text,uuid,jsonb) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.certify_inventory_v3() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.claim_physical_card(text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.close_commission_period_checked(uuid) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.close_commission_period_internal(uuid,text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_config(text,bigint,text,jsonb,jsonb,integer,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_layaway_liquidation_checked(text,text,text,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_layaway_liquidation(text,text,text,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_legacy_return(text,jsonb,jsonb,jsonb,jsonb) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.commit_loan_operation(uuid,text,jsonb,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_reference_reclassification(text,text,text,integer,text,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.commit_sale_with_additional_discount(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.commit_sale(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.complete_sync_command(text,text,boolean) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.complete_sync_device_recovery(text,uuid,jsonb,bigint,integer,integer) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.complete_sync_quarantine(text,text,bigint,boolean,text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.config_fingerprint() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.consume_sync_commands(text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.consume_sync_quarantine_decisions(text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.create_point_zero_backup(text,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.create_test_data_cleanup_backup(text,jsonb,text,integer,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.current_has_capability(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.current_permission_snapshot(text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.current_screen_permission(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.current_screen_permissions(text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.decode_money_components_wire() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.delete_product_checked(uuid,text,bigint,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.enforce_permission_admin_survives() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.establish_sync_point_zero(integer,bigint) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.execute_point_zero(text,text,uuid,text,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.get_sync_device_recovery(text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.guard_device_recovery_row() | SIGUE SIENDO NECESARIO | Guard de request activo y descartes historicos; rama online no exige rebootstrap |
| pos.guard_entity_version() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h101_ensure_reference_family() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_alias_immutable() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_barcode_v3_from_id(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_execute_inventory_v3(uuid,jsonb,jsonb,text,integer,integer,integer,integer,integer) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_guard_operational_inventory() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_internal_enabled() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_operational_items(jsonb,boolean,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_operational_items(jsonb,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_payload_hash(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h133_restore_inventory_v3_backup(uuid) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.h80_sync_activity_material_change() | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.h81_touch_quarantine_devices() | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.h83_assert_ornament_items(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_commit_sale_with_additional_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_persist_exchange_ornaments(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_persist_return_ornaments(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h83_persist_sale_ornaments(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h85_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h85_commit_sale_with_additional_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_assert_v2_document_items(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_commit_exchange_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_commit_return_delegate(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_commit_sale_with_discount_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_guard_used_reference_identity() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_persist_exchange_references(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_persist_return_references(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_persist_sale_references(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.h94_sync_v2_stock_shape() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.is_active_admin() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.is_active_seller() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.line_recognized_value(text,text,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.list_price(text,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.money_components_valid(jsonb,numeric) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.physical_card_available(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.point_zero_payload() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.point_zero_preserved_hash() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.point_zero_preview() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.point_zero_receipt(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.point_zero_sha256(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.prepare_sync_device_recovery(text,integer,bigint,integer,text,text) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.preview_test_data_cleanup(text,jsonb,integer) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.protect_sync_device_retirement() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.purge_test_data(text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.record_exchange_commission_policy(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.reject_purged_document() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.report_sync_device(text,text,integer,bigint,bigint,jsonb,integer,integer,text,timestamp with time zone) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.report_sync_quarantine(text,text,bigint,bigint,text,text,text,text,text,jsonb) | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.require_current_capability(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.require_sale_commit_capabilities(jsonb,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.require_sale_stock_reservation() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.reserve_folio_block(text,date,integer,integer) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.reserve_sale_stock(text,text,jsonb) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.resolve_operational_capability(uuid,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.resolve_screen_permission_precedence(boolean,text,text,boolean,boolean) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.resolve_screen_permission(uuid,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.restrict_direct_commission_writes() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.restrict_seller_metrics_update() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.restrict_seller_product_update() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.sale_commit_authoritative_state(text,text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.sale_line_balance(text,text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.sale_stock_reservation_status(text[]) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.save_products_checked_v2(uuid,jsonb,integer,bigint) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.save_products_checked(uuid,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.settle_commission_checked(uuid,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.soft_delete_entity(text,text,bigint,text) | SIGUE SIENDO NECESARIO | EXECUTE revocado a PUBLIC/anon/authenticated; solo gateway o infraestructura autorizada |
| pos.test_data_cleanup_affects_financials(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_cleanup_fleet_risk(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_cleanup_payload(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_cleanup_plan_hash(jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_cleanup_plan(text,jsonb) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_cleanup_receipt(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.test_data_purge_state() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.total_stock_pieces() | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.touch_sync_devices_domain() | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.touch_sync_domain() | SE ELIMINA | DROP sin CASCADE al activar; sin consumidor comercial actual |
| pos.unaccent_lower_ok(text) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |
| pos.user_screen_permissions_version(uuid) | SIGUE SIENDO NECESARIO | Lectura, restriccion o helper utilizado por autoridades actuales; grants previos |

## Funciones nuevas

Todas las siguientes siguen necesarias. Los unicos endpoints de escritura comercial del navegador son execute_online_command y la orquestacion Auth admin-users que vuelve a ese gateway para el perfil. online_presence y archive_online_legacy solo escriben telemetria/evidencia; los resolvers solo recibos tecnicos y nunca ejecutan payloads.

| Funcion | Clasificacion |
| --- | --- |
| online_request_context | SIGUE SIENDO NECESARIO |
| assert_online_device | SIGUE SIENDO NECESARIO |
| guard_online_commercial_write | SIGUE SIENDO NECESARIO |
| online_check_rows | SIGUE SIENDO NECESARIO |
| online_save_entities | SIGUE SIENDO NECESARIO |
| online_quote_context | SIGUE SIENDO NECESARIO |
| dispatch_online_command | SIGUE SIENDO NECESARIO |
| execute_online_command | SIGUE SIENDO NECESARIO |
| resolve_online_request | SIGUE SIENDO NECESARIO |
| online_request_result | SIGUE SIENDO NECESARIO |
| online_presence | SIGUE SIENDO NECESARIO |
| online_connectivity | SIGUE SIENDO NECESARIO |
| prepare_online_account | SIGUE SIENDO NECESARIO |
| advance_online_account | SIGUE SIENDO NECESARIO |
| online_account_result | SIGUE SIENDO NECESARIO |
| online_account_profile_command | SIGUE SIENDO NECESARIO |
| online_legacy_review_count | SIGUE SIENDO NECESARIO |
| online_commission_context | SIGUE SIENDO NECESARIO |
| online_snapshot | SIGUE SIENDO NECESARIO |
| online_legacy_intents | SIGUE SIENDO NECESARIO |
| classify_online_legacy | SIGUE SIENDO NECESARIO |
| archive_online_legacy | SIGUE SIENDO NECESARIO |
| activate_online_only | SIGUE SIENDO NECESARIO |

## Evidencia y limites

CI final 34683481979, commit df4965b1269239665594eca722c38c9adb86cb68: online-sql-local.json confirma cadena PGlite completa 208-213 PASS. La inspeccion Supabase real se conserva por separado; este resultado no inventaria navegadores fisicos.

Ultima ejecucion local de test-h164-online-sql.mjs: PASS, 23 funciones nuevas, 208/209/210/211 completas, con ACL reales de esquema y EXECUTE PUBLIC (incluido ACL NULL), ademas de una sesion NOINHERIT que asume el rol efectivo de migracion. Un caso por garantia: recibo tras respuesta perdida, cancelacion contra llegada tardia, CAS cliente/promocion, batch atomico, perfil sin sobrescribir dinero, REST/legacy cerrados, actor cruzado bloqueado, roles/RLS, agregado de comision privado consistente, cotizacion obsoleta rechazada, saga de perfil exacta y objetivo reservado, archivo legado con hash y cero replay, guardas fantasmas de Punto Cero/cleanup retiradas, descarte solo del subconjunto capturado y journal desconocido visible en revision. La verificacion de migraciones general previa termino 31 PASS; no se repitio sin causa.

Durante el rollout, 208 se aplico con enabled=false. La verificacion 209 fallo por falta de USAGE sobre pos; no quedo aplicada, ni se activo online, ni quedaron fixtures o archivos legados. El diagnostico por db query usa session_user=postgres y pasaba, por lo que no reproducia el transporte db push. Una sesion local NOINHERIT con SET ROLE postgres reprodujo exactamente el fallo al ejecutar la primera autoridad despues de RESET ROLE: el test volvia al login en lugar de conservar su rol efectivo. 209/211 ahora capturan current_user al entrar y restauran ese rol explicitamente. La inspeccion de grants tambien se ejecuta desde ese propietario; no se abre acceso a anon. El scaffold incluye la sesion delegada y los grants reales. La identidad exacta de la conexion push no se afirma; su sondeo temporal fue rechazado por revision automatica antes de ejecutarse. Estado final de las aplicaciones posteriores: consultar la correccion principal H164 y sus recibos de despliegue.

210 corrige una distincion importante: candidate_ids era un inventario amplio, mientras discarded_ids mas estado captured/completed representa la autorizacion realmente capturada. Los originales no se eliminan; una clasificacion anterior no respaldada vuelve a needs_review. Tambien se cuenta una fuente needs_review sin operaciones reconocibles, para que conservar sus bytes no oculte la decision pendiente.

Esta evidencia local no demuestra latencia/concurrencia de PostgREST, GoTrue real, tres equipos fisicos ni operacion de impresora. La certificacion A/B/C, ultima pieza, respuesta HTTP perdida tras COMMIT, ausencia de red y recuperacion pertenece al artefacto final contra Supabase real. El estado de publicacion y commit se registra en la correccion H164 principal, no se presume aqui.

Riesgo residual controlado: un lock comercial global simplifica las dependencias entre RPC para tres cajas y puede hacer esperar o rechazar transacciones cuando existe contencion; no produce un fallback offline. Un cambio de promocion, ventana o base de comision invalida la cotizacion y exige reconsulta/confirmacion antes del cobro. Las operaciones legadas no confirmadas se conservan y aislan para decision por identidad; nunca se descartan por mera existencia de otro documento.
