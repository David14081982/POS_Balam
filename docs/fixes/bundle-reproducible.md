# Bundle reproducible por contenido

**Riesgo:** H-19
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `a117267`

## Problema y reproducción

`build-offline.mjs` asignaba `randomUUID()` a cada asset. La fuente, los bytes y
el orden podían permanecer iguales, pero cada ejecución cambiaba todas las
referencias del manifiesto y, por ello, el hash de los artefactos.

Antes de corregir, `node test-build-reproducibility.mjs` aprobó 1/4: los dos
artefactos del mismo build eran copias exactas, pero fallaron la ausencia de
aleatoriedad, la identidad por contenido y el contrato de formato.

## Causa raíz

El manifiesto usaba identidad de ejecución en vez de identidad de contenido.
`addBytes()` llamaba `randomUUID()` sin relación con los bytes incorporados.

## Diseño

- Derivar la identidad de SHA-256 sobre MIME, modo de compresión y bytes
  originales.
- Conservar el formato UUID usado por el loader para no cambiar su contrato.
- Mantener orden, compresión, template, recursos y comportamiento del bundle.
- No modificar módulos de aplicación, datos, Supabase ni cola offline.

## Solución

`assetId()` calcula SHA-256, usa sus primeros 128 bits y los presenta en cinco
segmentos con el mismo formato UUID anterior. `addBytes()` conserva el resto de
su comportamiento y deduplica naturalmente contenido idéntico.

Se regeneraron `index.html` y `POS Balam (offline).html`.

## Pruebas

- Reproducción anterior: 1/4.
- `node test-build-reproducibility.mjs`: 4/4.
- Dos ejecuciones consecutivas de `node build-offline.mjs`: correctas, 66
  assets cada una.
- SHA-256 de ambos artefactos y ambas ejecuciones:
  `73F36BE13792E6483F673D157457D1296EC0138DFFF23398E96A8FA41C93E05D`.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-module-contracts.mjs`: 16/16.
- `git diff --check`: correcto.

El primer comando conjunto de regresión agotó 120 segundos después de aprobar
el smoke 17/17; navegación y contratos se repitieron por separado y aprobaron.

## Riesgo residual y pendientes

La reproducibilidad presupone las mismas respuestas de dependencias remotas. El
build fija versiones de scripts, pero fuentes e imágenes remotas podrían
cambiar su contenido en el origen y producir correctamente un hash distinto.
Eliminar esa dependencia requiere fijar localmente esos recursos en otra
corrección.

La reversión consiste en restaurar la identidad aleatoria anterior y regenerar
los artefactos; no afecta datos ni requiere migraciones.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-19--bundle-no-reproducible-por-identificadores-aleatorios`
- Arquitectura: `docs/02-architecture.md#build-offline`
