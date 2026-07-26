# Lector Excel seguro y trazable

**Riesgo:** H-12
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** `70c3114`

## Problema y reproducción

`POS Balam.html` y `balam/_source.html` cargaban
`https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js`. Esa versión era entregada
directamente desde un CDN y no estaba declarada en `package.json`.

Se inventariaron dos caminos de lectura:

1. `XLSXIO.parseFile()` leía archivos de inventario.
2. `CatalogXlsxCard.doImport()` leía archivos de catálogos.

Ambos entregaban el archivo completo a `XLSX.read()` sin límite previo de
tamaño, hojas o dimensiones. El build incorporaba la misma biblioteca al
artefacto offline. SheetJS 0.18.5 es anterior a las correcciones de
CVE-2023-30533 y CVE-2024-22363.

## Causa raíz

La dependencia de navegador vivía fuera del inventario npm, se obtenía en
tiempo de ejecución y no tenía una verificación propia de versión o integridad.
Además, cada pantalla implementaba su lectura con `FileReader` y
`XLSX.read()` de manera independiente, por lo que no existía una frontera única
para aplicar límites defensivos.

## Diseño

- Conservar SheetJS para no cambiar formatos ni semántica de exportación.
- Fijar la distribución oficial 0.20.3 dentro del repositorio.
- Verificar su SHA-256 mediante prueba automatizada.
- Centralizar toda lectura en `XLSXIO.readWorkbook()`.
- Rechazar antes del parser archivos vacíos o mayores de 10 MB.
- Limitar cada libro a 32 hojas y cada hoja a 50 000 filas, 256 columnas y
  1 000 000 de celdas declaradas.
- Leer sólo valores: no se requieren fórmulas, HTML ni estilos para importar.
- Mantener compatibilidad de lectura con `.xlsx`, `.xls` y `.csv`.
- Incorporar la biblioteca local al build offline mediante el mecanismo de
  recursos locales ya existente.

## Solución

- `balam/vendor/xlsx-0.20.3/xlsx.full.min.js` contiene la distribución oficial.
  SHA-256:
  `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`.
- `POS Balam.html` referencia la copia local versionada.
- `balam/xlsx-io.jsx` expone el lector central, validación del libro y límites.
- `balam/settings.jsx` dejó de leer catálogos por un camino independiente.
- `build-offline.mjs` incorporó la dependencia como recurso local sin requerir
  un cambio especial al empaquetador.
- Se regeneraron `balam/_source.html`, `POS Balam (offline).html` e
  `index.html`.

## Pruebas

- `node test-xlsx-security.mjs`: 17/17. Comprueba versión 0.20.3, SHA-256,
  importación válida XLSX, lectura histórica XLS y CSV, límites de tamaño,
  hojas, filas, columnas y celdas, cabecera `__proto__`, uso central desde
  Configuración y funcionamiento offline sin solicitud externa de SheetJS.
- `node test-import-fotos.mjs`: 23/23.
- `node test-export-modelo.mjs`: 14/14.
- `node test-smoke.mjs`: 13/13.
- `node build-offline.mjs`: artefactos regenerados; el log registró
  `balam/vendor/xlsx-0.20.3/xlsx.full.min.js` como recurso local.

El primer intento aislado de las pruebas de navegador no pudo solicitar las
dependencias de desarrollo React/Babel y agotó el tiempo de espera. La misma
prueba con acceso autorizado pasó; el artefacto offline se verificó bloqueando
solicitudes externas.

## Riesgo residual y pendientes

Los límites reducen exposición a consumo excesivo, pero cualquier parser de
formatos complejos puede recibir entradas nuevas no contempladas. La versión y
el hash quedan trazables para revisar futuras alertas. Los libros legítimos que
excedan los límites deben dividirse antes de importarlos; no se procesan
parcialmente ni alteran datos.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-12--lector-excel-vulnerable-y-sin-límites-explícitos`.
- Instalación y distribución oficial:
  `https://docs.sheetjs.com/docs/getting-started/installation/standalone/`.
- Distribución fijada:
  `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`.
- Aviso CVE-2024-22363:
  `https://cdn.sheetjs.com/advisories/CVE-2024-22363`.
- Avisos revisados:
  `https://github.com/advisories/GHSA-4r6h-8v6p-xvw6` y
  `https://github.com/advisories/GHSA-5pgg-2g8v-p4x9`.
