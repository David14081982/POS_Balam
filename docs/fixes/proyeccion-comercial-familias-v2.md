# Proyección comercial de familias V2

**Riesgo:** H-102  
**Estado:** RESUELTO LOCALMENTE  
**Fecha:** 15/08/2026  
**Commit técnico:** `4f09967`  
**Commit documental:** Pendiente de commit

## Problema y reproducción

Supabase conservaba correctamente las hermanas V2, pero los consumidores
comerciales iteraban referencias individuales. VICTOR aparecía repetido y el
detalle/POS usaba únicamente talla, stock, precio y SKU de la fila pulsada.

## Causa raíz

`DATA.referenceFamily()` reconstruía parentesco para el editor, pero no existía
una autoridad derivada compartida para presentar una familia en consumidores.
Cada pantalla elegía implícitamente una referencia como si fuera el producto
comercial completo.

Durante las regresiones se confirmó además un defecto previo H-83: el ordenado
de colores elegía catálogo según los códigos ya seleccionados. Una combinación
V1 `OR + CF` cambiaba de catálogo al pulsar `CF` y descartaba `OR`.

## Diseño

- `DATA.referenceFamilyProjection()` deriva una proyección sin persistirla.
- `DATA.commercialProducts()` agrupa V2 sólo por `reference_family_id`; V1 se
  devuelve sin agrupar.
- La proyección calcula stock total, referencias/tallas disponibles, rango de
  precio, grupos por talla/color, atributos comunes/mixtos y texto de búsqueda.
- `ReferenceFamilyPicker` es el selector compartido. Agrupa visualmente por
  talla, conserva variantes repetidas y entrega siempre referencia e ID exactos.
- Excel y todas las escrituras permanecen una fila/operación por referencia.
- El ordenado H-83 recibe explícitamente el modelo: V1 usa `color`; V2 usa
  `ornament_color`.

## Solución

Inventario, detalle, POS, Préstamos y Cambios consumen la proyección comercial.
Inventario muestra una fila por familia, búsqueda sobre todas las hermanas,
stock/precio familiares y detalle de todas las referencias. POS, Préstamos y
Cambios abren el selector familiar y sólo después agregan el `products.id`
exacto. Etiquetas permiten seleccionar hermanas exactas; la impresión global
materializa todas las referencias. Dashboard y KPIs cuentan productos
comerciales sin duplicar piezas ni valor.

La edición sigue entrando al formulario H-101 con todas las hermanas y no se
alteró `reference_family_id`, `products.id`, `barcode_code`, SKU, stock, RPC,
cola offline ni esquema.

## Pruebas

- H-102 contrato A–O: 15/15.
- H-102 E2E/BALAM QA: 16/16; VICTOR = una fila, 70 piezas, $50–$3,000,
  siete referencias, selección exacta talla 42 y cero errores de página.
- Responsive H-102: 320, 360, 390, 430, 768, 1024, 1280 y 1440 px sin overflow.
- H-101: familia 12/12, mixtas 10/10, contrato 26/26.
- H-83: 17/17; H-84: 19/19.
- H-100: 10/10; H-99 visual 12/12 y PDF 23/23.
- Build offline reproducible: `node build-offline.mjs`.
- Evidencia visual: `.evidence-h102/`.

## Riesgo residual y pendientes

Pendiente únicamente validar la misma matriz contra los bytes publicados. La
proyección es deliberadamente derivada: si una referencia remota cambia, el
siguiente pull/realtime recompone la familia desde las autoridades H-101.

## Rollback

Revertir los commits H-102 y regenerar los artefactos con
`node build-offline.mjs`. No hay migración ni datos que revertir.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-102.
- `docs/fixes/captura-edicion-masiva-v2.md`.
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`.
