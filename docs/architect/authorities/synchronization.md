---
capa: conocimiento
applies_to: [client, database]
related_histories: [H-04, H-09, H-14, H-18, H-62, H-77, H-79, H-121, H-148, H-164]
severity_max: required
no_alcance: "No define autoridades ni transcribe firmas. Identifica la pregunta y su fuente ejecutable."
---

# Autoridades · Operación online, terminales e identidad

Mantenimiento: `../README.md` § Registro de autoridades. `ADR-015` reemplaza
las rutas local-first de ADR-006/012/014; su evidencia permanece histórica.

## ¿Esta operación ya se aplicó?
**Autoridad:** recibo de `execute_online_command()` y resolución de
`resolve_online_request()`. Los recibos financieros de `sale_commits`,
`return_commits`, `exchange_commits` y `capability_operation_audit` conservan
su autoridad de dominio. Una ausencia definitiva cancela el request ID.
**Definición:** migración H-164 `20260911020800` y transacciones de cada dominio.
**Consumidores:** `rg -n "execute_online_command|resolve_online_request" balam/ supabase/`

## ¿Qué falta por sincronizar y en qué orden?
**Autoridad actual:** no existe una cola comercial nueva. `STORE.execute()`
espera la confirmación online; una referencia técnica pendiente consulta un
resultado y no contiene una operación para enviar. `flushQueue()` queda retirado.
**Definición:** `docs/02-architecture.md` § Retiro de la cola offline · `ADR-015`

## ¿Qué hace Actualizar este equipo y qué acredita su resultado?
**Autoridad:** la consulta de `STORE.refresh()` reconstruye DATA/CONFIG desde
`online_snapshot()`. `syncStatus().ready` exige lectura completa comprobada;
no acredita por sí solo otras instalaciones. Certificar A/B/C requiere evidencia
contra Supabase real del mismo artefacto, conforme a `R-SYNC-16/17`.
**Definición:** `balam/store.jsx` · `docs/02-architecture.md` § Sincronización

## ¿Este préstamo ya está confirmado en la nube?
**Autoridad:** `pos.loan_documents` y el recibo de su operación SQL. Ni
`_loanVersion`, una caché ni un expediente legacy sustituyen la presencia remota.
**Definición:** `balam/data.jsx` § préstamos · `pos.commit_loan_operation()`

## ¿Puede una fila local ausente del snapshot remoto seguir operativa?
**Autoridad:** la cobertura del snapshot autorizado. Ausencia en un conjunto
completo retira la proyección; una consulta parcial no prueba baja global. Un
borrador o un expediente se conserva separado, sin efectos comerciales.
**Definición:** `ADR-015` · `R-SYNC-13/14`

## ¿A qué préstamo corresponde este vale impreso?
**Autoridad:** `DATA.findLoanByFolio()`: folio vigente primero, alias después.
Los alias históricos no habilitan reejecución ni renombrado de otro documento.
**Definición:** `balam/data.jsx` · `ADR-001`

## ¿Cuál es esta terminal?
**Autoridad:** `CORE.getDeviceId()` conserva `balam_device_id`; la presencia
servidor distingue la instalación activa de su historia. El nombre es una etiqueta.
**Definición:** `balam/core.jsx` y `online_presence()`

## ¿Qué estado remoto desconoce esta terminal?
**Autoridad:** la nueva consulta `online_snapshot()`; Realtime sólo la adelanta.
No existe un cursor comercial durable cuya posición pueda sustituir esa lectura.
**Definición:** `balam/store.jsx` § ciclo de consulta y reconexión · `ADR-015`

## ¿Puede esta terminal escribir o debe reconstruir su pantalla?
**Autoridad:** el servidor valida contrato online, perfil/capacidades, dispositivo
y versiones dentro de la operación. STORE habilita UI tras verificar acceso y
snapshot. Un lock, versión o estado local no concede permiso comercial.
**Definición:** migración H-164 y `AUTH.refreshPermissions()`

## ¿Está completamente sincronizada?
**Autoridad actual:** `STORE.syncStatus()` describe conexión y última lectura;
no hay sincronización comercial pendiente. Sin conexión o recibo sin resolver
no se declara una nueva operación confirmada. La certificación de convergencia
exige comparar cada instalación con Supabase, no contar heartbeats.
**Definición:** `R-SYNC-11/16/17`

## ¿Qué equipo requiere atención y qué intentó sincronizar?
**Autoridad actual:** equipos activos e historial proceden del servidor.
`sync_activity` conserva historia/telemetría, sin autoridad comercial ni replay.
Los expedientes legacy íntegros identifican operaciones que requieren decisión;
los conteos viejos de `pending`/`blocked` no crean incidencias nuevas.
**Definición:** `syncFleetStatus()` y archivo H-164 de evidencia legacy

## ¿Qué equipo puede bloquear una limpieza selectiva?
**Autoridad:** el plan servidor y riesgo concreto sobre su alcance, incluidas
operaciones reales no reconciliadas. Una instalación ausente o una proyección
técnica obsoleta no sustituye ese riesgo. Respaldo y controles financieros permanecen.
**Definición:** `pos.test_data_cleanup_fleet_risk()` y gateway H-164

## ¿Una instalación retirada puede volver a activarse por heartbeat?
**Autoridad:** retiro administrativo servidor. `online_presence()` no revierte
una retirada y `false` no es confirmación. Activos e historial se consultan separados.
**Definición:** migración H-164 · `STORE.heartbeatDevice()`

## ¿Qué se decide sobre una operación en cuarentena?
**Autoridad:** expediente servidor con original verificable, hash y resolución.
Antes de retirar el origen, `archive_online_legacy()` confirma su conservación.
Una operación confirmada se reconoce sin repetir; una no reconciliada exige
decisión individual. Las autorizaciones antiguas no restauran una cola comercial.
**Definición:** `ADR-015` · `STORE.archiveLegacy()`

## ¿Puede un administrador ordenar un reintento remoto?
**Autoridad actual:** no existe reproducción comercial desde otra instalación.
Las órdenes históricas de retry no habilitan escritura tras el cerco H-164.
Un resultado incierto se consulta; no se vuelve a enviar su payload.
**Definición:** `ADR-015` · resolución de recibos online

## ¿La cuenta Auth y su perfil comercial quedaron confirmados?
**Autoridad:** recibo servidor de `pos.online_account_requests` y resolución de
`admin-users`. El marcador Auth protegido y el commit del perfil acreditan cada
paso. Un resultado incierto no equivale a éxito ni permite repetir una contraseña.
**Definición:** `supabase/functions/admin-users/index.ts` y migración H-164
