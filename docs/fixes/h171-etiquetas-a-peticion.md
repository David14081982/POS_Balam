# H171 — Etiquetas reutiliza imágenes y prepara documentos a petición

**Riesgo:** H-171, continuación del coste residual de H-167
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 13/09/2026
**Commit:** `3482f5d5857cf013f6381a73ef2a395bdf40c60b`

## Problema y reproducción

Inventario → Etiquetas bloqueaba las opciones hasta generar todos los PNG,
incluso si `barcodeUrls` ya contenía las imágenes guardadas en Supabase. Al
terminar empezaba automáticamente el PDF. Sólo se mostraban cuatro vistas.
El guardián nuevo, construido antes de modificar el cliente, midió 973
referencias sintéticas: 33 396 ms hasta las opciones, 973 PNG, cero lecturas
de imágenes guardadas. Resultado previo: 1 PASS / 1 FAIL.

## Causa raíz

`LabelModal` certificaba el lote y recorría todos sus códigos con
`BARCODES.toPNGDataURL`; su efecto de PDF se ejecutaba al abrir y al cambiar
copias/precio. `saveToSupabase` escribía `barcodeUrls`, pero ningún camino de
lectura de Etiquetas lo consumía. H167 había reducido el bloqueo del hilo y
hecho cancelable el trabajo; no había eliminado este trabajo anticipado.

## Diseño

Architecture Navigator confirma `DATA.listPrice`, `DATA.resolveProductSizes`
y `BARCODES.createLabelCertificationBatch` como autoridades existentes. Se
conserva la certificación del lote completo, incluido el índice de aliases
fuera de selección, antes de usar o generar cualquier imagen. Una URL no
sustituye la comprobación de producto, talla, contrato, unicidad y geometría.

Sólo se acepta el nombre exacto que escribe `STORE.uploadBarcode` en el bucket
`barcodes` de BALAM, para el código actualmente certificado. Respuesta PNG
legible, convertida a data URL para PDF e impresión sin dependencias externas.
URL ausente, de otro código, respuesta errónea o ilegible: generación de ese
código certificado. Espera remota acotada a 1,5 s por imagen; cuatro solicitudes
como máximo al abrir. No se añade persistencia ni una autoridad de identidad.

## Solución

Único componente de producto modificado: `LabelModal` en `balam/inventory.jsx`.
La apertura prepara cuatro vistas; Descargar PDF genera y descarga en una
petición, y Abrir vista imprimible prepara el lote solicitado. Copias y precio
invalidan el archivo anterior sin empezar otro. Cambios comerciales y cierre
cancelan la generación; los cambios de clientes conservan el lote vigente.
Compartir usa el PDF preparado y mantiene la activación del usuario.

El guardado explícito existente conserva su transporte, permisos y escrituras.
No se modifica SQL, Storage, inventario ni otra pantalla. Sólo pruebas con
proyecciones sintéticas y transportes externos bloqueados/simulados.

## Pruebas

- `node test-h171-label-demand.mjs --before`: 1 PASS / 1 FAIL, reproducción.
- `node test-h171-label-demand.mjs --fijar`: 18 PASS / 0 FAIL; apertura
  3 595 ms frente a 33 396 ms previos, cuatro imágenes reutilizadas, cero
  PNG/JPEG, 973/973 identidades correctas. Reabrir vuelve a certificar sin
  regenerar imágenes. PDF e impresión completos, URL de otro código rechazada,
  fallback ante ausencia/404 y lote inválido bloqueado. Baseline fijada.
- `node test-h167-label-performance.mjs`: 155/155; PDF completo con copias y
  precios, guardado sintético exacto y garantías previas conservadas. Baseline
  ratcheted: apertura sin imágenes guardadas limitada a cuatro PNG. Ejecutado
  antes del ajuste final de cancelación; CI volvió a comprobar el artefacto final: workflow 34780444756 SUCCESS.
- `node test-h167-label-lifecycle.mjs`: 7 PASS / 1 FAIL inicialmente; detectó
  que la generación a petición escapaba del cleanup condicionado anterior.
  Cierre síncrono e invalidación incondicional al desmontar: 8 PASS / 0 FAIL.
- `node test-h164-online-ui.mjs`: 6 PASS / 0 FAIL sobre el HTML final.
- `node test-h164-online-pwa.mjs`: 2 PASS / 0 FAIL sobre HTML y SW finales.
- `node build-offline.mjs`: artefactos regenerados desde fuente local.

El transporte de imágenes guardadas se simula con PNG legible; las pruebas de
H167 conservan generación Code128 real, PDF completo y guardas de identidad.
Las métricas temporales describen el navegador de prueba, no un SLA remoto.

## Riesgo residual y pendientes

La validación completa aún requiere tiempo proporcional al catálogo. Generar
un PDF grande sigue teniendo coste, ahora sólo al solicitarlo. La disponibilidad
de Storage puede provocar generación puntual. La procedencia se valida por el
contrato de escritura y nombre del código; no se decodifican ópticamente los
PNG de Storage. No se certifica una impresora física con estas pruebas.
Sin pendientes de esta corrección. HTML publicado y cotejado byte a byte:
`7c20c7bcfa26ca11bf9fbbacb106c43906ec1fce1aece364e7099b3281a2ccd2`.

## Publicación

Push a main autorizado expresamente por el OWNER. Workflow [34780444756](https://github.com/David14081982/POS_Balam/actions/runs/34780444756) completó regresión y despliegue. Los tres archivos públicos coinciden con el commit probado: HTML principal, HTML alterno y service worker. Comprobación: 2026-09-13T20:26:42.635Z. Cero escrituras comerciales en esta verificación.

[Constancia pública](evidence/h171/label-demand/production.json).

## Referencias

- [Riesgos](../03-known-risks.md).
- [Corrección H167](apertura-etiquetas-sin-bloqueo-h167.md).
- [Autoridades de inventario](../architect/authorities/inventory.md).
- [Evidencia previa](evidence/h171/label-demand/before.json).
- [Evidencia posterior](evidence/h171/label-demand/after.json).
