# Lectura desconocida y avisos legibles en POS

**Riesgo:** H-136
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 05/09/2026
**Commit:** `7889b5f120df0e6ccd4bcb0534614194a37fbe9a`

## Problema y reproducción

El usuario reportó una etiqueta nueva que escribe números sin agregar producto.
Al iniciar no se disponía del artículo/código exacto. Se reprodujo otro defecto
concreto: un V3 desconocido queda silencioso en captura global; en búsqueda
puede abrir una prenda cuyo nombre coincida con el número. Esperado: informar
sin seleccionar otra identidad. Las pruebas usan datos aislados y bloquean red
de negocio. Una consulta remota de los 16 productos recientes fue sólo lectura.

## Causa raíz

El manejador global salía al no encontrar `hit`; el directo continuaba buscando
nombre/SKU después de fallar la resolución logística. Además, `HumanMessage`
usaba texto oscuro dentro del fondo oscuro de `ToastHost`: contraste medido
1.17–2.91:1. Son defectos demostrados; no se atribuyen al incidente no identificado.

## Diseño

Resolver primero el código exacto y aliases existentes. Un V3 reconocido por
`BARCODES.parse` sin producto termina con aviso humano. La búsqueda comercial,
teclado humano y códigos históricos conservan su contrato. Sin cambio de
products.id, stock, SKU, barcode, cola offline, permisos ni migraciones.

## Solución

`balam/pos.jsx` maneja el fallo en ambas entradas. `balam/shared.jsx` añade el
mensaje con explicación/acción y variante inversa para avisos oscuros; los
mensajes inline conservan estilo. Detalles técnicos sólo para administradores.
Se regeneran los dos HTML y service worker desde fuentes.

## Pruebas

- `node test-h136-new-product-scan.mjs`: rojo inicial 8/12; verde ampliado 23/23.
  Alta desde formulario, separación de 2 de 5 piezas, etiquetas PDF, códigos
  distintos exactos, recarga con stock 3/2, fallos sin mutación, ocho tamaños
  320–1440 px, teclado humano y captura global. Contraste verde 12.10–14.63:1.
- PDF descargado contrastado mediante lector independiente ZXing; no se usa
  el texto visual como sustituto del contenido Code128.
- H-132 identidad 7/7; H-133 V3 8/8; H-130 guion 7/7; H-131 diagonal 23/23.
- H-134 mensajes 43/43 y E2E 26/26; H-109 aviso móvil 10/10.
- `node build-offline.mjs`; smoke bundle 17/17; navegación 15/15;
  `node test-build-reproducibility.mjs` 8/8 y dos builds idénticos.
- Pages `built`, HTTP 200, bytes iguales al blob Git de `index.html`;
  SHA-256 `83e7d331e50de67961109cbf10d0ca9cb90f46759cf62d5536b36716a65c4af9`.
  H-136 publicado 23/23, con red de negocio bloqueada.

## Riesgo residual y pendientes

El producto asociado a la etiqueta real sigue pendiente de identificar. Alta/traslado/etiqueta
funcionan en la reproducción aislada; no se afirma resolver ese incidente ni
certificar el lector físico. No se borraron ni modificaron datos reales.

## Seguimiento de altas futuras — 05/09/2026

El usuario proporcionó `30328899392999898742908026` y aclaró que la lectora
funciona con los demás productos. El formato numérico pertenece al barcode
interno; no sustituye el SKU comercial. Las altas guardan ambos y el lector
localiza por barcode/alias exacto. Esta ampliación no modifica hardware, formato,
SKU ni UI.

Consultas sólo lectura no encontraron ese código en productos remotos,
aliases almacenados ni filas eliminadas. Tampoco apareció en los snapshots
de inventario de Chrome examinados; esas copias no demuestran el estado que
existía durante el incidente. El registro remoto de reclasificaciones consultado
estaba vacío. No se atribuye una causa de pérdida, sincronización o lectura.

Se amplió la regresión H-136 habilitando STORE real, con red externa bloqueada:
el alta por formulario debe guardar el mismo SKU/barcode en producto local y
fila de la solicitud durable; luego separar stock, descargar etiqueta, escanear
y recargar. Resultado ampliado: 24/24. Esto comprueba futuras regresiones del
recorrido local; no certifica aceptación remota ni reproduce el incidente real.
**Commit de la ampliación:** `6673a0630ef6973863b8bd0d97f635f20d235a99`.

## Referencias

Seguimiento 05/09/2026: `sku-comercial-resumen-venta-h139.md` documenta el ciclo
por formularios con SQL aislado, decodificación independiente de PDF y recarga
con pull: 43/43 junto con H-138. La lectura agrega ambas referencias correctas;
se corrige por separado la omisión del SKU en el resumen. La cadena real sigue
sin asociar a un producto; H-136 no cambia a resuelto por esta evidencia.

- `docs/03-known-risks.md`, H-136.
- `docs/02-architecture.md`, identidad y entrada HID.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `test-h136-new-product-scan.mjs`.
