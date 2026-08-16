# Paridad del selector de tallas POS V1/V2

**Riesgo:** H-111  
**Estado:** RESUELTO  
**Fecha:** 16/08/2026  
**Commit:** Pendiente de commit

## Problema y reproducción

Con existencias positivas, tocar un producto V1 en el POS abría el modal
compacto “Selecciona talla”. Tocar una familia V2 equivalente abría directamente
“Selecciona referencia” y mostraba una tarjeta técnica por `products.id`.

La diferencia era visible en tres escenarios:

- A, V1: selección comercial por talla;
- B, V2 simple: una referencia física por talla, pero un selector técnico extra;
- C, V2 compleja: varias referencias de la talla 40 sin un primer nivel con las
  cinco piezas agregadas.

La regresión inicial `node test-h111-pos-family-size-selection.mjs` demostró el
defecto: 5 contratos existentes pasaron y fallaron los 4 contratos nuevos de
entrada por talla, resolución simple, segundo nivel y etiquetas humanas.

## Causa raíz

`POSScreen` bifurcaba `sizePick.isFamilyProjection` hacia
`ReferenceFamilyPicker`. Ese componente compartido fue creado para resolver una
referencia exacta en flujos técnicos y administrativos; agrupaba visualmente por
talla, pero renderizaba de inmediato todas las referencias. El POS no consumía
el nivel comercial ya disponible en `DATA.referenceFamilyProjection().sizeGroups`.

La identidad no estaba corrupta: `addToTicket` y `recordSale` ya operaban con el
objeto seleccionado y su `products.id`. El defecto estaba en la presentación y
en el orden de decisión.

## Diseño

- V1 conserva su modal, autoridades, precio por talla y salida exacta.
- Toda familia V2 entra primero por “Selecciona talla”.
- La cabecera usa foto, nombre, `familyVisualSku()` y rango de precios de las
  referencias disponibles, siempre como presentación derivada.
- Cada talla suma exclusivamente `Math.max(0, stockQuantity)` de sus referencias.
- Una talla con una sola referencia disponible entrega directamente ese objeto.
- Una talla con varias referencias abre “Selecciona variante”. Las etiquetas se
  derivan de las partes físicas que realmente difieren y se traducen con CONFIG;
  no se muestran SKU, UUID ni barcode.
- Cada variante entrega el objeto exacto; no existe resolución por SKU, posición
  o primer elemento de la familia.
- `ReferenceFamilyPicker` permanece sin cambios para préstamos y cambios.

Métrica de experiencia: A y B requieren una sola decisión de talla; C agrega
un segundo nivel únicamente cuando hay ambigüedad física real. No se eliminó
ninguna guarda de stock, vendedor, cobro o identidad.

## Solución

- `balam/pos.jsx`: selector familiar comercial de dos niveles, etiquetas humanas,
  stock/rango disponible y contratos de interacción estables.
- `balam/pos-ticket.jsx`: contrato E2E inerte por `productId` para comprobar la
  identidad real del renglón.
- `balam/data.jsx`: documenta el uso visual H-104/H-111 sin cambiar persistencia.
- `test-h111-pos-family-size-selection.mjs`: regresión A/B/C de contrato.
- `test-h111-pos-family-size-selection-e2e.mjs`: carrito, venta exacta y BALAM QA.
- `test-h102-family-ui-e2e.mjs`: actualiza el recorrido POS al nuevo contrato y
  conserva el selector técnico de Préstamos.
- `.agents/skills/balam-qa/SKILL.md`: exige matriz de paridad funcional y de
  experiencia V1/V2, sin exigir igualdad pixel-perfect.
- `index.html`, `POS Balam (offline).html` y `sw.js`: regenerados.

## Pruebas

- Rojo inicial H-111: 5 pasaron, 4 fallaron.
- `node test-h111-pos-family-size-selection.mjs`: 9/9.
- `node test-h111-pos-family-size-selection-e2e.mjs`: 19/19; A/B/C, carrito,
  venta exacta y stock de la referencia elegida.
- Responsive del flujo complejo: 320/360/390/430/768/1280, sin overflow y con
  capturas en `.evidence-h111/`.
- `node test-h102-commercial-family.mjs`: 15/15.
- `node test-h102-family-ui-e2e.mjs`: 16/16.
- `node test-h103-compact-family-stock-e2e.mjs`: 15/15.
- `node test-h104-family-visual-sku.mjs`: 8/8.
- `node test-h104-family-visual-sku-e2e.mjs`: 18/18.
- `node test-product-sizes.mjs`: 9/9.
- `node test-variant-price.mjs`: 38/38.
- `node test-sale-coherence.mjs`: 20/20.
- `node test-module-contracts.mjs`: 42/42.
- `node test-h110-preproduction-v2-certification.mjs`: 20/20, sin escrituras a
  Supabase y con limpieza exacta.
- `node build-offline.mjs`: correcto, 72 assets y bundle offline de 8.99 MB.
- `node test-smoke.mjs bundle`: 13 comprobaciones funcionales visibles pasaron;
  el arnés no terminó el proceso antes del timeout aunque no reportó fallos ni
  errores de página. El smoke de desarrollo no alcanzó su guarda de arranque.

## Riesgo residual y pendientes

Las pruebas usan Chrome headless y no sustituyen una verificación manual con
lector USB o periféricos. El cierre defectuoso/timeout del smoke general es un
problema preexistente del arnés, no se corrigió dentro de H-111.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-111--pos-expone-referencias-v2-en-lugar-de-una-selección-comercial-por-talla`.
- Proyección familiar: `docs/fixes/proyeccion-comercial-familias-v2.md`.
- SKU visual: `docs/fixes/sku-visual-familiar-inventario.md`.
- Autoridad de inventario: `docs/architect/authorities/inventory.md`.
- Autoridad de ventas: `docs/architect/authorities/sales.md`.
