# Arquitectura de POS BALAM

## Vista general

POS BALAM es una aplicación React cargada directamente en el navegador, sin
bundler en tiempo de ejecución. Los módulos en `balam/` publican APIs globales
en `window`. La aplicación es **local-first**: opera con datos en memoria y
`localStorage`; Supabase replica y comparte la información cuando hay sesión y
conectividad.

Flujo principal:

```text
Interfaz React
    ↓
CONFIG / DATA / AUTH
    ↓ cambios locales inmediatos
localStorage
    ↓ push asíncrono
STORE → cola offline → Supabase (esquema pos)
    ↑                    ↓
    └──── pull/merge al iniciar y sincronizar
```

`POS Balam.html` carga los módulos fuente. `build-offline.mjs` genera
`index.html` y `POS Balam (offline).html`; estos dos archivos son artefactos, no
la fuente primaria.

## Build offline

`build-offline.mjs` precompila JSX, genera Tailwind estático e incorpora
scripts, fuentes e imágenes en un manifiesto. Cada asset se identifica mediante
SHA-256 de su MIME, modo de compresión y bytes originales, conservando formato
UUID para el loader. Con las mismas fuentes y respuestas externas, dos builds
producen artefactos byte por byte idénticos; `index.html` es copia exacta de
`POS Balam (offline).html`.

Las 46 respuestas externas necesarias están fijadas, con bytes y SHA-256, en
`balam/vendor/build-resources.json`. El build normal sólo lee y verifica ese
almacén; un recurso ausente o corrupto aborta. La red se habilita únicamente
para una actualización deliberada con
`BALAM_REFRESH_BUILD_RESOURCES=1`, cuyo diff debe revisarse. Tailwind 3.4.17
proviene de la dependencia exacta del lockfile y no de `npx --yes`.

El SDK de navegador `@supabase/supabase-js` está fijado exactamente en la
versión 2.110.8 tanto en el lockfile como en
`balam/vendor/supabase-2.110.8/supabase.min.js`. Las entradas fuente documentan
su SHA-256 y lo cargan antes de los módulos; el build incorpora esos mismos
bytes como un asset local. La aplicación nunca inyecta ni descarga el SDK en
tiempo de ejecución.

Los arneses Playwright de comportamiento integrado ejecutan `index.html`, por
lo que prueban el artefacto distribuido sin Babel ni CDN. Pueden seguir leyendo
`POS Balam.html` estáticamente para verificar contratos de fuente.
`test-smoke.mjs` conserva de forma explícita sus dos modos, desarrollo y bundle.

## Instalación PWA

La publicación HTTP bajo `/POS_Balam/` registra `sw.js` con ese mismo scope.
El worker conserva sólo el shell autocontenido, el manifest y los iconos; no
intercepta Supabase, APIs ni datos de dominio. `STORE`, `localStorage` y la cola
offline siguen siendo las únicas autoridades operativas. La primera carga
requiere red y una navegación posterior puede usar el shell ya instalado.

`CONFIG.get('store.logo')` es la única autoridad visual administrable. Una vez
que el worker controla la página, `window.PWA` deriva PNG 180, 192, 512 y
maskable 512, los materializa con rutas versionadas por hash en Cache Storage y
enlaza al final un manifest igualmente versionado. Esta secuencia evita que
Chrome lea un manifest antes de que sus iconos existan. Se conserva una
generación anterior para instalaciones o lecturas concurrentes. Sin logo, o si
un logo histórico no puede decodificarse, se usan recursos fallback generados
por el build; no constituyen una segunda marca configurable.

El manifest mantiene `start_url`, `scope` e iconos relativos. Su `id` es
`/POS_Balam/`: Chrome resuelve `id` contra el origen, no contra la URL del
manifest, por lo que `./` identificaría incorrectamente la raíz del dominio.
Las cargas nuevas de logo exigen al menos 512 px en el lado mayor y conservan
hasta 1024 px. Fuentes históricas menores siguen funcionando con advertencia de
escalado.

Una versión nueva del worker queda en espera. Sólo una acción explícita envía
`BALAM_SKIP_WAITING`, y se bloquea mientras exista actividad de negocio,
captura, diálogo o una cola únicamente en memoria. `POS Balam (offline).html`
no registra worker y permanece como artefacto independiente.

`window.PWA.InstallAction` es la única superficie que inicia instalación. El
login y el topbar la montan con composiciones distintas, pero ambos consumen el
mismo `canInstall`, `standalone` y `requestInstall()`. La llamada a `prompt()`
ocurre directamente dentro del clic y registra `accepted` o `dismissed`; iOS no
simula ese evento y muestra la ruta manual Compartir → Añadir a pantalla de
inicio. La pantalla de autenticación sólo compone esta superficie y no conoce
el mecanismo de instalación.

## Orden de carga

El orden relevante definido en `POS Balam.html` es:

1. `balam/core.jsx`
2. `balam/config.jsx`
3. `balam/data.jsx`
4. `balam/auth.jsx`
5. módulos de interfaz
6. `balam/pwa.jsx` (no altera datos de dominio)
7. `balam/store.jsx`
8. `balam/app.jsx`

Aunque `STORE` se carga después, `CONFIG`, `DATA` y `AUTH` acceden a sus
servicios mediante el gateway de `CORE`. `App` coordina la inicialización.

## CORE

Archivo: `balam/core.jsx`. API: `window.CORE`.

Es el contrato temprano para responsabilidades que deben ser idénticas entre
módulos y que no dependen del dominio ni de persistencia remota. Actualmente
expone `getDeviceId()`: conserva la clave histórica `balam_device_id` y
garantiza que `DATA` y `STORE` usen una sola identidad durante la sesión,
incluso cuando `localStorage` no está disponible.

También aloja el adaptador de productos usado por las guardas de catálogos:
`DATA` registra funciones para listar y guardar su arreglo real; `CONFIG`
consulta esas funciones sin depender de `window.DATA`. `CORE` no conserva una
copia de productos ni asume su estructura más allá de entregar el arreglo.

El gateway evita que `DATA`, `CONFIG` y `AUTH` conozcan directamente a `STORE`:
antes del registro es no-op y, después de que `STORE` publica su API, reenvía
método, argumentos y resultado sin transformación. Además de escrituras
salientes, `AUTH` obtiene por esa frontera el cliente Supabase compartido.
`STORE` puede seguir leyendo los modelos y la identidad efectiva, por lo que
cada dependencia queda en una sola dirección.

## Recursos de interfaz

La apariencia vigente proviene de la configuración Tailwind y del bloque
`<style>` de `POS Balam.html`. El build compila Tailwind estático e incorpora
únicamente recursos locales enlazados mediante `src` o `href`. No existe una
segunda capa CSS heredada.

`balam/tweaks-panel.jsx` sigue cargándose porque `App` consume `useTweaks` y el
módulo publica el contrato de editor externo `Tweak*`/`postMessage`. Aunque el
producto no renderiza actualmente el panel flotante, esos exports se conservan
como frontera pública; una limpieza interna no debe retirarlos sin validar al
host que usa `__activate_edit_mode` y `__edit_mode_set_keys`.

`window.UI.Segment` es el selector segmentado canónico de Clientes e Inventario.
Conserva los tokens visuales compartidos y permite desplazamiento horizontal
sin comprimir ni partir opciones cuando el ancho es reducido.

`window.UI.resizeImageFile()` centraliza la lectura, decodificación y reducción
proporcional de imágenes locales. Logo y avatar solicitan PNG de hasta 256 px;
la foto de producto solicita JPEG 0.85 de hasta 600 px. La utilidad rechaza
tipo, lectura o decodificación inválidos y cada formulario conserva sus mensajes
y acciones posteriores.

La pantalla Vendedores consume `seller.avatar` mediante un componente local
compartido por resumen, tarjeta, lista y detalle. Cuando no existe fotografía,
conserva las iniciales y el color del perfil como representación histórica.

## CONFIG

Archivo: `balam/config.jsx`. API: `window.CONFIG`.

- Contiene ajustes, catálogos y reglas administrables.
- La copia local vive en `localStorage` bajo `balam_config_v1`.
- Expone lecturas y mutaciones; al guardar emite `configchange`.
- Tras persistir y emitir el evento, el gateway solicita `pushConfig()` para
  replicar configuración y catálogos cuando `STORE` está disponible.
- `DATA` lee ciertos catálogos mediante getters para reflejar cambios sin
  recargar módulos.
- Las guardas de borrado consultan productos mediante el adaptador de `CORE`;
  `CONFIG` no depende directamente de `DATA`.

Supabase separa esta información en tablas de configuración (`settings` y
`lookup`). Si existe configuración pendiente en la cola al arrancar, el pull se
omite para impedir que una copia remota anterior pise cambios locales.

## DATA

Archivo: `balam/data.jsx`. API: `window.DATA`.

- Es el modelo de dominio usado por la interfaz.
- Mantiene en memoria productos, vendedores, clientes, ventas, promociones,
  liquidaciones, devoluciones, pagos y movimientos.
- Persiste cada colección en claves propias de `localStorage`.
- Ejecuta reglas de negocio como folios, ventas, pagos, devoluciones,
  comisiones, inventario y datos de prueba.
- Las mutaciones guardan primero localmente y después invocan el gateway de
  sincronización de `CORE`.
- `applyRemote()` incorpora datos recibidos de la nube sin volver a enviarlos.

### Personal y elegibilidad comercial

`DATA.sellers` conserva el catálogo completo de personal que administra
Configuración → Usuarios. No todos sus elementos son vendedores comerciales.
`DATA.isEligibleSeller()` define el subconjunto que pueden consumir la pantalla
Vendedores y el selector del POS: el perfil debe estar activo, tener rol
`vendedor` y carecer de tombstone local (`_deletedAt`) o remoto (`deleted_at`).
Centralizar esta regla evita filtros divergentes sin cambiar la persistencia ni
ocultar personal de la administración de usuarios.

### Autoridad de comisión efectiva

`DATA.resolveSellerCommission(seller)` resuelve el porcentaje comercial sin
alterar `seller.role` ni la elegibilidad definida por H-29. La precedencia para
perfiles bajo la política H-31 es:

1. `commissionOverridePct`, donde `0` es válido y `null` significa ausencia;
2. `sellerLevelCode`, resuelto contra `seller_role.meta.commissionPct`;
3. el ajuste global existente `commission.basePct`.

La respuesta incluye `effectivePct`, `source`, información del nivel utilizado
y `policyVersion`. Un nivel inactivo previamente asignado continúa resolviendo
desde el catálogo completo para preservar datos; la lista activa sigue siendo
la única disponible para futuras interfaces de asignación.

Los perfiles sin `commissionPolicyVersion` o con versión 0 conservan
`comisionPct` como fuente `heredada`. Las altas nuevas nacen en versión 1, sin
porcentaje personalizado ni nivel. STORE replica estos campos en
`pos.sellers`; no se infieren niveles a partir del porcentaje histórico.

H-31 establece esta autoridad, pero no cambia todavía el cálculo financiero de
ventas, apartados, devoluciones, liquidaciones o cierres, ni metas y bonos.

Ventas y devoluciones solicitan las rutas especializadas `pushSale()` y
`pushReturn()` mediante el gateway. Cada una se confirma remotamente mediante
su propia transacción SQL idempotente.

### Autoridad monetaria por método

`pos.sale_payments.components` congela cada entrada como una lista de
`{methodCode, methodLabel, amount}`; `pos.returns.components` conserva con la
misma forma cada salida por reembolso. El código identifica el método y la
etiqueta snapshot impide que un cambio posterior en Configuración reescriba la
historia. `Mixto` y `Apartado` son experiencias/tipos de operación y nunca
componentes receptores de dinero.

`DATA.paymentMethodReport()` es la única proyección de entradas, devoluciones y
neto por método. Adopta documentos anteriores sólo cuando las columnas fijas o
un método simple prueban la distribución; el resto permanece como importe
histórico sin distribución. Su conciliación cumple `Σ neto por método + sin
distribución = neto monetario`, o publica la diferencia exacta.

La misma respuesta publica tres metadatos derivados sin cambiar la proyección
monetaria: `operations` cuenta IDs únicos de filas de cobro o devolución;
`origins` los clasifica una sola vez como venta, movimiento de apartado, cambio
cobrado o devolución; y `exchangeEntries` suma únicamente pagos `tipo=cambio`.
Anticipo, abono y liquidación son movimientos monetarios independientes porque
ocurren en fechas propias. Un pago mixto conserva un solo ID y cuenta una vez.
Pantalla, A4 y ticket térmico de 80 mm consumen el mismo snapshot; ninguna
salida consulta directamente ventas, pagos, cambios o devoluciones.

Las columnas fijas de `sale_payments` continúan como compatibilidad de clientes
anteriores, pero no se amplían al agregar métodos. Todo documento posterior a
H-90 debe llevar componentes válidos cuya suma sea exactamente su monto.

### Préstamos de mercancía

`DATA.loans` es la colección de mercancía que sale del negocio con obligación de
volver, administrada en `balam/loans.jsx` —pantalla `prestamos` del menú
lateral—. Un préstamo es un documento propio, no una venta de cero ni un
movimiento de inventario:

- congela su evidencia —`nombre`, `sku`, `talla`, `qty` y el `precio` de lista de
  la talla el día del préstamo, más una copia de la persona que recibió—, de modo
  que editar el producto o el cliente después no altera un préstamo registrado;
- su referencia comercial es `PR-{AAMMDD}-{CONSECUTIVO}`, con consecutivo propio
  derivado de los préstamos del día que conoce la terminal. **No** consume
  `pos.folio_counters`: la identidad técnica es un UUID separado;
- sus estados son `pendiente`, `devuelto` y `no_devuelto`. No son un catálogo
  administrable: son el contrato del módulo;
- la devolución puede ser parcial. Cada entrega deja su asiento y la fecha real de
  devolución se fija con la que completa el préstamo. Una pieza declarada no
  devuelta que aparece después todavía puede devolverse;
- **no mueve existencias.** `DATA.loanedQty(sku, talla)` es la única autoridad de
  «unidades fuera» y `DATA.prestamoAtraso()` la única de «vencido»; ambas se
  derivan de la colección. `pos.movements` no se usa: es historial de sólo lectura
  para el cliente y el pull lo reemplaza.

La captura consume `window.BARCODES` igual que el Punto de venta: leer la etiqueta
`SKU-TALLA` mete la pieza exacta en el préstamo sin preguntar la talla, y la
captura global HID —con la misma heurística de cadencia de `balam/pos.jsx`— funciona
aunque el foco esté en otro campo, retirando del campo enfocado lo que el lector
acabó de escribir. En el buscador de la cartera una lectura responde «¿quién tiene
esta prenda?» y busca en todos los estados, ignorando el filtro a propósito.

El préstamo **se replica** (H-62). No viaja como upsert de tabla: cada operación
—entrega, devolución, faltante, edición, baja y reapertura— se conserva en la
cola offline y se confirma con `pos.commit_loan_operation()`, transacción
idempotente por (operación, payload) auditada en
`pos.capability_operation_audit`. `pos.loan_documents` guarda el documento
**entero** en `document jsonb`: la evidencia congelada viaja tal cual y no se
normaliza, de modo que no existe una segunda representación del préstamo.
`_loanVersion` es la versión confirmada por el servidor y, a la vez, el
indicador de «esto ya está en la nube».

El pull sólo lo ejecuta un administrador, porque la RLS de `pos.loan_documents`
concede la lectura a `pos.is_active_admin()`. `DATA.applyRemoteLoans()` fusiona
en vez de reemplazar: un préstamo local que el servidor todavía no confirmó
sobrevive al pull —su envío puede seguir en la cola o estar pendiente de
migrar—, y un tombstone remoto sí retira el documento local.

El folio de préstamo es único entre terminales por el mismo contrato que el de
venta (`ADR-001`). Cuando dos terminales sin conexión emiten el mismo
`PR-{AAMMDD}-{NNN}`, la nube responde `folio_conflict`, la terminal añade su
código corto —`PR-260731-003-K7Q`— y **conserva el folio ya impreso** en
`loan.folioAliases`; `DATA.findLoanByFolio()` resuelve por folio vigente
primero y por alias después. El vale que firmó el cliente nunca deja de
localizar su préstamo.

La exportación a `.xlsx`, el listado impreso y el vale firmado se conservan como
herramientas operativas y de auditoría; ya no son el único respaldo.

### Promociones y margen mínimo

`window.PROMOS` calcula el precio unitario que usa el Punto de Venta y la vista
previa administrativa. Los descuentos porcentuales acumulados se aplican
primero y después los montos fijos.

Cuando el producto tiene costo positivo y
`discount.minMarginPct > 0`, el precio promocional no puede bajar de:

```text
costo / (1 - margen_mínimo / 100)
```

El piso se limita al precio de lista: una promoción nunca aumenta el precio.
Si el precio de lista ya incumple el margen, se bloquea el descuento adicional.
Costo cero/ausente o margen 0 conservan el cálculo histórico. El margen se
administra en Configuración → Ventas y POS, entre 0% y 100%, y afecta sólo
cálculos nuevos; las ventas guardadas conservan sus snapshots monetarios.

### Categorías y existencias por talla

`DATA.resolveProductSizes(producto, catálogos, variantes)` es la autoridad única
de las tallas aplicables. La relación canónica es el único escalar
`producto.attrs.__sizeCategoryId`; `sizeCategoryId` es una proyección derivada y
no puede prevalecer sobre el dato persistido. La autoridad resuelve exactamente
una categoría contra los catálogos vivos de `CONFIG` y devuelve identidad, valor
original, etiqueta, orden por posición configurada, estado, existencia e
identidad de variante. POS, códigos de barras, préstamos, cambios, descuentos y
el detalle/formulario de Inventario consumen ese resultado.

`DATA.resolveSizeFilterGroups()` es la autoridad del filtro global del POS y
devuelve una **estructura por categoría**, no una lista: las categorías en el
orden de Configuración y, dentro de cada una, sus tallas activas en el orden de
su catálogo, sin depender de los productos ni de sus existencias. Una categoría
sin tallas activas no produce grupo. La identidad de cada opción es la pareja
`{ sizeCategoryId, sizeId }` —serializada en `filterKey`—, así que dos
categorías que usen la misma representación textual siguen produciendo opciones
distintas. El POS la dibuja con un `<optgroup>` por categoría y «Todas las
tallas» como única opción global.

`DATA.resolveSizeFilterOptions()` es la proyección plana de esa misma autoridad,
obtenida por concatenación de sus grupos, para los consumidores que sólo
necesitan el conjunto de tallas ofrecidas.

Los productos históricos se infieren sólo cuando sus existencias positivas
identifican una escala inequívoca. Un registro con existencias positivas en dos
escalas no mezcla ni vende variantes: queda sin resolución y exige asignación
explícita en Inventario. La importación Excel transporta una categoría y rechaza
filas que llenen dos escalas o contradigan la categoría declarada.

### Contrato Excel canónico de Inventario

`XLSXIO.schema` publica el contrato versionado `balam.inventory`. Plantilla y
Exportar invocan el mismo escritor: la primera entrega cero productos y la
segunda el estado actual, pero ambas contienen las mismas hojas y columnas.
`Inventario` transporta el estado editable, las identidades técnicas
`_BALAM_ID_PRODUCTO`/`_BALAM_VERSION_PRODUCTO` y todas las tallas; `Catálogos`
publica los códigos y el mapa inequívoco encabezado humano → escala/valor; la
hoja oculta `_BALAM` identifica versión y huellas del esquema.

El lector resuelve columnas por encabezado, no por posición. Un libro canónico
se bloquea si falta o se duplica una columna obligatoria, si la versión es
incompatible, si una talla no puede resolverse o si un valor tipado/JSON es
inválido. Los archivos heredados siguen una ruta explícita y sus campos ausentes
significan **preservar** al actualizar; nunca reciben códigos de catálogo por
default silencioso.

`XLSXIO.planImport()` hace el preflight completo sin mutar DATA. Un ID técnico
válido actualiza exactamente ese producto; sin ID, un SKU nuevo es alta y un SKU
existente es conflicto. SKU duplicado en archivo o catálogo bloquea. La vista
previa expone altas, actualizaciones, conflictos y diferencias de stock/precio.
`applyImportPlan()` vuelve a comprobar la huella de base y reemplaza el estado en
una sola operación sólo si el plan entero sigue válido. STORE, Supabase y la
sincronización permanecen fuera de este contrato local.

### Resolución del descuento por renglón

`DATA.resolveLineDiscount(producto, talla)` es la única fuente de la resolución
de un renglón: devuelve el precio de lista, el precio efectivo y una copia
congelada de las promociones que lo produjeron. El Punto de Venta la calcula
**una sola vez** por renglón y la adjunta a la línea; el resumen, el renglón del
carrito y `recordSale` consumen esa resolución sin volver a consultar el motor.
El renglón es dueño de su precio.

`sale.lineas[].promos` guarda `[{ id, nombre, tipo, valor }]` como evidencia
histórica inmutable, y viaja a `pos.sale_items.promos`. Es copia y no
referencia: la venta sigue siendo explicable aunque la promoción se edite o se
elimine. Un arreglo vacío significa «sin promoción»; su ausencia significa
«venta anterior a H-32».

### Cotización de venta y descuento adicional

`DATA.saleQuote(ticket, applications)` es la autoridad única del total después
de promociones configuradas y descuentos adicionales. Recibe renglones cuya
promoción ya fue resuelta por `DATA.resolveLineDiscount()` y aplica después las
aplicaciones manuales en orden. Resumen, vista previa, Cobrar venta,
`recordSale()`, ticket y posventa consumen el mismo resultado.

Cada aplicación congela origen, beneficio, mecánica, alcance, motivo, usuario,
folio físico cuando aplica e importes anterior/descontado/final. El campo
histórico `sales.descuento` conserva exclusivamente el descuento configurado;
`descuento_adicional` y `descuentos_adicionales` son evidencia separada. El
importe adicional de ticket se prorratea sobre el valor posterior a promociones
y el último renglón elegible absorbe el residuo de centavos.

El precio final congelado por renglón es el valor que reconocen Cambios y
Devoluciones. La comisión se calcula sobre el total final realmente pagado. Un
apartado congela su descuento al crearse y los abonos no lo modifican.

Una tarjeta física sólo puede aplicarse con sesión y conexión. La defensa real
no es la interfaz: `pos.physical_card_redemptions` hace único el folio y
`pos.commit_sale_with_additional_discount()` lo consume en la misma transacción
que delega la venta a `pos.commit_sale()`.

### Presentación financiera del ticket

El resumen del Punto de Venta y el ticket impreso muestran, en este orden:
precio original, importe, IVA, descuento y total a pagar. El precio original se
deriva como `total + descuento`, e importe e IVA se calculan **sobre el precio
original**, por lo que `importe + IVA = precio original` y no coincide con el
total cuando hay descuento. Es el formato aprobado por Finanzas.

El porcentaje sólo se imprime cuando todos los renglones con descuento traen
evidencia, cada uno con exactamente una promoción, todas porcentuales y todas
con el mismo valor configurado. Nunca se deriva dividiendo descuento entre
precio. Los importes guardados —`subtotal`, `iva`, `total`, `descuento`— no
cambian: la presentación se calcula al mostrar y el ticket nunca consulta las
promociones vigentes para reconstruir una venta antigua.

### Evidencia visual del comprobante histórico

Toda venta creada desde H-85 guarda `receiptSnapshot.version = 1` y su espejo
remoto `pos.sales.receipt_snapshot`. El documento congela identidad textual de
la tienda y vendedor, y por cada renglón: nombre, SKU comercial, talla
código/etiqueta, color, ornamento, colores de ornamento y atributos visibles.
`BalamTicket` es una proyección de esa evidencia y de los importes ya guardados;
no consulta `DATA.products` por SKU durante una impresión o reimpresión.

La compatibilidad con ventas anteriores es conservadora: se imprimen nombre,
SKU, talla, precio y ornamento que ya vivan en el renglón; un dato ausente se
omite o conserva como código crudo. Nunca se completa desde el producto actual.
La reimpresión sólo monta ese documento: no registra pagos, movimientos ni otro
documento. Reportes imprime en una ventana A4 autocontenida, separada del modo
térmico de 80 mm.

## AUTH

Archivo: `balam/auth.jsx`. API: `window.AUTH`.

- Obtiene mediante el gateway de `CORE` el cliente compartido que crea `STORE`.
- Inicializa y observa la sesión de Supabase Auth.
- Supabase JS persiste el token en `localStorage` y renueva la sesión.
- Después del login, relaciona el correo autenticado con un vendedor de
  `DATA.sellers`.
- Expone usuario actual, estado de sesión y comprobación de administrador.
- Emite `authchange` para que la interfaz reaccione.

La administración de cuentas no se realiza directamente desde el navegador:
usa la Edge Function `admin-users`.

## STORE

Archivo: `balam/store.jsx`. API: `window.STORE`.

Es la frontera entre el dominio local y Supabase:

- Crea un único cliente Supabase configurado para el esquema `pos` mediante el
  SDK local previamente cargado; si éste falta, conserva el modo local sin
  intentar una descarga remota.
- Traduce objetos locales a filas SQL y viceversa mediante `MAP`.
- Hace `push` de configuración, colecciones, ventas y devoluciones.
- Hace `pull` de configuración y dominio.
- Fusiona ventas remotas; no borra ventas locales ausentes en la ventana remota.
- Pagina ventas recientes y permite recuperar una venta por folio.
- Sube fotos y códigos de barras a Supabase Storage.
- Invoca Edge Functions con el token real y conserva el cuerpo del error.

`STORE.enabled` indica disponibilidad del cliente; no significa que todas las
operaciones pendientes ya estén sincronizadas. `STORE.pending` es el tamaño de
la cola.

## Supabase

La autoridad de despliegue es la cadena ordenada de
`supabase/migrations/*.sql`, configurada por `supabase/config.toml`. Contiene
las bases históricas 001–012, las correcciones 013–028 y verificaciones finales
del contrato hasta 031. La migración 032 añade los índices medidos del pull de
ventas, 033 la autoridad de comisión efectiva, 004000 la evidencia del descuento
por renglón, 004100/004200 el contador diario del folio comercial y
004300/004400 el alias del folio impreso, cada par con su verificación.
Los archivos `supabase/pos_*.sql` se conservan como fuentes
históricas legibles de 001–012; `test-migrations.mjs` exige que sus copias
formales permanezcan idénticas.

El orden formal coloca promociones antes del antiguo script 004 porque ese
script intenta activar RLS sobre `pos.promotions`. La versión desplegada queda
determinada por el historial de migraciones, no por ejecutar manualmente
`_PEGAR-EN-SQL-EDITOR.sql`.

La migración `20260725002900_pos_h10_schema_contract_verification.sql` no cambia
datos: aborta si faltan tablas, columnas o funciones esenciales, si alguna
tabla `pos` queda sin RLS, si sobreviven policies permisivas antiguas, si
`anon` conserva acceso al esquema o si falta el bucket público de fotos.
Las migraciones 01950 y 030 rodean las verificaciones históricas con semillas
reservadas y las eliminan antes de terminar. La migración 031 aborta cuando la
huella semántica de tablas, columnas, funciones, restricciones, índices y RLS
se aparta de dos reconstrucciones limpias reproducibles.

Responsabilidades:

- Persistencia compartida entre terminales.
- Supabase Auth para identidad y sesión.
- Row Level Security para autorización sobre el esquema.
- Storage para imágenes y códigos.
- Edge Functions para operaciones que requieren privilegios de servidor.

### Autorización del esquema `pos`

El acceso directo de navegador al esquema sigue el contrato de las migraciones
`20260725001400_pos_admin_rls.sql`,
`20260725001500_pos_service_role_grants.sql` y
`20260725001600_pos_seller_pos_access.sql`:

- `anon` no tiene acceso al esquema ni a sus tablas;
- una sesión `authenticated` se relaciona por correo con un perfil activo y no
  eliminado;
- el administrador puede operar todo el dominio;
- el vendedor puede leer catálogo, configuración de cobro, clientes y
  vendedores, y escribir únicamente el conjunto operativo de una venta;
- el vendedor no puede actualizar productos directamente; las salidas de stock
  de venta sólo atraviesan `pos.reserve_sale_stock()`;
- sus cambios directos de vendedores se limitan a métricas de venta;
- un perfil inactivo o una cuenta Auth sin perfil recibe conjuntos vacíos y
  RLS rechaza sus escrituras;
- `service_role` conserva permisos técnicos sobre el esquema y omite RLS, por
  lo que sólo puede existir en infraestructura de servidor.

La interfaz resuelve permisos efectivos por identidad de Supabase Auth.
`AUTH.canAccess()` es la única autoridad de navegación; menú, destino inicial,
pantalla persistida, navegación interna y montaje consumen ese contrato. Una
pantalla revocada no se monta y se reemplaza por la primera permitida o por el
estado restringido.
`balam/screens.jsx` es el registro central de pantallas: de él se derivan menú,
títulos, componentes y secciones internas de Configuración. Agregar una
pantalla navegable exige registrarla una sola vez y los consumidores no
mantienen catálogos paralelos.
El snapshot de autorización procede de
`pos.current_permission_snapshot(text[])`, usa exclusivamente `auth.uid()` y
resuelve cada hoja mediante las funciones de Fase 2. La caché local contiene
versión de esquema, modelo, registro, permisos y fecha de verificación; sólo se
usa ante indisponibilidad remota y cualquier dato desconocido, incompleto,
corrupto o de otra identidad se deniega. Al reconectar, el snapshot remoto
reemplaza la caché atómicamente.

H-56 completó las fases 1 a 4. Administrador y vendedor conservan su conducta
inicial mediante permisos sembrados por rol, no por una excepción paralela en
la navegación. El editor de permisos ya está activo.

La Fase 5 separa la visualización de la autorización operativa. El catálogo
`operational_capabilities` contiene claves estables de acción; los permisos de
rol y overrides individuales se resuelven en servidor mediante
`resolve_operational_capability()`. Toda frontera sensible debe invocar
`require_current_capability()` dentro de su transacción. Administrador hereda
todas las capacidades y vendedor conserva sólo las operaciones históricamente
autorizadas. El primer grupo protege liquidación y cierre de comisiones con RPC
atómicas, auditoría e idempotencia, sin escritura directa desde el cliente.

El modelo de Fase 2 persiste identidades `auth.users.id`, nunca vendedores
comerciales sin cuenta. `user_screen_permission_overrides` precede a
`role_screen_permissions`; la ausencia de ambos deniega. Las funciones
`current_screen_permission()` y `current_screen_permissions()` exponen la
resolución del usuario actual. La administración usa RPC auditadas y no
escritura directa. Las cinco tablas nuevas tienen RLS y sólo un administrador
activo que conserve `config.usuarios` y `config.permisos` puede consultarlas o
mutarlas mediante las fronteras autorizadas.

`supabase/_PEGAR-EN-SQL-EDITOR.sql`, `ARREGLAR-ADMIN.sql` y scripts de limpieza
son herramientas operativas heredadas, no migraciones ni fuentes de verdad;
antes de ejecutarlos se debe revisar alcance y entorno.

## Edge Functions

Actualmente `supabase/functions/admin-users/index.ts`:

- Recibe el JWT del usuario.
- Usa un cliente con ese JWT y esquema `pos` para comprobar que sea
  administrador y operar sobre `pos.sellers` bajo RLS.
- Reserva `service_role` para crear, actualizar o eliminar usuarios en
  Supabase Auth.
- Nunca debe exponer la clave `service_role` al navegador.

Una Edge Function desplegada puede diferir del archivo local. Toda corrección
debe registrar versión/despliegue y verificar el comportamiento remoto.
La versión 8 de `admin-users` quedó verificada mediante creación de una identidad
temporal, autenticación, cambio real de contraseña, invalidación de la anterior,
autenticación con la nueva y eliminación completa. Las migraciones
`20260725002700` y `20260725002800` encapsulan la preparación y limpieza de la
identidad administrativa auxiliar.

## Sincronización

El dominio operativo `devices` no transporta datos comerciales. Proyecta el
estado de cada instalación en `pos.sync_devices` y el ciclo resumido de su cola
en `pos.sync_activity`: equipo, usuario, tipo de operación, referencia, estado y
diagnóstico acotado. Nunca persiste el payload de ventas, inventario o clientes.
Un heartbeat de un equipo conectado se publica cada minuto; una ausencia de
heartbeat significa estado actual desconocido, no «sincronizado».

El Centro de equipos es una lectura administrativa de esa proyección. Nombrar
una instalación no cambia su `device_id`. «Autorizar reintento» crea una orden
para la instalación de origen; cuando vuelva a conectarse, reutiliza
`STORE.retryOperation()` sobre la misma operación durable. La orden no concede
permisos, no altera documentos y no sustituye las RPC de negocio.

Una operación separada por cambio de época conserva dos representaciones con
responsabilidades distintas. El JSON y el archivo local guardan la operación
completa como evidencia recuperable; `pos.sync_quarantine_cases` guarda en la
nube sólo huella SHA-256, resumen, artículos acotados y la decisión auditada.
El administrador puede exportar esa proyección a Excel, aprobar o rechazar. Una
aprobación no escribe tablas comerciales: el equipo de origen restaura la misma
operación en la cola y `flushQueue()` vuelve a ejecutar su RPC normal con todas
sus defensas de permisos, inventario, época e idempotencia.

En el arranque, `STORE.init({ pull: true })`:

1. Cuenta las operaciones que ya estaban pendientes.
2. Intenta drenar la cola antes de descargar.
3. Procesa la marca de reset, si existe.
4. Descarga configuración, salvo que haya configuración local pendiente.
5. Descarga y aplica colecciones de dominio.
6. Descarga ventas por ventana temporal y las fusiona.
7. Vuelve a intentar la cola.

También se drena al evento del navegador `online`. La sincronización es
eventual; la interfaz no espera confirmación remota para aceptar una mutación
local.

### Recuperación transaccional de terminal

Un arranque administrativo recupera desde Supabase productos, clientes,
vendedores, promociones, devoluciones con sus renglones, liquidaciones, pagos,
movimientos y ventas con sus renglones. Las ventas recientes usan la ventana
configurable de 365 días y se agregan todos los apartados; un folio anterior se
puede recuperar bajo demanda.

`pos.movements` es un historial de sólo lectura para el cliente: las escrituras
de venta y devolución se realizan exclusivamente dentro de sus commits SQL
transaccionales. El pull recorre la tabla por `id` ascendente en páginas de
1 000 y sólo reemplaza `DATA.movements` después de completar la lectura. Si una
venta o devolución de la sesión activa sigue en la cola, se omite ese pull para
no pisar movimientos locales todavía no confirmados.

Los campos financieros de una venta se reconstruyen desde su snapshot remoto y
los pagos desde `sale_payments`. Un registro histórico sin esos campos conserva
su total conocido y no recibe valores inventados.

### Paginación y volumen

Toda lectura que pretende reconstruir un conjunto completo recorre páginas
explícitas de 1 000 filas y mantiene un orden estable. Esto incluye
configuración, catálogos, dominios administrativos, movimientos, ventas,
apartados y los lotes de renglones de ventas/devoluciones. Una página llena
nunca se interpreta como fin del conjunto; un error intermedio impide aplicar
un resultado parcial.

Las ventas recientes se ordenan por `fecha, folio` y los apartados por `folio`.
La migración `20260725003200_pos_h16_sync_indexes.sql` respalda esas consultas
con `sales_fecha_folio_idx` y el índice parcial
`sales_apartado_folio_idx`. Las ventas fuera de la ventana permanecen
disponibles mediante búsqueda por folio y el pull continúa fusionando, no
reemplazando, el historial local.

### Versionado multi-terminal

Productos, clientes, vendedores y promociones usan el contrato introducido por
`supabase/migrations/20260725001300_pos_013_concurrency.sql`:

- `sync_version` es la versión confirmada por el servidor;
- cada escritura envía `sync_base_version`, la versión que leyó la terminal;
- el servidor solo acepta coincidencia exacta e incrementa la versión;
- un intento obsoleto conserva la fila vigente y se registra en
  `pos.sync_conflicts`;
- `deleted_at` conserva eliminaciones como tombstones;
- `pos.soft_delete_entity()` aplica el borrado lógico bajo las políticas RLS de
  la tabla;
- cada navegador conserva un `balam_device_id` para relacionar conflictos con
  la terminal que los originó.

La política es primera escritura confirmada gana. El cliente pide la
representación resultante del `upsert`: si fue aceptado, guarda la versión nueva;
si fue rechazado, restaura la fila vigente y avisa. Las operaciones compactadas
se reconstruyen justo antes de enviarse para incorporar versiones confirmadas
mientras otra operación estaba en vuelo.

La migración de verificación
`20260725002600_pos_h06_concurrency_verification.sql` comprobó este contrato en
el Supabase enlazado para productos, clientes, vendedores y promociones:
cuatro escrituras obsoletas conservaron la primera versión confirmada y quedaron
auditadas; un snapshot anterior tampoco revivió un tombstone.

Este contrato de snapshots evita que una copia antigua revierta stock, pero por
sí solo no combina dos deltas de venta concurrentes. La reserva atómica
descrita a continuación cubre esa coordinación de H-01.

### Reserva atómica de stock

Las migraciones `20260725001700_pos_atomic_stock_reservation.sql` y
`20260725001800_pos_require_stock_reservation.sql` separan el descuento de una
venta de la sincronización de snapshots:

1. Cada venta local recibe un `operation_id` estable.
2. `STORE` conserva la operación en la cola y llama `pos.commit_sale()`; esta
   función invoca internamente `pos.reserve_sale_stock()` cuando corresponde.
3. La función serializa el mismo `operation_id`, bloquea productos en orden
   estable, agrupa por producto/talla y valida todo antes de descontar.
4. `pos.stock_reservations` registra la operación confirmada; repetirla
   devuelve éxito idempotente sin descontar otra vez.
5. Un trigger impide insertar una venta cobrada nueva sin una reserva que
   coincida en `operation_id` y folio.
6. Si falta inventario, la operación permanece en cola y la venta local queda
   `stock_pending`; no aparece como venta autoritativa hasta un reintento
   exitoso.

Los apartados no reservan inventario al crearse; la reserva se exige cuando se
liquidan y pasan a estado cobrado. Las ventas históricas sin `operation_id`
siguen siendo legibles y actualizables.

El apartado abierto se administra en `balam/layaway.jsx` —pantalla `apartados` del
menú lateral—: es la única superficie que captura un abono y emite su comprobante.
No decide nada del dominio: delega en `DATA.registrarPagoApartado`, que sigue
siendo la autoridad del abono, de la liquidación y de sus efectos.

Este contrato resuelve la competencia por existencias de H-01 y es parte de la
transacción completa de venta descrita a continuación.

### Commit transaccional de venta

Las migraciones `20260725001900_pos_transactional_sale.sql` y
`20260725002000_pos_transactional_sale_verification.sql` establecen el contrato
remoto de H-04 para ventas:

1. La clave de la operación durable de la cola se usa como `commit_id`; la clave
   estable de la venta continúa como `operation_id` de la reserva.
2. Una única llamada `pos.commit_sale()` procesa reserva, cabecera, renglones,
   movimientos, historial completo de pagos y deltas de cliente/vendedores.
3. PostgreSQL confirma todos los componentes o revierte todos ante cualquier
   excepción.
4. `pos.sale_commits` conserva el hash canónico del payload. Repetir la misma
   clave y contenido devuelve `idempotent=true`; cambiar el contenido devuelve
   `commit_mismatch`.
5. Los acumulados se aplican como deltas dentro del commit y una sola vez. La
   respuesta devuelve productos, cliente y vendedores para reconciliar las
   versiones locales.
6. Cada abono de apartado es un commit nuevo con el historial completo. La
   liquidación reutiliza el `operation_id` de la venta para reservar stock una
   sola vez.

Las operaciones de venta creadas por versiones anteriores de la aplicación se
migran en la cola con pagos/efectos vacíos y conservan su identificador. Las
ventas históricas siguen siendo legibles.

### Identidad y folio de venta

Cada venta nueva tiene dos identificadores con responsabilidades **separadas**;
ninguno se deriva del otro:

- `_operationId` / `sales.operation_id` es la identidad técnica inmutable: UUID
  usado por reserva de stock, commit idempotente, conflictos y cola offline. No
  se muestra al usuario.
- `folio` / `sales.folio` es la referencia comercial visible en ticket, tablas,
  búsquedas, devoluciones y reportes. Desde H-33 su formato es
  `{PREFIJO}-{AAMMDD}-{CONSECUTIVO}`, por ejemplo `BG-260727-0001`.

`DATA.nextFolio()` es la única autoridad que lo construye. El prefijo proviene
de `folio.prefix` y se normaliza a A-Z0-9, máximo seis caracteres; el día es el
del negocio y sale de la **misma** fecha que se guarda en la venta, no de una
segunda lectura del reloj; el consecutivo usa cuatro dígitos y crece a cinco
después de 10000 sin truncarse. Cambiar el prefijo no altera ninguna venta ya
registrada: el folio se copia dentro de la venta al crearla.

La unicidad entre terminales la aporta `pos.folio_counters`, un contador
atómico por (prefijo, día) que sólo escribe `pos.reserve_folio_block()`. Cada
terminal reserva un bloque de diez números y lo consume **sin red**, por lo que
una venta offline ya nace con folio corto y definitivo; repone cuando le quedan
tres o menos, al arrancar, al reconectar y después de cada venta. El día nuevo
pide un bloque nuevo y la numeración reinicia en `0001`. `DATA` conserva la
reserva en `balam_pos_folio_v2` y la pide a `STORE` por el gateway de `CORE`.

### El folio impreso no cambia

Sin bloque vigente y sin red, la terminal emite un folio **provisional** que
lleva un cuarto segmento con su código de terminal —`BG-260727-0001-K7Q`, tres
caracteres base 36 derivados de `balam_device_id`—. Ese sufijo lo distingue de
cualquier otra terminal, así que el folio provisional es **definitivo**: no se
renombra al sincronizar. El consecutivo toma como piso el mayor del día que la
terminal conoce, incluidas las ventas bajadas de la nube, y el cobro nunca se
bloquea. En cuanto llega un bloque, las ventas siguientes vuelven al formato
limpio; las provisionales ya emitidas conservan su folio.

Supabase conserva `commit_sale()` → `folio_conflict` para el residuo: dos
terminales que compartan código —una en 46 656— u operaciones heredadas de H-02
todavía en cola. Sólo en ese caso `STORE` pide otro número del contador y cambia
conjuntamente renglones, pagos, movimientos, devoluciones y entradas de cola,
con la misma identidad técnica. El folio ya impreso **no se pierde**: pasa a
`sale.folioAliases` / `pos.sales.folio_aliases` (índice GIN) y sigue resolviendo
búsqueda, devolución, reimpresión y `fetchSaleByFolio` desde cualquier terminal.
La operación permanece en la cola hasta que la nube conserve ese alias.

`DATA.findSaleByFolio()` es la autoridad de resolución: la coincidencia exacta
por folio vigente tiene prioridad y el alias sólo se consulta después, contra la
venta que realmente lo imprimió, de modo que un ticket nunca ofrece la venta
ajena que casualmente comparta la cadena. Cuando la búsqueda resuelve por alias,
la interfaz lo dice: «este ticket se registró posteriormente como …».

Una devolución no sale de la cola mientras la venta que la origina siga en ella
—pendiente, fallida o con folio sin resolver—, para que la nube no pueda
atribuirla a otra venta con el mismo folio impreso.

Una venta ya confirmada en la nube no se renombra nunca.

Los folios anteriores a H-33 —`prefijo + consecutivo + token base 36 del UUID`—
permanecen válidos, buscables, reimprimibles y devolvibles. No se migran, no se
interpretan como formato nuevo y no participan en el consecutivo diario. Una
operación antigua todavía en cola conserva la reidentificación por token de
H-02.

### Plazo de posventa

El plazo para devolver una venta es un **snapshot de la venta**, no una lectura
de la configuración vigente. `Configuración → Devoluciones` administra
`returns.limitEnabled` y `returns.limitDays`; cada venta congela ese valor al
crearse en `sales.return_limit_days` / `sales.return_expires_at`, de modo que
cambiar la política después no altera ninguna venta anterior.

`return_limit_days` nulo significa **sin límite** y es el estado de todas las
ventas anteriores a H-34: nunca vencen. Con días congelados y sin fecha, el
plazo todavía no arranca —es el caso del apartado, que empieza a contar el día
en que se liquida porque entonces se entrega la mercancía—. El vencimiento se
mide desde la **misma fecha guardada en la venta**, nunca desde una segunda
lectura del reloj.

`DATA.returnDeadline(sale)` es la autoridad única: devuelve estado
(`sin_limite`, `pendiente`, `vigente`, `vencido`), días restantes y la etiqueta
visible. Una fecha irreconocible se trata como «sin límite»: no se inventa un
vencimiento. `DATA.isReturnable()` conserva su responsabilidad —el estado de la
venta— y no absorbe el plazo: son dos compuertas ortogonales, por lo que una
venta vencida sigue siendo visible y filtrable en Devoluciones aunque no pueda
confirmarse.

`commit_sale` transporta ambas columnas de forma aditiva: un cliente que no
envía las claves obtiene NULL, es decir el resultado histórico, y un reintento
sin plazo no borra el ya registrado.

### Commit transaccional de devolución

Las migraciones `20260725002100_pos_transactional_return.sql` y
`20260725002200_pos_transactional_return_verification.sql` completan H-04:

1. La devolución completa permanece como una operación durable en la cola y
   viaja mediante una sola llamada `pos.commit_return()`.
2. La función bloquea la venta original y valida cantidades contra
   `sale_items` menos todas las devoluciones ya confirmadas. Dos terminales no
   pueden devolver la misma unidad.
3. En una transacción confirma cabecera, renglones, reingreso de stock,
   movimiento, estado de venta y reversos de cliente/comisión.
4. `pos.return_commits` conserva el hash del payload. Un reintento idéntico no
   duplica efectos y una clave reutilizada con otro contenido se rechaza.
5. Cada movimiento nuevo guarda `return_id`; devoluciones parciales distintas
   no borran ni reemplazan movimientos ajenos.
6. La respuesta devuelve el estado autoritativo de la venta y las entidades
   versionadas para reconciliar la copia local.

Las migraciones `20260725002300_pos_legacy_return_adoption.sql` y
`20260725002400_pos_legacy_return_adoption_verification.sql` cierran la
adopción de operaciones antiguas que ya estaban en cola. La migración local
captura desde `DATA` los objetivos exactos y su versión base para producto,
cliente y vendedores. `pos.commit_legacy_return()` valida todos los objetivos
antes de escribir: los aplica sólo sobre la versión base, reconoce sin duplicar
un objetivo ya aplicado en `base_version + 1` y deja en cola cualquier tercera
versión como `legacy_version_conflict`. Cabecera, renglones, movimientos y
objetivos se confirman o revierten juntos. No se infieren deltas históricos.
Los datos históricos sin `product_id` o `return_id` siguen siendo legibles.

## localStorage

Es persistencia operativa, no un caché descartable. Aloja:

- configuración;
- colecciones de dominio;
- reserva diaria de folios (`balam_pos_folio_v2`);
- préstamos de mercancía (`balam_pos_loans_v1`), caché local de
  `pos.loan_documents`: lo ya sincronizado se reconstruye desde la nube, lo que
  todavía no salió de la cola no;
- copia congelada previa a la migración de H-62
  (`balam_pos_loans_premigracion_v1`), que sólo se retira a mano;
- periodo y banderas de datos de prueba;
- sesión administrada por Supabase JS;
- cola `balam_sync_queue`.

Consecuencias:

- Borrar datos del navegador puede eliminar cambios aún no sincronizados.
- La cuota puede agotarse, especialmente con imágenes base64.
- Dos pestañas o dos terminales no comparten coordinación atómica local.
- Cambiar claves o formatos exige compatibilidad o migración explícita.

## Cola offline

La cola está en `localStorage` bajo `balam_sync_queue`.

- Toda operación se encola **antes** de intentar enviarse.
- `flushQueue()` es el ejecutor único y procesa en orden.
- Los `upsert` de una misma tabla y la configuración se compactan al estado más
  reciente.
- Ventas y eliminaciones se conservan en orden y deben ser idempotentes.
- Una operación solo sale de la cola después de éxito remoto.
- Cada operación conserva `status`, `attempts`, fechas y un diagnóstico con
  categoría, código, mensaje y política de recuperación.
- Red y errores de servidor permanecen en reintento automático. Autenticación,
  RLS, esquema, restricciones y conflictos se clasifican por separado; los
  bloqueos permanentes no se martillan en cada drenado.
- `STORE.queueStatus()` expone un resumen sanitizado y
  `STORE.retryOperation(id)` permite el reintento explícito.
- La campana administrativa muestra operaciones fallidas y su causa. Una nueva
  sesión reanuda las operaciones detenidas por autenticación.
- `flushQueue()` toma el candado antes de esperar al cliente de Supabase: nunca
  hay dos ejecutores de cola concurrentes dentro de la misma pestaña.
- Si `localStorage` rechaza la escritura por cuota, la cola completa se refleja
  en IndexedDB (`balam_sync/durable_queue`) antes de enviarse. El arranque
  hidrata ese espejo antes de drenar o hacer pull. Cuando `localStorage` vuelve
  a aceptar escrituras, recupera la autoridad y elimina el espejo para no
  restaurar snapshots obsoletos. Sólo si ambos almacenamientos fallan se
  conserva en memoria y se muestra la alerta crítica de no cerrar la pestaña.
- Cada operación nueva conserva el correo normalizado de la sesión que la creó.
  `flushQueue()` sólo ejecuta operaciones cuyo propietario coincide con la
  sesión activa; la compactación y el reajuste de versiones respetan el mismo
  límite.
- `AUTH` entrega cada cambio de identidad a `STORE.setSession()`. El logout
  suspende sincronización sin borrar pendientes y cada identidad distinta
  vuelve a drenar su propia cola antes de realizar un pull.
- Las operaciones históricas sin propietario se ponen en cuarentena. No se
  atribuyen al primer login: un administrador debe revisarlas y reclamarlas
  expresamente con `STORE.claimLegacyQueue()`.

La cola mejora durabilidad, pero por sí sola no convierte varias escrituras SQL
en una transacción. Ventas y devoluciones resuelven ese límite mediante
`commit_sale` y `commit_return`, respectivamente.

## Contratos que no deben romperse

- La acción local debe funcionar sin conexión y dejar una operación recuperable.
- Un pull no debe pisar cambios locales pendientes.
- Reintentar no debe duplicar ventas, pagos, devoluciones ni movimientos.
- Datos históricos sin campos nuevos deben seguir siendo legibles.
- Una terminal con una versión antigua no puede sobrescribir ni revivir una
  entidad más reciente; el conflicto debe quedar registrado.
- `sales.total` es el total final con IVA; el desglose fiscal y los pagos son
  snapshots históricos, no cálculos con configuración vigente.
