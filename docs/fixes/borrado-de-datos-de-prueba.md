# El borrado de datos de prueba dejaba operaciones vivas y el inventario torcido

**Riesgo:** H-68
**Estado:** RESUELTO
**Fecha:** 02/08/2026
**Commit:** `f397e92`

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

## Migraciones y despliegue

`supabase db push --dry-run --linked` declaró las dos como pendientes; el push
las aplicó por PRIMERA vez, y PostgreSQL lo probó con sus avisos —
`policy "active_admin_select" for relation "pos.test_data_purges" does not exist,
skipping` y los cuatro equivalentes de los disparadores— que sólo aparecen cuando
el objeto no existía (`AP-08`). `supabase migration list --linked` las muestra
aplicadas en local y remoto con fecha `2026-08-02 01:05:00` y `01:06:00`.

La verificación `20260802010600` corrió **contra la base real**: montó su
escenario, ejecutó la limpieza completa, comprobó existencias restauradas,
idempotencia, lápidas y denegación al no-administrador, y lo deshizo todo. Sus
comprobaciones finales —`H68_ROLLBACK_INCOMPLETE_ROWS`,
`H68_ROLLBACK_INCOMPLETE_STOCK`, `H68_ROLLBACK_INCOMPLETE_CONFIG`,
`H68_FIXTURES_SURVIVED`— habrían abortado el push si un solo documento, una sola
pieza o un solo byte de la configuración del dueño hubiera cambiado. No abortó.

Artefacto publicado con `f397e92`: **8 803 579 bytes**, SHA-256
`616b1d05491afe14e6a058e4a0f29b7e9d7301ef7a5cfde1fee9cc200c101fa0`, idéntico al
`git show HEAD:index.html` del commit. (El archivo del disco pesa 8 803 750 bytes
y su SHA-256 es `35bda40c…`: Git normaliza CRLF→LF al versionar, así que la
comparación válida es contra el blob del commit, que es lo que GitHub Pages
sirve.)

**Verificación sobre el sitio publicado** —`https://david14081982.github.io/POS_Balam/index.html`,
sin iniciar sesión, con el escenario completo (venta, apartado, devolución,
cambio y préstamo)— **11 pasaron, 0 fallaron**: el paquete expone las siete
funciones nuevas, borra los cinco tipos de documento, restaura el inventario de
24 → 22 → **24 piezas**, conserva productos y descuentos, la huella de
configuración no se mueve (`9d40f13a-12865`) y la segunda ejecución no vuelve a
tocar el inventario.

## Corrección posterior · `DELETE requires a WHERE clause`

**Síntoma.** Al pulsar el botón en el sitio publicado, el modal mostró «No se
borró nada · DELETE requires a WHERE clause». La transacción hizo rollback: ni la
nube ni la terminal cambiaron.

**Identificación exacta.**

| | |
|---|---|
| Función / RPC | `pos.purge_test_data(text)` |
| Archivo | `supabase/migrations/20260802010500_pos_h68_purge_test_data.sql` |
| Sentencias | **17** `delete from pos.<tabla>;` sin condición, líneas **465–484** |
| Primera en ejecutarse | línea **465**, `delete from pos.physical_card_redemptions;` |
| Orden | tras calcular el plan, restaurar existencias e insertar las lápidas; la primera del bloque de vaciado |
| Tablas afectadas | `physical_card_redemptions`, `exchange_items`, `exchanges`, `return_items`, `returns`, `sale_payments`, `sale_items`, `sales`, `loan_documents`, `liquidations`, `stock_reservations`, `sale_commits`, `return_commits`, `exchange_commits`, `layaway_liquidation_commits`, `sync_conflicts`, `folio_counters` |
| Respuesta de Supabase | `{"code":"P0001"…}` con `message: DELETE requires a WHERE clause`; el cliente lo devolvía como `{ ok:false, code:'REMOTE', error:… }` |

El `delete from pos.movements … where tipo in (…)` de la línea 487 y los tres
`update` sí llevaban condición. Se revisó **toda** la cadena de migraciones: los
únicos borrados sin filtro eran esos 17.

**Causa raíz.** Supabase precarga la biblioteca **`safeupdate`** —comprobado en
`pg_db_role_setting` de la instalación real por
`20260802010900_pos_h68_safeupdate_guard_verification.sql`—, que rechaza todo
`DELETE` o `UPDATE` sin `WHERE`. `db push` entra como `postgres`, **sin** esa
guarda, así que la migración se aplicó y su verificación pasó; el navegador entra
como `authenticated`, **con** la guarda. La frontera es `SECURITY DEFINER`, pero
la guarda es de **sesión**: cambiar de dueño no la desactiva, y está bien que así
sea.

**Corrección.** La guarda no se toca.
`20260802010700_pos_h68_purge_where_clause.sql` redefine la frontera para que
calcule primero el **plan de borrado** —los identificadores exactos de cada fila
a eliminar— y ejecute cada sentencia contra ese plan:

```sql
delete from pos.sales s where s.folio = any(v_sale_folios);
get diagnostics v_rows = row_count;
if v_rows <> cardinality(v_sale_folios) then
  raise exception 'purge_delete_mismatch' …;
end if;
```

Las diecisiete llevan condición **y** comprueban su propio conteo: un descuadre
aborta la transacción entera. El kardex pasa a borrarse por `id` de fila en vez
de por `tipo`, así que `Entrada`, `Ajuste` y `Transferencia` ya no dependen de un
filtro por texto: nunca entran al plan.

**Cambio de alcance declarado.** `pos.sync_conflicts` deja de vaciarse. Es
superficie de diagnóstico —del mismo lado que las bitácoras de auditoría que
H-68 ya conservaba— y ninguna pantalla la lee.

**Guardián permanente.** El arnés evalúa la definición **vigente** de cada función
`pos.*` (la última `create or replace` de la cadena, que es lo que ejecuta la
base) y falla si alguna tiene un `DELETE`/`UPDATE` sin `WHERE`. Sin la migración
correctiva el arnés da **50 pasaron, 3 fallaron** y enumera las 17 tablas; con
ella, **53 pasaron, 0 fallaron**.

**Verificación sobre lo publicado.** `node test-h68-boton-publicado.mjs`
descarga el `index.html` del sitio, comprueba su SHA-256 contra el blob del
commit y lo sirve para **accionar la interfaz real** —Configuración → Datos de
demostración → botón → modal—: **17 pasaron, 0 fallaron**. Incluye responder a la
frontera con el error EXACTO que rompió el botón (se lee en pantalla con su
código `P0001` y no se borra nada) y después con el contrato real: el informe
enumera el borrado por módulo, el inventario vuelve de **22 → 24** piezas, la
huella de configuración no se mueve y el reintento reusa el mismo ticket antes de
liberarlo. El sitio exige inicio de sesión, así que el recorrido se hace sobre
los bytes descargados servidos en local: es el mismo archivo, byte a byte, y lo
único que cambia es el origen.

**Lo que no se pudo probar dinámicamente, declarado.** `load 'safeupdate'` está
prohibido para el rol de migraciones (`access to library "safeupdate" is not
allowed`, 42501), así que la guarda no puede **armarse** dentro de una migración
para ejecutar la limpieza bajo ella. El vínculo se cierra por deducción sobre
hechos comprobados, no por conjetura: la guarda existe en esta instalación
(comprobado), sólo rechaza sentencias sin `WHERE` (su definición), y la frontera
desplegada no tiene ninguna (comprobado leyendo `pg_get_functiondef`, no el
archivo).

## Riesgo residual y pendientes

- La ejecución REAL del botón sobre la nube la decide el dueño: exige sesión de
  administrador y borra de verdad. La frontera ya corrió íntegra sobre la base
  real dentro de la verificación (y se deshizo), así que lo único no ejercitado
  es la pulsación con credenciales.
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
