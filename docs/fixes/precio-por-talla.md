# Precio general del artículo con excepciones por talla

**Riesgo:** H-36
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El negocio necesita que, dentro del mismo SKU, ciertas tallas tengan un precio
comercial distinto —M y L a $350, XL a $450—. No es una promoción temporal: es
el precio normal de esa talla. `pos.products.precio` era un único valor por
artículo y no existía ningún campo ni pantalla capaz de expresarlo.

`node test-variant-price.mjs` sobre el código anterior: **8 pasaron, 30
fallaron**. Los 8 que pasaban describen el comportamiento actual que **no debía
cambiar**: la evidencia de promoción por renglón de H-32, el piso de margen y la
venta histórica.

Dos de los fallos no eran «falta implementar» sino un defecto financiero real
que el cambio habría introducido:

- con M a $350 y XL a $450 y una promoción del 10 %, la venta registraba
  `descuento = 70` cuando debe ser `80`;
- `precioOrig` congelaba `350` en el renglón de XL, es decir evidencia histórica
  falsa.

## Causa raíz

Contrato ausente, no defecto. La pregunta «¿cuánto cuesta esta talla antes de
promociones?» estaba respondida **seis veces** leyendo `producto.precio`
directamente: `PROMOS.lineUnit`, `DATA.resolveLineDiscount`, `subtotalOrig` y
`precioOrig` dentro de `recordSale`, el impresor de etiquetas de Inventario —que
ya itera por talla— y los respaldos de `pos-ticket.jsx`.

Mientras todas las tallas valieran lo mismo, las seis coincidían y la
duplicación era invisible. En cuanto dejaran de coincidir, `recordSale`
calcularía el descuento restando dos precios que ya no hablan de lo mismo:
`subtotalOrig` con el precio del artículo y `totalConDescuento` con la
resolución del renglón. `assertSaleAmounts` no lo detecta porque valida
`subtotal + iva = total` y nunca el descuento.

Es el mismo patrón de H-35 (`AP-01`), detectado antes de que la función
existiera.

## Diseño

En BALAM el SKU identifica el **modelo** y reserva un marcador `T` en el
segmento de talla; el identificador por pieza se deriva con
`BARCODES.codeOf(p, talla)` y no se persiste. La variante que ya usan
existencias, etiquetas, `sale_items`, la reserva de stock y `sale_line_balance`
es `(producto, talla)`. Por tanto «precio por SKU» y «precio por talla» son el
mismo eje, y el modelo correcto es **precio general del artículo con excepciones
por talla**, no una entidad genérica de variante comercial.

### Autoridades

| Pregunta de negocio | Autoridad |
|---|---|
| ¿Cuánto cuesta esta talla antes de promociones? | `DATA.listPrice(producto, talla)` |
| ¿Qué precio muestra este artículo en el catálogo? | `DATA.priceRange(producto)` — **derivada**: recorre las tallas con existencias llamando a `listPrice` |

`priceRange` mira sólo las tallas con existencias porque son las que el POS deja
vender: anunciar un rango que incluye una talla agotada le diría al cliente un
precio que no puede pagar. Sin existencias cae al precio general.

### El dato

`pos.products.precios_talla jsonb not null default '{}'`, con forma
`{ "<talla>": <precio> }`, replicando el patrón que la propia tabla ya usa en
`barcode_urls`. Semántica, siguiendo el precedente de H-31:

- **ausencia de la clave** = esa talla vale el precio general;
- **clave presente** = precio explícito de esa talla. Un `0` es un precio;
- `{}` = artículo sin excepciones. Es el estado de todos los artículos previos.

Una excepción es un precio, no un recargo: cambiar el precio general **no** la
mueve. `hydrate()` canoniza el mapa al guardar —poda tallas fuera del catálogo
vigente y valores inutilizables—; la lectura permanece tolerante.

### El flujo de captura

El formulario de producto conserva su campo `Precio` sin cambios y **no muestra
nada más por omisión**: la mayoría de los artículos no tiene excepciones y no
debe pedírsele ninguna. Un control «Precios especiales por talla» agrega filas
**«grupo de tallas → precio»**, reutilizando el idioma que el producto ya usa
para expresar un alcance por tallas: los chips multi-selección del Alcance de
Descuentos, acotados a las tallas de la grilla de Existencias, con `tallaLabel` y
respetando una escala desactivada.

El dato guardado es el mapa canónico; **la agrupación vive sólo en la
presentación** y se reconstruye al abrir juntando las tallas que comparten
precio. Se prefirió a guardar `[{tallas, precio}]`, que admite una talla en dos
filas con precios distintos y obligaría a una regla de desempate dentro de la
autoridad —la ambigüedad que `ADR-003` existe para evitar—. Como contrapartida,
dos filas con el mismo precio se muestran fusionadas al reabrir, y el formulario
rechaza guardar una talla presente en dos filas.

### Lo que no se tocó

`pos.commit_sale` **no se modificó**: `pos.sale_items` ya transporta `precio`,
`precio_base` y `precio_original` de forma condicional y la función los trata
como valores opacos, así que la venta congela el precio de su talla sin que el
servidor conozca este modelo. Se evitó por completo el riesgo de `AP-05`.

`PROMOS.applyStack` tampoco se modificó: la acumulación, el piso de margen y las
reglas comerciales quedan exactamente igual.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/data.jsx` | `listPrice()`, `priceRange()` y `sanitizePreciosTalla()`; `resolveLineDiscount` consume la autoridad; `subtotalOrig` y `precioOrig` salen de la resolución; `hydrate()` canoniza el mapa. |
| `balam/discounts.jsx` | `lineUnit(p, talla, origIn)` recibe el precio de lista; precedencia `origIn` → autoridad → `p.precio`. |
| `balam/pos.jsx` | Rango en tarjeta, fila y detalle; precio real de cada talla en el selector. |
| `balam/pos-ticket.jsx` | Se retiran los respaldos a `l.p.precio`; el tachado usa el precio de lista de la talla. |
| `balam/inventory.jsx` | Captura por grupo de tallas; rango en tabla, ficha y exportación visual; valor de inventario y etiquetas por talla. |
| `balam/store.jsx` | `precios_talla` ↔ `preciosTalla`, envío condicional. |
| `supabase/migrations/20260728005100_pos_h36_variant_price.sql` | Columna y restricción de forma y valores. |
| `supabase/migrations/20260728005200_pos_h36_variant_price_verification.sql` | Verificación autocontenida. |
| `test-variant-price.mjs` | Arnés nuevo, 38 casos. |

Decisiones registradas:

- **`lineUnit` conserva `p.precio` como último recurso.** El único consumidor de
  producción es `resolveLineDiscount`, que siempre pasa la resolución; ese
  respaldo sólo lo alcanzan llamadores directos con un `DATA` parcial, es decir
  `test-discounts.mjs`, que **no se modificó** por ser la evidencia de que el
  motor quedó intacto. No es una segunda fórmula: es la definición de
  `listPrice` sin excepciones.
- **El valor del inventario pasó a sumar por talla.** Antes era
  `totalStock(p) * p.precio`; con precios por talla esa cuenta sería falsa.
- **`previewDraft` sigue usando el precio general.** Es la vista previa
  administrativa del catálogo, sin talla concreta; darle una talla arbitraria
  habría inventado un ejemplo.

## Pruebas

Reproducción previa: `node test-variant-price.mjs` → **8 pasaron, 30 fallaron**.
Después: **38 pasaron, 0 fallaron**, cubriendo la autoridad y sus casos límite,
el rango con y sin existencias, la resolución del renglón, promoción porcentual
y de monto fijo sobre la talla cara, el piso de margen, el descuento y el
`precioOrig` de una venta con tallas de distinto precio, la excepción más barata
que no inventa descuento, compatibilidad histórica, saneo del mapa y los
contratos de código, transporte y esquema.

Durante la línea base se corrigió un **falso positivo del propio arnés**: el
contrato de `recordSale` se comprobaba dentro de una ventana de 4 500 caracteres
que no alcanzaba las líneas culpables. Es `AP-09` en pequeño —verificar el
síntoma y no la defensa—; se sustituyó por patrones exactos sobre todo el
archivo y el conteo honesto pasó de 9/29 a 8/30.

Regresión ejecutada:

| Arnés | Resultado |
|---|---|
| `test-discounts.mjs` | 43/43 **sin modificar** |
| `test-discount-trace.mjs` | 65/65 |
| `test-sale-coherence.mjs` | 17/17 |
| `test-returns.mjs` | 17/17 |
| `test-line-balance.mjs` | 38/38 |
| `test-return-deadline.mjs` | 38/38 |
| `test-store-queue.mjs` | 115/115 |
| `test-migrations.mjs` | 29/29 |
| `test-module-contracts.mjs` | 36/36 |
| `test-folio-diario.mjs` | 60/60 |
| `test-folio-concurrency.mjs` | 12/12 |
| `test-commission.mjs` | 10/10 |
| `test-effective-commission.mjs` | 22/22 |
| `test-liquidations.mjs` | 10/10 |
| `test-eligible-sellers.mjs` | 10/10 |
| `test-seller-avatars.mjs` | 13/13 |
| `test-concurrency.mjs` | 9/9 |
| `test-role-access.mjs` | 10/10 |
| `test-build-reproducibility.mjs` | 8/8 |
| `test-supabase-sdk.mjs` | 4/4 |
| `test-browser-harness-entry.mjs` | 8/8 |
| `test-image-processing.mjs` | 5/5 |
| `test-xlsx-security.mjs` | 17/17 |
| `test-export-modelo.mjs` | 14/14 |
| `test-smoke.mjs bundle` | 17/17 |
| `test-ui-navigation.mjs` | 13/13 |
| `test-filtros-inventario.mjs` | 18/18 |
| `test-reset-propaga.mjs` | 21/21 |
| `test-reset-pruebas.mjs` | 19/19 |
| `test-auto-fotos.mjs` | 11/11 |
| `test-import-fotos.mjs` | 23/23 |

`node build-offline.mjs` regeneró los artefactos correctamente (67 assets).

**`test-discount-trace.mjs` requirió un ajuste de método**, no de expectativas:
extrae el *cuerpo* de `resolveLineDiscount` por expresión regular y lo evalúa
aislado, así que al ganar esa función una dependencia hermana dejó de resolver
`listPrice`. Se le inyecta ahora la autoridad extraída del mismo archivo real,
con la misma técnica. Ninguna de sus 65 aserciones cambió.

## Despliegue

**Ninguno.** Las dos migraciones están **escritas y verificadas por lectura,
pero no aplicadas**: no se ejecutó `db push` ni ninguna operación contra
Supabase. La puerta de publicación permanece cerrada a la espera de
autorización expresa.

## Riesgo residual y pendientes

- **No existe un módulo de costos.** `pos.products.costo` es una sola columna
  cuyo único consumidor es el piso de margen de `applyStack`, y `data.jsx` la
  rellena como el 45 % del precio cuando no se captura. Con el costo a nivel de
  artículo, el piso subprotege a la talla cara: con precio general $350, costo
  automático $158 y margen 45 %, el piso queda en $287.27 y se aplica también a
  una talla de $450 cuyo costo real fuera mayor. Acotado y declarado; un módulo
  de costos real es una historia propia.
- Las etiquetas ya impresas con el precio del artículo quedan incorrectas para
  las tallas que reciban una excepción y deben reimprimirse. Es operativo.
- `stockOf(p, talla)` busca sólo por `talla` ignorando `escala`, y un artículo
  puede manejar ambas escalas. El precio usa la misma clave para no introducir
  una tercera convención; la ambigüedad es preexistente.
- La importación y exportación de Excel siguen tratando `Precio` como el precio
  general y conservan las excepciones sin tocarlas, igual que ya hacen con el
  costo y los códigos de barras. Llevar los precios por talla a la hoja exigiría
  un segundo bloque de ~20 columnas y quedó fuera de alcance.
- Guardar el mapa canónico pierde la agrupación literal capturada: dos filas con
  el mismo precio aparecen fusionadas al reabrir el formulario.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-36.
- Contratos relacionados: H-03 (snapshot financiero), H-11 (piso de margen),
  H-31 (excepción nullable sobre un valor general), H-32 (evidencia del
  descuento por renglón), H-33 (identidad técnica vs. referencia comercial).
- Sistema arquitectónico: `docs/architect/decisions/ADR-003` (autoridad única),
  `ADR-002` (congelar en el documento), `playbooks/domain.md` § `AP-01`,
  `playbooks/client.md` § `R-CLI-08` y `AP-10`.
