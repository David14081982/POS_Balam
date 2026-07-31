# Auditoría integral de categorías por talla

**Riesgo:** H-59
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Aunque Configuración → Catálogos de producto ya era la fuente de verdad, el
filtro “Todas las tallas” del POS derivaba sus opciones recorriendo productos,
exigía stock positivo y deduplicaba sólo por el texto de la talla. El selector
del POS y el detalle de Inventario compartían un resolvedor, pero su fallback
podía devolver ambas categorías para productos históricos ambiguos.

La importación Excel agravaba el problema: no transportaba la categoría y
permitía llenar simultáneamente columnas de letra y número. Además coexistían
`attrs.__sizeCategoryId` —persistido— y `sizeCategoryId` —derivado— con
precedencia inconsistente.

`node test-size-categories-audit.mjs` antes del cambio: **5 pasaron, 10
fallaron**.

## Causa raíz

No existía un único contrato para las dos preguntas distintas:

1. qué tallas pertenecen a un producto;
2. qué tallas globales debe ofrecer el filtro.

La primera se resolvía con una asignación que toleraba dos escalas. La segunda
se calculaba desde productos y existencias en lugar de consultar Configuración.
El orden también podía salir de `meta.order`, aunque el orden administrable real
es la posición del elemento dentro del catálogo. Excel y algunos consumidores
secundarios seguían leyendo variantes crudas.

El modelo de datos no es muchos-a-muchos: la relación formal vive en el escalar
`attrs.__sizeCategoryId`. La asociación simultánea observada era semántica,
creada por variantes de ambas escalas y por cargas sin categoría; por tanto era
un defecto de carga y canonicalización, no una necesidad de tabla intermedia.

## Diseño

- `attrs.__sizeCategoryId` es la única relación persistida. El campo superior
  `sizeCategoryId` es una proyección para la interfaz.
- Un producto resuelve exactamente cero o una categoría. Cero significa que
  requiere asignación; nunca significa “usar todas”.
- Un histórico sólo se infiere si tiene stock positivo en una única escala. Si
  tiene stock positivo en dos, se bloquea para selección y venta hasta editarlo.
- `resolveProductSizes()` responde por producto y conserva tallas inactivas en
  su resultado para compatibilidad; POS y el detalle muestran sólo activas con
  existencia.
- `resolveSizeFilterOptions()` responde por el filtro global: todas las tallas
  activas, tengan o no stock, en el orden de Configuración.
- La comparación de valores acepta número/texto mediante normalización con
  `String`, pero la clave del filtro conserva categoría e identidad de talla.
- No se elimina stock histórico ambiguo automáticamente porque elegir una escala
  sería una decisión de datos irreversible.
- Las categorías completas no tienen estado activo/inactivo en el modelo
  vigente. No se inventó esa política durante esta corrección.

## Solución

- `balam/data.jsx`: endurece `inferSizeCategory()` y
  `resolveProductSizes()`; incorpora `resolveSizeFilterOptions()`,
  `sizeFilterMatch()` y una búsqueda central de variante; aplica la autoridad a
  totales y mutaciones.
- `balam/pos.jsx`: construye el filtro desde Configuración, conserva identidad
  de categoría y usa el resolvedor en “Selecciona talla”.
- `balam/inventory.jsx`: usa la misma resolución en valor, edición y
  “Existencias por talla”.
- `balam/barcodes.jsx`, `balam/loans.jsx`, `balam/returns.jsx`,
  `balam/discounts.jsx` y `balam/pos-ticket.jsx`: eliminan decisiones paralelas
  basadas en `stock` crudo o en comparar sólo el código del catálogo.
- `balam/config.jsx`: normaliza comparaciones entre tallas numéricas y texto.
- `balam/xlsx-io.jsx`: obtiene encabezados en vivo, exporta/importa “Categoría
  por talla”, rechaza dos escalas y no pierde columnas históricas inactivas.
- `balam/store.jsx`: persiste una sola categoría canónica en `attrs` y conserva
  el contrato modular cuando DATA aún no está montado.
- `test-size-categories-audit.mjs`: cubre autoridad, ambigüedad, actividad,
  orden, identidad, importación, caché y render real del filtro.
- `index.html` y `POS Balam (offline).html`: regenerados desde `balam/`.

## Auditoría real y persistencia canónica

La auditoría no destructiva revisó los 240 productos reales de Supabase y la
caché local de la terminal:

- no existe ningún producto con stock positivo en las escalas Letra y Número;
- 237 productos con stock positivo corresponden inequívocamente a
  `size_number` y suman 3,505 unidades;
- BRAULIO (`imp-1784582003846-41`), DANTE
  (`imp-1784582003845-31`) y VALERIO (`imp-1784582003849-56`) no tienen
  existencias;
- Supabase tenía 240 productos sin `attrs.__sizeCategoryId`; la caché local ya
  proyectaba `size_number` en 237 y conservaba los tres agotados sin categoría;
- los historiales auditados contenían 22 movimientos, 21 renglones de venta,
  dos de cambio, uno de devolución y ningún préstamo.

El dueño confirmó los 240 productos como Talla (Número). La migración
`20260731009700_pos_h59_size_category_persistence.sql` fija el conjunto mediante
cantidad y huella MD5 ordenada de IDs, valida el catálogo estable existente,
stock, productos positivos y los tres agotados, y actualiza únicamente
`attrs.__sizeCategoryId`. Usa `jsonb_set`, conserva las demás propiedades de
`attrs` y deja que el trigger vigente actualice sólo `sync_version` y
`updated_at`.

La operación es idempotente: sólo selecciona filas cuyo valor sea distinto de
`size_number`. Antes y después compara huellas de todos los campos funcionales,
la matriz completa de variantes/stock y movimientos. Una primera ejecución se
canceló antes de modificar datos porque los metadatos históricos aún no tenían
`sizeCategory/sizeScale`; la guarda se corrigió para aceptar campos ausentes,
pero rechazar valores explícitos incompatibles. La ejecución definitiva
encontró y modificó 240/240 filas, sin omitidas.

`20260731009800_pos_h59_size_category_persistence_verification.sql` confirmó:
240/240 en `size_number`, cero filas candidatas en una repetición, 3,505
unidades en 237 productos, los tres productos confirmados en cero y los mismos
conteos históricos. Ambas migraciones están aplicadas en Supabase.

La preinspección posterior de sólo lectura confirmó que la caché física de
Chrome ya convergió a 240/240 en `size_number`, conserva 3,505 unidades y deja
BRAULIO, DANTE y VALERIO en cero. La cola principal está vacía, el respaldo
IndexedDB no contiene operaciones y no hay fotografías embebidas. No se editó
LevelDB directamente. La prueba adicional con un perfil completamente limpio
no alcanzó a ejecutarse y permanece como validación previa al despliegue.

## Pruebas

- Persistencia H-59: `node test-h59-size-persistence.mjs` — **12/12**.
- H-59: `node test-size-categories-audit.mjs` — **23/23**.
- Autoridad: `node test-product-sizes.mjs` — **9/9**.
- POS: `node test-pos-size-filter-menu.mjs` — **6/6**.
- Inventario: `node test-filtros-inventario.mjs` — **18/18**.
- Precio: `node test-variant-price.mjs` — **38/38**;
  `node test-precio-talla-e2e.mjs` — **19/19**.
- Excel: exportación **14/14**, importación/fotos **23/23**, seguridad **17/17**.
- Consumidores: descuentos **43/43**, trazabilidad **65/65**, cambios E2E
  **37/37**, pantalla **45/45**, modelo **28/28**, devoluciones **17/17** y
  préstamos **117/117**.
- Infraestructura: cola offline **115/115**, contratos **40/40**, smoke
  **17/17**, navegación **15/15**, roles **15/15**, reproducibilidad **8/8** y
  cadena de migraciones **31/31**.
- `node build-offline.mjs`: correcto, **71 assets**, sin Babel en runtime.

## Riesgo residual y pendientes

La auditoría real descartó stock positivo en ambas escalas; Supabase y la
terminal existente ya tienen los 240 productos en `size_number`. Antes del
despliegue queda pendiente completar la prueba funcional con un perfil limpio,
sin reutilizar caché.

La activación/desactivación existe en tallas, no en la categoría completa.
Agregarla requiere una decisión funcional sobre qué hacer con productos y stock
de una categoría desactivada.

Promociones y renglones históricos conservan la talla por valor, sin ID de
categoría. Los catálogos actuales no colisionan; si en el futuro dos categorías
usan el mismo valor, esos documentos necesitarán una migración de identidad.

No se creó commit ni push de Git y no se desplegó la aplicación. Sólo se
aplicaron las dos migraciones de datos/verificación expresamente autorizadas.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-59.
- Autoridades: `docs/architect/authorities/inventory.md`.
- Arquitectura: `docs/02-architecture.md` → Categorías y existencias por talla.
- Antecedentes: `docs/fixes/autoridad-categorias-por-talla.md` y
  `docs/fixes/menu-filtro-tallas.md`.
