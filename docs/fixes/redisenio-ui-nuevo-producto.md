# Rediseño UI/UX de Nuevo/Editar producto

**Riesgo:** H-84
**Estado:** RESUELTO — PUBLICACIÓN PENDIENTE
**Fecha:** 08/08/2026
**Commit técnico:** Pendiente de commit

## Problema y reproducción

El alta masiva podía representar correctamente existencias, precios especiales y
colores de ornamento por talla, pero obligaba a reconstruir el resultado final
comparando bloques distantes. Los catálogos completos y los alcances de cada
grupo seguían abiertos después de configurarlos.

La línea base reproducible se fijó con
`node test-h84-product-form-ux-metrics.mjs --fijar`: cuerpo de 1,393 px,
overflow de 863 px, 57 opciones de color y 30 chips de talla visibles con dos
grupos de colores y uno de precio; no existía ninguna fila de resumen efectivo.
Las cuatro defensas de guardado ejercidas por la prueba ya bloqueaban.

## Causa raíz

`ProductForm` utilizaba la misma representación expandida para editar y para
explicar el resultado. No había una proyección conjunta por talla y cada
validación terminaba en un aviso global, sin relación accesible con el control
responsable.

## Diseño

- Se conserva un único formulario y la cuadrícula masiva de existencias como
  superficie principal de captura.
- Los grupos de colores y precios son proyecciones de edición plegables. Las
  banderas `expanded` son estado exclusivo de UI y se eliminan de la firma del
  borrador y del objeto guardado.
- El selector compacto consume códigos canónicos de `DATA.COLOR_NAME`; el orden
  y la persistencia siguen en las autoridades H-83 existentes.
- La matriz de sólo lectura deriva talla, existencia, ornamento, colores y precio
  efectivos mediante `DATA.resolveProductSizes`,
  `DATA.effectiveOrnamentColors` y `DATA.listPrice`. Nunca modifica el borrador.
- Por defecto se muestran tallas con existencia, excepción o error; `Mostrar
  todas` agrega las tallas restantes.
- Las mismas defensas de nombre/modelo, catálogos obligatorios, familia de
  tallas, precios incompletos/solapados y colores vacíos/incompatibles alimentan
  ahora errores inline, resumen y foco. No se agregó ni quitó una regla comercial.
- Cambiar familia exige confirmación si la operación eliminaría existencias o
  excepciones. Cerrar por botón, fondo o Escape exige confirmación si la firma
  del borrador cambió.
- La variante `productForm` del modal agrega diálogo semántico, autofocus,
  trampa/restauración de foco y pantalla completa móvil sin cambiar los demás
  modales.

No se modifican DATA, CONFIG, Excel, STORE, Supabase, SKU, `product_id`,
`variant_id`, stock, precios, sincronización ni las reglas de H-83.

## Solución

- `balam/inventory.jsx`: nueva jerarquía en seis secciones, selectores compactos,
  grupos plegables, matriz derivada, errores inline, protección de familia y de
  borrador, navegación rápida entre existencias y contratos estables de prueba.
- `balam/shared.jsx`: variante opt-in de `Modal` limitada a `ProductForm` para
  accesibilidad, foco y responsive.
- Pruebas H-83, H-36, smoke y precio por talla: migradas de textos/controles
  visuales antiguos a los contratos semánticos del formulario rediseñado.
- `index.html` y `POS Balam (offline).html`: regenerados exclusivamente desde
  `balam/` mediante `node build-offline.mjs`.

## Pruebas

- `node test-h84-product-form-ux-e2e.mjs` → **19/19**: edición, matriz efectiva,
  varias excepciones, tallas cero, `Mostrar todas`, foco, teclado, cierre sucio,
  advertencia de familia, móvil 390×844 e Inventario/POS.
- `node test-h84-product-form-ux-metrics.mjs` → **verde**: opciones visibles
  color **57→0**, tallas repetidas **30→0**, cinco filas derivadas, overflow
  editable ajustado **863→817**; SKU, precio, stock y mapas persistidos exactos;
  cuatro bloqueos preservados.
- `node test-h83-ornament-colors-by-size.mjs` → **32/32**.
- `node test-h83-ornament-colors-by-size-e2e.mjs` → **17/17**.
- `node test-precio-talla-e2e.mjs` → **19/19**.
- `node test-variant-price.mjs` → **38/38**.
- `node test-product-sizes.mjs` → **9/9**.
- `node test-filtros-inventario.mjs` → **18/18**.
- `node test-pos-size-filter-groups.mjs` → **19/19**.
- `node test-module-contracts.mjs` → **41/41**.
- `node test-ui-navigation.mjs` → **15/15**.
- `node test-build-reproducibility.mjs` → **8/8**.
- `node test-smoke.mjs bundle` → **17/17**.
- `node build-offline.mjs` → compilación JSX y regeneración de ambos artefactos
  completadas.

## Riesgo residual y pendientes

Ningún riesgo funcional conocido dentro del alcance. Las confirmaciones de
descarte usan el diálogo nativo del navegador, por lo que su apariencia depende
de la plataforma; su bloqueo y sus dos decisiones quedaron cubiertos en Chrome.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-84---el-alta-de-producto-dispersa-el-resultado-efectivo-por-talla`
- `docs/architect/playbooks/client.md`
- `docs/architect/authorities/inventory.md`
- `docs/fixes/colores-ornamento-por-talla.md`
- `docs/fixes/precios-por-talla.md`
