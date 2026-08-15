# Selector legible de Color de ornamento

**Riesgo:** H-106
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 15/08/2026
**Commit técnico:** `987df89`
**Commit documental:** Pendiente de commit

## Problema y reproducción

En Inventario → Editar producto, el selector compartido por las variantes
físicas y las excepciones por talla distribuía los colores en hasta ocho
columnas dentro del ancho heredado de cada celda. Con 68 activos, la variante
dejaba un panel de 248 px y cada opción mostraba sólo muestra y código. La línea
roja H-106 obtuvo 18 comprobaciones aprobadas y 25 fallidas.

## Causa raíz

`renderColorSelector()` en `balam/inventory.jsx` renderizaba una cuadrícula
`grid-cols-3 sm:grid-cols-5 lg:grid-cols-8`; la opción contenía exclusivamente
el código dentro de un `span truncate`. El panel permanecía en el flujo de la
celda del disparador, por lo que no tenía ancho propio. La búsqueda aplicaba
sólo `toLowerCase()`, sin normalizar acentos.

## Diseño

Se conserva el mismo componente, `CONFIG.selectable()`, el orden del catálogo,
la multiselección y la compatibilidad histórica H-105. El panel visual se monta
en `document.body` para no quedar recortado por la columna o el scroll del
modal; mide 480 px en escritorio y deja 16 px por lado en viewports estrechos.
Los resultados forman una lista con scroll vertical interno y buscador fijo.

Cada fila expone muestra, código y nombre, tiene un target mínimo de 44 px y
borde de 2 px en el swatch. Sólo un nombre excepcionalmente largo puede usar
ellipsis, conservando el valor completo en `title`. Escape cierra únicamente el
selector y el foco vuelve al disparador.

## Solución

- `balam/inventory.jsx`: lista legible compartida, panel responsive mediante
  portal, búsqueda insensible a mayúsculas/acentos, borde visible, scroll interno
  y restauración de foco.
- `test-h106-ornament-color-selector-e2e.mjs`: reproducción y regresión de los
  dos contextos, 68 activos, AZL histórico, multiselección y ocho viewports.
- `index.html`, `POS Balam (offline).html` y `sw.js`: artefactos regenerados con
  `node build-offline.mjs`.

No se modificaron catálogos, códigos, nombres, HEX, datos, identidades,
persistencia, Excel, POS ni Supabase.

## Pruebas

- Línea roja H-106: 18/43; 25 fallos reproducidos.
- H-106/BALAM QA: 159/159 en 320, 360, 390, 430, 768, 1024, 1280 y 1440 px.
- Revisión visual: capturas de variante y excepción en `.evidence-h106/`;
  códigos, nombres y swatches legibles, Blanco con borde, sin recorte.
- H-105: 6/6.
- Editor familiar H-101: 12/12; familias mixtas: 10/10.
- Responsive H-87: 492/492.
- Navegación: 15/15.
- Smoke del bundle: 17/17.
- `node build-offline.mjs`: correcto. `index.html` y
  `POS Balam (offline).html` son idénticos, SHA-256
  `5612916e6d6ef68b154ee9a0f924cbf1945f97b494625a7edde5a1d310f45e5b`.
- Pages run `31913351874`: `success` para `987df89`.
- El HTML público mide 8,989,182 bytes, SHA-256
  `2e2ff07c1cc4d1575e1b5648382ec86246a1facd658c586d39bfc2374fadf400`;
  coincide exactamente con el blob Git
  `c00217a77001b307497585394d2baf320f04f9e1` tras CRLF→LF.
- El mismo arnés H-106 ejecutado sobre esos bytes publicados obtuvo 159/159;
  las capturas están en `.evidence-h106/published-*`.

## Riesgo residual y pendientes

Ninguno conocido dentro del selector. `axe-core` no está instalado en el
repositorio; no se agregó una dependencia para esta corrección.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-106--el-selector-de-color-de-ornamento-no-escala-al-catálogo-vigente`
- Corrección preservada: `docs/fixes/catalogo-color-ornamento-h105.md`
- Arquitectura: `docs/02-architecture.md` § Identidad de referencias físicas V2.
