# Arquitectura de POS BALAM

## Vista general

POS BALAM es una aplicación React cargada directamente en el navegador, sin
bundler en tiempo de ejecución. Los módulos en `balam/` publican APIs globales
en `window`. El contrato comercial aprobado en H-164 es **online-only**:
Supabase es la única autoridad comercial y toda escritura requiere confirmación
del servidor. `DATA` y `CONFIG` contienen exclusivamente proyecciones efímeras;
una recarga las reconstruye desde remoto. No existe una cola comercial nueva
ni fallback offline. La decisión y sus límites viven en `ADR-015`.

```text
Usuario → solicitud con identidad estable → CORE → STORE.execute
    → Supabase / RPC → confirmación autoritativa → consulta remota
    → sustituir proyección de memoria → actualizar UI → mostrar éxito
```

Sin conexión real con Supabase, se bloquean las escrituras y se muestra:
«Sin conexión. BALAM necesita internet para continuar.» Una respuesta incierta
se consulta por su identidad antes de permitir repetir: «Estamos confirmando
la operación. No la repitas.» La recepción perdida nunca autoriza reenviar
automáticamente una operación comercial.

`POS Balam.html` carga los módulos fuente. `build-offline.mjs` genera
`index.html` y `POS Balam (offline).html`; estos dos archivos son artefactos, no
la fuente primaria. Sus nombres históricos describen el empaquetado de recursos,
no una capacidad comercial sin Internet. Esta documentación describe el código
de H-164; aplicación SQL, publicación y certificación se acreditan por separado
en `docs/fixes/evaluacion-arquitectura-sincronizacion-h164.md`.

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

## Publicación en GitHub Pages

El workflow `h164-online-authority.yml` verifica consumidores y almacenamiento,
contratos online, SQL y la UI del artefacto generado antes de publicar desde
`main`. PGlite está fijado en el lockfile; la ejecución SQL local no descarga una
dependencia paralela. Las rutas activas de H-148/H-132 y la excepción de publicación
H-157 se retiran; sus pruebas y evidencia históricas permanecen en el repositorio.

La matriz remota se ejecuta manualmente con `live=true`, separada del despliegue
y desactivada por defecto. Reutiliza exactamente el artefacto probado y conserva
las identidades de QA. Las credenciales de provisión sólo se cargan en ese job
desde `main`. Su ausencia no equivale a certificación; la publicación sigue
separada de esa evidencia según la decisión H-162.
H-164 exige la certificación A/B/C solicitada por el usuario antes de declarar
cerrado este frente; publicar y certificar siguen siendo resultados distintos.

## Instalación PWA

La publicación HTTP bajo `/POS_Balam/` registra `sw.js` con ese mismo scope.
El worker conserva sólo el shell autocontenido, el manifest y los iconos; no
intercepta Supabase, APIs ni datos de dominio. `localStorage` y la cola
comercial anterior ya no participan como persistencia operativa. Supabase es la única
autoridad comercial. La primera carga requiere red; una navegación posterior
puede abrir el shell instalado, pero no confirma negocio sin consultar Supabase.

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
captura o un diálogo realmente abierto. Las guardas usan el estado explícito
de apertura; un drawer cerrado no equivale a diálogo activo. Una solicitud de
resultado incierto conserva su referencia técnica antes de cualquier recarga.
`POS Balam (offline).html` no registra worker y permanece como artefacto
independiente, con el mismo requisito de conexión comercial.

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
`DATA` registra el acceso a los productos confirmados; `CONFIG` consulta
ese adaptador sin depender de `window.DATA` y prepara filas separadas para
cualquier modificación. `CORE` no mantiene otra colección comercial.

El gateway evita que `DATA`, `CONFIG` y `AUTH` conozcan directamente a `STORE`:
antes del registro rechaza una llamada no disponible y, después de que
`STORE` publica su API, reenvía
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

- Mantiene en memoria ajustes, catálogos y reglas administrables confirmados.
- Las lecturas públicas entregan copias; no exponen el estado mutable real.
- `prepareMutation()` aplica el reductor a un borrador separado, sin emitir
  cambios ni persistir. Devuelve configuración y productos afectados juntos.
- Las mutaciones públicas son asíncronas: esperan `CORE` → `STORE.execute()`.
  La configuración y los productos asociados se confirman en una transacción.
- `load()` reemplaza la proyección con `settings` y `lookup` de Supabase y
  emite `configchange`; `clearRemote()` retira esa proyección al cambiar sesión.
- No lee ni escribe configuración comercial en `localStorage`. Los valores de
  arranque no permiten escribir antes de verificar el estado remoto.

El servidor valida la versión esperada de configuración. Un conflicto no
modifica la proyección confirmada ni se convierte en una operación pendiente.

## DATA

Archivo: `balam/data.jsx`. API: `window.DATA`.

- Es el modelo de dominio usado por la interfaz.
- Mantiene en memoria productos, vendedores, clientes, ventas, promociones,
  liquidaciones, devoluciones, pagos y movimientos.
- No persiste colecciones comerciales en el navegador.
- Conserva cálculos, contratos históricos y preparación de comandos para ventas,
  pagos, devoluciones, comisiones, préstamos, inventario y otros dominios.
- Las mutaciones preparan copias separadas y esperan confirmación por `CORE`.
  `confirmCommand()` exige una respuesta válida; no hay éxito local anticipado.
- `replaceFromOnline()` sustituye en memoria el conjunto recibido de Supabase.
  `saveProductRows()` y `saveProductFamily()` envían sólo filas propuestas,
  con identidad y versión base, sin guardar una segunda realidad local.
- `DATA.canonicalProductAttrs()` es la autoridad de representación para atributos
  de catálogos custom conocidos. Un opcional `null`, vacío o con sólo espacios se
  omite; claves `__*` y atributos históricos desconocidos se preservan. Las
  fronteras de alta, edición e importación rechazan los obligatorios sin valor.
  Firma física, snapshots, persistencia, estadísticas, Excel y fingerprints
  consumen esa misma autoridad.

### Identidad de referencias físicas V2

El modelo es aditivo. Un producto V1 conserva su `products.id`, matriz `stock[]`
y adaptadores históricos. Toda alta nueva es V2: una referencia física equivale
a una fila `products`, con un solo `size_code`, `stock_quantity` escalar,
`barcode_code` y firma física canónica. No existe un `variant_id` paralelo:
`products.id` es la identidad técnica única e inmutable.

`CONFIG.referenceParts()` define, mediante `EN REFERENCIA`, qué categorías
integran la firma física. Es independiente de `EN SKU`; por ello dos referencias
pueden compartir SKU comercial sin compartir identidad ni stock. La duplicidad
de SKU produce advertencia; duplicar `products.id`, `barcode_code` o firma física
V2 bloquea. Material (`tela`) y Color Tela (`color`) son dimensiones distintas,
y Color de ornamento es un catálogo independiente y multiselección canónica.

El escaneo moderno sólo sigue `Code128 → barcode_code → products.id`. Nunca
atraviesa SKU ni elige la primera coincidencia. La etiqueta muestra nombre,
barras, SKU y precio; el texto técnico de `barcode_code` no se imprime. El SKU
queda como representación humana configurable y no cambia al editar precio.

Las autoridades SQL de alta individual y familiar conservan `barcode_contract`
y la familia enviada en la creación. Una referencia activa sin contrato 3 se
rechaza explícitamente, incluso si el valor es NULL. Las ediciones conservan
los códigos y aliases históricos; estos metadatos no se reparan mediante una
regeneración de SKU o de códigos de barras.

En POS, una lectura de formato logístico V3 sin coincidencia termina con un
aviso humano tanto en el campo de búsqueda como en la captura global. No pasa
a coincidencias comerciales por nombre o SKU. Los avisos sobre fondo oscuro
usan la variante inversa de `HumanMessage`; el detalle técnico conserva su
restricción administrativa.

Los bloqueos de baja de Inventario entregan código y contexto `product_delete`
al catálogo central de mensajes. Así se conserva el motivo operativo sin
alterar las guardas ni reinterpretar errores iguales de otros flujos.

`BARCODES.certifySellableReference()` es la puerta ejecutable previa a toda
etiqueta vendible nueva. Sólo una referencia V2 cuyo `barcode_code` sea único,
codificable y resoluble al mismo `products.id+talla` puede producir preview,
PNG, PDF, vista imprimible o upload. Un lote falla completo si una combinación
no certifica: no hay salida parcial. V1 permanece legible mediante sus
adaptadores históricos, pero no autoriza etiquetas vendibles nuevas; su stock
debe migrarse explícitamente a V2 sin reinterpretar documentos anteriores.

`window.BARCODES` también es la autoridad única de entrada HID. Si una
distribución de teclado incompatible hace que el navegador reporte la posición
física `Minus` como apóstrofe o `Slash` como guion, `scannerChar()` entrega `-`
o `/`, respectivamente, antes de presentar o acumular la tecla. POS, Préstamos
y Cambios consumen el mismo contrato tanto en su campo directo como en la
captura global. Esta adaptación no cambia el texto Code128, SKU, `barcode_code`
ni identidad; los caracteres ya correctos se conservan, una tecla física
`Quote` mantiene el apóstrofe literal y `resolve()` respeta la coincidencia
exacta prioritaria.

Ventas, devoluciones, cambios y préstamos nuevos congelan `line_id`,
`productId`, barcode, SKU, atributos físicos, talla, precio de lista, descuentos
y precio efectivo. La posventa parte de la línea original. `SKU+talla` subsiste
únicamente para documentos V1 y sólo se adopta cuando produce un candidato
único; toda ambigüedad bloquea.

Una referencia V2 con stock o documentos no admite edición silenciosa de su
firma. `DATA.reclassifyReference()` espera la confirmación online de la operación y
`pos.commit_reference_reclassification()` mueve cantidad entre dos IDs con
bloqueo, auditoría, idempotencia y reversa exacta. Nunca reescribe documentos.

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

- congela su evidencia —`line_id`, `productId`, barcode, `nombre`, `sku`,
  atributos, `talla`, `qty` y precios—, más una copia de la persona que recibió, de modo
  que editar el producto o el cliente después no altera un préstamo registrado;
- su referencia comercial es `PR-{AAMMDD}-{CONSECUTIVO}`, con consecutivo propio
  asignado online mediante `STORE.allocateFolio()` y `pos.folio_counters`.
  No consume una reserva local: la identidad técnica es un UUID separado;
- sus estados son `pendiente`, `devuelto` y `no_devuelto`. No son un catálogo
  administrable: son el contrato del módulo;
- la devolución puede ser parcial. Cada entrega deja su asiento y la fecha real de
  devolución se fija con la que completa el préstamo. Una pieza declarada no
  devuelta que aparece después todavía puede devolverse;
- **no mueve existencias.** `DATA.loanedQty(productId, talla)` es la autoridad V2 de
  «unidades fuera» y `DATA.prestamoAtraso()` la única de «vencido»; ambas se
  derivan de la colección. `pos.movements` no se usa: es historial de sólo lectura
  para el cliente y el pull lo reemplaza.

La captura consume `window.BARCODES` igual que el Punto de venta: V2 resuelve
`barcode_code` directamente a `products.id`; `SKU-TALLA` queda como adaptador V1. La
captura global HID —con la misma heurística de cadencia de `balam/pos.jsx`— funciona
aunque el foco esté en otro campo. POS, Préstamos y Cambios retiran del campo
enfocado exactamente la ráfaga cruda sólo después de resolverla como código
conocido; una ráfaga desconocida no altera el tecleo humano. En el buscador de
la cartera una lectura responde «¿quién tiene
esta prenda?» y busca en todos los estados, ignorando el filtro a propósito.

El préstamo se confirma exclusivamente en servidor. Entrega, devolución,
faltante, edición, baja y reapertura pasan por `STORE.execute()` y la autoridad
transaccional `pos.commit_loan_operation()`, con identidad y versión esperada.
`pos.loan_documents` conserva el documento completo en `document jsonb`, con su
evidencia congelada, y `pos.capability_operation_audit` conserva la idempotencia
de la operación. `_loanVersion` describe la versión recibida; no acredita por
sí sola un documento ausente de Supabase.

`online_snapshot()` reconstruye la colección que la sesión está autorizada a
leer. No se rescatan préstamos de una caché local ni se fusionan documentos
pendientes. Un expediente legacy sin confirmación se conserva para decisión
individual fuera de la colección operativa, sin reproducción automática.

Los folios y alias históricos siguen localizando vales ya impresos.
`DATA.findLoanByFolio()` busca primero folio vigente y después alias. Las nuevas
operaciones reciben el folio del servidor antes de confirmarse y sólo pueden
imprimirse después de la confirmación autoritativa.

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
`_BALAM_ID_PRODUCTO`/`_BALAM_VERSION_PRODUCTO`; V2 añade modelo de registro,
barcode, firma, una talla y stock escalar, mientras V1 conserva todas las tallas. `Catálogos`
publica los códigos y el mapa inequívoco encabezado humano → escala/valor; la
hoja oculta `_BALAM` identifica versión y huellas del esquema.

La plantilla nueva permite altas V2 rellenando sus campos visibles de referencia
y talla, sin editar el modelo técnico oculto. La presentación prioriza esos
campos y conserva las columnas legacy del contrato para leer y exportar V1.
Un modelo V1 explícito o un archivo heredado conserva su ruta de compatibilidad;
rellenar una plantilla nueva no convierte productos V1 existentes.

El lector resuelve columnas por encabezado, no por posición. Un libro canónico
se bloquea si falta o se duplica una columna obligatoria, si la versión es
incompatible, si una talla no puede resolverse o si un valor tipado/JSON es
inválido. Los archivos heredados siguen una ruta explícita y sus campos ausentes
significan **preservar** al actualizar; nunca reciben códigos de catálogo por
default silencioso.

Los valores históricos de catálogo, incluida una talla inactiva, sólo se
conservan al actualizar la misma referencia identificada y sin cambiar ese
valor. No habilitan altas ni cambios hacia valores inactivos. Los códigos
disponibles para nuevas altas proceden de los catálogos activos de CONFIG.

Los atributos custom se comparan y transportan en su representación de DATA:
para un catálogo opcional conocido, ausencia, `null`, `""` y espacios significan
«sin valor» y se serializan omitiendo la clave. Excel no mantiene una fórmula
paralela para fingerprints ni para el round-trip.

`XLSXIO.planImport()` hace el preflight completo sin mutar DATA. Un ID técnico
válido actualiza exactamente ese producto y nunca convierte V1↔V2; V2 también
puede localizar por barcode único. Sin identidad, el adaptador V1 exige una
coincidencia única. SKU duplicado entre referencias V2 sólo advierte; ID,
barcode, firma o edición física usada bloquean. La vista
previa distingue altas, actualizaciones, filas sin cambios, conflictos y
diferencias de stock/precio. El aviso de SKU compartido no se extiende a la
ambigüedad legacy que bloquea el plan. La autoridad de mensajes recibe el
contexto de importación y separa problemas de formato, identidad, catálogo,
versión y bloqueo de negocio.

`applyImportPlan()` vuelve a comprobar la huella de base y prepara filas
separadas sólo si el plan entero sigue válido. Su conjunto de IDs incluye
exclusivamente altas y actualizaciones con cambios canónicos; las filas sin
cambios no autorizan escritura. Si el archivo entero coincide, la UI cierra
con «Sin cambios» sin ejecutar una mutación.

La confirmación espera `DATA.saveProductRows()` y la transacción del gateway.
Las versiones, identidades y restricciones de uso de las referencias se
verifican en servidor. Un rechazo no instala el plan en DATA; una respuesta
incierta mantiene la referencia técnica y consulta el recibo antes de repetir.
Excel no implementa persistencia, cola ni reglas de concurrencia paralelas.

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

`BalamTicket` y `BalamReturnReceipt` comparten `useReceiptPageSize()` dentro de
`pos-ticket.jsx`. El hook mide el comprobante de 80 mm y define una página CSS
nombrada con altura explícita, redondeada hacia arriba con 1 mm adicional. Se
actualiza al renderizar, cambiar sus dimensiones, terminar de cargar fuentes y
antes de imprimir. El cuerpo hereda la misma página durante impresión para
evitar una hoja inicial vacía por el portal. Al desmontar se retiran regla,
observador y evento. El PDF conserva una página continua sin cambiar contenido,
tipografía ni documentos. H-153 congela esa vista y vuelve a medirla en un frame
exclusivo antes de enviarla; el ticket por método también recibe página continua.
Reportes A4 y etiquetas conservan su formato propio. Una configuración física de papel que lo fuerce puede
requerir ajuste del controlador; el corte real se valida en la impresora.

### Transporte de comprobantes en Android

La exclusión de impresión es técnica y efímera. No existe un escritor comercial
local ni rebase durable al volver de una aplicación externa. La aplicación
reconsulta Supabase al recuperar foco o conectividad. Un comprobante comercial
nuevo sólo llega al transporte después de confirmarse su operación.

`UI.printReceipt()` crea un trabajo en `window.PrintManager`, cargado después de
`shared.jsx`. Congela documento y estilos antes de cualquier espera; cada trabajo
conserva ID, origen, tipo, copia, hashes y recursos propios. La cola entrega sólo
un trabajo por vez. Android recibe un PNG mediante intent con paquete fijo y
gesto directo. `prepareReceipt()` captura el HTML y CSS de impresión, incluidas fuentes, logo e iconos locales,
sin consultar el catálogo ni modificar documentos. Para el rollo de 80 mm, el PNG
de 576 puntos aprovecha el cabezal de 72 mm: excluye el padding horizontal
exterior salvo 1 px de resguardo por lado y escala la composición proporcionalmente.
La copia térmica usa bordes negros y binarización de luminancia a umbral 200
(sólo 0/255), evitando texto gris tramado por el controlador. Su compresión sin pérdida
usa las APIs del navegador y no agrega dependencias ni red. La preparación se
anticipa al clic; si aún no termina, se informa y se requiere otro clic, nunca
se abre RawBT desde una continuación asíncrona. La imagen se conserva sólo en
memoria por elemento y contenido; cambiar de documento invalida la anterior.
POS, reimpresión de ventas, ticket por método, abonos,
cambios y devoluciones comparten el transporte. Un documento vacío o excesivo
se rechaza completo con mensaje, igual que un recurso no disponible localmente.
Android ofrece sólo el botón principal hacia RawBT; la ayuda indica 576 puntos
para rollos de 80 mm. No expone `window.print()` como alternativa Bluetooth,
pues invocarlo no acredita un diálogo nativo ni salida física. Para errores
de recursos o longitud indica reimprimir desde computadora. La autoimpresión
no abre aplicaciones externas.

El transporte nativo conserva su iframe hasta `afterprint` y el retorno de
`print()`. RawBT conserva exclusión hasta ocultamiento seguido de regreso visible
o confirmación explícita del operador. El siguiente intent exige otro gesto;
foco por sí solo no libera la cola. Hay cancelación antes del envío y reintento
del mismo documento. Ningún temporizador constituye la garantía del ciclo.
Reportes A4, listados de Apartados y Préstamos comparten la cola conservando sus
plantillas. Etiquetas mantiene su generador y ventana independientes.

El historial de sesión en Configuración → Impresión distingue entrega, regreso
y error; nunca acredita salida en papel. No persiste contenido comercial ni
se mezcla con la persistencia comercial de Supabase. Recargar no repite impresiones.
La exclusión corresponde a la instancia de BALAM y sus ventanas hijas; no
coordina impresoras compartidas entre equipos. Véase H-153.

## AUTH

Archivo: `balam/auth.jsx`. API: `window.AUTH`.

- Obtiene por `CORE` el cliente compartido de Supabase y observa la sesión Auth.
- Supabase JS puede conservar y renovar tokens de sesión en el navegador.
- El perfil activo y los permisos se consultan en servidor; no se habilitan
  operaciones con perfiles o permisos guardados en caché ni con un modo demo.
- Expone identidad, acceso y `authchange`. Un fallo de verificación remota
  deniega acceso; `refreshPermissions()` vuelve a verificar al reconectar.
- Una secuencia compartida descarta respuestas de una identidad anterior,
  otro refresco o una sesión cerrada. La revocación remota sigue siendo efectiva.

La navegación consume `AUTH.canAccess()` y cada operación comercial vuelve a
ser autorizada en servidor. La administración de cuentas usa `admin-users`;
el navegador no invoca la API administrativa Auth con privilegios de servidor.

## STORE

Archivo: `balam/store.jsx`. API: `window.STORE`.

Es el coordinador de una única ruta de escritura online:

- Crea el cliente Supabase con el SDK local fijado, esquema `pos` y peticiones
  `cache: no-store`. Si el SDK o Supabase no están disponibles, falla cerrado.
- Traduce documentos y filas mediante `MAP`; no persiste esos datos localmente.
- `execute()` verifica disponibilidad, sesión y conectividad real; conserva una
  referencia técnica sin payload, envía el comando idempotente y espera recibo.
- `execute_online_command()` autoriza y despacha las transacciones comerciales.
  Las cuentas Auth usan el flujo servidor de `admin-users` por el mismo coordinador.
- Si se pierde la respuesta, consulta el resultado por request ID. Un ID ausente
  se cancela atómicamente para impedir que una petición atrasada confirme después.
- Tras la confirmación exige `online_snapshot()` y aplica toda la proyección
  antes de devolver éxito. El cambio de sesión invalida respuestas anteriores.
- Realtime, actualización manual, foco, visibilidad y reconexión provocan una
  consulta autoritativa; no aplican eventos comerciales directamente.
- Sube recursos a Storage y sólo guarda su referencia comercial por el gateway.

`syncStatus()` conserva el nombre por sus consumidores de interfaz: `ready`
significa lectura remota verificada, `busy` impide repetir una solicitud en
curso y `lastSuccess` identifica la última comprobación. `pending` y `blocked`
son cero; no representan colas ocultas. `legacyReviewCount` cuenta expedientes
históricos para revisión, fuera de la operación nueva.

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
- las capacidades determinan qué comandos comerciales puede solicitar cada rol;
- el vendedor puede leer los conjuntos permitidos y solicitar únicamente las
  acciones operativas autorizadas;
- el gateway online es la frontera de escritura del navegador. Las salidas de
  stock y las métricas financieras se modifican dentro de las transacciones SQL,
  nunca mediante snapshots directos enviados por una pantalla;
- la activación H-164 cerca las rutas de clientes anteriores en servidor; una
  cabecera o un lock del navegador no sustituyen esa defensa;
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
resuelve cada hoja mediante las funciones de Fase 2. No se conserva una caché
de autorización para operar sin servidor. Una respuesta desconocida, incompleta,
corrupta o de otra identidad se deniega. La reconexión verifica perfil y permisos
antes de habilitar nuevamente la operación comercial.

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

`supabase/functions/admin-users/index.ts` verifica JWT, capacidad
`sellers.manage` y conectividad real. Antes de modificar Auth prepara un recibo
servidor en `pos.online_account_requests` con actor, identidad estable, huella
y comando de perfil congelado; nunca persiste contraseña ni token en ese recibo.

La API administrativa Auth usa `service_role` sólo en servidor. La identidad
de solicitud en `app_metadata` permite comprobar un resultado Auth cuya
respuesta se perdió. El perfil comercial se confirma por el gateway con el
JWT original y una identidad derivada estable. Una baja retira primero el
perfil operativo y después la cuenta Auth. No hay éxito hasta confirmar ambos.

`action: resolve` consulta o completa pasos demostrados; no repite una contraseña
incierta ni adopta cuentas ajenas por coincidencia de correo. Un rechazo
definitivo devuelve un recibo terminal; una operación que necesita decisión
permanece como expediente individual. El navegador conserva sólo su referencia.

Una Edge Function desplegada puede diferir del archivo local. Toda corrección
debe registrar versión/despliegue y verificar el comportamiento remoto; las
pruebas históricas de otra versión no certifican este flujo.

## Sincronización

El nombre identifica la actualización visual entre equipos. H-164 retira el
Sync Engine comercial local-first: no hay `flushQueue`, replay, cursores
durables, escritor local ni rebootstrap comercial. Los contratos anteriores
de ADR-006/012/014 y las migraciones que los implementaron se conservan como
historia; ADR-015 gobierna la operación nueva.

En el arranque, `STORE.init()` verifica sesión y presencia, archiva evidencia
legacy con recibo verificable, refresca permisos, resuelve referencias técnicas
de resultado y consulta `online_snapshot()`. Sólo una lectura completa válida
habilita operaciones. El cambio de identidad vacía la proyección en memoria.

Una pérdida de Internet, Supabase o autorización detiene escrituras. El retorno
a la aplicación y la comprobación periódica vuelven a consultar la autoridad;
no intentan drenar nada. Realtime adelanta esa misma lectura. Perder un evento
no impide corregir una pantalla mediante una consulta posterior.

`execute_online_command()` conserva identidad y hash del comando en servidor,
autoriza dentro de la transacción y serializa los efectos. La resolución de
solicitud usa el mismo candado: recibir una ausencia definitiva cancela el ID
antes de habilitar otro intento. Los comandos financieros mantienen además sus
recibos históricos de dominio. La referencia local no contiene datos que puedan
reproducir el negocio y se retira sólo tras resultado terminal y lectura remota.

El Centro de equipos conserva su presentación y separa equipos activos de
historial de instalaciones retiradas. Muestra nombre, usuario, última conexión,
versión y estado activo/retirado. No administra pendientes comerciales, época,
protocolo ni rebootstrap. Un heartbeat `false` no es confirmación y un equipo
retirado no se reactiva al emitir presencia. La antigüedad de una instalación
o su ausencia de señal no demuestra una divergencia ni un cliente incompatible.

Los archivos locales legacy se leen únicamente para inventariar y trasladar
evidencia íntegra al servidor. El hash y el recibo se comprueban antes de retirar
cada origen exacto; no se limpia todo el navegador. Una operación confirmada se
reconoce sin ejecutarla; una no reconciliable queda para decisión individual.
Los datos de prueba sólo admiten descarte bajo autorización demostrada. Ningún
expediente de cuarentena vuelve a una cola comercial.

El estado de publicación y la certificación A/B/C contra Supabase real son
evidencias separadas. H-164 exige la certificación solicitada por el usuario:
un mock, un heartbeat o un conteo cero no prueban que tres equipos adoptaron el
artefacto ni que no divergen. Véanse `R-SYNC-16/17` y el documento de corrección.

### Punto Cero administrativo

`pos.system_manifest.system_mode` es la autoridad de modo y sólo admite
`preproduction` o `production`. PostgreSQL rechaza `execute_point_zero()` salvo
en preproducción. No existe RPC ordinaria para volver desde producción: hacerlo
es un procedimiento extraordinario fuera del flujo destructivo.

`point_zero_preview()` cuenta desde las tablas remotas y sella el contenido
y las condiciones servidor de la operación. El gateway online exige conexión,
permisos y ausencia de una escritura incompatible. Los conteos viejos de colas
o heartbeats no prueban riesgo comercial vigente; los expedientes reales sin
resolver sí requieren decisión. Las instalaciones retiradas mantienen el cerco.
Las lápidas históricas se preservan y no cuentan como operación activa.
El respaldo recalcula ese
token, persiste el payload eliminable separado de la auditoría y devuelve un
documento con SHA-256. La ejecución exige administrador activo,
`settings.manage`, respaldo, token vigente y la frase exacta `PUNTO CERO`; toma
candado, compone la purga H-68, elimina inventario y verifica cero operativo y
huella conservada. Un fallo revierte el bloque completo y `operation_id` hace
idempotente el reintento.

El payload incluye los alias de códigos y los mapas históricos V1/V2 ligados
a productos. Esos hijos se eliminan antes de sus padres dentro de la misma
transacción; la excepción interna de inmutabilidad se limita al borrado de
alias y se restaura inmediatamente. Contrato V3, respaldos y auditoría de la
migración de inventario permanecen conservados. Los equipos retirados siguen
retirados al avanzar la época.

El SQL conserva el avance histórico de `data_epoch` para cercar clientes
anteriores; las terminales online reconstruyen su pantalla consultando Supabase.
`point_zero_operations` conserva actor, equipo, versiones,
respaldo relacionado, conteos y resultado; el contenido eliminado vive en
`point_zero_backups`.

El diálogo de Punto Cero revisa su diagnóstico ante cambios relevantes de
sincronización, datos y conectividad, con reintento explícito y respuestas
secuenciadas. Sólo lo hace en la fase de diagnóstico. Respaldo y confirmaciones
conservan su snapshot; si el servidor lo rechaza por cambio de datos o seguridad,
se vuelve a revisar y se exige un respaldo nuevo y otra confirmación.

### Limpieza selectiva y riesgo real de flota

La tarjeta administrativa «Eliminar datos por categoría» revisa la selección
al cambiar las casillas o el estado de sincronización, flota, datos y conexión.
Ofrece reintento directo, muestra todos los bloqueos e invalida respuestas
obsoletas. Los eventos de su propia consulta se agrupan para evitar bucles;
el asistente conserva su snapshot y revalida al respaldar y ejecutar. El nombre
describe selección por categorías sin clasificar registros como prueba/real;
la disponibilidad continúa restringida al modo preproducción por el contrato SQL.

La seguridad de limpieza se decide sobre el alcance exacto del plan y la
evidencia servidor. Con el cerco online activo, `sync_activity`, los conteos
legacy y la falta de heartbeat no generan una autoridad comercial alternativa.
Los expedientes no reconciliados deben conservarse y evaluarse por su impacto;
una incidencia antigua sin payload ni ruta de ejecución es historia, no un
pendiente nuevo. Los controles financieros y el respaldo siguen siendo obligatorios.

Los grupos de limpieza representan documentos autoritativos, no todas las
proyecciones que los consumen. «Cambios» elimina documentos `exchanges`; una
venta visible como candidata en la pantalla Cambios sigue perteneciendo a
Ventas. «Liquidaciones y ajustes de comisión» elimina esos dos documentos; el
saldo «Comisiones por liquidar» es una proyección derivada de ventas, cambios,
ajustes y liquidaciones retenidos. El preview debe exponer los folios exactos y
explicar un conteo cero sin convertir la caché o la proyección en autoridad.

`test_data_cleanup_affects_financials(plan)` limita las guardas y la
recomputación financiera a ventas, devoluciones, cambios y comisiones.
Préstamos, reclasificaciones y clientes no cambian `comision_acum`; sólo una
selección de ventas recompone además `ventas_mes` y `ventas_num`. Una limpieza
de dominio ajeno no puede quedar bloqueada por evidencia de comisión que no
consume ni puede reescribir esas proyecciones.

Una fila de `return_commits` sin su `pos.returns` no es una devolución ni permite
reconstruir piezas, dinero o movimientos. H-123 la trata como el dominio técnico
opt-in `orphan_return_evidence`: el preview expone folio, fecha e identidades
exactas; el respaldo conserva la fila; y la ejecución toma el lock del commit,
revalida que continúe huérfano, exige cardinalidad exacta y coloca una lápida por
`return_id`. No modifica stock ni finanzas. Si se selecciona Devoluciones sin
seleccionar esta evidencia, la guarda permanece cerrada.

Supabase sigue siendo la autoridad vigente. El servidor conserva las lápidas,
identidades exactas y cercos de compatibilidad históricos de las limpiezas. El
cliente online no consume eventos de limpieza para rehacer una realidad local:
espera el recibo y reconstruye desde `online_snapshot()`. Una reconexión no vuelve
a ejecutar el borrado comercial. Retirar una instalación conserva actor, fecha
y nota; el heartbeat no puede deshacer esa decisión.

### Recuperación transaccional de terminal

`online_snapshot()` devuelve en una sola sentencia los conjuntos autorizados
de productos, configuración, clientes, vendedores, promociones, ventas y
renglones, devoluciones, cambios, préstamos, pagos, comisiones y movimientos.
STORE valida el contrato completo antes de sustituir DATA y CONFIG; el conjunto
vacío es válido, una respuesta incompleta o fallida no habilita operaciones.

`pos.movements` es un historial de sólo lectura para el cliente: venta,
devolución y reclasificación lo escriben dentro de sus transacciones SQL.
Los importes y pagos se reconstruyen desde documentos remotos, sin recalcular
el pasado con configuración actual ni inventar campos históricos ausentes.

### Paginación y volumen

La lectura H-164 obtiene un snapshot JSON consistente, sin componer páginas
parciales de distintos instantes. La interfaz puede paginar o filtrar ese
resultado efímero. Una consulta por folio es de lectura y no habilita podar otras
identidades. Los índices y adaptadores históricos siguen conservados.

El tamaño y la latencia del snapshot completo requieren medición con volumen
representativo; no se presume capacidad ilimitada. Una futura lectura paginada
debe probar cobertura, orden estable y consistencia antes de sustituir el
snapshot completo, sin volver a persistir datos comerciales en el navegador.

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

La política es primera escritura confirmada gana. H-164 valida la base en el
gateway servidor y rechaza el comando completo si es obsoleta. La interfaz
todavía no ha aplicado el borrador a DATA: consulta la fila vigente e informa
el conflicto. No compacta ni conserva operaciones para enviar después. El
formulario puede conservar el borrador sin efectos para que el usuario decida.

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

1. Cada solicitud de venta recibe un `operation_id` estable.
2. `STORE.execute()` solicita el commit online; la transacción de venta invoca
   internamente `pos.reserve_sale_stock()` cuando corresponde.
3. La función serializa el mismo `operation_id`, bloquea productos en orden
   estable, agrupa por producto/talla y valida todo antes de descontar.
4. `pos.stock_reservations` registra la operación confirmada; repetirla
   devuelve éxito idempotente sin descontar otra vez.
5. Un trigger impide insertar una venta cobrada nueva sin una reserva que
   coincida en `operation_id` y folio.
6. Si falta inventario, el servidor rechaza la operación completa. No se crea
   venta local, pendiente ni comprobante; la UI consulta el estado vigente.

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

1. El gateway asigna una identidad estable de solicitud al `commit_id`; la clave
   de la venta continúa como `operation_id` de la reserva.
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

Las ventas históricas siguen siendo legibles. Las operaciones locales de
versiones anteriores se inventarían y reconcilian como evidencia, sin
migrarlas a otra cola ni ejecutarlas automáticamente.

### Identidad idempotente del Cambio

Cada solicitud de Cambio recibe un `operationId` estable antes de enviarse.
`DATA.recordExchange()` conserva esa identidad en el documento
`cmb-{operationId}`; `STORE.execute()` la entrega a
`pos.commit_exchange_checked()` y `pos.exchange_commits` por el gateway online.

Repetir clave y payload devuelve el recibo sin volver a mover stock, crear
documentos, movimientos, pagos ni comisión. La misma clave con otro payload o
un documento incompatible se rechaza; no existe `blocked_conflict` local ni
bucle de reintento. Los renglones se identifican por `products.id`, nunca por SKU.

### Identidad y folio de venta

Cada venta nueva tiene dos identificadores con responsabilidades **separadas**;
ninguno se deriva del otro:

- `_operationId` / `sales.operation_id` es la identidad técnica inmutable: UUID
  usado por reserva de stock, commit idempotente y resolución de resultados. No
  se muestra al usuario.
- `folio` / `sales.folio` es la referencia comercial visible en ticket, tablas,
  búsquedas, devoluciones y reportes. Desde H-33 su formato es
  `{PREFIJO}-{AAMMDD}-{CONSECUTIVO}`, por ejemplo `BG-260727-0001`.

`DATA.nextFolio()` solicita su asignación a la autoridad SQL mediante STORE. El prefijo proviene
de `folio.prefix` y se normaliza a A-Z0-9, máximo seis caracteres; el día es el
del negocio y sale de la **misma** fecha que se guarda en la venta, no de una
segunda lectura del reloj; el consecutivo usa cuatro dígitos y crece a cinco
después de 10000 sin truncarse. Cambiar el prefijo no altera ninguna venta ya
registrada: el folio se copia dentro de la venta al crearla.

La unicidad entre terminales la aporta `pos.folio_counters`, un contador
atómico por (prefijo, día). `STORE.allocateFolio()` solicita una asignación
online idempotente para la operación; no reserva bloques consumibles offline
ni escribe `balam_pos_folio_v2`. El día nuevo inicia su propia secuencia. Una
asignación sin documento confirmado puede dejar un hueco; no se reutiliza para
otra operación ni acredita una venta.

### El folio impreso no cambia

No se emiten nuevos folios provisionales sin conexión. Sólo se imprime una
operación confirmada con su folio remoto. Una venta confirmada no se renombra.

Los folios anteriores y `folio_aliases` siguen válidos para búsqueda,
devolución, reportes y reimpresión. `DATA.findSaleByFolio()` prioriza coincidencia
exacta del folio vigente y sólo después busca alias del documento que realmente
lo imprimió. `fetchSaleByFolio()` conserva esa consulta contra Supabase.

Los alias históricos no autorizan reidentificar ni reproducir una operación
local pendiente. Sus expedientes se reconcilian por identidad y evidencia remota
antes de cualquier decisión, sin inferir deltas ni crear un documento nuevo.

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

1. La solicitud completa viaja por `STORE.execute()` a la transacción online
   que conserva la autoridad de `pos.commit_return()`.
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
`20260725002400_pos_legacy_return_adoption_verification.sql` documentan la
adopción histórica de devoluciones antiguas. H-164 no vuelve a invocar esa
adopción desde una cola: los originales existentes se archivan y comparan con
la evidencia autoritativa antes de resolver cada expediente. No se infieren
deltas históricos. Los registros sin `product_id` o `return_id` siguen legibles.

## Almacenamiento del navegador

`localStorage` e IndexedDB no son autoridades comerciales. No conservan como
estado operativo stock, productos, clientes, ventas, pagos, devoluciones,
cambios, préstamos, apartados, movimientos, catálogos ni configuración comercial.

Se permiten tokens Auth, identidad técnica de instalación, preferencias de
presentación y recursos técnicos. Un borrador sin confirmar no produce efectos.
DATA y CONFIG viven en memoria y se reconstruyen desde remoto al recargar; una
proyección sin verificación vigente no habilita escrituras ni se declara actual.

Las referencias `balam_online_request_v1:*` contienen request ID, usuario, tipo
y huella, sin payload comercial ni secretos. Sirven exclusivamente para consultar
un resultado incierto tras recargar. Antes del envío se comprueba su persistencia;
si no puede protegerse la referencia, no se envía la solicitud. Borrarlas sin
resolver su resultado destruye evidencia técnica y no es un mecanismo de reparación.

La PWA sólo cachea recursos estáticos y técnicos. Las solicitudes Supabase usan
`no-store`; una caché HTTP o el shell instalado no habilitan operación offline.

## Retiro de la cola offline

La cola comercial, su espejo IndexedDB, replay, compactación, locks de escritor,
cursores y recuperación local-first se eliminan del runtime H-164. No tienen
fallback ni consumidores operativos nuevos. La cola técnica de impresión es
efímera, transporta documentos ya confirmados y no reejecuta negocio.

`archiveLegacy()` inventaría claves comerciales conocidas y cada registro de
`balam_sync/durable_queue`. Conserva original y SHA-256 mediante
`archive_online_legacy()` antes de retirar únicamente el origen que aún coincide.
Un fallo de archivo o confirmación conserva ese origen. No se vacía el navegador
ni se descartan preferencias, credenciales o almacenamiento ajeno.

El servidor clasifica evidencia confirmada, caché histórica y expedientes que
requieren revisión. Una operación comercial real sin confirmación se conserva
íntegra para decisión individual; no se reproduce y no es un pendiente nuevo.
El conteo y resolución reales de las instalaciones A/B/C requieren comprobar
sus originales y sus recibos; el código de migración no acredita por sí solo
que las colas de equipos todavía ausentes estén resueltas.

## Limpieza y archivos de cuarentena

El protocolo 6 de limpieza distinguió históricamente cola ejecutable de
expedientes archivados y conservó `quarantine_discard`, recibos y lápidas.
H-164 mantiene esa evidencia y los controles de respaldo de los documentos,
pero retira la restauración/reproducción comercial del cliente. Una autorización
antigua de reintento no habilita una ruta local-first tras activar el cerco.

Toda decisión sobre evidencia real no reconciliada exige alcance e identidades
demostrables. El archivo servidor preserva los originales; no se declara cero
pérdidas por haber eliminado una clave local ni se borra cuarentena de forma
indiscriminada. Rechazo, descarte autorizado y confirmación son estados distintos.

El plan también congela `payment_ids` y la huella de sus filas completas: los
pagos de ventas seleccionadas y los de tipo cambio con folio propio de un cambio
seleccionado. Respaldo, ejecución y proyección local consumen esos mismos IDs;
los eventos históricos sin esa lista conservan la selección por folio de venta.
Cambiar el importe de un pago invalida el plan y su respaldo previo.

Reportes se suscribe a `datachange` de DATA para actualizar cobros y comisiones
cuando llega un snapshot confirmado, conservando pestañas y filtros abiertos.
`sale_payments` sigue siendo la autoridad monetaria; no se ocultan pagos por
ausencia de ventas ni vendedores por el texto de su nombre.

## Contratos que no deben romperse

- Sin conexión real con Supabase no se crea ni confirma una operación comercial.
- Una solicitud sólo muestra éxito después del commit y la consulta autoritativa.
- No se crean colas comerciales ni se persisten colecciones como segunda autoridad.
- Los borradores permanecen separados; un refresco no los confirma ni los descarta.
- Reintentar no debe duplicar ventas, pagos, devoluciones ni movimientos.
- La lectura remota de Movimientos conserva `movements.operation_id` como `operationId` y
  enriquece `reversalOf` desde `reference_reclassifications.reversal_of`:
  Reclasificación usa esa identidad compuesta para reconocer reintentos y
  autorizar únicamente la reversa exacta.
- Datos históricos sin campos nuevos deben seguir siendo legibles.
- Una terminal con una versión antigua no puede sobrescribir ni revivir una
  entidad más reciente; el conflicto debe quedar registrado.
- `sales.total` es el total final con IVA; el desglose fiscal y los pagos son
  snapshots históricos, no cálculos con configuración vigente.
