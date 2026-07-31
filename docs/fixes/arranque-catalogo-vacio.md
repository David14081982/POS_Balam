# Recuperación del arranque con catálogo temporalmente vacío

**Riesgo:** H-60
**Estado:** RESUELTO
**Fecha:** 31/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

En producción, una terminal nueva conservaba ventas históricas mientras el
catálogo aún no había llegado. El Dashboard calculaba una miniatura con
`D.products[i % D.products.length]`; con longitud cero entregaba `undefined` a
`ProductThumb`, que leía `p.modelo` y derribaba todo el render.

La misma terminal contenía un upsert de productos con `rows: []`. Su ID
`opms8lh2lx-1-a8ig`, válido como identificador local, se enviaba como parámetro
UUID a `save_products_checked`, que respondía `22P02`. La operación quedaba en
`retry_wait` y, por ser un pendiente de productos, impedía que `pullDomain`
recuperara las 240 filas remotas.

La evidencia de producción quedó en `.evidence-h59-production/`: captura,
traza de consola/Network y verificaciones remotas antes/después.

## Causa raíz

Tres contratos independientes no estaban defendidos:

1. `ProductThumb` suponía que todo consumidor siempre entregaba un producto.
2. La identidad interna de cola `op...` se reutilizaba como UUID de los RPC de
   producto.
3. `pushRows('products', [])` podía crear un pendiente sin efecto que bloqueaba
   el pull de la misma autoridad.

## Diseño

- Una referencia ausente conserva el renglón y muestra un placeholder explícito;
  un producto válido mantiene el diseño anterior.
- Toda operación nueva usa UUID v4; los upserts/bajas pendientes de productos
  con ID histórico no UUID reciben uno nuevo antes de su primer reintento.
- Un upsert vacío de productos no se crea, no se envía y se retira de la cola.
- La limpieza es selectiva por tipo, dominio y ausencia de filas. No toca
  ventas, cambios, devoluciones, fotos ni otras operaciones.
- Una respuesta vacía no reemplaza un catálogo local de productos existente.
  Los borrados reales continúan viajando como tombstones.

## Solución

- `balam/shared.jsx` tolera una referencia ausente y muestra un placeholder
  diagnosticable.
- `balam/dashboard.jsx` deja de calcular módulo sobre un arreglo vacío.
- `balam/store.jsx` genera UUID v4, rechaza upserts vacíos de productos,
  sanea únicamente el pendiente defectuoso y permite que el pull continúe.
- `balam/data.jsx` protege un catálogo local existente ante una aplicación
  remota vacía.
- `test-production-startup-regression.mjs` reproduce ventas históricas con cero
  productos durante el arranque.
- `test-store-queue.mjs` cubre UUID, no creación, limpieza selectiva y
  recuperación del catálogo.

## Pruebas

- `node test-production-startup-regression.mjs`: 3/3.
- `node test-store-queue.mjs`: 121/121.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.
- H-59: auditoría 23/23, autoridad 9/9, menú POS 6/6, Inventario 18/18 y
  persistencia 12/12.
- Contratos: 40/40; reproducibilidad: 8/8.
- `node build-offline.mjs`: correcto, 71 assets.

## Riesgo residual y pendientes

Pendiente de la verificación posterior al despliegue contra producción y de
reemplazar el commit en este documento.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-60.
- Autoridad: `docs/architect/authorities/synchronization.md`.
- Antecedentes: `docs/fixes/diagnostico-cola-offline.md` y
  `docs/fixes/auditoria-categorias-talla.md`.
