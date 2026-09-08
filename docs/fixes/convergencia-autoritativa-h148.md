# Convergencia autoritativa y cola durable

**Riesgo:** H-148
**Estado:** RESUELTO
**Fecha:** 08/09/2026
**Commit:** `acf53bf` (motor, SQL y certificación), `31d5aca` (espera determinista de CI)

## Problema y reproducción

La flota podía mostrar un checkpoint vigente con una proyección incompleta o
no persistida. Una operación offline dependía de una colección local que un
arranque podía reemplazar. La recuperación archivaba también pendientes
válidos. El usuario necesitaba comprobar A/B/C contra Supabase, sin recurrir a
Punto Cero para operaciones ordinarias.

Línea base aislada: `origin/main` en `02f95ba`; el árbol original del usuario,
con trabajo sin publicar, se preservó. El proyecto enlazado publicó protocolo
3, época 7 y 15 dominios activos. Tres instalaciones H142 reportaban 17/10/1
pendientes y requerían recuperación. La telemetría no guarda esos payloads y
no demuestra su contenido ni permite reconstruirlos desde el servidor.

## Causa raíz

- Los adaptadores de persistencia descartaban errores: reproducción inicial
  **19/26** comprobaciones de durabilidad; el coordinador no podía distinguir
  aplicación durable de intento fallido.
- Versión cero se confundía con ausencia de trabajo; un cursor adelantado y
  una caché dañada podían parecer actuales. La primera matriz de coordinación
  pasó **1/5** antes de corregir esas rutas.
- `upsert` y perfiles reconstruían intenciones desde `DATA`; configuración
  esperaba el debounce antes de encolar. Hubo reproducciones específicas de
  pérdida tras caché ausente, recarga y configuración pendiente.
- Un ACK incompleto o un conflicto recuperado podía consumir la intención.
  Las bajas además aceptaban `base+1` sin exigir tombstone y podían adoptar la
  versión del competidor. Pruebas rojas **11/13**, **12/13** y **31/32**;
  las mismas rutas pasan **13/13** y **32/32**. La comprobación adicional de
  checkpoint de rebootstrap reprodujo **13/14** y quedó en **14/14**: tampoco
  publica el cursor en memoria antes de confirmar su persistencia.
- Confirmar una venta/devolución actualizaba la versión base de un snapshot
  de inventario ajeno aún pendiente; eso podía habilitar existencias anteriores.
  La reproducción pasó de **14/15** a **15/15**. Sólo una confirmación de
  escritura de la misma clase autoriza rebasar una intención aún no enviada;
  un recibo financiero no convierte un reemplazo obsoleto en vigente.
- Una marca remota de limpieza histórica ejecutaba la ruta de autoridad
  local; el arranque real intentó publicar perfiles/colecciones y RLS lo
  rechazó. Ahora el origen remoto permanece remoto.
- La liquidación SQL del apartado reinsertaba `sale_items` con una lista de
  columnas anterior a V2. La prueba A/B/C y la verificación real reprodujeron
  `H148_FROZEN_LINE_IDENTITY_LOST`: la línea estaba identificada antes de
  liquidar y perdía sus metadatos después.

## Diseño

Supabase confirma; la cola durable contiene intención exacta no confirmada;
las colecciones locales son proyecciones reconstruibles. Se conservan
local-first, guardas de actividad/escritor, contratos V1/V2, RLS, stock SQL,
identidad por `products.id`, SKU/barcode y comprobantes históricos.

Recibir → validar cobertura/versión → aplicar → persistir y verificar →
avanzar cursor. Realtime sólo invalida. La reconciliación periódica funciona
sin WebSocket. Un snapshot completo admite conjunto vacío y reemplaza sólo
cuando no hay intención/actividad protegida; una ventana parcial no poda
fuera de su cobertura.

Las RPC comerciales existentes siguen siendo autoridad de venta, devolución,
cambio, préstamo, apartado y comisión. No se creó un segundo motor financiero.
Se reparó el motor de sincronización y se reemplazaron las reglas inseguras de
reconstrucción de payload, checkpoint y recuperación indiscriminada.

## Solución

`STORE.synchronizeNow()` unifica la cabecera y «Actualizar este equipo»:
manifiesto, envío de pendientes válidos, espera, descarga, reconciliación y
verificación. Expone estado humano, hora de éxito y diagnóstico administrativo.
Punto Cero conserva sus restricciones excepcionales.

Se añadieron checkpoints durables, comprobaciones de actividad tras lecturas
asíncronas, snapshots completos de ventas y reconciliación cada minuto con
revisión completa cada cinco minutos. Los payloads enviados se congelan;
ediciones posteriores sólo adoptan versiones de confirmaciones aceptadas.
Clientes, vendedores y promociones publican IDs explícitos, y configuración
persiste la intención antes de demorar su envío.

Las migraciones `20260908018200` y `20260908018300` preservan los ocho campos
congelados de `sale_items` al liquidar. El parche se generó desde la función
remota vigente, con guardas de hash antes/después. No reescribe datos
históricos, cambia firmas, ACL, RLS ni importes. La verificación crea filas
propias dentro de un subbloque que revierte siempre; comprueba identidad,
respuesta, replay, stock, pago único y acceso denegado.

### Mapa de autoridad y sincronización

Son **15 dominios de protocolo y 16 proyecciones certificables**: los ajustes
de comisión pertenecen al dominio `sellers`.

| Dominio/proyección | Tablas de autoridad | Escritura y recepción |
|---|---|---|
| products | products, barcode_aliases, reference_reclassifications | RPC versionada por IDs/familia; snapshot completo y ledger de movimientos |
| clients | clients | Intención por IDs, RLS/versiones/tombstones; snapshot |
| sellers y commissionAdjustments | sellers, commission_adjustments | Perfil acotado y RPC de comisión; snapshot conjunto |
| promotions | promotions | Intención por IDs y baja lógica; snapshot |
| sales | sales, sale_items | Commit SQL idempotente; historial completo con líneas |
| payments | sale_payments | Pagos/RPC de apartado y cambio; snapshot |
| returns | returns, return_items | Commit SQL; documento con líneas congeladas |
| exchanges | exchanges, exchange_items | Commit SQL; documento con identidad de origen |
| loans | loan_documents | Operación versionada; documento congelado completo |
| liquidations | liquidations | RPC comisión; snapshot y periodo derivado |
| movements | movements, reference_reclassifications | Sólo commits SQL; lectura completa y ledger |
| config | lookup, settings, config_sync_state | commit_config atómico; snapshot completo |
| permissions | screen_permission_catalog, screen_permission_catalog_state, permission_roles, user_permission_role_assignments, role_screen_permissions, user_screen_permission_overrides, operational_capabilities, role_capability_permissions, user_capability_overrides | AUTH/RPC/administración autorizada; refresco durable |
| purges | test_data_purges, purged_documents, selective_cleanup_events | Marcas de autoridad; aplicación/reconstrucción protegida. Certificación no ejecuta Punto Cero sobre negocio |
| devices | sync_devices, sync_activity, sync_conflicts, sync_quarantine_cases | Heartbeat/órdenes/diagnóstico; nunca autoridad comercial |

Las tablas restantes no son colecciones editables ni réplicas paralelas:
`sale_commits`, `return_commits`, `exchange_commits`,
`layaway_liquidation_commits`, `config_commits`, `stock_reservations` y
`folio_counters` son recibos/idempotencia/reservas SQL;
`physical_card_redemptions` se consulta por RPC en la operación que consume el
beneficio; `permission_change_audit` y `capability_operation_audit` son auditoría;
`system_manifest`, `sync_domain_versions`, `inventory_contract_state` y
`inventory_sync_baselines` gobiernan contrato y coordinación;
`test_data_cleanup_backups`, `test_data_cleanup_operations`,
`inventory_v3_backups`, `inventory_v3_operations`, `inventory_v1_v2_map`,
`point_zero_backups` y `point_zero_operations` conservan migración/recuperación.
Las 57 tablas `pos` observadas tienen así un responsable explícito.

Storage contiene archivos referenciados por las filas; no decide existencias
ni documentos. Auth conserva identidad/sesión. Preferencias visuales,
impresora, pestaña escritora, borradores y cola pertenecen a la instalación;
no se propagan como datos confirmados de tienda.

## Pruebas

Evidencia de trabajo: `C:/tmp/balam-h148-evidence`. Los ensayos parciales se
marcan `NOT CERTIFIED / SKIP`; no acreditan la matriz completa.

- `node test-h148-reconciliation.mjs`: **15/15**.
- `node test-h148-projection-durability.mjs`: **32/32**.
- `node test-store-queue.mjs`: **186/186**.
- `node test-h138-registration-sql.mjs --delete-cycle --delete-browser`:
  **55/55**, PostgreSQL aislado y formulario real para referencia/familia.
- Contratos de módulos **42/42**, identidad V2 **49/49**, apartado **35/35**,
  comisiones **95/95**, foco de actualización **20/20**, carreras H142 **5/5**,
  smoke **15/15** y responsive **492/492**. Pasaron además fronteras de
  escritura H95, familias H101, contrato V3 H133, devolución H71/H72, cambio,
  préstamo, permisos/sesión, reset/purga y recuperación de escritor H147.
- `node test-h148-sync-certification.mjs --self-test`: rechaza **14** falsos
  certificados; esta autoprueba no certifica Supabase.
- Migraciones: **31/31** controles de cadena; SQL real rojo antes del parche,
  verde con rollback de función y semillas, verde durante `db push`.
- Función instalada comprobada: MD5 `cf66ef2e110f9ea197860f3409b072c7`;
  ACL y `security_definer/search_path` preservados; ambas versiones aparecen
  en el historial remoto.
- Matriz real final: **21/21**, tres perfiles Chrome independientes contra
  Supabase; **16/16 proyecciones**, cero pendientes perdidos y cero divergencias.
  Evidencia: [h148-live-matrix.json](evidence/h148-live-matrix.json). El gate
  completo pasó después de limpiar semillas y comparar las 17 tablas previas.
- HTML definitivo SHA-256:
  `2ef20021e02fb3d704eb8a314818fa18e40ae17148d74d460df68b33881a921d`.
  Un checkout limpio reconstruyó los mismos bytes, incluido el service worker.
- Etiquetas/identidad: H132 **7/7**, su certificador **2/2**, H127 **11/11**,
  H99 **23/23**, H100 **10/10**. Cambio **36/36**, devolución **29/29**,
  identidad posventa **16/16**.
- CI detectó que el caso 40f de cola suponía un envío iniciado tras 10 ms:
  **185/186**. Ahora espera la llamada real retenida por el transporte,
  comprueba ambos payloads y espera el drenado: **186/186**. Esta corrección
  sólo cambia la prueba; el HTML y el certificador real permanecen idénticos.
- El HTML descargado de Pages pasó **32/32** comprobaciones de durabilidad.

### Publicación

Publicado en [GitHub Pages](https://david14081982.github.io/POS_Balam/).
Comprobado el 08/09/2026 a las 07:59 UTC: `index.html` y
`POS Balam (offline).html` coinciden byte a byte con el artefacto certificado
(9 045 359 bytes, SHA-256 arriba). `sw.js` coincide con
`ee8b61616176649fc78da4e89f27c05251f32e677b792180220baff81fc7db05`.
Chrome cargó el build H148 servido por Pages en 320/1280 px, sin overflow ni
excepciones de página. Supabase confirmó ambas migraciones y el dry-run final
indicó que la base está al día.
Evidencia: [h148-pages.json](evidence/h148-pages.json).
CI del commit `31d5aca`: [H148 aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34202215121),
[H132 aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34202215259)
y [Pages aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34202213562).

### Certificador permanente

```powershell
node build-offline.mjs
$env:BALAM_SYNC_LIVE='1'
$env:BALAM_TEST_OUTPUT='C:/tmp/balam-sync-evidence'
node test-h148-live-convergence.mjs
node test-h148-sync-certification.mjs C:/tmp/balam-sync-evidence/matrix.json
```

Requiere Chrome y CLI Supabase autenticada. La clave de provisión sólo vive en
Node; A/B/C usan Auth y RLS reales. El entorno debe ser el preproduction
existente. Se crean referencias V2 válidas y usuarios/documentos propios; la
limpieza usa exclusivamente sus IDs y compara hashes de 17 tablas de negocio
antes/después (excepto timestamps `updated_at`). Los contadores de folio y
versiones son monotónicos: los huecos de prueba no se revierten.

CI exige `docs/fixes/evidence/h148-live-matrix.json` del mismo HTML y
certificador, con menos de 24 horas, en PR/push que cambian código, artefactos,
migraciones o el propio contrato. No basta pasar sus tests aislados. Cambios
exclusivamente documentales no obligan a repetir operaciones de negocio.
`.gitattributes` conserva los bytes de los artefactos generados y fija LF en
el certificador para que Git no invalide sus hashes al publicar desde Windows.
Las regresiones y la validación del certificado no necesitan secretos.
La certificación real es una ejecución
manual de `h148-sync-authority.yml` exclusivamente sobre `main`, serializada,
con `SUPABASE_ACCESS_TOKEN` configurado. Sin credencial, matriz completa o
evidencia de menos de 24 horas del mismo artefacto/certificador, falla cerrada.
AGENTS, BALAM QA y `R-SYNC-16/17` exigen esta evidencia para funciones
distribuidas. Las pruebas con mocks siguen siendo regresión, nunca sustituto.

## Riesgo residual y pendientes

Sin divergencias conocidas en el artefacto certificado y publicado.
Las instalaciones físicas antiguas deberán reconectarse con su almacenamiento
original para procesar/revisar sus intenciones; 17/10/1 declaradas no equivalen
a 28 payloads recuperados. No se descartaron ni se inventaron esas operaciones.
Un conflicto comercial real permanece visible y requiere revisión; no se
resuelve sobrescribiendo otra venta o existencia. Cuota insuficiente conserva
el bloqueo hasta poder persistir.

## Referencias

- `docs/03-known-risks.md#h-148`
- `docs/architect/decisions/ADR-014-autoridad-confirmada-cola-y-cache.md`
- `docs/architect/playbooks/synchronization.md`
- `docs/02-architecture.md`
