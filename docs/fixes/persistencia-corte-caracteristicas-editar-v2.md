# Persistencia de atributos generales al editar V2

**Riesgo:** H-115
**Estado:** RESUELTO
**Fecha:** 18/08/2026
**Commit:** `126e98e`

## Problema y reproducción

En el bundle publicado `37e83cc`, una familia V2 existente podía cambiar Corte y Características, cerrar el formulario y mostrar `1 referencias guardadas`, pero `products.attrs` conservaba los valores anteriores. Con stock/candado ocurría algo peor: la pérdida sucedía antes de `DATA.updateReference()`, por lo que la guarda no veía el cambio físico y también se mostraba éxito.

La reproducción se hizo con fixtures locales y Supabase interceptado. El alta V2 sí persistía ambos campos y una excepción explícita de fila también; el defecto era la edición general de referencias existentes.

## Causa raíz

`ProductForm.submit()` construía cada `candidateAttrs` desde `source.attrs` y `row.attrs`. Después sólo reaplicaba `familyCaptureKinds`; los nuevos valores generales `captureScope=reference` alojados en `d.attrs` nunca se materializaban en el candidato.

## Diseño

El valor efectivo de cada atributo capturado por referencia se resuelve, por fila, con esta precedencia:

1. excepción específica no vacía;
2. valor general común del formulario;
3. valor fuente de la referencia cuando la proyección familiar es mixta.

La tercera regla evita que la opción vacía “Usar valor general” borre un atributo cuando no existe una autoridad general común. No se cambia `CONFIG.inReference`, `physicalSignature`, IDs, barcode, stock ni documentos.

## Solución

- `balam/inventory.jsx`: materializa `referenceCaptureKinds` en todos los candidatos V2 existentes antes de entrar a DATA.
- `balam/data.jsx` y `balam/xlsx-io.jsx`: reemplazan los mensajes falsos “con operaciones” por una explicación que también contempla existencias/candado y aclara que los datos comerciales siguen editables.
- `test-h115-v2-reference-attrs.mjs`: contrato determinista del ensamblado y la guarda.
- `test-h115-v2-reference-attrs-e2e.mjs`: alta, edición unlocked, bloqueo con stock, variante, familia mixta, reload/pull, inspección de `products.attrs` y aislamiento remoto.

## Pruebas

- Reproducción contra bundle publicado: 13/13 hallazgos; confirmó pérdida de ambos campos y éxito falso.
- `node test-h115-v2-reference-attrs.mjs`: 7/7.
- `node test-h115-v2-reference-attrs-e2e.mjs`: 12/12.
- Regresión V1/V2 y BALAM QA: 353 comprobaciones verdes únicas, incluyendo
  responsive 320–1440 px, smoke, navegación, Excel, POS/posventa y certificación
  transversal H-110 sin escrituras Supabase.
- `node test-h84-product-form-ux-metrics.mjs`: no concluyente; el arnés dejó
  abierto el modal de colores y el overlay interceptó un click posterior. El
  E2E funcional H-84 pasó 19/19 y el fallo no cruza el código H-115.
- `node build-offline.mjs` y `node test-build-reproducibility.mjs`: build correcto,
  artefactos gemelos y 8/8 invariantes reproducibles.
- Publicación: `origin/main` en `04827ff`; GitHub Pages coincide byte a byte con
  el bundle del commit (SHA-256 `F03DF3CB9FCFEA3509C22E3DC770423B51AF8B37364A1C6EF142DD5BAB586A9D`).
- Lectura Supabase posterior: CONFIG 36/180, productos 395, 370 activos y última
  migración `20260817015000`, sin cambios respecto de la línea base.

## Riesgo residual y pendientes

- Una familia con valores físicos mixtos no tiene un “valor general” autoritativo. La corrección preserva los valores existentes; definir una acción explícita para unificarlos es decisión de producto.
- Cliente y PostgreSQL difieren en préstamos y en el alcance de `attrs`; no se modificó el trigger.
- Reclasificación tiene autoridad de dominio/servidor, pero no UI productiva.
- Baja V2 permanece bajo HARD STOP H-114.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-115--editar-v2-descarta-corte-y-características-generales-con-éxito-falso`
- Auditoría: `docs/audits/reconciliacion-guardas-v2-2026-08-18.md`
- Arquitectura: `docs/architect/authorities/inventory.md`
