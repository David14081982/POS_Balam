---
capa: conocimiento
applies_to: [client, database]
related_histories: [H-04, H-09, H-14, H-18, H-62, H-77, H-79, H-121]
severity_max: required
no_alcance: "No define ninguna autoridad ni transcribe firmas. Sólo dice qué pregunta responde cada una y dónde vive."
---

# Autoridades · Sincronización e identidad

Reglas de mantenimiento en `../README.md` § Registro de autoridades.

## ¿Esta operación ya se aplicó?
**Autoridad:** `pos.sale_commits` / `pos.return_commits`, por clave + hash del
payload. Para préstamos y capacidades, `pos.capability_operation_audit` cumple el
mismo papel por (`operation_id`, capacidad, hash)
**Definición:** migraciones `20260725001900`, `20260725002100`, `20260730008000`
**Creada por:** H-04 · **Extendida por:** H-56 Fase 5 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "sale_commits\|return_commits\|capability_operation_audit" supabase/ balam/`

## ¿Qué falta por sincronizar y en qué orden?
**Autoridad:** `STORE.flushQueue()` — ejecutor único, con candado
**Definición:** `docs/02-architecture.md` § Cola offline
**Creada por:** H-09, H-14 · **Decisión:** `ADR-006`
**Consumidores:** `grep -rn "flushQueue\|queueStatus" balam/`

## ¿Este préstamo ya está confirmado en la nube?
**Autoridad:** presencia y versión en `pos.loan_documents`; si aún no existe,
una operación `loanOperation` exacta en la cola durable. `_loanVersion` es sólo
metadato de la proyección y no autoriza conservar ni migrar un documento.
**Definición:** `balam/data.jsx` § préstamos · `balam/store.jsx` § `applyOp`
**Creada por:** H-62 · **Corregida por:** H-121 · **Decisión:** `ADR-014`
**Consumidores:** `grep -rn "_loanVersion" balam/ test-*.mjs`

## ¿Puede una fila local ausente del snapshot remoto seguir operativa?
**Autoridad:** sólo si una operación durable exacta la protege o si la lectura
remota no cubrió esa identidad. En snapshot completo, ausencia sin cola retira;
en ventana temporal sólo se retira dentro de la ventana; en incremental hace
falta tombstone/versionado. `DATA`, `localStorage`, cursores y telemetría no
pueden justificarla por sí solos.
**Definición:** `ADR-014` · `playbooks/synchronization.md`
**Creada por:** H-121

## ¿A qué préstamo corresponde este vale impreso?
**Autoridad:** `DATA.findLoanByFolio()` — folio vigente primero, alias después,
igual que `findSaleByFolio()`
**Definición:** `balam/data.jsx` · `docs/02-architecture.md` § Préstamos de mercancía
**Creada por:** H-62 · **Decisión:** `ADR-001`
**Consumidores:** `grep -rn "findLoanByFolio\|loanFolioAliases" balam/ test-*.mjs`

## ¿Cuál es esta terminal?
**Autoridad:** `CORE.getDeviceId()` — clave histórica `balam_device_id`
**Definición:** `balam/core.jsx` · `docs/02-architecture.md` § CORE
**Creada por:** H-18
**Consumidores:** `grep -rn "getDeviceId" balam/`

## ¿Qué estado remoto desconoce esta terminal?
**Autoridad:** `pos.sync_domain_versions` frente a los cursores durables de
`STORE`; Realtime sólo invalida
**Definición:** `ADR-012` · **Creada por:** H-77
**Consumidores:** registro de dominios y coordinador de `balam/store.jsx`

## ¿Puede esta terminal escribir o debe reconstruirse?
**Autoridad:** `pos.system_manifest` + versión/época de `pos.sync_devices`;
PostgreSQL valida las operaciones que reemplazan una línea base
**Definición:** `ADR-012` · **Creada por:** H-77

## ¿Está completamente sincronizada?
**Autoridad:** `STORE.syncStatus()`: cola, cursores, invalidaciones, pulls,
conflictos, compatibilidad y época; offline nunca satisface el contrato
**Definición:** `playbooks/synchronization.md` · **Creada por:** H-77

## ¿Qué equipo requiere atención y qué intentó sincronizar?
**Autoridad:** `pos.sync_devices` para la última señal declarada y
`pos.sync_activity` para la proyección resumida de cada operación. La cola local
continúa siendo la autoridad de lo pendiente; ausencia de señal es «desconocido»
y nunca prueba sincronía
**Definición:** migración `20260807012000` · **Creada por:** H-79

## ¿Qué equipo puede bloquear una limpieza selectiva H-113?
**Autoridad:** `pos.test_data_cleanup_fleet_risk()` cruza dominios seleccionados,
`pos.sync_activity`, cuarentena y capacidad de cerco por protocolo/época. Un
heartbeat ausente no es un bloqueo; sólo lo es riesgo concreto no aislado.
La cola local declarada en `sync_devices.queue_pending` decide si una
proyección activa es actual; con cola cero queda como incidencia histórica sin
replay. La cuarentena conserva su bloqueo porque sí tiene ruta de restauración.
**Definición:** migraciones `20260818015300`, `20260819015500` ·
**Creada por:** H-116 · **Reconciliada por:** H-118

## ¿Una instalación retirada puede volver a activarse por heartbeat?
**Autoridad:** `pos.admin_set_sync_device_retired()` y el estado durable
`sync_devices.status='revoked'`; `report_sync_device()` no sobrescribe ese estado.
**Definición:** migración `20260818015300` · **Creada por:** H-116

## ¿Qué se decide sobre una operación en cuarentena?
**Autoridad:** `pos.sync_quarantine_cases` conserva huella, resumen y decisión;
la operación completa permanece en el archivo local/JSON del equipo. Aprobar
sólo autoriza que `STORE` la restaure en su cola y la ejecute por la RPC vigente
**Definición:** migración `20260807012400` · **Creada por:** H-81
**Consumidores:** `grep -rn "sync_quarantine_cases\|decideSyncQuarantine" balam/ supabase/`
**Consumidores:** `grep -rn "syncFleetStatus\|sync_activity" balam/`

## ¿Puede un administrador ordenar un reintento remoto?
**Autoridad:** `pos.admin_request_sync_retry()` crea la orden y la instalación
de origen la consume mediante `pos.consume_sync_commands()`. La ejecución sigue
perteneciendo a `STORE.retryOperation()` y conserva RLS, RPC e idempotencia
**Definición:** migración `20260807012000` · **Creada por:** H-79
