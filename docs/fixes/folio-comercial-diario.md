# Folio comercial corto con consecutivo diario

**Riesgo:** H-33
**Estado:** RESUELTO
**Fecha:** 27/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El folio visible de una venta se veía así en producción:

```text
BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H
```

29 caracteres. Sobresalía del ticket impreso, se partía en tres líneas en la
lista de Devoluciones y estiraba las columnas de Reportes y del historial.

Reproducción: `node test-folio-diario.mjs` sobre el código anterior no existía;
la evidencia directa son las cinco ventas reales de `pos.sales`, cuyos folios
van de `BG-1-1WUEU8VWHIXDI76K6MJHCKC77` a `BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H`, y
la captura de Devoluciones donde `BG-260727-0001` aún se partía en tres
renglones por el ancho fijo de la columna.

## Causa raíz

`DATA.nextFolio()` construía el folio como
`prefijo + consecutivo local + '-' + token`, donde el token era la
representación en base 36 de los 128 bits del UUID `operation_id` (25
caracteres). Esa era la solución de H-02: como el consecutivo local no es único
entre terminales, se le adosó la identidad técnica para garantizar unicidad.

Es decir: el identificador técnico interno estaba **expuesto dentro del folio
comercial**. La causa del folio largo no es un problema de presentación, sino
que un solo campo cumplía dos funciones incompatibles —ser globalmente único y
ser legible para una persona—.

## Diseño

Se separan definitivamente las dos responsabilidades:

| | Identificador técnico | Folio comercial |
|---|---|---|
| Campo | `sale._operationId` / `pos.sales.operation_id` | `sale.folio` / `pos.sales.folio` |
| Forma | UUID v4 | `{PREFIJO}-{AAMMDD}-{0001}` |
| Usos | reserva de stock, commit idempotente, conflictos, cola offline | ticket, tablas, búsqueda, devoluciones, reportes |
| Visible | no | sí |

El folio ya **no deriva** de la identidad técnica y la identidad técnica no
deriva del folio.

### Unicidad sin alargar el folio

Un consecutivo diario calculado localmente no puede ser único entre terminales
—dos terminales offline empezarían ambas en `0001`— y "leer el último y sumar
uno" es exactamente lo que H-02 rechazó. Las alternativas evaluadas:

1. **Asignación central con reserva local por bloques.** Elegida.
2. Identificador de terminal dentro del folio: cambia el formato aprobado.
3. Sólo resolución de conflicto al sincronizar: con dos terminales vendiendo el
   mismo día, casi todos los folios de la segunda terminal se renombrarían
   después de imprimir el ticket.
4. Folio provisional y definitivo al sincronizar: afecta el ticket, excluido
   expresamente por el alcance.

La opción 1 encaja con la arquitectura real: ya existen RPC transaccionales
idempotentes, cola offline durable y una defensa `folio_conflict` en
`commit_sale()`. El contador vive en Supabase; la terminal reserva un rango y lo
consume **sin red**, así que una venta offline nace con folio corto y
definitivo.

Contrato completo:

- `pos.folio_counters(prefix, business_date, last_seq)` es la autoridad del
  consecutivo. Sólo `pos.reserve_folio_block()` lo escribe.
- Cada terminal reserva bloques de 10 y repone cuando le quedan 3 o menos, al
  arrancar, al reconectar y después de cada venta.
- El bloque es por (prefijo, día): al cambiar el día se pide uno nuevo y la
  numeración reinicia en `0001`.
- El día del folio sale de la **misma** fecha que se guarda en la venta, no de
  una segunda lectura del reloj: una venta a las 23:59 no puede quedar partida
  entre dos días.
- El consecutivo se rellena a cuatro dígitos y crece a cinco a partir de 10000
  sin truncarse.
- Los folios históricos no se migran, no se interpretan como formato nuevo y no
  participan en el consecutivo diario.

### El folio impreso no cambia nunca

La primera versión de esta corrección dejaba una contradicción real: dos
terminales sin bloque y sin red imprimían ambas `BG-260727-0001` y una se
renombraba al sincronizar, dejando dos tickets físicos con la misma referencia y
sin forma de distinguirlos. «Una venta confirmada nunca se renombra» era cierto
sólo para `_syncStatus === 'synced'`, no para una venta ya cobrada e impresa.
El contrato quedó así:

- **Sin bloque, el folio lleva el código de la terminal**:
  `BG-260727-0001-K7Q`, tres caracteres base 36 derivados de `balam_device_id`.
  Se distingue de un vistazo, es corto y es **definitivo**: no se renombra al
  sincronizar. Dos terminales no pueden imprimir la misma cadena.
- **Con bloque, el formato va limpio**: `BG-260727-0001`. El sufijo aparece
  únicamente cuando no hay reserva disponible.
- **Alias histórico para el residuo**: si aun así la nube rechaza el folio —dos
  terminales con el mismo código, una en 46 656, o una operación heredada de
  H-02—, `STORE` reidentifica la venta y el folio ya impreso se conserva para
  siempre en `sale.folioAliases` y en `pos.sales.folio_aliases` (índice GIN). La
  operación no sale de la cola hasta que la nube guarde ese alias.
- **Resolución sin ambigüedad**: `DATA.findSaleByFolio()` da prioridad absoluta
  a la coincidencia por folio vigente y sólo después consulta los alias, contra
  la venta que realmente los imprimió. Un ticket nunca ofrece la venta ajena que
  casualmente comparta la cadena.
- **La interfaz lo explica**: al resolver por alias, Devoluciones muestra
  «Ticket … · registrado como …» en la lista y «este ticket se registró
  posteriormente como …» en el detalle; el ticket reimpreso añade la fila
  «Ticket impreso» con el folio que conserva el cliente.
- **Orden en la cola**: una devolución no se envía mientras la venta que la
  origina siga en la cola —pendiente, fallida o con folio sin resolver—, para
  que `commit_return` no pueda bloquear otra venta con el mismo folio impreso.

## Solución

- `balam/data.jsx` — autoridad única. `normalizeFolioPrefix()`,
  `businessDate()`, `folioFromParts()`, `parseFolio()`, `folioPreview()`,
  `terminalCode()`, `folioBlockRequest()`, `applyFolioBlock()` y un
  `nextFolio()` que ya no concatena la identidad técnica. `rekeySaleFolio()`
  guarda el folio impreso en `folioAliases`; `findSaleByFolio()`,
  `saleFolioAliases()` y `folioAliasHit()` resuelven e informan. Reserva
  persistida en `balam_pos_folio_v2`; el contador global anterior
  (`balam_pos_folio_v1`) ya no se usa y los reinicios locales borran ambas
  claves. `collisionSafeFolio()` se conserva para los folios históricos.
- `balam/store.jsx` — `ensureFolioBlock()` reserva bloques mediante
  `pos.reserve_folio_block()` en el arranque, al reconectar y a petición de
  `DATA` por el gateway de `CORE`. `replacementFolio()` resuelve un
  `folio_conflict` con otro número corto del contador y sólo cae al token
  histórico cuando el folio no tiene formato H-33. Tras el commit, persiste el
  alias en `pos.sales.folio_aliases` **antes** de marcar la venta como
  sincronizada; `fetchSaleByFolio()` consulta también por alias; `flushQueue()`
  retiene las devoluciones cuya venta sigue en cola.
- `balam/config.jsx` — el ajuste `folio.prefix` pasa de `BG-` a `BG`.
- `balam/settings.jsx` — Configuración → Negocio normaliza el prefijo con la
  misma autoridad que genera el folio y muestra la vista previa real del día.
- `balam/returns.jsx` — la columna del folio se dimensiona para mostrarlo
  completo en una línea; la búsqueda acepta alias y la interfaz avisa con qué
  folio quedó registrado el ticket.
- `balam/pos-ticket.jsx` — el ticket reimpreso agrega la fila «Ticket impreso»
  cuando la venta tiene alias. El bloque financiero de H-32 no se tocó.
- `supabase/migrations/20260727004100_pos_h33_daily_folio.sql` — contador y RPC.
- `supabase/migrations/20260727004200_pos_h33_daily_folio_verification.sql` —
  verificación autocontenida contra la base real.
- `supabase/migrations/20260727004300_pos_h33_folio_aliases.sql` — columna
  `folio_aliases` con índice GIN.
- `supabase/migrations/20260727004400_pos_h33_folio_aliases_verification.sql` —
  verificación del alias contra la base real.
- `supabase/LIMPIAR-PRUEBAS.sql` — vacía también el contador diario, como ya
  hacía el reinicio local.
- `index.html` y `POS Balam (offline).html` regenerados desde `balam/`.

No se modificaron precios, IVA, descuentos, promociones, comisiones,
devoluciones ni `commit_sale`/`commit_return`.

## Pruebas

Locales:

- `node test-folio-diario.mjs`: 60/60 (nuevo). Cubre consecutivo diario, cambio
  de día, prefijo, >9999, medianoche, histórico H-02, dos terminales con y sin
  bloque, códigos de terminal distintos y estables, alias local, búsqueda por
  alias, devolución por alias, mensaje de folio actual y la prioridad del folio
  vigente sobre el alias.
- `node test-folio-concurrency.mjs`: 12/12 (reescrito). Sobre `index.html`:
  dos terminales sin bloque no imprimen la misma cadena, bloques disjuntos,
  reinstalación, reimpresión por alias y el aviso visible en Devoluciones.
- `node test-store-queue.mjs`: 115/115 (18 casos nuevos, secciones 30-32):
  reserva de bloque, conflicto residual con alias remoto, devolución retenida
  hasta sincronizar su venta y venta que no se marca sincronizada si el alias
  no llegó a la nube.
- `node test-migrations.mjs`: 29/29 (5 checks nuevos).
- Regresión: coherencia de venta 17/17, devoluciones 17/17, descuentos 43/43,
  trazabilidad H-32 65/65, comisiones 10/10, comisión efectiva 22/22,
  liquidaciones 10/10, concurrencia 9/9, roles 10/10, contratos de módulos
  36/36, elegibilidad 10/10, avatares 13/13, exportación 14/14, XLSX 17/17,
  SDK 4/4, build reproducible 8/8, smoke bundle 17/17, navegación 13/13,
  entradas E2E 8/8, filtros 18/18, reset local 19/19, reset propagado 21/21,
  fotos automáticas 11/11, importación 23/23, imágenes 5/5.
- `node build-offline.mjs`: correcto, 67 assets.

Chrome real sobre `index.html`:

- venta nueva → `BG-260727-0001`, con `_operationId`
  `a863d47a-b849-4e24-9fff-fc8f9d84da45` (UUID separado del folio);
- ticket impreso: `TRANSACCIÓN — BG-260727-0001` en una sola línea;
- Devoluciones: el folio se muestra completo en un renglón;
- Configuración → Negocio: «Así se verá hoy: BG-260727-0001»; al escribir
  `ab-1` el prefijo se normaliza a `AB1`, la vista previa pasa a
  `AB1-260727-0001` y la venta anterior conserva `BG-260727-0001`.

Supabase (proyecto `Balam`, migración 004200, con limpieza total):

- contrato del contador: tabla, llave `(prefix, business_date)`, RLS activo y
  ninguna policy de escritura;
- reserva atómica: terminal A `1..10`, terminal B `11..20`, sin solape; el
  prefijo `bg-` se normalizó a `BG`; un piso menor no hizo retroceder el
  contador;
- venta nueva aceptada con folio `BG-260727-0001`;
- segunda terminal con el mismo folio provisional: `folio_conflict`, sin
  insertar, y reconciliación corta a `BG-260727-0022`;
- las cinco ventas reales anteriores a H-33 conservaron sus folios
  (`BG-1-1WUEU8VWHIXDI76K6MJHCKC77` … `BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H`);
- limpieza: filas temporales eliminadas y el contador devuelto a su estado
  previo.

Supabase (migración 004400, alias, con limpieza total):

- una venta nueva nace con `folio_aliases = []`;
- el folio impreso `H33ALS-260727-0001-K7Q` localizó su venta
  `H33ALS-260727-0022` mediante `folio_aliases @> [...]`;
- el alias no existe como folio vigente de ninguna otra venta;
- la restricción rechaza un `folio_aliases` que no sea arreglo;
- ninguna venta real tiene alias y no quedó rastro temporal.
  `db push --dry-run` posterior: «Remote database is up to date».

## Riesgo residual y pendientes

- El folio impreso no cambia ni se repite. La única forma de que dos tickets
  compartan cadena es que dos terminales distintas produzcan el mismo código de
  tres caracteres (1 en 46 656) **y** estén ambas sin bloque **y** en el mismo
  día **y** en el mismo consecutivo. Ese residuo no pierde datos: la nube lo
  rechaza, la venta se reidentifica y el folio impreso queda como alias
  permanente, buscable y devolvible desde cualquier terminal.
- Una terminal sin bloque emite folios con sufijo: son más largos (18
  caracteres) y visiblemente distintos de los normales. Es intencional; ocurre
  sólo mientras la terminal no haya conectado en el día.
- Con dos terminales activas el mismo día, la segunda empieza en `0011` y no en
  `0001`: los bloques son disjuntos por diseño. Los saltos también aparecen si
  se reinstala el navegador a media jornada.
- Si la nube confirma la venta pero rechaza la escritura del alias, la operación
  permanece en cola y se reintenta; el commit es idempotente por hash. Mientras
  tanto el alias existe localmente en la terminal que lo imprimió.
- Las ventas anteriores a H-33 conservan su folio largo por diseño; seguirán
  ocupando más espacio en ticket, tablas y exportaciones.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-33--folio-comercial-largo-por-identidad-técnica-expuesta`
- Arquitectura: `docs/02-architecture.md#identidad-y-folio-de-venta`
- Antecedente: `docs/fixes/folios-multi-terminal.md` (H-02)
