# Build sin dependencias remotas mutables

**Riesgo:** H-20
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El build descargaba Babel, React, JsBarcode, CSS, 31 fuentes y nueve imágenes
en cada ejecución. Tailwind se resolvía con `npx --yes`. En el entorno sin red,
Babel degradó a runtime y Tailwind abortó con `EACCES/fetch failed`.

`node test-build-reproducibility.mjs` aprobó 4/7 antes del cambio: faltaban la
ausencia de red, Tailwind fijado y un almacén íntegro de recursos.

## Causa raíz

El artefacto era offline, pero su proceso de construcción no lo era. Versiones
en URLs no fijaban todos los bytes y `npx --yes` resolvía una herramienta fuera
del lockfile. Además, los `catch` históricos permitían omitir recursos y
continuar con un bundle degradado.

## Diseño

- Versionar los bytes exactos de cada respuesta externa junto con SHA-256.
- Verificar cada hash antes de consumirlo.
- Prohibir descargas durante el build normal.
- Permitir actualización explícita exclusivamente con
  `BALAM_REFRESH_BUILD_RESOURCES=1`.
- Fijar Tailwind 3.4.17 en `package-lock.json` y ejecutar su CLI local.
- Abortar ante recursos ausentes, corruptos o incompletos.

## Solución

`balam/vendor/build-resources.json` conserva 46 respuestas con bytes base64 y
SHA-256. `fetchBuf()` lee y verifica ese almacén durante el build normal; sólo
el modo explícito de actualización llama a la red y vuelve a escribirlo.

Tailwind 3.4.17 quedó como dependencia exacta y el build ejecuta
`node_modules/tailwindcss/lib/cli.js`. Ya no usa `npx --yes`.

Los fallos de Babel, scripts, fuentes o imágenes abortan el proceso. No existe
la ruta anterior de “SKIP” o Babel en runtime.

## Pruebas

- Reproducción anterior: 4/7.
- `node test-build-reproducibility.mjs`: 8/8.
- Caché: 46/46 entradas con SHA-256 válido.
- Build normal sin modo de actualización: correcto, 66 assets.
- Caché inexistente mediante `BALAM_BUILD_RESOURCE_CACHE`: fallo temprano
  esperado con `recurso no fijado`; prueba negativa aprobada.
- SHA-256 de ambos artefactos:
  `73F36BE13792E6483F673D157457D1296EC0138DFFF23398E96A8FA41C93E05D`.
- `npm install`: 78 paquetes auditados, cero vulnerabilidades.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-module-contracts.mjs`: 16/16.
- `git diff --check`: correcto.

## Riesgo residual y pendientes

El build normal es autocontenido respecto de recursos externos y falla cerrado.
Actualizar deliberadamente el almacén sí requiere Internet y revisión del diff.
Una instalación nueva necesita `npm ci` para obtener las dependencias de
desarrollo fijadas por `package-lock.json`; esto no altera los bytes externos
incorporados al bundle.

No se modificaron lógica del POS, datos, Supabase, sincronización ni interfaz.
La reversión restaura la lectura remota anterior y retira el almacén fijado.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-20--build-depende-de-red-y-recursos-externos-mutables`
- Arquitectura: `docs/02-architecture.md#build-offline`

