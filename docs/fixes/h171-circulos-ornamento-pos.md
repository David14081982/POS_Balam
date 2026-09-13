# H171 — Círculos de ornamento sobre el precio en POS

**Riesgo:** H-171, presentación de las tarjetas de Punto de venta.
**Estado:** RESUELTO LOCALMENTE; PUBLICACIÓN PENDIENTE
**Fecha:** 13/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El OWNER reportó que faltaban los círculos con sombra que identificaban los
colores de ornamento encima del precio. La tarjeta vigente pasa directamente
del título/subtítulo al precio y Agregar. El arnés POS existente reprodujo
0 círculos donde dos colores disponibles requerían dos círculos.

## Causa raíz

`ProductCard` de `balam/pos.jsx` no renderizaba ninguna muestra de color de
ornamento. Los colores permanecen en las referencias; el defecto es visual.
La proyección familiar no debe interpretarse como una referencia individual.

## Diseño y solución

Cambio sólo en `ProductCard`: fila de círculos de 16 px, borde y sombra interior
y exterior encima del precio. Texto accesible y tooltip con el nombre del color.
Se deduplican los códigos de las referencias disponibles de cada familia.
`DATA.effectiveOrnamentColors` conserva la autoridad V2 y la compatibilidad por
talla V1; `CONFIG.find` resuelve nombre y HEX en el catálogo correspondiente.
Una referencia sin colores efectivos no inventa círculos. Si falta HEX, se usa
el fallback visual existente de COLOR_HEX o gris neutro; no color de tela.

Architecture Navigator: autoridad de inventario y playbooks client/delivery.
La presentación deriva del snapshot confirmado y no persiste datos. No cambian
precios, stock, familias, identificadores, filtros, carrito, permisos ni SQL.
Otros roles ven la misma presentación cuando ya tienen acceso al POS. No hay
nuevo consumidor comercial, documento, migración ni contrato distribuido;
certificar A/B/C no aplica a esta modificación visual.

## Pruebas

- Reproducción con `node test-h166-pos.cjs`: falla focal `0 !== 2`.
- `node test-h166-pos.cjs`: PASS; círculos y catálogo progresivo de 1500
  referencias, búsqueda, lector, precio, carrito y responsive conservados.
- `node test-h164-online-ui.mjs`: 6 PASS / 0 FAIL.
- `node test-h164-online-pwa.mjs`: 2 PASS / 0 FAIL.
- Inspección de capturas 390/1280 px: círculos visibles encima del precio.
- `node build-offline.mjs`: ambos HTML y SW regenerados desde fuente local.

Se extendió el arnés POS existente: colores efectivos, deduplicación, exclusión
del color presente sólo en una referencia agotada, ausencia cuando no hay
ornamento, HEX, sombras y posición encima del precio en 390/1280 px.
Conserva sus comprobaciones de búsqueda, lector, tallas, precio y carrito.
Fixtures exclusivamente sintéticos en navegador aislado, red comercial bloqueada.

## Riesgo residual y pendientes

No se modifican asignaciones de color del inventario; se representa su dato
vigente. Sin riesgo funcional nuevo conocido; pendiente commit y publicación
verificable. No se declara certificación comercial remota por una prueba visual.

## Referencias

- [Riesgos](../03-known-risks.md).
- [Autoridad de inventario](../architect/authorities/inventory.md).
- [Colores efectivos por talla](colores-ornamento-por-talla.md).
- [Catálogo de ornamento](catalogo-color-ornamento-h105.md).
- [Antes](evidence/h171/pos-ornaments/before.json) y
  [después](evidence/h171/pos-ornaments/after.json).
- Capturas: [móvil](evidence/h171/pos-ornaments/card-390.png) y
  [escritorio](evidence/h171/pos-ornaments/card-1280.png).
