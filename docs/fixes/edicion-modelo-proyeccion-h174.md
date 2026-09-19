# Edición rechazada por el modelo histórico

**Riesgo:** H-174
**Estado:** RESUELTO EN CÓDIGO
**Fecha:** 19/09/2026
**Commit:** `569699c015e42849892c7924278a3be9fcdc3220`

## Problema y reproducción

Al editar la familia `24-TB-MC-MNT-MAO-AMAR-<talla>` (TIRA BORDADA) y guardar,
aparece «No se pudo confirmar el guardado» con
`P0001 / REFERENCE_RECLASSIFICATION_REQUIRED` en `product_edit`. Otras
familias sí se guardan.

Lectura SQL autorizada por el dueño, sólo SELECT, del 19/09/2026:

- La familia `d6b00455-…` tiene 9 referencias V2 con existencias y
  `physical_identity_locked`, y `sync_version` 1, porque ninguna edición ha
  prosperado.
- En todas, `modelo = '0TB'` y `attrs.producto = 'TB'`. El catálogo Modelo
  vigente es `producto`.

`node test-h174-edit-model-projection.mjs` antes de corregir: **4/6**. La
réplica de la guarda rechaza `["modelo"]`: el formulario envía `TB` y no `0TB`.

## Causa raíz

- El formulario deriva `modeloFinal` del catálogo Modelo (`TB`) y lo compara
  con la columna histórica (`0TB`). Como difieren, envía `modelo = TB` aunque el
  usuario no lo haya tocado.
- `DATA.updateReference()` sólo compara la firma física. Con catálogo Modelo,
  la firma usa el atributo `producto`, que no cambia, así que la edición pasa en
  el cliente.
- `pos.h94_guard_used_reference_identity()` protege la columna `modelo` y
  rechaza el cambio porque la referencia tiene existencias.

## Diseño

Una referencia con existencias, bloqueo u operaciones no puede cambiar su
identidad física: esa regla y su guarda SQL no cambian. `modelo` es la
proyección del catálogo Modelo y ya no puede modificarse en una fila protegida.
Por eso la autoridad del dominio conserva el valor persistido y deja pasar
precio, costo, stock y demás datos comerciales.

Se mantienen:

- El bloqueo de cualquier cambio de firma, como el color.
- La edición libre del modelo en referencias sin existencias ni operaciones.

No hay migración ni reparación de datos.

## Solución

- `balam/data.jsx`, `updateReference()`: la condición de protección se calcula
  una vez; si aplica, `next.modelo = current.modelo`.
- Artefactos regenerados.
- `test-h174-edit-model-projection.mjs`, añadida al workflow.

## Pruebas

- Reproducción: 4/6 → **6/6**. Cubre la edición real de la familia desde el
  formulario, la regla en DATA, el bloqueo de un cambio físico real, el modelo
  editable sin protección y cero errores de página.
- Regresiones verdes: `test-h172-product-edit.mjs` 7/7,
  `test-h173-ticket-thermal-output.mjs` 28/28, `test-h164-online-ui.mjs` 6/6
  y `test-h164-online-pwa.mjs` 2/2.
- Fallos previos, idénticos contra una copia de `HEAD` sin H-174:
  - `test-h101-family-ui`, `test-h101-mixed-size-families`,
    `test-h102-family-ui-e2e`, `test-h103-compact-family-stock-e2e` y
    `test-h104-family-visual-sku-e2e`: «La talla no pertenece a la familia
    seleccionada» al preparar sus datos de prueba.
  - `test-h94-reference-model-v2`: la misma excepción en las dos versiones.
  - `test-h163-inventory-excel-e2e` 0/1 y `test-h163-inventory-messages` 15/16
    en las dos versiones.
  - Ninguno está en el workflow. Quedan fuera de este alcance.

## Alcance medido en producción

Censo de solo lectura sobre 962 referencias V2 activas, de las cuales 927 están
protegidas:

- **34** referencias protegidas en **8 familias** tienen `modelo` distinto de
  `attrs.producto`. Todas son TIRA BORDADA (`0TB` frente a `TB`).
- Una referencia más tiene la misma diferencia, pero sin protección: se guardaba
  y el formulario cambiaba su modelo a `TB`.
- Otras fuentes de reenvío normalizado, todas en cero: cuello u ornamento
  vacíos, colores de ornamento fuera de catálogo o duplicados, atributos vacíos
  o con espacios, y categoría o escala de talla inconsistentes.

## Publicación

- Workflow `35453322879` SUCCESS (regression y deploy).
- `index.html` y `sw.js` públicos idénticos byte a byte al commit. SHA-256 de
  `index.html`: `c040aea3582784df39086e1c693ab4b91ede0d6e8152c3848a66f2598e915b7e`.
- `node test-h174-edit-model-projection.mjs <Pages>`: 6/6.

## Riesgo residual y pendientes

- Las 34 referencias conservan `0TB`. No se unifican datos sin una decisión del
  dueño.
- La importación Excel tiene su propio plan de conflictos y no se modificó.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-174`
- `guardado-edicion-productos-h172.md`, `sincronizacion-automatica-h155.md`
