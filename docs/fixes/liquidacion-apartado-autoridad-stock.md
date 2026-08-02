# La liquidación de apartados confirma el stock con autoridad remota

**Riesgo:** H-65  
**Estado:** RESUELTO Y PUBLICADO · migraciones 150/300/400/450 pendientes de
aplicar en Supabase  
**Fecha:** 01/08/2026  
**Commit:** `c39b567`

## Problema y reproducción

Al liquidar `BG-260728-0004`, el cliente registró el estado `Pagado` y un
movimiento `Venta · -1`, pero el producto `imp-1784582003842-2`, talla `B`,
seguía mostrando 3 piezas. El comparador `BG-260729-0011` sí mostraba la talla
`0` de 3 a 2. El producto objetivo comparte SKU con otro registro, por lo que la
primera hipótesis atribuyó el incidente a una selección ambigua por SKU.

La reproducción fijada contra el commit anterior (`HEAD`) ejecuta:

```text
node test-h65-layaway-liquidation.mjs --reproduccion
4/26 verificaciones contra HEAD
```

Las cuatro guardas históricas pasan y faltan los 22 contratos preventivos de
H-65. La evidencia remota se obtuvo en transacciones `REPEATABLE READ READ ONLY`
y permitió decidir sin inferencias: **E1 CONFIRMADA**.

Las definiciones desplegadas antes de corregir tenían estas huellas:
`reserve_sale_stock()` `124a0f3f39c4e1d93a4120543f970616`, `commit_sale()`
`d2a4449b17cc0b1f233b3742348b9c32` y la función del trigger de venta
`46063d1d6e2ac5a2b751d1ee384368e4`. El trigger `BEFORE` estaba habilitado y
exigía reserva para una venta pagada; no había una falla de esas autoridades.

## Causa raíz

La reserva de `BG-260728-0004` ya había descontado la pieza durante el abono
parcial del 30/07/2026:

- operación `ef547feb-9bf3-457b-b5c5-f8846b4b510c`;
- reserva exacta de `imp-1784582003842-2`, talla `B`, cantidad 1;
- creada `2026-07-30 22:52:53.341363Z`, al mismo tiempo que el abono de $200;
- snapshot posterior de la variante: 3 piezas.

Después de esa reserva no existen devoluciones, cambios, préstamos, ajustes ni
conflictos de sincronización sobre la variante objetivo que expliquen otro
valor.

El apartado recuperado desde Supabase no declaraba `_stockRequired=false`.
`pushSale()` interpretaba `sale._stockRequired !== false` como permiso para
reservar, de modo que el abono parcial reservó inventario aunque el documento
seguía en `Apartado`.

Al liquidar el 01/08/2026, `finalizarApartado()` volvía a descontar el espejo
local, creaba el movimiento y persistía venta/producto antes de conocer la
respuesta remota. El servidor reutilizó correctamente la reserva anterior por
el mismo `operation_id` y devolvió el stock autoritativo en 3; la reconciliación
sobrescribió el decremento local temporal. La interfaz presentó ese reemplazo
como si la liquidación no hubiera descontado la prenda.

Los dos productos con SKU `1-ALS-ML-CCAP-T` **no causaron este incidente**:
ambos permanecieron en talla `B = 3` y la reserva identifica expresamente el
producto objetivo. La duplicidad sigue siendo un riesgo independiente para
documentos históricos sin `productId`, por lo que ahora el fallback ambiguo se
bloquea en lugar de elegir el primer producto.

## Diseño

La liquidación cumple estas invariantes:

1. `productId` es la identidad primaria; SKU sólo es compatibilidad histórica y
   debe ser único para poder adoptarse.
2. El cliente nunca convierte un intento en confirmación. Sólo
   `stock_reserved=true` y el `reservation_operation_id` exacto confirman stock.
3. Reserva, estado `Pagado`, pago final, movimiento, vendedores y ledger se
   confirman en una sola transacción remota idempotente.
4. Un replay conserva `operation_id`, pago y efecto único. Una reserva previa
   aplica el snapshot remoto y no descuenta otra vez.
5. La respuesta autoritativa se persiste como una unidad local. Un journal
   previo permite rollback dirigido si falla cualquiera de las cinco cachés.
6. Mientras una liquidación está pendiente, sólo sus productos quedan
   bloqueados; el resto del catálogo conserva el modelo local-first.
7. La decisión E1 prohíbe cualquier ajuste de inventario para este incidente.
8. Una sola pestaña del navegador es dueña de la escritura local. Las demás
   quedan en lectura y ninguna liquidación ocurre sin ese arrendamiento.
9. Dos reservas con las mismas líneas expresan la misma intención aunque el JSON
   difiera en orden o repita pares. Sólo un contenido realmente distinto se
   rechaza, y siempre como `operation_mismatch`.

### Concurrencia entre pestañas

`localStorage` es compartido por todas las pestañas del mismo origen: dos copias
en memoria pueden persistir arreglos completos y la última en escribir gana. Con
una liquidación en vuelo eso significaba perder la respuesta autoritativa.

La escritura local se arrienda ahora con `navigator.locks` bajo el nombre
`balam-pos-local-writer-v1`:

- la pestaña que obtiene el candado **reconstruye las once colecciones desde la
  caché durable** antes de habilitar cualquier mutador, de modo que hereda lo que
  la pestaña anterior confirmó y no lo pisa con memoria vieja;
- las demás pestañas muestran «Otra pestaña está operando» y no mutan nada;
- `assertLocalWriter(true)` —arrendamiento obligatorio— protege
  `applySaleCommitResult()` y los locks de liquidación; `assertLocalWriter(false)`
  protege el resto de los mutadores;
- un navegador sin Web Locks **falla cerrado**: puede vender, pero no liquidar.
  Un descuento de inventario nunca depende de una garantía que no existe;
- al cerrarse la pestaña activa, la siguiente toma el relevo, rebasa sus cachés y
  vuelve a hidratar la cola durable.

Del lado remoto la defensa es independiente de la del navegador y cubre también
dos terminales distintas: `pg_advisory_xact_lock(operation_id)`, la unicidad de
`operation_id` en el ledger H-65 y el rechazo `layaway_already_liquidated` de los
dos wrappers genéricos.

### Reservas equivalentes con distinto orden

`reserve_sale_stock()` conserva desde siempre el JSON que recibió y compara los
reintentos por igualdad exacta. La frontera H-65 deriva una representación
canónica —agrupada por `product_id`+`talla`, ordenada— desde los renglones del
apartado. Un apartado histórico cuya reserva se creó con otro orden, o con el
mismo par en dos renglones separados, describía la misma intención con otro JSON:
el core respondía conflicto y bloqueaba una liquidación cuyo inventario ya estaba
correctamente descontado.

La frontera compara ahora **canónico contra canónico** y, cuando coinciden,
entrega al core `prior.lines` **tal cual está persistido**, sin normalizar la
representación. Así la reserva se reconoce idempotente, el inventario no se toca y
`sale_commit_authoritative_state()` conserva su comparación exacta. Si el
contenido canónico difiere —otro producto, otra talla, otra cantidad—, o la
reserva pertenece a otro folio, o sus líneas son inválidas, la respuesta es
`operation_mismatch` con un `reason` explícito y **cero efectos**: las adopciones
legacy de `operation_id` y `product_id` se revierten antes de devolver.

## Solución

- `balam/data.jsx`: elimina el decremento definitivo previo al servidor;
  resuelve por `productId`; bloquea SKU ambiguo; aplica venta, productos, pago,
  movimiento y vendedores desde una sola respuesta; añade journal recuperable,
  rollback, razones de resincronización tokenizadas y locks durables por
  producto, incluidos borrados y restablecimientos administrativos; arrienda la
  escritura local con `navigator.locks` y reconstruye las once colecciones al
  tomar el relevo. La cola durable se consulta por `CORE.invokeSync`: DATA no
  conoce a STORE.
- `balam/store.jsx`: marca los apartados descargados como no reservables,
  confirma stock sólo desde la respuesta, conserva identidad de renglón y
  comisión, encola una liquidación por folio, mantiene IDs estables, clasifica
  rechazos permanentes, devuelve el pago autoritativo original en replays, exige
  la pestaña de escritura para encolar y aplicar, y bloquea toda venta genérica
  que llegue tarde al mismo folio.
- `balam/layaway.jsx`: espera la confirmación asíncrona y no anuncia éxito a una
  operación pendiente.
- `balam/app.jsx`: una pestaña sin arrendamiento se presenta en lectura, con la
  causa visible y sin pintar pantallas que invitarían a capturar.
- `balam/inventory.jsx` y `balam/settings.jsx`: impiden borrar o reemplazar datos
  que participan en una liquidación todavía pendiente.
- `20260801010100_pos_h65_atomic_layaway_liquidation.sql`: añade identidad al
  kardex nuevo, snapshots de comisión, ledger H-65, estado explícito de reserva,
  adopción histórica auditada y la frontera atómica de seis argumentos. Los
  cores permanecen privados; sólo los wrappers `checked` se exponen.
- `20260801010200_pos_h65_atomic_layaway_liquidation_verification.sql`: prueba en
  la base real atomicidad, replay, reserva previa, adopción legacy, SKU
  duplicado, rollback tardío, H-52, comisión, ACL, `deny`, usuario inactivo y
  limpieza de fixtures.
- `20260801010150_pos_h65_verification_template_seed.sql` y
  `…10450_…_verification_template_cleanup.sql`: en una instalación limpia crean y
  eliminan exactamente una plantilla de producto para que las verificaciones 102
  y 104 puedan clonar un esquema que evoluciona. En producción, que ya tiene
  catálogo, ambas son no-op.
- `20260801010300_pos_h65_legacy_reservation_lines.sql`: adopta la representación
  exacta de una reserva anterior equivalente, rechaza como `operation_mismatch`
  cualquier contenido realmente distinto y añade a los dos wrappers genéricos el
  candado de folio y el rechazo `layaway_already_liquidated`. La redefinición se
  genera desde `pg_get_functiondef()` y **aborta** si el texto desplegado derivó
  de lo que esta migración espera sustituir (R-DB-03).
- `20260801010400_pos_h65_legacy_reservation_lines_verification.sql`: prueba con
  fixtures propios el orden equivalente, el rechazo con rollback de adopciones,
  el replay, la falla tardía, los commits genéricos tardíos y la ACL; además toma
  la huella del inventario real antes y después y **aborta si movió una sola
  pieza**.

No hubo corrección de datos. Tampoco existe reversión de `+1`: ejecutarla sería
introducir una pieza inexistente porque la reserva anterior ya había hecho el
único descuento correcto.

## Pruebas

La pasada final ejecutó **las 67 suites del repositorio** después del último
cambio. **64 suites quedaron verdes con 1,679 verificaciones**; las tres
restantes fallan exactamente igual en `HEAD` y no pertenecen a H-65 (ver
«Fallas preexistentes»).

Cobertura directa de esta corrección:

- `test-h65-layaway-liquidation.mjs` (contrato estático): **35/35**, y **4/35
  contra `HEAD`** con `--reproduccion`, que conserva la prueba roja;
- `test-h65-layaway-e2e.mjs` (dominio real del bundle): **28/28**, incluidas
  pestaña secundaria en lectura, relevo cross-tab con rebase y navegador sin Web
  Locks fallando cerrado;
- `test-store-queue.mjs`: **133/133**, con liquidación durable, reintentos y
  `operation_mismatch` como conflicto permanente;
- `test-layaway-screen.mjs`: **55/55**;
- `test-sale-coherence.mjs`: **20/20**;
- `test-return-deadline.mjs`: **38/38**;
- `test-module-contracts.mjs`: **41/41** — DATA vuelve a no depender de STORE;
- `test-discount-trace.mjs`: **65/65** sobre la nueva costura `saleItemFromRow`;
- `test-migrations.mjs`: **31/31**;
- `test-build-reproducibility.mjs`: **8/8**;
- `test-smoke.mjs`: **15/15**, Supabase interceptado y cero errores de página.

Validaciones adicionales:

- `git diff --check`: limpio;
- `supabase db lint --linked --schema pos --level warning`: cero errores; tres
  advertencias históricas ajenas a H-65 (`reserve_sale_stock`, `commit_return`,
  `commit_sale_with_additional_discount`);
- `supabase migration list --linked`: 101 y 102 aplicadas; 150, 300, 400 y 450
  pendientes;
- `supabase db push --linked --include-all --dry-run`: propone exactamente esas
  cuatro y en ese orden.

La primera ejecución de la verificación 102 se revirtió completa al intentar
preparar el fixture de usuario inactivo con un JWT de vendedor todavía activo.
Se neutralizó esa identidad sólo durante la preparación administrativa, se
restauró antes de probar la frontera y el segundo despliegue concluyó con:

```text
H65 atomic=ok legacy_adoption=ok ambiguity=deny commission=ok acl=ok
idempotence=ok rollback=ok h52=ok status=ok wrappers=ok cleanup=ok
```

### Fallas preexistentes ajenas a H-65

Se comprobaron contra un *worktree* de `HEAD`, donde fallan idénticas:

| Suite | Falla | Causa |
|---|---|---|
| `test-additional-discount.mjs` | «Configuración ofrece la pantalla de beneficios» | el título vive en `balam/screens.jsx` desde el registro de pantallas; la prueba sigue buscándolo en `settings.jsx` |
| `test-concurrency.mjs` | «ambas terminales leen la misma versión inicial» | el arnés de nube simulada no devuelve la fila tras el primer `pullDomain` |
| `test-liquidations.mjs` | `pushRows(liquidations)` en liquidar y en corte | `liquidarComision()` y `cerrarMes()` llaman `save(LS_LIQ, …)`, no `saveLiquidations()` |

No se tocaron: corregirlas es trabajo propio, con su propio riesgo y su propia
evidencia. Quedan anotadas aquí para que no se confundan con esta corrección.

## Verificación de producción

### Primer despliegue (migraciones 101 y 102)

Snapshot predeploy: `2026-08-01 21:48:23.330764Z`.  
Snapshot postdeploy: `2026-08-01 21:52:52.696344Z`.

Ambos fueron `REPEATABLE READ`, `read_only=on`.

| Evidencia | Antes | Después |
|---|---:|---:|
| Productos totales / activos | 240 / 239 | 240 / 239 |
| Piezas remotas | 3,531 | 3,531 |
| Objetivo `imp-1784582003842-2` · B | 3 | 3 |
| Producto con SKU duplicado · B | 3 | 3 |
| Comparador `imp-1784582003839-0` · talla `0` | 2 | 2 |
| Reservas / ventas / commits | 21 / 21 / 29 | 21 / 21 / 29 |
| Filas del ledger H-65 | no existía | 0 |
| Fixtures H-65 residuales | 0 | 0 |

Huellas idénticas antes/después: productos
`a524a9ce3d2c25ad740ff4b962fdf39d`, reservas
`373311603b15d64a135a9b2f779a7a87`, commits
`b4e1aca62cfc094e6fceaae79ae9423f`, ventas sin las dos columnas nuevas
`c39d123ad8f6538483be8d2b4f67d8c5` y paquete objetivo
`928b5dad5dd98d7c358a87fa1723393c`.

Las 21 ventas históricas conservan `comision` y `comision_base` en `NULL`; el
único cambio de su hash completo es la presencia esperada de esas columnas. Los
cuatro archivos LevelDB del perfil local conservan exactamente longitud y
SHA-256 predeploy, por lo que no se modificaron el espejo local ni la única cola
bloqueada de vendedores. No existe operación H-65 pendiente capaz de repetir el
descuento.

El artefacto de ese primer despliegue medía 8,781,680 bytes con SHA-256
`81F72FD809F88DAD3367A533A998FE30C98D0DEB0BC5349C2E516971FAF06ABB`.

### Segundo despliegue (concurrencia entre pestañas y reservas equivalentes)

**El paquete se publicó; las cuatro migraciones restantes NO se aplicaron.**

Artefacto publicado por el hook `post-commit` en
`https://david14081982.github.io/POS_Balam/` desde el commit `c39b567`:
8,788,159 bytes, SHA-256
`3C8610F9D4B7E02BCE8996E4F3686973F92FE504B318781CFA6119258123E394`.
`index.html` y `POS Balam (offline).html` son copias exactas.

El archivo servido se descargó y se comparó: antes del despliegue tenía SHA-256
`2C1153AA91D049A35A30BEEB85EB5FE1B24F2DD18A74C7A989691C7E69C319E5` con 8,769,520
bytes; después coincide **byte por byte** con el local.

| Migración | Estado remoto |
|---|---|
| `20260801010100` frontera atómica | **aplicada** |
| `20260801010200` verificación de la frontera | **aplicada** |
| `20260801010150` plantilla de verificación (no-op en producción) | pendiente |
| `20260801010300` reservas equivalentes y candado de folio | pendiente |
| `20260801010400` verificación de reservas equivalentes | pendiente |
| `20260801010450` limpieza de plantilla (no-op en producción) | pendiente |

`supabase db push --linked --include-all` fue **rechazado por la política de
permisos del entorno de trabajo**, no por la base ni por la migración. El dueño
debe ejecutarlo. La cadena está lista y probada en seco:
`db push --dry-run` propone exactamente esas cuatro, en ese orden, y `db lint`
no reporta errores.

**Ninguna pieza se movió.** El paquete publicado no ajusta inventario: la
corrección E1 prohíbe hacerlo y el código no contiene ninguna escritura de
compensación. Las cuatro migraciones pendientes tampoco pueden moverlo cuando se
apliquen:

- 150 sólo inserta la plantilla si `pos.products` **no tiene ninguna fila
  activa**; producción tiene 239, así que es no-op;
- 300 sólo hace `create or replace function`, `grant`/`revoke` y `comment`, y
  **aborta** si el texto desplegado no coincide con lo que espera sustituir;
- 400 crea y borra únicamente sus propios fixtures (`h65-reservation-*`,
  `H65-VERIFY-RESERVATION-%`) y ahora toma la huella `md5` de `id=stock` de todo
  el catálogo antes y después: si difiere, lanza
  `H65_VERIFICATION_MOVED_REAL_INVENTORY` y la transacción entera se revierte;
- 450 sólo borra la fila `__h65_verification_template__`, ausente en producción.

Cada una corre dentro de su propio `begin/commit`: cualquier excepción revierte
todo lo suyo.

Mientras 300 no esté aplicada, el comportamiento remoto sigue siendo el del
primer despliegue: un apartado histórico cuya reserva tenga otro orden de líneas
recibe `operation_mismatch`, la cola se marca como conflicto permanente y **no
se descuenta nada dos veces**. Falla cerrado, igual que hoy.

La protección entre pestañas es del navegador y **ya está activa** con el
paquete publicado: no depende de ninguna migración.

No se ejecutó ni se eliminó la cola bloqueada de vendedores. No se tocó H-66.

## Riesgo residual y pendientes

- **Pendiente único de H-65:** aplicar `20260801010150`, `20260801010300`,
  `20260801010400` y `20260801010450` con
  `supabase db push --linked --include-all`, y conservar la salida de las dos
  `raise notice` de la 400 (`H65 inventory_before=…` / `inventory_after=…`) como
  evidencia remota de que el catálogo no se movió.
- Un documento histórico sin `productId` y con SKU duplicado queda bloqueado
  para revisión. Es una defensa intencional: nunca se elegirá un producto por
  azar.
- Un navegador sin Web Locks puede vender pero no liquidar apartados. Es
  deliberado; los navegadores usados en tienda sí lo soportan.
- El snapshot local completo conserva 240 productos y 3,523 piezas, mientras la
  autoridad remota conserva 239 activos y 3,531 piezas. Esa diferencia global
  ya existía antes de H-65; no afecta la variante objetivo —local y remoto
  coinciden en 3— y no se mezcló con esta corrección ni con H-66.
- Ningún riesgo de corrección de datos queda abierto para H-65.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-65.
- Autoridades: `docs/architect/authorities/inventory.md` y
  `docs/architect/authorities/sales.md`.
- Playbooks: `docs/architect/playbooks/sync.md`,
  `docs/architect/playbooks/database.md` y
  `docs/architect/playbooks/financial.md`.
