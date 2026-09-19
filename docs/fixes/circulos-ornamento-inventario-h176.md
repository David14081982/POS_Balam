# Círculos de color de ornamento en Inventario

**Riesgo:** H-176
**Estado:** RESUELTO
**Fecha:** 19/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El dueño pide que en Inventario, en la columna «Color / Orn.», aparezcan justo
debajo del nombre del color de tela unos círculos flotantes, con sombra, con
los colores de ornamento de cada prenda. Es el mismo estilo que el POS
recuperó en H-171.

La tabla ya tenía un espacio para ellos, pero leía `p.ornColors`. Ese dato
viene vacío en las familias V2 (proyección) y en V1 con colores por talla, así
que no aparecía ningún círculo. Los que sí aparecían eran de 10 px y sin la
sombra del POS.

`node test-h176-inventory-ornament-colors.mjs` sobre `HEAD`: **6/10**. Con dos
colores esperados, la familia muestra cero círculos a 1280 y a 1024 px.

## Causa raíz

La fila consumía una propiedad de referencia individual que la proyección
familiar no tiene, en lugar de `DATA.effectiveOrnamentColors` por referencia y
talla, que es la autoridad usada por el POS.

## Diseño

`OrnamentSwatches`, en `balam/inventory.jsx`:

- Reúne sin repetir los colores efectivos de todas las referencias de la fila,
  también las agotadas, porque Inventario muestra todo el catálogo.
- Resuelve nombre y HEX con `CONFIG.find`.
- Usa el círculo de 16 px con sombra interior y exterior de `ProductCard`.
- Queda en una sola fila, alineado bajo el nombre del color.
- Una prenda sin colores no muestra nada.

No cambian datos, precios, stock, identidades, permisos ni SQL. La vista de
celular usa tarjetas sin columna de color y queda fuera del alcance.

## Solución

- `balam/inventory.jsx`: componente `OrnamentSwatches` y separación `gap-1`
  en la celda.
- Artefactos regenerados.
- `test-h176-inventory-ornament-colors.mjs`, añadida al workflow.

## Pruebas

- H-176: 6/10 → **10/10** a 1280 y a 1024 px. Cubre los colores deduplicados,
  incluido uno que sólo existe en una talla agotada; el HEX y el nombre del
  catálogo; la sombra y los 16 px; la posición justo debajo del nombre, en una
  fila y alineada; la ausencia de círculos sin ornamento; y cero errores de
  página.
- Regresiones: H-175 10/10, H-174 6/6, H-172 7/7, `test-h166-pos.cjs` PASS
  (círculos del POS), UI 6/6 y PWA 2/2.
- Captura a 1280 px inspeccionada: tres círculos bajo «Blanco».

## Riesgo residual y pendientes

Con muchos colores, la columna se ensancha para mantener una sola fila.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-176`
- `h171-circulos-ornamento-pos.md`
