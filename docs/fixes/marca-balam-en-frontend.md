# H-93 · Sustitución de Heritage por Balam en el frontend

## Estado

RESUELTO · Pendiente de publicación

## Fecha

10/08/2026

## Problema y evidencia

La auditoría del frontend encontró cuatro textos mostrados al usuario con la
marca `Heritage`: la confirmación de alta de cliente, la acción rápida del
tablero, la descripción de Vendedores y el rol senior predeterminado.

## Causa raíz

Las cadenas provenían de una etapa visual anterior y no se actualizaron al
consolidar la marca Balam. Además, el catálogo local-first podía conservar el
rol predeterminado antiguo aunque cambiara la semilla.

## Corrección

- Se sustituyeron por Balam todas las cadenas visibles y referencias editoriales
  del frontend.
- `backfillState()` migra solamente la etiqueta histórica exacta
  `Heritage Senior Associate`; no modifica roles personalizados.
- Se conserva `balam/heritage.jsx` como nombre técnico para evitar una ruptura
  innecesaria en la carga del módulo.
- Se regeneraron los artefactos publicados desde las fuentes.

## Pruebas

- `node test-h93-brand-balam.mjs`: 6/6.
- `node test-h69-commissions.mjs`: 88/88.
- `node test-h69-commission-settings.mjs`: 25/25.
- `node test-screen-registry.mjs`: 12/12.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.
- `node test-build-reproducibility.mjs`: 8/8.

El smoke del archivo de desarrollo agotó inicialmente 30 segundos durante la
carga; el bundle de producción arrancó en Chrome sin errores y completó todo el
recorrido. No se atribuye ese timeout a una regresión funcional.

## Riesgo residual

El literal anterior permanece exclusivamente como clave de reconocimiento para
migrar configuraciones históricas, y `heritage.jsx` permanece como nombre
técnico interno. Ninguno se muestra en la interfaz.

## Commit

Pendiente de commit.
