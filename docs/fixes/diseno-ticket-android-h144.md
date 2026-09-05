# Mismo diseño de comprobantes en Chrome y Android

**Riesgo:** H-144
**Estado:** CORREGIDO Y PUBLICADO — DISEÑO CONFIRMADO; ANCHO/CONTRASTE EN H-145
**Fecha:** 05/09/2026
**Commit:** `61c7579` (funcional); cierre documental en commit posterior.

## Problema y reproducción

El usuario confirma papel impreso con H-143. Solicita conservar el diseño de
Chrome, no la proyección de texto que elimina logo, fuentes y geometría.
Se parte de `13fe14a` en un worktree limpio separado del árbol original.

## Causa raíz

`UI.printReceipt()` envía `receiptPrintText()`: su contrato deliberadamente
descarta la estructura visual. El documento montado ya contiene el diseño.

## Diseño

Reutilizar ese documento y sus estilos de impresión. Rasterizar localmente a
576 puntos de ancho para el ticket de 80 mm y enviar PNG por el contrato
`rawbt:data:image/png;base64,` documentado por el autor. No crear otra plantilla
financiera ni forzar comandos de un modelo de impresora desde BALAM.
Preparar sin abrir aplicaciones y entregar exclusivamente desde clic directo.

| Capacidad/ciclo | Invariante |
|---|---|
| POS, Reportes, Apartados, Cambio, Devolución | Mismo documento original |
| V1/V2, abonos e históricos | Ninguna reconstrucción desde catálogo |
| Preparación/cancelación/error | Sin envío automático ni contenido parcial |
| Reintento y documento siguiente | Identidad visual validada antes del envío |
| Offline/recarga | Sólo recursos locales; nada persistido ni subido |
| Escritorio/PDF | Conserva impresión nativa y formato continuo H-135 |
| Permisos/cola/stock/pagos/reversas | No cambia ninguna operación de negocio |

## Solución

`shared.jsx` extiende la costura de H-143 con preparación local de gráficos.
Un iframe temporal sin scripts aplica los estilos existentes de impresión y
los recursos del bundle convertidos a data URI. Un SVG foreignObject entrega
el mismo layout al canvas de Chrome. Un PNG gris de 8 bits con filtro Sub y
DEFLATE conserva los píxeles de luminancia, suavizado y tonos sin pérdida.
Se usa `CompressionStream` existente en la plataforma; no se incorpora una
biblioteca. La imagen en color inicial excedía el límite con 24 prendas:
comprimir el PNG gris conserva contenido y geometría sin imponer una trama.

`ReceiptPrintHelp` anticipa la preparación. `reports.jsx` prepara el documento
de su ventana. El botón compara el contenido del elemento con la imagen
preparada; ante cambio, vuelve a preparar. Sólo un clic con PNG listo abre
RawBT. Las continuaciones sólo muestran estado; cerrar no envía nada. Un logo
inválido, documento vacío, altura mayor de 24,000 puntos o data URI mayor de
500,000 caracteres bloquean el envío completo y ofrecen la impresión del
sistema. No se truncan tickets ni se degrada a texto silenciosamente.

Las imágenes no salen de la tablet salvo al RawBT instalado. Los recursos
admitidos son data/blob locales; el iframe se retira en `finally`. El error
de decodificación se convierte en un mensaje legible con reintento.

## Pruebas

Rojo inicial H-144: **0/1**, frente al bundle `13fe14a`. H-143 previo **35/35**
demuestra transporte correcto de texto y explica por qué no detectaba la falta
de diseño. El arnés H-143 se adapta al contrato gráfico: afirma PNG real y
conserva los recorridos de POS/Reportes/Apartados, gesto, errores y reintento.

La prueba H-144 decodifica el PNG que recibe RawBT y lo compara con una captura
independiente del documento original bajo `media: print`: altura dentro de
3 puntos, error medio de canales menor de 12/255 y contenido no vacío. Cubre
logo personalizado, V1 histórico, V2, 24 prendas, largo→corto, abono, cambio y
devolución, ocho anchos 320–1440, offline, cancelación, fuente inválida y clic
durante preparación. Capturas y métricas regenerables `h144-*.png/json`.

| Verificación | Resultado |
|---|---|
| `node test-h144-ticket-design.mjs` | 47/47 |
| `node test-h143-android-tickets.mjs` | 35/35 |
| `node test-h85-receipts.mjs` | 20/20 |
| `node test-h90-payment-method-ticket-e2e.mjs` | 21/21 |
| `node test-h90-payment-method-ticket.mjs` | 17/17 |
| `node test-h135-continuous-ticket.mjs` | 61/61; PDF continuo real |
| `node test-smoke.mjs bundle` | 17/17 |
| `node test-ui-navigation.mjs` | 15/15 |
| `node test-build-reproducibility.mjs` | 8/8 |
| H-144 y H-143 sobre GitHub Pages | 47/47 y 35/35 |
| PNG con lector independiente Python stdlib | 11/11 firmas, CRC y DEFLATE válidos |
| Build repetido | SHA-256 idéntico, 72 assets, 9.04 MB |

24 prendas con nombres/SKU largos y ornamento: 576 × 8083 puntos, data URI
445,602 caracteres. Una prenda posterior: 576 × 2008. Error medio visual
5.98–10.25/255 en los siete escenarios; diferencia de altura menor de 2 puntos.
No son píxeles RGB idénticos: el transporte es gris y el screenshot independiente
se reescala; sí conservan fuentes, cajas, orden, tamaños relativos y contenido.
BALAM QA inspeccionó los PNG finales y la comparación de Reportes con Chrome.
No se observaron recortes, controles tapados ni errores de página. Supabase
permanece interceptado en las suites; las impresoras no se contactan.

Build local SHA-256:
`a83d09a18449dd5c7f0ba52c34af69190395fad6254fb14365e0ef7e825cdeb2`.
Pages run `33996318899` publicó `61c7579` y la API reporta `built`.
El archivo servido devuelve HTTP 200 y coincide byte a byte con el blob Git:
9,041,688 bytes, SHA-256
`84a8a2f63de8ee5064ab8180a1f4ca839365239f5e87dfaae7ddbdef91ba6dd5`.
H-132 CI run `33996319818` terminó en `success`.

El primer pase público obtuvo 46/47: el arnés contaba la carga del icono PWA
generado por el logo sintético como red. Se comprobó `response.fromServiceWorker()`
para esa respuesta local; el arnés distingue cache del worker de red real y
conserva la detección de solicitudes fallidas. El pase final obtiene 47/47,
con `network: []` y el icono en la lista de cache. No se cambió el producto para
eliminar este falso positivo. La prueba H-143 pública obtiene 35/35.

## Revisión

Se modifica sólo la frontera de salida compartida y la preparación de su
consumidor con ventana propia. Los documentos y fórmulas siguen en sus
autoridades originales. No hay otra plantilla, snapshot persistido, servicio
de imágenes ni autoridad de permisos. La cache gráfica se valida por contenido
antes de cada envío y el cierre no imprime tardíamente. Las siete comparaciones
del artefacto y el PNG de Reportes corrigen la limitación de probar sólo texto
o invocaciones de impresión. Roles, reversas y multiterminal no tienen cambios
de contrato que requieran verificación remota.

## Riesgo residual y pendientes

El 05/09/2026 el usuario confirma el diseño impreso. El ancho y contraste
reportados después se atienden en `ancho-contraste-ticket-android-h145.md`;
esa corrección sustituye la escala de grises y el margen térmico descritos aquí.

La impresora térmica convierte los tonos a blanco y negro según su controlador.
Hardware, ancho configurado y ajuste físico del formato gráfico pendientes;
no se equipara una URI a papel impreso. Los documentos excepcionalmente largos
conservan la alternativa del sistema; no se afirma longitud ilimitada por
intents Android. Los logos remotos no disponibles localmente exigen la misma
alternativa. No se modificaron datos, CONFIG de producción, permisos, cola,
identidades, Excel, etiquetas ni préstamos. No hay SQL ni razón para verificar
Supabase remoto. Escritorio continúa con su PDF y autoimpresión H-135/H-85.

## Referencias

- `docs/fixes/impresion-android-rawbt-h143.md` y `ticket-termico-continuo-h135.md`.
- https://github.com/402d/DemoRawBtPrinter/blob/master/app/src/main/java/ru/a402d/demorawbt/MainActivity.java
- Contrato del autor, publicación #96: https://4pda.to/forum/index.php?showtopic=886170&st=80
- https://www.w3.org/TR/png-3/
- https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
- https://developer.chrome.com/docs/android/intents
