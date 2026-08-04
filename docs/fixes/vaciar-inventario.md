# Vaciar el inventario para reemplazarlo entero

**Riesgo:** H-76
**Estado:** RESUELTO — publicado; ejecución en producción pendiente del dueño
**Fecha:** 04/08/2026
**Commit:** `8815aea`
**Artefacto publicado:** sha256
`3de3c685a6bc081b9b3090831c7329f4ecc8af5e716f9a201949766613198cdb`
(8 848 852 bytes), idéntico byte a byte al `index.html` del commit y verificado
por ejecución sobre `https://david14081982.github.io/POS_Balam/`
(`verify-h76-publicado.mjs` 13/13: la autoridad viaja en el artefacto, el
apartado vivo bloquea sin borrar nada, el vaciado deja la configuración
intacta, y la tarjeta real nace con el borrado bloqueado hasta el respaldo).

## Problema y reproducción

El dueño del producto necesita **reemplazar el catálogo completo**: borrar los 239
productos actuales y subir un inventario nuevo. El producto no tenía ninguna forma
de hacerlo.

Precondiciones: inventario con productos, sesión de administrador. Pasos y
resultado actual, los tres caminos que existían:

1. **Importar el Excel nuevo.** `confirmImport` (`balam/inventory.jsx` § 128-157)
   ACTUALIZA por SKU y agrega los que no existen: **nunca borra**. El catálogo
   viejo queda mezclado con el nuevo.
2. **«Borrar datos de prueba»** (`DemoPanel`, H-68). Su propio botón dice
   «conserva inventario»: `resetTestData` vacía lo operativo y **devuelve** al
   inventario las piezas que esas ventas movieron. Los productos no se tocan por
   diseño.
3. **Borrar producto por producto** desde Inventario → detalle → Eliminar. Con 239
   productos no es una operación: son 239 operaciones sin cuenta previa, sin
   respaldo, sin guardas y sin ninguna garantía de que terminen todas.

Resultado esperado: una sola acción, con la cuenta a la vista, que deje el
inventario en cero sin tocar nada más y que se niegue a empezar si no puede
terminar.

Reproducción: `node test-h76-vaciar-inventario.mjs` → **3 pasaron, 34 fallaron**
(3/37) antes del cambio.

## Causa raíz

Un **contrato ausente** (`FF-01`), no un defecto: nadie respondía la pregunta
«¿qué contiene el inventario y qué impide vaciarlo?». Las tres rutas anteriores
responden preguntas distintas —actualizar por SKU, limpiar lo operativo, dar de
baja *un* producto— y ninguna es la que el negocio necesita al reemplazar el
catálogo.

El eslabón que lo hacía invisible: `removeProduct` sí existe y hace lo correcto
—baja local, `delete_product_checked` remoto y cola durable—, así que parecía que
la capacidad ya estaba. Lo que faltaba no era el borrado, sino **la decisión de
conjunto**: guardas, cuenta e invariante.

## Diseño

**Autoridad nueva:** «¿Qué contiene el inventario y qué impide vaciarlo?» →
`DATA.inventoryFootprint()`. Devuelve productos, piezas, renglones, documentos
vivos, apartados, operaciones en cola, la huella de lo que NO debe cambiar y el
motivo de bloqueo si lo hay.

**`DATA.clearInventory()` no reimplementa el borrado.** Cada producto sale por
`removeProduct`, que ya es la autoridad de «cómo se borra un producto»
(`ADR-011`, `R-CLI-03`): la baja viaja por la cola como cualquier otra operación,
es idempotente y sobrevive a un reintento. `clearInventory` sólo aporta lo que
faltaba. Sin esto habría **dos** respuestas a la misma pregunta (`AP-01`).

**Todo o nada en la decisión.** Las guardas se resuelven ANTES de tocar el primer
producto: medio inventario borrado es peor que ninguno.

**Guardas que bloquean, en este orden:**

- `LAYAWAY_LOCK` — hay una liquidación de apartado sin reconciliar. Además de la
  incertidumbre sobre la pieza, `protectLayawayLockedProducts()` restauraría el
  producto borrado desde su snapshot: sin esta guarda el vaciado sería mentira.
- `LAYAWAY_ACTIVE` — hay apartados vivos; esas piezas están comprometidas con un
  cliente y su producto debe existir hasta liquidar o cancelar.
- `QUEUE_PENDING` — hay operaciones sin subir. Una carga de productos pendiente
  volvería a crear lo borrado. Mismo criterio que `migrateSizeCodes` (H-74).
- `EMPTY` — no hay nada que borrar.
- `NO_SESSION` — guarda de la interfaz, no de la autoridad: sin sesión sólo se
  borraría esta computadora y el siguiente arranque volvería a bajar el catálogo
  de la nube.

**Los documentos vivos NO bloquean.** Se informan con su cuenta. Una venta congela
SKU, nombre, talla y precio (`ADR-002`), así que el ticket sigue siendo explicable
sin el producto; lo único que pierde es la foto y el enlace, que ya se resuelven
con un marcador explícito. Bloquear aquí impediría el caso legítimo de reemplazar
el catálogo conservando el historial.

**El respaldo es una invariante, no un consejo.** El botón de borrar permanece
deshabilitado hasta haber exportado el Excel desde la propia tarjeta. Es la única
defensa real de una acción irreversible.

**Invariante de cierre:** después del vaciado quedan cero productos y el número de
borrados es igual al que había. Si no cuadra se responde `INCOMPLETE` con los que
sobrevivieron, nunca con un «listo».

**`configFingerprint({ omitProductos: true })`** — la misma huella de H-68 sin la
parte que esta operación sí puede tocar. No es una segunda fórmula: es la misma
pregunta —«¿cambió algo que no debía cambiar?»— aplicada a una operación cuyo
objeto son precisamente los productos.

**No alcance:** migrar o borrar documentos, tocar catálogos, tallas, precios,
descuentos, promociones, vendedores, usuarios o permisos; limpiar las fotos y los
códigos de barras ya subidos a Storage; y propagar el vaciado por época a las
terminales apagadas (lo hace la cola producto a producto, no una transacción
remota como en H-68).

## Solución

- `balam/data.jsx`: `inventoryFootprint()`, `clearInventory()`, sus mensajes de
  bloqueo y `configFingerprint({ omitProductos })`; ambas exportadas en `DATA`.
- `balam/settings.jsx`: tarjeta **«Vaciar inventario»** en Configuración →
  Inventario, con la cuenta viva, el botón de respaldo que habilita el de borrado,
  el motivo del bloqueo cuando lo hay, la confirmación con cifras y el informe
  final. Emite `configchange` al terminar para que las pantallas montadas relean
  el inventario.
- `test-h76-vaciar-inventario.mjs`: arnés nuevo sobre el artefacto real.
- Artefactos regenerados con `node build-offline.mjs`.

## Pruebas

    node test-h76-vaciar-inventario.mjs   38/38   (previo 3 pasaron, 34 fallaron)

Cubre: la cuenta de productos, piezas y renglones; el vaciado completo con su
informe; que cada baja se publica por el gateway (`deleteRow` una vez por
producto); que catálogos, vendedores y la huella de configuración quedan
idénticos; los tres bloqueos **en los dos sentidos** (`R-DEL-11`) —apartado vivo,
liquidación pendiente y cola con operaciones, y la misma semilla vaciándose al
retirar la condición—; el inventario ya vacío; y el **recorrido real** por
Configuración → Inventario: botón bloqueado sin respaldo, bloqueado con respaldo
pero sin sesión, liberado con ambos, y la pantalla Inventario en cero después.

Regresión ejecutada, toda en verde:

    test-h68-purga-datos-prueba 53/53 · test-reset-pruebas 19/19
    test-module-contracts 41/41 · test-store-queue 159/159
    test-h74-codigos-de-talla 25/25 · test-h63-size-protection 34/34
    test-filtros-inventario 18/18 · test-product-sizes 9/9
    test-permission-admin-ui 21/21 · test-operational-capabilities 40/40
    test-export-modelo 14/14 · test-smoke 15/15 · test-ui-navigation 15/15
    test-build-reproducibility 8/8 · test-h68-boton-publicado 17/17
    test-ux-metrics sin retroceso (11 interacciones, 2 validaciones)

## Riesgo residual y pendientes

- **No hay deshacer.** El respaldo en Excel es la única vuelta atrás, y no
  restituye los identificadores internos: reimportarlo crea productos nuevos, con
  códigos de barras que hay que reimprimir.
- **Las fotos y los códigos de barras en Storage quedan huérfanos.** No hay
  pérdida de datos y no se cobran por separado, pero nadie los recoge.
- **El vaciado viaja producto a producto por la cola**, no como una transacción
  remota con época propia (H-68). Con la cola vacía como precondición y el soft
  delete versionado de `delete_product_checked` es suficiente, pero una terminal
  apagada no se entera hasta su siguiente pull.
- **Los documentos que citan productos borrados** conservan su evidencia congelada
  y muestran un marcador en lugar de la foto. Es el comportamiento acordado, no un
  defecto.
- **Las promociones con alcance por producto** no se revisan: si una apuntaba a un
  producto borrado, su alcance queda sin efecto hasta que se edite.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-76
- Autoridades: `docs/architect/authorities/inventory.md`
- Antecedentes: `docs/fixes/borrado-de-datos-de-prueba.md` (H-68) ·
  `docs/fixes/codigos-de-talla-reales.md` (H-74)
- Decisiones: `ADR-002`, `ADR-006`, `ADR-011` · Reglas: `R-CLI-03`, `R-CLI-05`,
  `R-CLI-08`, `R-DEL-10`, `R-DEL-11`, `R-DEL-12`
