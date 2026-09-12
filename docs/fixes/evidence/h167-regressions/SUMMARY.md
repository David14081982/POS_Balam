# Regresiones de etiquetas H-167

Fecha: 12/09/2026. Ejecución secuencial en Chrome sobre el artefacto integrado preliminar de .h161-release, con peticiones a Supabase interceptadas. No se modificó producto ni se ejecutó build/commit durante esta subtarea.

Artefacto preliminar: index.html; 8979362 bytes; SHA-256 c4a05f90d3b3897a8428ce43a4fbaa44bd9b2ec9eca657ef43512e4c8cc21101. Estas regresiones corresponden a ese artefacto, anterior al ajuste final de invalidación. La validación del artefacto final se registra por separado.

| Comando | Resultado | Salida |
|---|---|---|
| node test-h167-label-resolution.mjs | 16/16; 200 referencias certificadas con 200 visitas al catálogo | 0 |
| node test-h132-inventory-identity-certification.mjs | 2 comprobaciones aprobadas, 4 fallidas; abortó esperando cerrar modal inexistente | 1 |
| node test-h127-label-diagnostics.mjs | Sin aserciones ejecutadas; abortó esperando labels-copies-stock | 1 |
| node test-h99-label-pdf.mjs | 23/23 | 0 |
| node test-h99-label-visual.mjs | 12/12 | 0 |
| node test-h100-materialized-label-sku.mjs | Sin aserciones ejecutadas; semilla rechazada por talla fuera de familia | 1 |

Las tres suites aprobadas suman 51 comprobaciones; las tres incompatibles NO se consideran aprobadas.

## Alcance demostrado

H-167 mantiene identidad, aliases, tombstones, V1 histórico, colisiones externas a la selección y completitud con coste lineal. H-99 valida extensión/MIME/estructura y xref PDF, JPEG real, Code128 presente en raster, paridad exacta con el master de preview, páginas 60×40 mm, texto íntegro, copias individuales y por stock, Web Share y vista imprimible. La prueba visual mantiene geometría y tipografía para SKU corto, típico y largo.

## Adaptación de dos arneses

Sólo test-h99-label-pdf.mjs y test-h99-label-visual.mjs se adaptaron: configuración de fixture aislada, barcodeContract 3 explícito e instalación del snapshot completo mediante DATA.replaceFromOnline(). El getter DATA.products devuelve una copia; el antiguo splice no instala productos. Visual espera labels-copies-one antes de consultar el preview preparado de forma asíncrona. No se retiraron ni debilitaron aserciones; la sintaxis de ambos archivos fue comprobada.

## Limitaciones de arneses históricos

H-132 fue comparado en el MISMO navegador con barcodes.jsx original. Sus resultados completos fueron idénticos, incluidos BARCODE_UNRESOLVED para V2. DATA.products terminó vacío en ambas ejecuciones después del antiguo splice. Evidencia: diagnose-h132.log y h132-original-comparison.json. El SHA-256 de la fuente original consta en ese JSON.

H-127 usa la misma instalación antigua mediante splice y no alcanza el modal con controles. Se conserva sin adaptación por alcance. H-100 aborta antes de probar etiquetas: DATA.createReference() rechaza su talla porque la semilla no prepara la categoría/familia vigente. También conserva splice histórico; no se amplió su reparación.

Logs completos: archivos .log de este directorio (UTF-8). Los fallos incluyen stderr y contexto de PowerShell. results.jsonl conserva los códigos de salida y fechas. Se capturaron imágenes sintéticas bajo .evidence-label-visual/ del worktree. Papel, impresora y lector físicos: NOT_TESTED; estos recorridos no acreditan certificación distribuida.
