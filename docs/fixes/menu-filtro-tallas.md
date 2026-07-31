# Menú normal en el filtro de tallas del POS

**Riesgo:** H-58
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Al seleccionar una talla, el control cerrado se vuelve amarillo correctamente,
pero en Chrome/Edge sobre Windows el menú nativo podía pintar todas las opciones
con el mismo fondo. `node test-pos-size-filter-menu.mjs` antes del cambio:
**3 pasaron, 2 fallaron**; faltaban el contrato estable y el restablecimiento de
colores de las opciones.

## Causa raíz

No existe una regla global ni una variable CSS que pinte las opciones. El
componente `FilterSelect` de `balam/pos.jsx` aplica `bg-gold text-on-gold`
directamente al `<select>` activo y entregaba `<option>` sin fondo ni texto
propios. Chromium puede usar esos colores heredados al dibujar el popup nativo.

## Diseño

El `<select>` permanece nativo y conserva exactamente sus clases de estado
cerrado. Cada `<option>` restablece únicamente `bg-surface text-on-surface`.
Selección, foco y hover quedan a cargo del navegador y del tema del sistema; no
se introducen pseudoselectores, hacks ni un listbox personalizado.

## Solución

- `balam/pos.jsx` clona las opciones de `FilterSelect` con los colores normales
  del menú y añade `data-testid="pos-size-filter"` al filtro de tallas.
- `index.html` y `POS Balam (offline).html` fueron regenerados desde la fuente.
- `test-pos-size-filter-menu.mjs` protege la cascada y la verifica en Chrome.

## Pruebas

- `node test-pos-size-filter-menu.mjs`: 6/6.
- `node test-product-sizes.mjs`: 9/9.
- `node test-module-contracts.mjs`: 40/40.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.
- `node build-offline.mjs`: correcto, 71 assets.

## Riesgo residual y pendientes

Los menús `<select>` nativos varían visualmente entre sistema operativo y
navegador; el hover y el resaltado seleccionado seguirán su apariencia nativa.
Es deliberado y no requiere migrar a un componente personalizado.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-58---el-menú-nativo-del-filtro-de-tallas-hereda-el-fondo-amarillo`
- Reglas: `docs/architect/playbooks/client.md` y
  `docs/architect/playbooks/delivery.md`.
