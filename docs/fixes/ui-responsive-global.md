# UI responsive global

**Riesgo:** H-87
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 09/08/2026
**Commits:** `e477c92` (implementación), `bb11b19` (documentación) y `9855a55` (suite pública)

## Problema y reproducción

Las once pantallas principales conservaban shell, espaciado, toolbars, KPIs,
tablas y formularios de escritorio en teléfono. Sobre el bundle anterior,
`document.scrollWidth` excedía el viewport entre 320 y 430 px: Inventario llegó
a 665 px en 320, Clientes a 641, POS a 468 y Reportes a 650.

## Causa raíz

El shell reservaba permanentemente 64/256 px para la sidebar y la topbar no
priorizaba sus acciones. Las pantallas repetían padding de escritorio, mínimos
acumulativos y barras horizontales; KPIs y modales carecían de contratos
compartidos. Inventario y Clientes intentaban conservar tablas de escritorio en
vez de cambiar a una proyección móvil.

## Diseño y solución

- El shell usa drawer móvil, contenido a ancho completo y topbar por prioridad;
  la sidebar de escritorio conserva su variante colapsable.
- `window.UI` publica composición, KPI, drawer y contratos táctiles; `Modal`,
  `Segment` y `Pager` conservan 44 px, foco visible, trampa/restauración de foco,
  cuerpo scrollable y footer con wrap.
- El KPI común separa importe y unidad, permite wrap y usa `clamp()` con piso
  legible. Inventario, Clientes, Panel, Apartados, Préstamos y Reportes lo usan.
- Inventario y Clientes cambian de tabla a fila-tarjeta en móvil; la tabla
  completa permanece desde tablet. Importación H-86 conserva desplazamiento
  explícito porque la comparación de columnas lo requiere.
- POS, formularios, filtros, Reportes y Configuración cambian su composición a
  una columna o reflujo antes de recuperar el layout de escritorio.
- Drawers son fullscreen en teléfono. ProductForm conserva exactamente la
  variante fullscreen y los contratos H-84 existentes.

No se modificaron DATA, CONFIG, STORE, Supabase, migraciones, SKU, inventario,
ventas, precios, sincronización, permisos ni los contratos H-83/H-84/H-85/H-86.

## Pruebas

- `node test-responsive-ui.mjs`: **492/492** en 320, 360, 375, 390, 430, 600,
  768, 1024, 1280 y 1440 px; once pantallas, acciones, targets, KPI, cinco
  importes, modal, footer y foco.
- H-83: **32/32 + 17/17**; H-84: **19/19**; H-85: **18/18**; H-86: **37/37**.
- Clientes H-70: **39/39**; Inventario: **18/18**; POS por talla: **19/19**.
- Navegación: **15/15**; AUTH: **19/19**; permisos: **13/13 + 21/21**.
- Contratos de módulos: **41/41**; smoke bundle: **17/17**; build reproducible:
  **8/8**; `node build-offline.mjs` completado.

## Despliegue

Publicado en `https://david14081982.github.io/POS_Balam/`. El build local tiene
SHA-256 `C3FEDDF9BA7C99DE375240DF2D633F6BF78C73536DF32CCB4D76E9953C6FAD7C`.
GitHub Pages normalizó los finales de línea al servir el mismo contenido: el
archivo público descargado tiene SHA-256
`3679A7A8E470B5BC0110EEFC858AAB1E781D794078BF065F75F6FC8F5019D857` y
`git diff --no-index` confirmó equivalencia de contenido. La suite H-87 volvió
a pasar **492/492** sobre ese archivo público. No requiere migraciones.

## Riesgo residual

Ninguno funcional conocido. Las tablas densas conservan la tabla completa en
tablet/escritorio y la proyección priorizada en teléfono; la suite verifica que
la información esencial siga siendo recuperable mediante detalle.

## Referencias

- `docs/03-known-risks.md` § H-87.
- `docs/architect/playbooks/client.md`.
- H-83, H-84, H-85 y H-86 permanecen como invariantes de regresión.
