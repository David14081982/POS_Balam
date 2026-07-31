# El filtro de tallas del POS es una estructura por categoría

**Riesgo:** H-61
**Estado:** RESUELTO
**Fecha:** 31/07/2026
**Commit:** `59c5c52`

## Problema y reproducción

H-59 hizo que el filtro global de tallas del Punto de venta obtuviera su
universo de Configuración → Catálogos de producto en vez de recorrer productos y
existencias. Corrigió el **contenido**, pero no la **forma**: el `<select>`
seguía dibujando una sola lista plana en la que las dos categorías corrían
seguidas sin ninguna frontera visible.

Para el operador eso es indistinguible de la mezcla que H-59 decía haber
eliminado: no hay encabezado que diga dónde terminan las tallas de letra y dónde
empiezan las de número, y como ambas categorías pueden contener el mismo código
—`PZ`, `CH`, `GR`— el menú muestra dos opciones con la misma etiqueta y ninguna
manera de saber a qué categoría pertenece cada una.

`node test-pos-size-filter-groups.mjs` antes del cambio: **4 pasaron, 15
fallaron**. El arnés capturó el menú realmente renderizado:

    Todas las tallas, XS, S, L, 2XL, PIEZA, CHICO, GRANDE, 36, 4, 12, 0, PIEZA

Cero `<optgroup>`, doce opciones al mismo nivel que «Todas las tallas» y dos
«PIEZA» indistinguibles.

## Causa raíz

La autoridad respondía la pregunta con el tipo equivocado. `resolveSizeFilterOptions()`
devolvía un arreglo plano de tallas y perdía en ese aplanamiento la única
información que el menú necesitaba para agrupar: a qué categoría pertenece cada
tramo y en qué orden van las categorías.

`balam/pos.jsx` no podía reconstruirla, porque un `[{…}, {…}]` ya no dice dónde
está el corte. La categoría seguía viva dentro de cada elemento —`filterKey`
conserva la pareja categoría+talla desde H-59, y por eso el filtrado nunca
estuvo mal— pero la **estructura** se había tirado una capa antes de llegar a la
interfaz.

Es el mismo error que `FF-02` describe: se modeló la implementación disponible
—una lista de opciones de `<select>`— en lugar del concepto del negocio, que es
un catálogo de tallas organizado por categorías.

## Diseño

La pregunta de negocio no cambia —«¿qué opciones muestra el filtro global de
tallas y en qué orden?»— así que **no nace una autoridad nueva**: se corrige el
tipo de la respuesta y se edita la entrada existente del registro (`README.md` §
Registro de autoridades).

- `DATA.resolveSizeFilterGroups()` pasa a ser la autoridad. Devuelve una
  estructura `[{ categoryId, categoryLabel, sizes }]`, no una lista.
- Las categorías, su orden, las tallas de cada una y el orden de cada talla se
  leen íntegramente de `CONFIG`: `sizeCategories()` da las categorías en el
  mismo orden en que Configuración → Catálogos de producto las presenta, y cada
  talla ocupa su posición dentro del arreglo del catálogo. No hay ningún orden
  escrito en el código.
- `DATA.resolveSizeFilterOptions()` **se conserva y se deriva** de los grupos por
  concatenación. Sigue existiendo para quien sólo necesita el conjunto de tallas
  ofrecidas —`balam/discounts.jsx`— sin que aparezca una segunda fórmula que
  algún día discrepe (`AP-01`).
- La identidad de la selección es `{ sizeCategoryId, sizeId }`. Ya estaba
  serializada en `filterKey` desde H-59; ahora el campo por talla se llama
  `sizeCategoryId` en vez de `categoryId`, de modo que hay **un solo nombre**
  para el concepto y coincide con la clave persistida `attrs.__sizeCategoryId`.
  El `categoryId` del resultado de `resolveProductSizes()` no cambia: ése
  responde otra pregunta —la categoría del producto—.
- Una categoría sin tallas activas no produce grupo. Anunciar un encabezado
  vacío no informa de nada, y la regla «las tallas activas deben aparecer» se
  cumple trivialmente cuando no hay ninguna.
- El `<select>` nativo se conserva. `<optgroup>` da grupos reales y accesibles
  —el navegador expone el encabezado a los lectores de pantalla y no lo deja
  seleccionar—, así que «Todas las tallas» sigue siendo la única opción global y
  la primera. Reemplazarlo por un listbox propio habría costado teclado, foco y
  accesibilidad sin ganar nada.

## Solución

- `balam/data.jsx`: incorpora `resolveSizeFilterGroups()` como autoridad,
  reescribe `resolveSizeFilterOptions()` como su derivación plana y renombra el
  campo de identidad por talla a `sizeCategoryId`.
- `balam/pos.jsx`: el filtro consume los grupos y emite un `<optgroup>` por
  categoría con su etiqueta; el restablecimiento de una talla que dejó de existir
  recorre los grupos. `FilterSelect` propaga la cascada de color del menú
  **dentro** de los `<optgroup>`, no sólo al primer nivel: es la `<option>` la
  que Chromium pinta, así que sin eso H-58 habría regresado en cuanto se
  agruparan las opciones.
- `test-pos-size-filter-groups.mjs`: arnés permanente. Deriva la expectativa de
  `CONFIG` en tiempo de ejecución —nunca de un orden escrito en el archivo—, de
  modo que también falla si alguien reintroduce un orden fijo en el código.
- `test-size-categories-audit.mjs`: sigue la autoridad y el campo renombrados.
- `index.html` y `POS Balam (offline).html`: regenerados desde `balam/`.

## Comprobación con los catálogos reales de la tienda

Con los catálogos del snapshot de sólo lectura de producción del 31/07/2026
—71 tallas de número, 14 de letra— el menú queda así
(`.evidence-h61/filtro-catalogos-reales.json`):

    Todas las tallas
    Talla (Letra)  (14) XS, S, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL,
                        PIEZA, CHICO, MEDIANO, GRANDE, EXTRA GRANDE
    Talla (Número) (62) 1, 2, 3, … 52, 0,
                        PIEZA, CHICO, MEDIANO, GRANDE, EXTRA GRANDE,
                        2XG, 3XG, 4XG, 5XG

Las nueve tallas inactivas del catálogo de número (`s`, `A`–`H`) no aparecen:
71 configuradas, 62 ofrecidas. Las tallas de pieza que conviven en las dos
categorías salen una vez en cada grupo, cada una con su propia identidad.

`.evidence-h61/pos-filtro-cerrado.png` acompaña como comprobante de que la
pantalla carga con esos catálogos reales; muestra el control cerrado, porque el
menú desplegado de un `<select>` nativo lo dibuja el sistema operativo y no
entra en una captura del navegador. La estructura de grupos se comprueba en el
JSON y en el arnés, que leen el DOM.

## Pruebas

- H-61: `node test-pos-size-filter-groups.mjs` — **19/19** (antes: 4/15).
- H-59: `node test-size-categories-audit.mjs` — **23/23**.
- Persistencia H-59: `node test-h59-size-persistence.mjs` — **12/12**.
- Autoridad: `node test-product-sizes.mjs` — **9/9**.
- Menú POS (H-58): `node test-pos-size-filter-menu.mjs` — **6/6**.
- Inventario: `node test-filtros-inventario.mjs` — **18/18**.
- Precio: `node test-variant-price.mjs` — **38/38**;
  `node test-precio-talla-e2e.mjs` — **19/19**.
- Consumidores: descuentos **43/43**, trazabilidad **65/65**, cambios E2E
  **37/37**, devoluciones **17/17**, préstamos **117/117**, ticket **23/23**.
- Excel: exportación **14/14**, importación con fotos **23/23**, seguridad
  **17/17**.
- Infraestructura: contratos **40/40**, smoke **17/17**, navegación **15/15**,
  roles **15/15**, permisos **18/18**, registro de pantallas **12/12**, cola
  **121/121**, arranque **5/5**, reproducibilidad **8/8**, migraciones
  **31/31**.
- Guardián de UX (`R-DEL-14`): `node test-ux-metrics.mjs` — validaciones 2/2,
  interacciones 11/11, recorrido completo. Sale con código 0. La línea base **no
  se refija**: esta historia no promete reducir pasos y no los redujo
  (`R-DEL-16` no aplica).
- `node build-offline.mjs`: correcto, **71 assets**, sin Babel en runtime.

Dos observaciones honestas sobre la regresión:

- `test-loans-screen.mjs` dio **115/117** en una corrida y **117/117** en las dos
  siguientes; `HEAD` da 117/117. Los dos casos que fallaron son los del lector
  de código de barras, que dependen de la cadencia entre pulsaciones: es
  inestabilidad del arnés, no del cambio.
- `test-additional-discount.mjs` da **26 pasaron, 1 falló** («Configuración
  ofrece la pantalla de beneficios»). Se comprobó en un worktree sobre `HEAD`:
  falla igual **antes** de este cambio. Es un fallo preexistente, ajeno a esta
  historia, y no se tocó.

## Despliegue

Publicado en `https://david14081982.github.io/POS_Balam/`. El archivo servido
coincide byte a byte con el `index.html` del commit `59c5c52`: SHA-256
`70C9D23C0CC75DB02FE5631CCD9AF31CFB39813994F4CBAFE5392B29D45A2B6B`,
8 760 388 bytes. Sin migraciones que aplicar antes del cliente.

El hash prueba los bytes, no la conducta, así que el paquete publicado se cargó
y se le preguntó por su comportamiento
(`.evidence-h61/verify-deploy.mjs` → `deploy-verification.json`):
`window.DATA.resolveSizeFilterGroups` es una función y, con los catálogos reales
de la tienda, responde con dos grupos —`Talla (Letra)` con 14 tallas y
`Talla (Número)` con 62—, cada uno en el orden de Configuración, y la lista
plana resulta ser exactamente la concatenación de esos grupos. Cero errores de
página. El render del `<select>` no pudo comprobarse contra Pages porque la
pantalla exige inicio de sesión; se comprobó contra el mismo artefacto servido
localmente, cuyos bytes son los mismos.

**Nota de convención (`R-DEL-08`):** el asunto del commit `59c5c52` quedó
malformado —una línea `@` antes del asunto real, por sintaxis de shell
equivocada al redactarlo—. El cuerpo y el contenido son correctos. No se
reescribió el historial ya publicado en `main`: se corrige hacia adelante
dejándolo anotado aquí.

## Riesgo residual y pendientes

El dueño validó el filtro agrupado en la terminal real el 31/07/2026 y lo dio
por aceptado. Con eso queda aceptada también H-59: su contenido era correcto
desde entonces y lo que faltaba era la presentación.

El orden de las **categorías** entre sí no es administrable hoy: sale del orden
de los catálogos en `CONFIG.catalogMeta`, que es el mismo que usa la pantalla de
Configuración para listar sus tarjetas (Letra antes que Número). Coinciden, así
que el filtro respeta lo que el dueño ve; pero si algún día se quiere elegir ese
orden, hace falta una decisión funcional y un control en Configuración. No se
inventó aquí.

La activación/desactivación sigue existiendo por talla y no por categoría
completa, igual que al cerrar H-59.

Este cambio corrige la forma del menú. Si una terminal concreta muestra un orden
distinto al de Configuración **dentro** de un grupo, lo que está desordenado es
su catálogo local, no el filtro: el arnés demuestra que el filtro reproduce
exactamente el arreglo de `CONFIG`, y la comprobación con los catálogos reales
lo confirma con las 62 tallas de número en orden. El camino para eso sería
revisar el orden guardado en Configuración → Catálogos de producto en esa
terminal.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-61.
- Autoridades: `docs/architect/authorities/inventory.md`.
- Arquitectura: `docs/02-architecture.md` § Categorías y existencias por talla.
- Antecedentes: `docs/fixes/auditoria-categorias-talla.md` (H-59) y
  `docs/fixes/menu-filtro-tallas.md` (H-58).
