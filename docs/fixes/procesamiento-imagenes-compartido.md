# Procesamiento compartido de imágenes

**Riesgo:** H-26
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `95fc44f`

## Problema y reproducción

Logo, avatar y foto de producto repetían el pipeline completo de `FileReader`,
`Image`, escala proporcional, canvas y `toDataURL`. Logo/avatar usaban PNG a
256 px y producto JPEG 0.85 a 600 px.

Antes del cambio, `node test-module-contracts.mjs` aprobó 32/36: fallaron el
export común, sus consumos en Configuración e Inventario y la implementación
única de `FileReader`.

## Causa raíz

Cada formulario incorporó localmente el procesamiento del archivo, aunque las
únicas diferencias reales eran tamaño máximo, MIME y calidad. Esto duplicó
también el manejo de lectura y decodificación fallidas.

## Diseño

- Compartir sólo lectura, decodificación, escala y codificación.
- Parametrizar tamaño, MIME y calidad.
- Conservar PNG 256 para logo/avatar y JPEG 0.85 a 600 para producto.
- Conservar mensajes, estado de formulario, respaldo local y subida posterior.
- Rechazar tipo no imagen, lectura abortada/fallida y decodificación inválida.
- No cambiar datos, Supabase, Storage, cola ni persistencia.

## Solución

`window.UI.resizeImageFile()` devuelve una promesa con el data URL reducido.
`settings.jsx` la usa para logo y avatar; `inventory.jsx` para producto y
mantiene después su vista previa, respaldo local y subida idempotente existente.

`test-image-processing.mjs` ejecuta la utilidad aisladamente con APIs de
navegador controladas. Se regeneraron los dos artefactos publicados desde
`balam/`.

## Pruebas

- Reproducción anterior: 32/36.
- `node test-module-contracts.mjs`: 36/36.
- `node test-image-processing.mjs`: 5/5; PNG, JPEG/calidad, tipo inválido,
  lectura fallida y decodificación fallida.
- `node test-ui-navigation.mjs baseline`: 13/13 sobre el bundle anterior.
- `node test-ui-navigation.mjs compare`: 22/22; nueve pantallas idénticas.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17, incluida migración y subida simulada de
  foto con persistencia.
- `node test-import-fotos.mjs`: no ejecutó casos; agotó 30 segundos esperando
  las dependencias CDN del archivo de desarrollo en el entorno restringido.

## Riesgo residual y pendientes

Riesgo bajo: la codificación depende de canvas del navegador, como antes. La
utilidad transforma esos fallos en rechazo y los consumidores muestran el mismo
mensaje existente sin guardar datos parciales.

La limitación CDN observada aquí fue resuelta posteriormente por H-27: el arnés
de importación ejecuta ahora el bundle local.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-26--procesamiento-de-imágenes-duplicado-en-tres-formularios`
- Arquitectura: `docs/02-architecture.md#recursos-de-interfaz`
- Residual previo: `docs/fixes/limpieza-codigo-recursos.md`
