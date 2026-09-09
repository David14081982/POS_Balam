# Limpieza con descarte respaldado de cuarentena

**Riesgo:** H-150

**Estado:** CORREGIDO Y VERIFICADO; publicación del cliente pendiente

**Fecha:** 09/09/2026

**Commit:** Pendiente de commit

## Problema y reproducción

Con todos los grupos de prueba seleccionados, EIFBB1 bloqueaba la limpieza por
una operación del 05/09/2026 a las 15:08:26 de Hermosillo, aunque declaraba cero
pendientes y cero bloqueados. Supabase conservaba 64 expedientes
`pending_review` de ese equipo. El primer conflicto era `productDeleteScope`,
operación `0b5c2c8d-2cff-4daa-99eb-3d6945e01d5a`. La hora correspondía a
`updated_at` del expediente, no a la captura original.

El diagnóstico de sólo lectura y su SQL están en `evidence/h150-diagnosis.*`.
La matriz original obtenía 6 conflictos para ventas, 1 para devoluciones y 55
para reclasificaciones. El E2E nuevo falla contra el HTML anterior porque falta
el resumen de descarte (0 elementos frente a 1 esperado).

Se trabajó en `fix/h150-cleanup-pending`, checkout aislado basado en `22fca32`.
La copia original con trabajo previo no se modificó.

## Causa raíz

`pos.test_data_cleanup_fleet_risk` separaba actividad histórica de la cola,
pero concatenaba independientemente toda cuarentena pendiente o reintentable
como conflicto bloqueante. La UI presentaba ese conflicto como cola pendiente
y no identificaba una solicitud de baja de producto. La limpieza tampoco
tenía un contrato para descartar esos archivos y evitar su reactivación.

El dominio técnico `products`, dependencia de reclasificaciones, incluía 54
ediciones de producto y una solicitud de baja. Son intentos archivados, no
documentos comerciales de reclasificación ni productos que deban borrarse.

## Diseño

La confirmación de limpieza incluye por separado los intentos archivados sin
reintento autorizado que afectan los dominios elegidos. Se muestran tipos,
conteos y equipo antes del respaldo y en las confirmaciones. Descartar una
solicitud de baja o edición NO la ejecuta ni borra el producto. El inventario
conserva la reconciliación comercial ya existente; los descartes no aportan
deltas de stock. Configuraciones y promociones fuera de selección permanecen.

Invariantes: snapshot exacto en hash y respaldo; rechazo atómico con el borrado
comercial; idempotencia por `cleanup_id`; bloqueo permanente del replay por
identidad; permisos y ACL previos conservados. Cola activa, alcance desconocido
o reintento aprobado/en entrega siguen bloqueando. No basta con declarar cola
cero. Reclasificaciones y cierres antiguos sin identidad comercial verificable
siguen requiriendo revisión administrativa.

## Solución

- Migración `20260909019200`: incorpora `discarded_by_cleanup` con FK al
  recibo; integra `quarantine_discard` en preview, hash, respaldo y resultado.
  Reutiliza el lock de recuperación H-149 para serializar escritura, decisión
  administrativa y descarte. Rechaza únicamente el snapshot confirmado y
  revierte todo ante cualquier fallo posterior.
- `assert_device_recovery_write` impide ejecutar una identidad descartada,
  incluidos alias comerciales registrados. `report_sync_quarantine` no reabre
  el archivo en otra época; `admin_decide_sync_quarantine` no lo reautoriza.
  Ambos caminos de cambio verifican también `exchange.id`, además del commit.
- `balam/store.jsx`: limpieza protocolo 6 y build `2026-09-09-h150`;
  nuevos resúmenes de cuarentena conservan `operationIds`. Sin cambio del
  protocolo general de sincronización (3), esquema mínimo ni época al instalar.
- `balam/settings.jsx`: resumen explícito de archivos, agrupación por tipo,
  detalle y resultado; razones diferenciadas para cuarentena aún bloqueante.
- Clientes anteriores no pueden confirmar planes con descartes. Los eventos
  de limpieza conservan protocolo 5: el retorno usa su reconstrucción habitual
  y el servidor impide reactivar los archivos descartados.
- Migración `20260909019300`: verificación remota de contratos, permisos y
  bloqueo de replay con fixtures técnicos que se revierten. No ejecuta una
  limpieza comercial real.

## Pruebas

| Comando / evidencia | Resultado |
|---|---|
| `psql ... -f test-h150-cleanup-quarantine-functional.sql` | 10/10: flota, selección, snapshot, hash estable, payload cambiado, aprobados, cola desconocida y alias |
| `psql ... -d h150_exact -f test-h150-cleanup-quarantine-execute.sql` | 13/13: respaldo, cliente viejo, rollback inyectado, descarte, idempotencia, replay, conservación V1/V2 y configuración |
| `node test-h150-cleanup-quarantine-e2e.mjs` | 20/20: preview, respaldo, confirmación, resultado y ocho anchos 320–1440 |
| Migración de verificación local y remota | `H150_REMOTE_VERIFICATION_OK` |
| H-113 / H-116 contratos / H-116 UI | 35/35, 20/20, 29/29 |
| H-124 contratos / H-124 UI | 11/11, 11/11 |
| `node test-store-queue.mjs` | 186/186 |
| H-81 / H-118 / H-149 | 15/15, 10/10, 15/15 |
| Migraciones / contratos de módulos | 31/31, 42/42 |
| Smoke / navegación / reproducibilidad | 17/17, 15/15, 8/8 |

La base local se reconstruyó desde el esquema real vigente, sin copiar datos
comerciales. El SQL de ejecución exige la base aislada `h150_exact` y revierte
sus fixtures. Se ajustaron expectativas obsoletas de versión H-116/H-124 y el
localizador H-124 del aviso ahora envuelto por `HumanMessage`; se conservan
las afirmaciones de estado, plan actualizado y ausencia de ejecución.

`node test-h148-live-convergence.mjs` con `BALAM_SYNC_LIVE=1` y posterior
`node test-h148-sync-certification.mjs docs/fixes/evidence/h148-live-matrix.json`:
23/23 casos reales A/B/C, 16/16 dominios, cero pendientes perdidos y cero
divergencias finales; fixtures retirados y 17 tablas comerciales preservadas.
Certificado final: `evidence/h148-live-matrix.json`, terminado
`2026-09-09T16:41:02.667Z`. HTML probado SHA-256
`496d54e47f3cc0ad18b6e102620fb92a84c5d664a4ee4294b7739fe429c27145`.
Esta matriz de regresión no equivale a ejecutar una limpieza destructiva
H-150 en los datos reales.

## Despliegue y preservación

Migraciones 19200 y 19300 aplicadas antes del cliente; `db push --dry-run`
confirma que no hay pendientes. Las huellas y conteos de 17 tablas comerciales
y de cuarentena coinciden antes/después de instalar (18/18). No se ejecutó la
limpieza solicitada en los datos del usuario.

El preview real ya devuelve `executable=true`, cero bloqueos y 62 archivos por
descartar, junto a 9 ventas, 1 devolución, 2 cambios y 3 clientes elegibles.
Dos archivos ajenos, configuración y promoción, quedan fuera. Evidencia
resumida: `evidence/h150-verification.json`.

## Riesgo residual y pendientes

Falta publicar y verificar el cliente. El usuario debe revisar el resumen,
descargar respaldo y confirmar su limpieza. Los conteos pueden cambiar con
nueva actividad; el hash exige recalcular el plan cuando corresponde. No se
inspeccionó físicamente el archivo local de EIFBB1 ni se borró: el rechazo
servidor impide ejecutar las identidades descartadas. Se conserva evidencia
técnica para auditoría en vez de eliminarla físicamente.

## Referencias

- `docs/03-known-risks.md`, H-150.
- `docs/02-architecture.md`, limpieza y archivos de cuarentena.
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`.
- `docs/fixes/recuperacion-dirigida-h149.md`.
- `docs/architect/decisions/ADR-014-autoridad-confirmada-cola-y-cache.md`.
