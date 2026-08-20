# Limpieza selectiva exclusiva de Devoluciones

**Riesgo:** H-119
**Estado:** RESUELTO — SERVIDOR Y CLIENTE PUBLICADOS
**Fecha:** 19/08/2026
**Commit funcional:** `209b2c1`

## Problema y reproducción

El recorrido real publicado Configuración → Administración / Datos →
Limpiar datos de prueba, con únicamente Devoluciones marcado, dejó el botón
principal deshabilitado y mostró un conflicto genérico. La auditoría de los
bytes publicados encontró 0 devoluciones reales, 0 partidas y ningún efecto de
stock. La RPC devolvió además `commission_evidence_missing` por la venta
conservada BG-260810-0011, aunque la selección no tenía ningún documento que
limpiar. En paralelo, el foco del propio checkbox registró actividad `config`:
`STORE.syncStatus()` estaba sincronizado, con cola y bloqueos en cero, mientras
`CORE.activityStatus()` declaraba una actividad.

Una ejecución PostgreSQL aislada demostró el defecto de integridad más grave:
al borrar una devolución, `execute_test_data_cleanup()` seleccionaba movimientos
por `return_id` y también por el folio comercial compartido. El segundo criterio
eliminaba tanto el movimiento Devolución como el movimiento Venta, aunque la
venta original permanecía. `DATA.applySelectiveCleanup()` repetía el mismo
alcance por folio en la proyección local.

## Causa raíz

Una devolución y su venta de origen comparten folio, pero no identidad durable.
El movimiento posventa tiene `movements.return_id`; usar el folio para borrarlo
viola el alcance semántico de «Devoluciones». Además, una selección válida sin
documentos podía conservar un `plan_hash` ejecutable en bases sin otra guarda y
elevar la época sin borrar nada. Finalmente, la guarda genérica de foco de
Configuración incluía el panel administrativo, de modo que interactuar con la
limpieza producía el estado local que la misma limpieza prohíbe.

## Diseño

- Devoluciones se seleccionan y eliminan por `returns.id`.
- Sus partidas, commit y movimiento moderno se eliminan por `return_id`. Un
  movimiento legacy sin esa columna se identifica por tipo `Devolución` +
  folio; el folio solo nunca amplía el alcance ni alcanza a la Venta.
- El plan con una selección comercial no vacía y cero documentos antepone
  `cleanup_no_matching_data`, permanece no ejecutable y conserva el diagnóstico
  técnico restante.
- Administración / Datos no crea borradores de configuración. Sus controles no
  registran actividad `config`; las guardas propias de sincronización, flota,
  protocolo, época, respaldo y confirmación no cambian.
- La venta, pago, comisión congelada, producto y movimiento de venta sobreviven.
  El stock pierde exactamente las piezas que la devolución había reingresado.

## Solución

- `20260819015700_pos_h119_returns_only_cleanup.sql` modifica hacia adelante las
  dos funciones H-113: retira el folio de Devoluciones del borrado de movimientos
  y bloquea planes sin coincidencias.
- `20260819015800_pos_h119_returns_only_cleanup_verification.sql` verifica las
  definiciones instaladas y siempre termina con rollback.
- `balam/data.jsx` aplica localmente el mismo alcance exacto por `return_id`.
- `balam/shared.jsx` permite desactivar de forma explícita una guarda de foco y
  libera cualquier token activo al cambiar de sección.
- `balam/settings.jsx` excluye sólo Administración / Datos de la actividad de
  borrador, explica una selección vacía y traduce la falta de evidencia de
  comisiones sin exponer el código como mensaje principal.
- Los arneses H-117 y H-119 fijan el estado sin resultados, la ejecución real
  exclusiva de Devoluciones y la convergencia de una segunda terminal.

## Pruebas

- Rojo PostgreSQL aislado: `H119_SALE_MOVEMENT_WAS_DELETED`. Verde: preview
  10→9, devolución/partida/commit/movimiento eliminados y
  venta/partida/commit/movimiento conservados; rollback en la prueba funcional.
- E2E real UI → STORE → PostgreSQL 18 aislado: 14/14; preview, respaldo
  exacto moderno/legacy sin movimiento Venta, confirmación, una sola ejecución,
  estado local, recarga y segunda terminal.
- H-113: contrato 35/35 y UI 21/21. H-116: contrato 20/20 y UI 29/29. H-118:
  10/10. H-117 A–H: 65/65 y responsive 320–1440 px sin overflow.
- Cola 176/176; módulos 42/42; migraciones 31/31; navegación 15/15; roles
  15/15; smoke del bundle 17/17; build reproducible 8/8.
- PostgreSQL 18 temporal: H-116 A–D, H-118 A–F y verificadores H-119 verdes.
  Todos los fixtures comerciales H-119 son aislados; la funcional termina con
  rollback y el E2E limpia exclusivamente sus identidades prefijadas.

## Publicación y certificación real

- Las migraciones `20260819015700` y `20260819015800` se aplicaron al proyecto
  vinculado. El dry-run posterior confirmó `Remote database is up to date`.
- GitHub Pages run `32318296988` terminó en `success` para `209b2c1`. El HTML
  servido coincide byte por byte con el blob Git: 9,008,603 bytes, SHA-256
  `0fc59871029158c0f595ecbde8c58561e4c09f35e46ea39020aeecf168911962`.
- La repetición administrativa publicada marcó exclusivamente Devoluciones:
  conteo 0, inventario sin cambio, 2 equipos listos, 4 que se actualizarán al
  volver y 0 que requieren atención. Mostró «No hay operaciones de la selección
  para limpiar.», mantuvo el CTA deshabilitado y dejó
  `STORE.syncStatus()` sincronizado con cola 0/0 y
  `CORE.activityStatus().active=0`.
- No se abrió la confirmación ni se invocaron backup, ejecución o Punto Cero.

## Riesgo residual y pendientes

La base real conserva 0 devoluciones y 2 `return_commits` históricos sin
cabecera viva, anteriores a H-119. No se seleccionaron, borraron ni reinterpretaron:
no son una devolución comercial ejecutable y su tratamiento requiere otra
historia. La venta BG-260810-0011 conserva `comisiones=null`; si en el futuro
existe una devolución para limpiar, la guarda financiera seguirá bloqueando el
recalculo hasta reconciliar esa evidencia. H-119 sólo mejora su explicación.

La auditoría real fue read-only: no ejecutó backup, limpieza, Punto Cero,
heartbeat artificial, reintento, descarte, cuarentena, retiro ni escritura de
stock o documentos comerciales. La publicación servidor-first sólo reemplazó
las definiciones técnicas de las RPC y registró las migraciones; no modificó
filas comerciales.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-119--limpiar-sólo-devoluciones-puede-retirar-el-movimiento-de-la-venta-conservada`
- `docs/fixes/limpieza-selectiva-datos-prueba.md`
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`
- `docs/fixes/reconciliacion-sync-activity-historica.md`
- `docs/architect/authorities/inventory.md`
