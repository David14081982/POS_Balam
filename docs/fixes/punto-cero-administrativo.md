# Punto Cero administrativo permanente y seguro

**Riesgo:** H-98
**Estado:** RESUELTO Y DESPLEGADO; BORRADO REAL DETENIDO
**Fecha:** 12/08/2026
**Commits técnicos:** `80b5234`, `345b53d`

## Problema y reproducción

H-68 borraba operaciones y restauraba stock, pero conservaba productos. La
pantalla Datos de demostración mantenía además dos caminos locales directos.
No había modo preproducción/producción, preview remoto sellado, respaldo ligado
a la ejecución, confirmación fuerte ni comprobante. La línea base
`test-h98-punto-cero.mjs` fue **2 pasaron, 18 fallaron**.

Resultado esperado: una herramienta sólo administrativa que deje productos,
piezas y operación en cero, conserve configuración/identidades/permisos y nunca
pueda ejecutarse desde el flujo normal en producción.

## Causa raíz

Era un contrato ausente, no un fallo de H-68. Existían dos capacidades:
purgar pruebas conservando inventario y establecer una línea base de
sincronización también conservando inventario. Ninguna respondía "¿qué se
eliminará y puede aprobarse exactamente este estado para dejar toda la
operación en cero?".

## Diseño

La autoridad queda en cuatro RPC administrativas:

- `point_zero_preview()` obtiene conteos reales, SHA-256, esquema, época, modo,
  equipos, cola y bloqueos; produce `preview_token`.
- `create_point_zero_backup()` recalcula el preview y persiste en
  `point_zero_backups` todos los datos eliminables, con actor, fecha, equipo,
  build, esquema, conteos y huella.
- `execute_point_zero()` exige administrador activo, `settings.manage`, modo
  `preproduction`, respaldo coincidente, preview sin cambio, frase exacta y
  sincronización completa. Usa candado, `operation_id` e idempotencia.
- `point_zero_receipt()` proyecta el comprobante desde la auditoría.

La ejecución compone `purge_test_data()` de H-68 dentro de su transacción; no
reimplementa los documentos. Después elimina lo que H-68 conserva. Cualquier
excepción revierte ese bloque.

La UI reutiliza la identidad histórica `config.demo`, ahora visible como
**Administración / Datos**. No aparece si `AUTH.canAccess()` la deniega. El
botón queda deshabilitado en producción y PostgreSQL repite esa guarda.

## Tablas exactas

Se eliminan por plan cerrado y condición `WHERE`:

- inventario: `products` y todos los `movements` restantes;
- ventas/apartados: `sales`, `sale_items`, `sale_payments`,
  `physical_card_redemptions`, `stock_reservations`, `sale_commits`,
  `layaway_liquidation_commits` y `folio_counters`;
- posventa: `returns`, `return_items`, `return_commits`, `exchanges`,
  `exchange_items` y `exchange_commits`;
- operación: `loan_documents`, `liquidations`, `commission_adjustments` y
  `reference_reclassifications`;
- clientes: filas no genéricas de `clients`.

Se actualizan, sin eliminar identidades: acumulados transaccionales de
`sellers`; `system_manifest.data_epoch`; `sync_devices`; versiones de dominio y
la marca `_resetMark`. Se insertan metadatos en `test_data_purges`,
`purged_documents`, `point_zero_backups` y `point_zero_operations`.

Se conservan: `settings` salvo la marca técnica, `lookup`, `_catalogMeta`,
`sellers` y Supabase Auth, promociones, roles, catálogos de pantallas y
capacidades, asignaciones/overrides de permisos, auditorías, conflictos,
cuarentena, PWA, Storage, RLS, RPC y migraciones. La huella preservada incluye
configuración, catálogos, personal, Auth y las cuatro familias de permisos.

## Solución

- Migraciones `20260812013900` y `20260812014000`: modo, respaldo, auditoría,
  RPC y verificación autocontenida.
- `balam/store.jsx`: RPC, guardas locales, ticket idempotente y documentos.
- `balam/data.jsx`: `applyPointZero()` local sin escrituras remotas.
- `balam/settings.jsx` y `balam/screens.jsx`: sección, modo y wizard.
- Artefactos regenerados con `node build-offline.mjs`.

## Pruebas

- Línea base H-98: 2/20; final **20/20**.
- Wizard E2E con fixtures sintéticos: **18/18**.
- Migraciones: **31/31**; migración remota 14000 notificó
  `structure=ok permissions=ok plan=ok ROLLBACK=ok production=guarded`.
- H-68 **53/53**; H-76 **38/38**; cola **176/176**; permisos UI
  **21/21**; roles **15/15**; navegación **15/15**; contratos **42/42**;
  registro **12/12**; build **8/8**; smoke bundle **17/17**.
- El smoke de desarrollo agotó 30 s al cargar Babel tras la regresión
  encadenada; el artefacto distribuido precompilado pasó completo.

## Despliegue y punto de parada

Las dos migraciones están aplicadas en el proyecto enlazado y su verificación
no ejecutó Punto Cero sobre datos del negocio. El cliente del commit `80b5234`
se envió a `origin/main`. GitHub Pages sirve exactamente su blob `index.html`
`7d73cb9dabef16eceaf98a821242905a32cd25a3`: 8,969,403 bytes y SHA-256
`c6af545ff8e4cab2b0f1bd384bad7dd21832bdcbce4c0cfd42d827680027a8da`.

No se llamó `execute_point_zero`, no se borraron los **1,378 productos**
actuales, no se cargó inventario real, no se importó Excel, no se imprimieron
etiquetas y el modo permanece `preproduction`. La ejecución real requiere una
nueva autorización explícita del dueño.

## Riesgo residual y pendientes

- El respaldo es JSON completo y verificable; todavía no existe una RPC de
  restauración. El rollback durante la ejecución sí es automático por SQL.
- Todos los equipos registrados deben estar en línea y limpios. Un equipo
  retirado debe revocarse administrativamente antes.
- `purged_documents` conserva identidades mínimas contra resurrección, no el
  payload eliminado.

## Corrección del diagnóstico invisible — 13/08/2026

### Reproducción y causa raíz

En los bytes publicados, «Actualizar diagnóstico» sí ejecutaba
`STORE.pointZeroPreview()` y `setPreview(r)`. No había error de click, RPC, RLS
ni transición de estado: la tarjeta jamás renderizaba `preview.counts`; sólo el
modal del flujo destructivo incluía `PointZeroCounts`. Por eso el administrador
no veía ningún cambio al pulsar el botón.

### Cambio quirúrgico

- la tarjeta renderiza el preview autoritativo completo bajo **Se eliminará** y
  **Se conservará**, con `generated_at` del servidor;
- el RPC de lectura enumera las 24 métricas del plan cerrado, incluidas
  `sale_items`, `return_items`, `exchange_items`, reservas, commits y folios;
- al iniciar una consulta o recibir un error se invalida el preview anterior;
  el error queda visible y la continuación permanece deshabilitada;
- el cliente rechaza respuestas incompletas; respaldo y ejecución conservan su
  recálculo y comparación de `preview_token`, de modo que un cambio de datos
  exige actualizar y aprobar otro preview.

No cambió `execute_point_zero()` ni se llamó respaldo, ejecución o purga.

### Pruebas y despliegue

- prueba visual roja: 4/9; verde: **9/9**;
- contrato H-98 **24/24** y wizard sintético **18/18**;
- H-68 **53/53**, H-76 **38/38**, permisos **83/83**, navegación **15/15**,
  migraciones **31/31**, arranque precompilado **5/5**;
- migración remota 14200: preview real dentro de `ROLLBACK`; productos
  **1,378 → 1,378** y piezas **3,334 → 3,334**;
- Pages: commit `345b53d`, blob
  `8122ef6696b2706981de32e0775fb6ea6f39780d`, 8,970,531 bytes, SHA-256
  `179c0b03da8e3c6974a448fff60a843ce05f60e24cc7aa5420d3b4bc10a110c0`;
- recorrido autenticado real: click exclusivo en «Actualizar diagnóstico»,
  conteos remotos visibles, sello temporal visible, cero errores y cero
  peticiones a respaldo/ejecución/purga.

Evidencia: `.evidence-h98-visible-preview/resultado.json` y
`.evidence-h98-visible-preview/diagnostico-pages.png`.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-98
- Antecedentes: H-68, H-76, H-77
- Decisiones: ADR-004, ADR-005, ADR-006, ADR-008 y ADR-012
