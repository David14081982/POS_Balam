# Chips compactos de existencias familiares

**Riesgo:** H-103
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 15/08/2026
**Commit técnico:** `55ae37d`
**Commit documental:** `dfdb5c5`
**Commit de validación pública:** `7da216c`

## Problema y reproducción

Después de H-102, Inventario → Detalle de producto seguía leyendo correctamente
la familia V2 completa, pero «Existencias por talla» mostraba cada grupo como
una fila de ancho completo. Antes de H-102 utilizaba chips compactos distribuidos
horizontalmente mediante `flex-wrap`.

## Causa raíz

El commit H-102 `4f09967` sustituyó el patrón histórico
`flex flex-wrap gap-2` por `grid gap-2` para alojar el desglose de referencias.
El cambio de fuente de datos no requería reemplazar la representación visual.

## Solución

`DetailDrawer` conserva `referenceFamilyProjection.sizeGroups` como única fuente
para familias V2 y restaura las clases exactas del chip anterior: contenedor
`flex flex-wrap gap-2` y cuadro `flex flex-col items-center min-w-[48px]
px-2 py-1.5`. Cada chip muestra talla y stock agregado. Cuando una talla tiene
varias referencias, el mismo chip incluye debajo el desglose compacto por color,
piezas y precio.

No se modificaron DATA, `products.id`, `reference_family_id`, stock, SKU,
barcode, POS, persistencia, sincronización ni esquema.

## Pruebas

- Línea roja: el componente compacto no existía y el E2E agotó la espera.
- H-103 E2E/BALAM QA: 9/9.
- H-102 contrato: 15/15; H-102 E2E: 16/16.
- Responsive específico: 320, 360, 390, 430 y 1280 px sin overflow.
- Responsive global H-87: 492/492.
- Navegación: 15/15.
- Smoke bundle: 17/17.
- Build offline correcto mediante `node build-offline.mjs`.
- Evidencia visual: `.evidence-h103/`.
- E2E ejecutado sobre el archivo descargado de GitHub Pages: 9/9.
- Pages sirve exactamente el blob Git
  `7280802218eebc03c559652c3fd781419bdcdb01` (8,986,937 bytes; SHA-256
  `5e208557fd24409264da46cf4e928a0b43884f7851bd71e87e1aa23c0a72d682`).

## Riesgo residual y pendientes

Ninguno conocido. La versión pública conserva la proyección familiar completa,
el desglose de referencias repetidas y el patrón compacto sin overflow.

## Rollback

Restaurar sólo el bloque visual de `DetailDrawer` y regenerar los artefactos.
No existe migración ni dato que revertir.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-103.
- `docs/fixes/proyeccion-comercial-familias-v2.md`.
- Patrón anterior: `git show 4f09967^:balam/inventory.jsx`.
