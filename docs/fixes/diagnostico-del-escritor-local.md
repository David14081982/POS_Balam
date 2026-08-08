# Diagnóstico correcto del escritor local

**Riesgo:** H-82
**Estado:** RESUELTO
**Fecha:** 07/08/2026
**Commit:** `e2e6634`

## Problema y reproducción

Una sola pestaña mostraba «Otra pestaña está operando» durante F5, login o
recarga. El arnés `test-h82-local-writer-ui.mjs` produjo 2/9 antes del cambio:
Web Locks mantenía correctamente un escritor, pero la interfaz no distinguía
arranque, rebase ni contención confirmada.

## Causa raíz

`App` mostraba el mismo aviso para todo estado distinto de `writer`. Los estados
transitorios `waiting` y `rebasing` eran presentados como otro propietario sin
consultar el lock retenido por el navegador.

## Diseño

`navigator.locks.request()` y `localWriterState === 'writer'` conservan toda la
autoridad. Una consulta `navigator.locks.query()` ejecutada tras 250 ms sólo
clasifica el mensaje: nunca habilita escritura, libera ni reemplaza el lock. Si
la consulta no existe o falla, la aplicación permanece cerrada y muestra un
estado neutral.

## Solución

`balam/data.jsx` publica `localWriterContended`, lo activa exclusivamente cuando
la solicitud continúa esperando y existe un propietario del lock nombrado, y lo
limpia al recibir el relevo. `balam/app.jsx` diferencia preparación, rebase,
contención real y caché bloqueada. El gate incorporó contratos estables para las
pruebas. Los dos artefactos distribuibles fueron regenerados.

## Pruebas

- `node test-h82-local-writer-ui.mjs`: 13/13 (línea base 2/9).
- `node test-h65-layaway-e2e.mjs`: 28/28.
- `node test-auth-permissions.mjs`: 19/19.
- `node test-module-contracts.mjs`: 41/41.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.
- `node test-build-reproducibility.mjs`: 8/8.

## Riesgo residual y pendientes

En un navegador que permita solicitar Web Locks pero no consultarlos, BALAM
seguirá bloqueando toda escritura y mostrará «Preparando almacenamiento local».
No atribuirá la espera a otra pestaña sin confirmación. No hubo cambios de red,
Supabase, cola offline, inventario ni documentos.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-82---el-arranque-atribuye-estados-transitorios-a-otra-pestaña`
- `docs/fixes/liquidacion-apartado-autoridad-stock.md`
