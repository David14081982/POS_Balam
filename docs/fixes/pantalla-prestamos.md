# Préstamos de mercancía: el documento que faltaba

**Riesgo:** H-46 · H-48 · H-49
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** `9387e62` (H-46) · `c9618dd` (H-48) · `Pendiente de commit` (H-49)

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

Esta historia nació como H-47 y se renumeró a **H-48**. Mientras se probaba, otra
sesión publicó `be84e3c` y `70b1e06` reclamando H-47 para la comisión del excedente,
con tres migraciones ya nombradas `pos_h47_*` en el historial compartido. Los
identificadores no se renumeran una vez publicados
(`docs/architect/README.md` § Presupuestos y crecimiento), así que el número cedió
la historia que **no** estaba publicada, que era ésta. Préstamos conserva H-46 por
decisión del dueño del producto.

Esa misma sesión commiteó `docs/03-known-risks.md` completo cuando el archivo tenía
las dos historias mezcladas, de modo que la entrada de esta historia entró al
historial dentro de `be84e3c`. No hubo pérdida: la entrada está íntegra y aquí sólo
cambió su identificador.

## Fechas en día/mes/año (H-49)

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

## Riesgo residual y pendientes

**Los préstamos viven sólo en esta terminal.** No hay tabla `pos.loans`: crearla
exige una migración con RLS, `grants` nominales y verificación autocontenida
(`R-SEC-01`, `R-DB-05`, `R-DB-10`), y aplicarla contra la base real antes de
publicar el cliente (`R-DEL-03`, `AP-08`). Esta sesión no tenía credenciales para
hacerlo, y publicar un cliente que empuje contra una tabla ausente dejaría la
operación bloqueada por esquema en la cola, visible en la campana, para siempre.
Consecuencias mientras eso siga pendiente: borrar los datos del navegador pierde
los préstamos, una segunda terminal no los ve, y el respaldo es la exportación a
Excel o el listado impreso. La pantalla lo dice donde se opera.

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

**Numeración entre terminales:** el consecutivo del folio se deriva de los
préstamos que conoce la terminal, así que dos terminales podrían emitir el mismo
`PR-…`. Hoy es inocuo —los préstamos no se comparten— pero es un requisito a
resolver junto con la replicación, no después.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-46
- Arquitectura: `docs/02-architecture.md` § Préstamos de mercancía
- Autoridades: `docs/architect/authorities/inventory.md`
- Pantalla hermana y precedente de superficie: `docs/fixes/pantalla-apartados.md`
