# Préstamos de mercancía: el documento que faltaba

**Riesgo:** H-46 · H-48 · H-50
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** `9387e62` (H-46) · `c9618dd` (H-48) · `287ced9` (H-50, cuyo asunto dice
`H-49` por la colisión de identificadores que se explica en § Sobre la numeración)

## Problema y reproducción

El producto sabía representar mercancía que se vende, que se aparta, que se
devuelve y que se cambia. No sabía representar mercancía que **sale con la
obligación de volver**: una guayabera que un empleado se lleva puesta a un
evento, o varias piezas que un cliente se lleva a probar a su casa.

`grep -rin "prestamo" .` sobre el repositorio completo no devolvía nada: ni
colección, ni pantalla, ni campo, ni catálogo. La consecuencia operativa es que
la mercancía salía sin ningún documento que dijera quién la tiene, desde cuándo y
para cuándo la va a regresar; la pérdida no se detectaba, porque no había nada
que pudiera vencer.

**Reproducción previa al cambio:** `node test-loans-screen.mjs` contra el bundle
vigente. **0 de 2 verificaciones**: se detiene en la primera porque
`window.LoansScreen` no existe.

## Causa raíz

No es un defecto: es un **contrato ausente** (`FF-01`). Ninguna autoridad estaba
equivocada; faltaba el concepto de negocio.

La tentación era modelar el préstamo con lo que ya había —una venta de $0, o un
movimiento de inventario— y las dos habrían producido daño:

- una venta de $0 contamina el consecutivo comercial diario
  (`pos.folio_counters`), los reportes y las comisiones con documentos que no son
  ventas;
- un movimiento en `pos.movements` **se borra solo**: esa tabla es historial de
  sólo lectura para el cliente y cada pull reemplaza el arreglo local
  (`docs/02-architecture.md` § Recuperación transaccional de terminal), así que un
  movimiento de préstamo escrito localmente desaparecería en la siguiente
  sincronización.

Un préstamo es un documento propio (`FF-02`).

## Diseño

**El documento congela su evidencia.** Cada renglón guarda `nombre`, `sku`,
`talla`, `qty` y el `precio` de lista de la talla el día del préstamo; la persona
se guarda por copia, no por referencia. Editar o borrar el producto o el cliente
después no altera un préstamo ya registrado, y el valor de la pérdida no depende
de una edición posterior del catálogo (`R-DOM-02` · `AP-06`).

**Referencia comercial separada de la identidad técnica** (`R-DOM-04` ·
`ADR-001`). `id` es un UUID que no se muestra; el folio visible es
`PR-{AAMMDD}-{CONSECUTIVO}`, con su propio consecutivo derivado de los préstamos
del día que la terminal ya conoce. **No consume** el contador diario de ventas.

**El día sale del documento, no del reloj** (`R-DOM-03`). El folio y el vencimiento
se derivan de la misma fecha que se guardó en el préstamo.

**Tres autoridades nuevas**, registradas en
`docs/architect/authorities/inventory.md` (`R-DOM-06`):

| Pregunta | Autoridad |
|---|---|
| ¿cuántas unidades están fuera por un préstamo? | `DATA.loanedQty(sku, talla)` |
| ¿cuántas piezas faltan por regresar? | `DATA.prestamoPendientes(prestamo)` |
| ¿está vencido, y por cuántos días? | `DATA.prestamoAtraso(prestamo, hoy)` |

`prestamoAtraso` es el único lugar donde se decide «vencido», y lo consumen la
pantalla, el filtro, el indicador y la campana. Un préstamo devuelto o declarado
perdido nunca está vencido: ya declaró su desenlace.

**Los tres estados no son un catálogo administrable.** `pendiente`, `devuelto` y
`no_devuelto` son el contrato del módulo, no etiquetas: un cuarto estado
cambiaría comportamiento. Añadir un catálogo a `CONFIG` habría escrito además
filas nuevas en `pos.lookup` sin necesidad.

**El préstamo NO mueve existencias.** Decisión explícita y su motivo: como esta
fase no replica en la nube, un descuento de stock —que **sí** viaja a
`pos.products`— podría sobrevivir a la pérdida del registro local del préstamo y
quedar como un faltante sin explicación en todas las terminales. Se prefirió el
riesgo reversible (una pieza prestada que aparece como existencia) al
irreversible (una existencia descontada sin documento). La pantalla lo declara
donde se opera, y `loanedQty()` queda como la costura por la que Inventario o el
Punto de venta podrán mostrar «hay 5, 2 están prestadas» sin recorrer la
colección (`R-DOM-07` · `ADR-003`).

**Devolución por partes.** Cada entrega deja su asiento en `loan.devoluciones`;
la «fecha real de devolución» que pide el negocio se fija con el asiento que
completa el préstamo, y mientras falte mercancía permanece vacía. Una pieza dada
por perdida que finalmente aparece se puede devolver: el módulo no castiga al
negocio por haber declarado la pérdida.

### Idiomas de interacción reutilizados

`R-CLI-08` obliga a recorrer el flujo existente antes de proponer captura. Nada
de esta pantalla es un lenguaje nuevo:

| Pieza | Origen reutilizado |
|---|---|
| cartera, KPIs, búsqueda, `Segment`, fila con detalle desplegable, Excel, listado impreso | `balam/layaway.jsx` |
| buscador de prenda y selector de talla con precio de la talla y existencias | `balam/pos.jsx` § `SizeModal` |
| autocompletado en línea de la persona | `balam/pos-ticket.jsx` § `ClientPicker` |
| documento impreso en ventana propia | `balam/inventory.jsx` § `printLabels` |
| aviso de pendientes en la campana | `balam/app.jsx` § `NotificationsBell` |

La primera versión del selector listaba las **veinte** tallas del artículo —el
`AP-10` literal—. Se corrigió al idioma del Punto de venta: sólo las tallas con
existencia, agrupadas por escala, y un control explícito para prestar una talla
que el sistema cree agotada. El arnés lo fija: `sólo se ofrecen las tallas con
existencia` compara la lista de controles ofrecidos.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/data.jsx` | colección `loans` (`balam_pos_loans_v1`), folio propio, siete operaciones y tres autoridades; `saveLoans()` **sin** `syncUp` |
| `balam/loans.jsx` | pantalla nueva: cartera, cuatro indicadores, búsqueda, cinco filtros, fila con detalle, alta, edición, devolución, confirmaciones, vale y listado impresos |
| `balam/app.jsx` | entrada `prestamos` en el menú, título, ruta y aviso de vencidos en la campana |
| `balam/xlsx-io.jsx` | `XLSXIO.exportLoans()` |
| `balam/heritage.jsx` | `loan → assignment_return` en el mapa de íconos |
| `POS Balam.html`, `balam/_source.html` | carga de `balam/loans.jsx` |
| `test-loans-screen.mjs` | arnés nuevo, 99 verificaciones sobre el bundle |
| `test-module-contracts.mjs`, `test-ui-navigation.mjs` | orden de módulos, global publicada y pantalla navegable |

Las rutas de reinicio incorporan la colección: `persistAllLocal`, `clearAllLocal`
y `resetTestData` la tratan como dato transaccional. No hay stock que revertir,
porque un préstamo nunca lo descontó.

Las confirmaciones destructivas usan un modal propio, no `window.confirm`: la
deuda de estandarización de diálogos declarada en H-44 no crece con esta historia.

## Pruebas

Reproducción previa: `node test-loans-screen.mjs` → **0/2**, sin el módulo.

Después del cambio, sobre el artefacto distribuido:

    node test-loans-screen.mjs        99/99

Cubre el recorrido completo: pantalla en el menú, alta con producto, talla,
cantidad, persona y fechas; bloqueo y liberación de cada validación **en los dos
sentidos** (`R-DEL-11`) —sin mercancía, sin persona, con fechas incoherentes, sin
piezas en la devolución, y liberado al completarse—; folio propio que no gasta el
de ventas; evidencia congelada; inventario intacto antes y después de devolver;
que **nada se encola contra la nube**; indicadores; devolución parcial y total con
su fecha real; rechazo de devolver más piezas de las que faltan comprobado contra
la autoridad, no contra el síntoma (`FF-10`); vencidos con sus días de atraso y su
aviso en la campana; declaración de pérdida y reapertura; persistencia tras
recargar; y las tres salidas —Excel, vale con firmas, listado— con su escape de
HTML y sin una sola petición de red.

Regresión completa, toda en verde:

    test-module-contracts 38/38 · test-build-reproducibility 8/8
    test-smoke 15/15 · test-ui-navigation 15/15 · test-layaway-screen 55/55
    test-cambio-e2e 37/37 · test-exchange-screen 45/45 · test-ticket-print 23/23
    test-precio-talla-e2e 19/19 · test-returns 17/17 · test-sale-coherence 17/17
    test-reset-pruebas 19/19 · test-reset-propaga 21/21
    test-folio-diario 60/60 · test-folio-concurrency 12/12
    test-store-queue 115/115 · test-xlsx-security 17/17 · test-migrations 31/31
    test-role-access 10/10 · test-line-balance 38/38 · test-liquidations 10/10
    test-variant-price 38/38 · test-return-deadline 38/38 · test-concurrency 9/9
    test-exchange-model 28/28 · test-exchange-commit 32/32
    test-filtros-inventario 18/18 · test-export-modelo 14/14
    test-commission 10/10 · test-effective-commission 22/22
    test-eligible-sellers 10/10 · test-image-processing 5/5
    test-seller-avatars 13/13 · test-supabase-sdk 4/4

Guardián de `R-DEL-14` sin intervención: interacciones 11, validaciones 2,
recorrido completo, código 0. `R-DEL-13`, `R-DEL-15` y `R-DEL-16` **se descartan
por escrito**: esta historia no promete menos pasos ni menos coste, añade una
capacidad que no existía, así que no tiene métrica que mejorar ni línea base que
refijar.

`R-DEL-03` no aplica: la historia no toca el esquema y no hay migración que
aplicar antes del cliente.

## Despliegue

Artefactos regenerados con `node build-offline.mjs`; `index.html` es copia exacta
de `POS Balam (offline).html`. El archivo servido por GitHub Pages se verificó
idéntico byte a byte al `index.html` del commit `9387e62` (`R-DEL-07`):

    SHA-256  BFF07979BB358B54808213BD42946CCAFF66743271BCDDB754CE54540591EE7C
    bytes    8 716 917

La primera lectura devolvió todavía el artefacto anterior
(`AD7486DB…`, 8 689 492 bytes, el de H-45); la segunda, veinte segundos después,
ya servía el nuevo.

## Lector de código de barras (H-48)

La primera entrega aceptaba sólo texto: había que leer el nombre de la prenda y
teclearlo, aunque toda la mercancía lleva etiqueta `SKU-TALLA` y el negocio tiene
lector. Además de costar el doble, teclear admite equivocarse de prenda o de
talla, y el préstamo **congela** esa evidencia: el error queda escrito en el vale
que firma el cliente.

No se creó ninguna autoridad: se consume `window.BARCODES`
(`balam/barcodes.jsx`), la misma que resuelve las etiquetas en el Punto de venta,
con `find()` por coincidencia contra `codeOf(producto, talla)`. Aquí no se parsea
ni se interpreta el formato del código.

**En la captura del préstamo** se reprodujeron los tres caminos de
`balam/pos.jsx` § `onScan`, en el mismo orden: código completo → la pieza exacta
entra al préstamo sin preguntar la talla, porque ya venía en la etiqueta; SKU
exacto → abre el selector de talla; texto libre → abre la primera coincidencia.
Leer dos veces la misma etiqueta suma cantidad en el renglón que ya existe. El
buscador nace enfocado, así que el lector funciona en cuanto se abre la captura.

**Lector USB (HID) con el foco fuera del buscador.** Se replicó la captura global
de `balam/pos.jsx` con su heurística de cadencia —un lector teclea por debajo de
~30 ms por carácter, así que una pausa mayor a 50 ms reinicia el búfer— y sólo
interviene cuando la ráfaga resuelve a un código conocido: el tecleo humano nunca
se confunde con una lectura.

Con una diferencia necesaria respecto del POS: la captura del préstamo tiene
**tres campos de texto**, así que una ráfaga con el foco en «quién recibe» dejaría
el código metido dentro del nombre de la persona. Al reconocer el código se retira
del campo enfocado exactamente lo que el lector acabó de escribir
(`retirarCodigoTecleado`), verificando antes que el valor termine con ese código.
El arnés lo fija: `la ráfaga del lector no se queda escrita en el nombre de la
persona`.

**En el buscador de la cartera** una lectura responde otra pregunta: «¿quién tiene
esta prenda?». Cuando el término resuelve a una pieza, la búsqueda **ignora el
filtro de estado** —si la prenda ya volvió, la respuesta útil sigue siendo el
préstamo que la sacó— y la pantalla lo declara con un aviso que nombra la prenda,
la talla y cuántos préstamos la contienen. Si la pieza nunca salió, el mensaje
habla de la pieza y no del filtro.

Lo que **no** se hizo, por restricción deliberada: cuando el término no resuelve a
ninguna prenda del catálogo, la cartera lo trata como búsqueda de texto normal. La
detección heurística de `BARCODES.parse()` da positivo con cualquier cadena que
lleve un guion en medio —`Rodrigo-Perez` incluido—, y en el POS eso sólo elige el
texto de un aviso, donde equivocarse es inocuo. Aquí habría cambiado el mensaje de
una lista vacía por una razón adivinada.

**Pruebas de H-48:** ocho comprobaciones nuevas en la captura y cuatro en la
cartera, dentro de `test-loans-screen.mjs` → **112/112**. Regresión de cliente en
verde: contratos 38/38, navegación 15/15, smoke 15/15, apartados 55/55, E2E del
cambio 37/37, pantalla del cambio 45/45, ticket impreso 23/23, cola 115/115,
folio diario 60/60, precio por talla 19/19, devoluciones 17/17, reinicio 19/19,
inventario 18/18, coherencia de cobro 17/17, `.xlsx` 17/17, reproducibilidad 8/8.
Guardián de `R-DEL-14` intacto.

### Despliegue del lector

Artefactos regenerados y publicados en `c9618dd`; el archivo servido por GitHub Pages
se verificó idéntico byte a byte a su `index.html` (`R-DEL-07`):

    SHA-256  491086D1E500B2F3C6BE21950A5235EC3125F24D9F2C545E98917918960D1615
    bytes    8 721 377

Ese paquete incorpora también el código cliente de H-47 —comisión del excedente,
trabajada en paralelo sobre este mismo árbol—, cuyas tres migraciones se aplicaron a
la base real el 30/07/2026. Con eso quedó cerrada la divergencia que esa historia
había declarado (`comision-del-excedente.md` § Publicación).

### Una conclusión que estuvo mal, y por qué

Antes de publicar sostuve que el paquete **excluía** el código de H-47 y que sus
migraciones seguían pendientes, y sobre esa base estuve a punto de no regenerar el
artefacto. Las dos afirmaciones eran falsas, y el error fue de método:

busqué `reverseExchangeCommission` con `grep` dentro de `index.html` y, al no
encontrarlo, concluí ausencia. **El artefacto no guarda los `.jsx` en texto plano**,
de modo que esa búsqueda no puede probar nada —es `AP-09` en su forma más pura:
comprobar el síntoma en vez del mecanismo—. La propia H-47 dejó escrita la
advertencia en su documento, § Nota para quien audite el artefacto, y la leí después
de haber sacado la conclusión.

La comprobación válida es por **ejecución**: cargar el paquete y preguntar
`typeof window.DATA.reverseExchangeCommission`, que devuelve `function`. Queda como
el modo de verificar la composición de un artefacto en este proyecto; un `grep` sobre
`index.html` o sobre `POS Balam (offline).html` sólo sirve para lo que está en texto
plano, y su resultado negativo no es evidencia.

### Sobre la numeración

Tres colisiones de identificador, todas por lo mismo: **dos sesiones trabajando el
mismo árbol a la vez**, cada una tomando el siguiente número libre desde una vista
desactualizada del registro.

| Historia | Nació como | Quedó en | Por qué |
|---|---|---|---|
| Préstamos | H-46 | **H-46** | decisión del dueño del producto |
| Lector | H-47 | **H-48** | la comisión del excedente publicó H-47 primero (`be84e3c`) |
| Fechas | H-49 | **H-50** | el ingreso del cambio en Reportes publicó H-49 primero (`927eabf`) |

La regla que resuelve cada caso es la misma y no se negocia: los identificadores no se
renumeran una vez publicados (`docs/architect/README.md` § Presupuestos y
crecimiento), así que cede siempre la historia que **no** estaba en el historial
compartido. En los dos casos fue ésta, y renumerarla no costó nada porque su número
sólo vivía en documentación y en dos comentarios.

El asunto del commit `287ced9` dice `H-49` y ya no se puede corregir sin reescribir
historia publicada. La entrada de `docs/03-known-risks.md` lo declara.

Además, esa otra sesión commiteó `docs/03-known-risks.md` completo cuando el archivo
tenía dos historias mezcladas, de modo que la entrada del lector entró al historial
dentro de `be84e3c`. No hubo pérdida.

**Cómo se evita:** no trabajar dos sesiones a la vez sobre este repositorio. El hook
`post-commit` publica cada commit, así que dos sesiones no sólo se pisan los números:
compiten por el artefacto publicado. Aquí no se perdió ninguno —se comprobó por
ejecución que el paquete final contiene las cuatro historias— pero eso fue suerte de
ordenación, no una garantía del proceso.

## Fechas en día/mes/año (H-50)

La pantalla mostraba `2026-07-29`: el formato en que las fechas se **persisten**, no
el que lee una persona. Aparecía en la fila, en el detalle, en el vale que firma el
cliente, en el listado impreso y en el `.xlsx`.

`window.UI.fechaCorta()` y `window.UI.fechaHora()` —nuevas en `balam/shared.jsx`— son
la única fuente del formato visible. Nacen **compartidas** a propósito: Apartados,
Devoluciones y Reportes muestran hoy el mismo ISO, y cuando se barran deben consumir
este formateador en vez de reimplementarlo en cada pantalla (`R-DOM-01` · `AP-01`
aplicados a la presentación). Una fecha que no reconocen se devuelve intacta: nunca
se inventa una fecha.

**El formato persistido no cambia.** `fecha`, `fechaEsperada` y `fechaDevolucion`
siguen en `AAAA-MM-DD [HH:mm]`, porque de ese orden lexicográfico dependen las
comparaciones de plazo, el consecutivo del folio vía `businessDate()` y la
legibilidad de los préstamos ya registrados. Por eso `diaDe()` sobrevive en
`balam/loans.jsx` con su responsabilidad escrita en el comentario: alimenta las
comparaciones y los campos `type="date"`, que sólo aceptan ISO. Lo que se **lee**
pasa por el formateador; lo que se **compara**, no.

Cinco comprobaciones nuevas lo fijan, y no sólo afirman que aparece `DD/MM/AAAA`:
también exigen que **ninguna** cadena `\d{4}-\d{2}-\d{2}` llegue a la pantalla, al
vale ni al listado. Un descuido que devuelva una fecha a ISO falla el arnés.

## Persistencia remota (H-62)

Los préstamos dejan de vivir sólo en una terminal.

### Lo que ya existía y nadie había declarado

H-56 Fase 5 —la historia de capacidades operativas— **ya había creado el
backend**: `20260730009500/09600` crean `pos.loan_documents` y
`pos.commit_loan_operation()`, y están aplicadas y verificadas contra la base
real. `STORE.pushLoanOperation()` y las cinco llamadas de `DATA` viajaban en el
artefacto publicado desde entonces. De modo que los préstamos registrados con
sesión de administrador **ya se estaban escribiendo en la nube** mientras la
pantalla y esta documentación afirmaban lo contrario. El comentario de
`balam/data.jsx` § préstamos decía todavía «no existe tabla remota».

Lo que faltaba no era el envío, sino todo lo demás. H-62 lo completa sin crear
un segundo sistema: el pull reutiliza `MAP` + `fetchAllRows` + `applyRemote`, el
folio reutiliza el contrato de `folio_conflict` de la venta, y la idempotencia
reutiliza `pos.capability_operation_audit`.

### Los cinco huecos que impedían la réplica

| Hueco | Consecuencia real | Corrección |
|---|---|---|
| No existía lectura | Otra terminal no los veía; la caché no se reconstruía | `MAP.loans` + `applyRemoteLoans()` + dominio `loans` en el pull |
| Folio choca entre terminales | La segunda terminal recibía `23505`, clasificado `blocked_data` **no reintentable**: ese préstamo no llegaba nunca | `folio_conflict` estructurado + sufijo de terminal + alias |
| La versión no se rebasea | Dos cambios sin conexión: el segundo fallaba `40001` | `rebaseQueuedLoanVersions()` |
| `40001`/`22023`/`P0002` sin clasificar | Caían en `unknown` → reintento automático **infinito** | Ramas nuevas en `classifyFailure()` |
| `deliver` sólo aceptaba `pendiente` | Un préstamo histórico ya cerrado no se podía adoptar | `deliver` admite los tres estados y nace con `has_events` |

Además, el choque de folio tenía una segunda cara peor que el bloqueo: como la
respuesta `{ok:false}` llegaba con HTTP 200, `applyOp` la tomaba por éxito y
**retiraba la operación de la cola**. El préstamo desaparecía de la cola sin
haberse persistido. El arnés lo fija con `el préstamo se persiste pese al choque`.

### La devolución parcial no cambió de forma

Se conserva el modelo de H-46: `lineas[].devueltas` acumula y `devoluciones[]`
guarda el asiento de cada entrega, todo **dentro del mismo documento**. No se
normalizó en tablas hijas, y es deliberado: `pos.loan_documents.document` guarda
el documento entero, de modo que la evidencia congelada viaja tal cual y
`DATA.prestamoPendientes()` sigue siendo la única autoridad de «cuántas faltan».
Normalizar habría creado una segunda respuesta a una pregunta que ya tenía una
(`AP-01`), y habría exigido un motor de diferencias que el cliente no tiene.

### Migración de los préstamos locales

`STORE.migrateLocalLoans()` adopta en la nube, una sola vez, los préstamos que
nunca salieron del navegador —los que no tienen `_loanVersion`—, conservando
folio, fechas, líneas y devoluciones. Antes de encolar nada deja una copia
congelada en `balam_pos_loans_premigracion_v1` con su fecha y su motivo.

**No borra nada.** La copia previa sobrevive a la migración y sólo se retira a
mano: mientras exista, el estado anterior es reconstruible. Es idempotente por
construcción —un préstamo confirmado no se reenvía y uno ya encolado no se
duplica— y `pos.loan_documents.id` es llave primaria, así que duplicar es
imposible por esquema. Devuelve un informe con detectados, encolados,
confirmados, sin confirmar y fallidos con su causa.

### Pruebas

Reproducción previa: `node test-loans-sync.mjs` → **29/51**, 22 fallando.
Después del cambio: **69/69**.

Incluye el recorrido entre **dos terminales independientes** —dos contextos de
navegador con `localStorage` y `balam_device_id` distintos contra la misma
nube—: A registra, sincroniza; B lo ve con folio, persona y piezas idénticos; B
devuelve una pieza y luego cierra el préstamo; A vuelve a sincronizar y ve la
devolución parcial primero y el cierre con su fecha real después. Ninguna de las
dos queda con operaciones bloqueadas y el inventario no se mueve.

**Sobre el folio renombrado:** el renombrado sólo AÑADE un sufijo, de modo que
el folio impreso queda como prefijo del nuevo. Lo localizan las dos superficies:
`DATA.findLoanByFolio()` por alias explícito, y el buscador de la cartera por
subcadena. La garantía duradera es el alias —la coincidencia por subcadena es
incidental y dejaría de funcionar si un renombrado futuro sustituyera en vez de
añadir—, así que el buscador debería consumir la autoridad. Queda como deuda:
hoy no cambia el resultado para nadie.

El arnés prueba el CLIENTE contra un doble de Supabase que implementa el mismo
contrato; el SERVIDOR lo prueba la verificación autocontenida de
`20260731010000` contra la base real. Son dos mitades de la misma garantía y
ninguna sustituye a la otra (`R-SEC-03` · `R-DB-09`).

`test-loans-screen.mjs` es el guardián de «ninguna diferencia funcional»: sus
117 casos siguen intactos, sin editar uno solo.

### Despliegue de H-62

Migraciones aplicadas **antes** que el cliente (`R-DEL-03`). La verificación
autocontenida se ejecutó contra la base real y emitió:

    H62_LOAN folio_conflict=structured audit_clean=ok rekey=ok
             version_guard=ok event_guard=ok capability_guard=ok
             fixtures_clean=ok

Artefactos regenerados con `node build-offline.mjs`; `index.html` es copia
exacta de `POS Balam (offline).html`. El archivo servido por GitHub Pages se
verificó idéntico byte a byte al `index.html` del commit `5d9800b`
(`R-DEL-07`):

    SHA-256  136DD8D9F6FE1DC2A912F97EAE9ADF68483EC81A33D97CF7D6F9C9FA266C4670
    bytes    8 765 220

El cierre operativo —el aviso que ya declara la sincronización— se publicó en
`ea7d953` y se verificó igual (`R-DEL-07`). Las dos primeras lecturas
devolvieron todavía el artefacto anterior; la tercera ya servía el nuevo:

    SHA-256  E854B19680BD4140507AFB3C800828ACCC3D9A2C5CB59ED219150213209B8BF6
    bytes    8 765 296

La composición del paquete no se auditó con `grep`: el artefacto no guarda los
`.jsx` en texto plano y un `grep` negativo no prueba nada (`AP-09`, y la
conclusión equivocada que quedó registrada arriba en H-48). Se comprobó por
**ejecución**: `test-loans-sync.mjs` recorre `index.html` y ejerce
`STORE.migrateLocalLoans()`, el pull y el rekey de folio sobre ese mismo
paquete, y el archivo servido es idéntico byte a byte al probado.

## Riesgo residual y pendientes

**El aviso de la pantalla ya declara la sincronización.** Se sustituyó al cerrar
H-62, después —y sólo después— de que el dueño del producto comprobara en
producción los cinco supuestos: la nube persiste, la cola drena, la migración
local terminó, otra terminal los consulta y los reintentos no duplican. El texto
conserva íntegra la advertencia de inventario, que no ha cambiado, y menciona el
vale firmado como herramienta operativa y de auditoría, ya no como el único
respaldo.

**Sólo el administrador ve los préstamos sincronizados.** La RLS de
`pos.loan_documents` concede la lectura a `pos.is_active_admin()` y las
capacidades `inventory.loan.*` están sembradas únicamente para el rol `admin`.
Un vendedor al que se le conceda la pantalla podría capturar y su operación
quedaría bloqueada por permiso: pantalla y capacidad se conceden por separado.

**El servidor no valida cantidades.** `commit_loan_operation()` comprueba
transiciones, versión, capacidad e idempotencia, pero acepta los `devueltas` que
le mande el cliente: «no devolver más de lo pendiente» sigue siendo una defensa
sólo del cliente. Queda **fuera de H-62 por decisión del dueño del producto** y
registrado como deuda técnica: no impide guardar, sincronizar ni recuperar.

**Un préstamo no reserva ni descuenta inventario.** La pieza prestada sigue
contando como existencia y puede venderse en piso por descuido. Es el mismo
riesgo residual que H-40 registró para el apartado, y la decisión está razonada
arriba. `DATA.loanedQty()` ya expone la cifra para que Inventario y el Punto de
venta la muestren cuando se autorice esa ampliación.

**Fuera de alcance, declarado:** depósito o garantía en dinero por la mercancía
prestada; convertir un préstamo en venta cuando el cliente decide quedarse la
pieza; recordatorio automático al vencer más allá del aviso de la campana;
préstamos de mercancía que no está en el catálogo. El préstamo tampoco aparece en
Reportes.

**Numeración entre terminales:** resuelto en H-62 con el contrato de la venta.
El consecutivo se sigue derivando de los préstamos que conoce la terminal —con
el pull, eso ya incluye los de las demás—, y el residuo real, dos terminales sin
conexión el mismo día, lo resuelve `folio_conflict`: la segunda añade su código
corto y conserva el folio impreso como alias. **No existe un consecutivo global
limpio con la terminal offline** salvo que el folio impreso pueda cambiar
después, y el vale firmado no puede cambiar.

**Deuda técnica preexistente detectada durante H-62, no corregida aquí:**
`test-reset-propaga.mjs` da 12/21 —su doble de Supabase no conoce
`commit_sale_with_additional_discount_checked`, la RPC de H-52—, y
`test-concurrency.mjs` aborta en su primera comprobación. Ambos fallan igual con
el artefacto anterior a H-62, comprobado sustituyéndolo. Las dos comprobaciones
HID de `test-loans-screen.mjs` son intermitentes desde H-56 y también lo son sin
estos cambios.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-46
- Arquitectura: `docs/02-architecture.md` § Préstamos de mercancía
- Autoridades: `docs/architect/authorities/inventory.md`
- Pantalla hermana y precedente de superficie: `docs/fixes/pantalla-apartados.md`
