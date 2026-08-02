# El borrado de datos de prueba dejaba operaciones vivas y el inventario torcido

**Riesgo:** H-68
**Estado:** RESUELTO
**Fecha:** 02/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`Configuración → Datos de demostración → «Borrar datos de prueba (conserva
inventario)»` debía dejar el sistema como antes de empezar a operar. No lo hacía.

**Reproducción** (`node test-h68-purga-datos-prueba.mjs`, fase «ANTES», que ejecuta
el artefacto del commit anterior obtenido con `git show HEAD:index.html`):

Con 20 piezas de dos productos, una venta de 4 y un cambio que devuelve 1 del
producto A y entrega 1 del producto B, el botón dejaba:

| Comprobación | Antes del cambio |
|---|---|
| Documentos de cambio borrados | **no** — sobrevivía 1 |
| Movimientos `Cambio (entra)` / `Cambio (sale)` | **2 huérfanos**, sin documento |
| Existencias del producto A | **21** de 20 — inventaba una pieza |
| Existencias del producto B | **19** de 20 — perdía una pieza |
| Reglas de descuento configuradas | **borradas** (0 de 1) |
| Operación AJENA en la cola de sincronización | **descartada** |
| Autoridad transaccional / resumen previo | **no existían** |

Las seis afirmaciones de esa fase pasan hoy contra el paquete anterior: el defecto
era real y reproducible.

## Causa raíz

`resetTestData()` en `balam/data.jsx` se escribió cuando el producto sólo tenía
ventas y devoluciones, y nunca se extendió con los módulos posteriores.

1. **Entidades omitidas.** No tocaba `exchanges` (H-37), ni sus movimientos, ni la
   aplicación de beneficios físicos, ni los diarios de confirmación, ni las
   reservas de inventario. `persistAllLocal()` tampoco persistía `LS_EXCHANGES`.
2. **Reversión por SKU.** El stock se revertía con `bySku[sku]`, no con
   `productId` ni con la identidad interna de la talla (`ADR-011`), y sólo
   consideraba ventas y devoluciones. Un cambio movía el inventario en dos
   sentidos y ninguno se deshacía: de ahí el 21/19 de la tabla.
3. **Descuentos tratados como dato operativo.** Borraba `promos`, que es
   configuración; lo operativo de un descuento es su aplicación, y esa vive
   dentro de la venta.
4. **Sin autoridad transaccional.** La limpieza era una secuencia de borrados en
   el navegador, más un archivo SQL que el dueño tenía que correr aparte
   (`supabase/LIMPIAR-PRUEBAS.sql`). Sin transacción común, la nube podía quedar
   vacía con el stock viejo, o al revés.
5. **La cola se vaciaba entera.** `clearQueue()` descartaba también operaciones
   ajenas a los datos borrados.
6. **Las terminales apagadas resucitaban lo borrado.** `applyResetMark()` corría
   DESPUÉS de `flushQueue()` en `init()` y, además, se rendía si la terminal
   tenía cola pendiente. Un equipo apagado encendía, subía sus ventas de prueba a
   la nube recién limpiada y reaparecían en todas las demás en el siguiente pull.

## Diseño

**La limpieza es una transacción del servidor.** `pos.purge_test_data(p_purge_id)`
calcula el plan de restauración, lo aplica, vacía lo operativo, pone en cero los
acumulados, **comprueba dentro de la misma transacción** que no quedó nada y que
la configuración no se movió, y sella una época. Cualquier fallo deshace todo.

**La restauración se deriva de los documentos, por identidad.** Nunca de una
cifra capturada:

| Documento | Efecto que tuvo | Reversión |
|---|---|---|
| Venta cobrada | descontó | devuelve las piezas (por su reserva) |
| Apartado | no descontó | nada |
| Apartado liquidado | descontó una vez | devuelve una vez |
| Devolución | reingresó | las retira |
| Cambio | entró lo devuelto y salió lo entregado | deshace **los dos** lados |
| Préstamo | no mueve existencias | nada |

La identidad es `product_id` + identidad interna de talla. Un renglón histórico
sin `product_id` se resuelve por SKU **sólo si es inequívoco**; si resuelve a dos
productos, la operación entera se detiene antes de tocar nada, porque no se puede
saber a cuál devolver las piezas. Un producto que ya no existe se informa aparte:
no hay existencia que restaurar.

**La configuración es una invariante comprobada, no una promesa.**
`pos.config_fingerprint()` resume catálogos, ajustes, descuentos, productos sin
existencias con la identidad de sus tallas, vendedores sin acumulados y el modelo
de permisos completo. Se toma antes y después; si difiere, la limpieza se
deshace. El cliente hace lo mismo con `DATA.configFingerprint()` y lo enseña en
el informe final.

**La época viaja a las terminales apagadas.** `pos.test_data_purges` guarda una
época monotónica que cualquier terminal autenticada lee con
`pos.test_data_purge_state()`. En `init()`, `applyRemotePurge()` corre **antes**
de `flushQueue()`: invalida las operaciones pendientes de datos ya borrados,
limpia la terminal y registra la época. Es el orden lo que impide la
resurrección.

**Las lápidas son la última defensa.** `pos.purged_documents` guarda la identidad
TÉCNICA —`operation_id` / `id`, nunca el folio, que se reinicia con
`folio_counters` (`ADR-001`)— de cada documento borrado, y cuatro disparadores
`before insert` rechazan su reinserción con `operation_purged`. `classifyFailure`
lo trata como conflicto permanente: se ve en el panel de sincronización en vez de
reintentarse en bucle.

**La cola se invalida, no se vacía.** `pruneQueueForPurge(corte)` descarta los
documentos (venta, devolución, cambio, préstamo, comisión) y las cargas masivas de
tablas borradas; **conserva** la configuración, las bajas de catálogo y todo lo
capturado después del corte. Las cargas masivas de productos, vendedores y
clientes se **reconstruyen** desde el estado ya limpio, después del pull, para que
un alta capturada sin red sobreviva sin arrastrar existencias viejas.

**Decisión declarada:** `pos.capability_operation_audit` y
`pos.permission_change_audit` NO se borran. Son evidencia de seguridad, no
reportes del negocio.

## Solución

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260802010500_pos_h68_purge_test_data.sql` | `pos.test_data_purges`, `pos.purged_documents`, `pos.purge_test_data()`, `pos.test_data_purge_state()`, `pos.config_fingerprint()`, `pos.total_stock_pieces()`, `pos.reject_purged_document()` y sus cuatro disparadores |
| `supabase/migrations/20260802010600_..._verification.sql` | verificación autocontenida (`ADR-004`) |
| `balam/data.jsx` | `testDataFootprint()`, `configFingerprint()`, `totalPieces()`, `stockEntryByIdentity()`, `purgeStockDeltas()` y `resetTestData()` reescrito con rollback local |
| `balam/store.jsx` | `purgeTestData()`, `applyRemotePurge()`, `pruneQueueForPurge()`, `rebuildPurgedUpserts()`, `readPurgeState()`, orden de `init()` y `operation_purged` en `classifyFailure` |
| `balam/settings.jsx` | modal de confirmación con el resumen previo y el informe final por módulo |
| `supabase/LIMPIAR-PRUEBAS.sql` | pasa a ser una llamada a la misma autoridad |

`resetTestData()` conserva `false` como respuesta EXCLUSIVA del lock de
liquidación de apartado (H-65); en el resto devuelve un informe.

## Pruebas

`node test-h68-purga-datos-prueba.mjs` → **49 pasaron, 0 fallaron**, incluidas las
seis de la fase «ANTES» sobre el artefacto del commit anterior.

Cobertura de los 17 casos exigidos:

| # | Caso | Comprobación |
|---|---|---|
| 1 | venta → stock vuelve | `RESTAURA las existencias al valor previo` |
| 2 | apartado sin duplicar | `el apartado NO descontó existencias` |
| 3 | apartado liquidado una vez | `el apartado liquidado descontó una vez` |
| 4 | devolución revertida | `la devolución reingresó su pieza` |
| 5 | cambio revierte sus dos efectos | `el cambio movió inventario en los dos sentidos` + A/B restaurados |
| 6 | préstamo limpiado | `BORRA préstamos` |
| 7 | vendedores en cero | `pone en cero ventas y comisiones del vendedor` |
| 8 | reglas de comisión intactas | `CONSERVA al vendedor con su contraseña, % y meta` |
| 9 | descuentos intactos | `CONSERVA las reglas de descuento intactas` |
| 10 | clientes de prueba fuera | `BORRA los clientes de prueba y deja el genérico` |
| 11 | usuarios y permisos intactos | huella de configuración idéntica (incluye permisos en SQL) |
| 12 | catálogos, tallas, precios, productos | `CONSERVA los productos idénticos` + huella |
| 13 | segunda ejecución no mueve stock | `SEGUNDA ejecución` + `la misma época no se aplica dos veces` |
| 14 | fallo intermedio → rollback | `un fallo de la autoridad remota no borra nada` + `H68_ROLLBACK_INCOMPLETE_*` en SQL |
| 15 | nada reaparece al sincronizar | invalidación selectiva + lápidas (`H68_PURGED_SALE_RESURRECTED`) |
| 16 | dos terminales o pestañas | `una segunda pestaña no puede limpiar` + época propagada |
| 17 | sin regresiones H-65/H-66 | `test-h65-layaway-liquidation` 35/35, `test-h65-layaway-e2e` 28/28, `test-h67-size-headers` 27/0 (identidad de talla de H-66) |

Regresión: `test-reset-pruebas.mjs` 19/0 · `test-reset-propaga.mjs` 21/0 ·
`test-store-queue.mjs` 133/0 · `test-h65-layaway-liquidation.mjs` 35/35 ·
`test-h65-layaway-e2e.mjs` 28/28 · `test-sale-coherence.mjs` 20/0 ·
`test-exchange-commit.mjs` 32/0 · `test-loans-sync.mjs` 69/69 ·
`test-operational-capabilities.mjs` 40/0 · `test-permissions-model.mjs` 13/0 ·
`test-discounts.mjs` 43/0 · `test-returns.mjs` 17/0 · `test-migrations.mjs` 31/0 ·
`test-module-contracts.mjs` 41/0 · `test-smoke.mjs` 15/0 ·
`test-ui-navigation.mjs` 15/0 · `test-build-reproducibility.mjs` 8/0 ·
`test-ux-metrics.mjs` sin retroceso (11 interacciones, 2 validaciones).
`test-h66-canonical-code.mjs` no se ejecuta: es el arnés de reproducción de H-66
y él mismo declara que no pertenece a la suite de regresión.

Dos arneses fallan **igual antes y después del cambio** (comprobado con
`git stash` sobre `balam/` y los artefactos): `test-concurrency.mjs` aborta en su
paso 1 y `test-liquidations.mjs` da 8/2. No los toca esta historia.

## Riesgo residual y pendientes

- La limpieza sigue siendo **global**: no existe «borrar sólo lo de este mes».
  Es deliberado — el botón dice «datos de prueba», no «datos seleccionados».
- Las lápidas de `pos.purged_documents` crecen con cada limpieza. Son filas
  mínimas (tipo + identidad) y nadie las poda todavía.
- Un renglón histórico cuyo SKU resuelve a dos productos **bloquea** la limpieza
  entera. Es la decisión correcta —no se adivina a qué producto devolver piezas—
  pero exige que el dueño desambigüe el catálogo antes de poder limpiar.
- `pos.capability_operation_audit` conserva referencias a folios ya borrados.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-68
- Autoridad remota: `supabase/migrations/20260802010500_pos_h68_purge_test_data.sql`
- Decisiones: `ADR-001` (identidad técnica vs folio), `ADR-004` (verificación
  autocontenida), `ADR-006` (la transacción vive en SQL), `ADR-011` (identidad de
  la talla)
- Historias relacionadas: H-37 (cambios), H-46 (préstamos), H-52 (beneficio
  físico), H-65 (lock de liquidación)
