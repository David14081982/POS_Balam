# Lectura desconocida y avisos legibles en POS

**Riesgo:** H-136
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 05/09/2026
**Commit:** `7889b5f120df0e6ccd4bcb0534614194a37fbe9a`

## Problema y reproducción

El usuario reportó una etiqueta nueva que escribe números sin agregar producto.
No se dispone todavía del artículo/código exacto. Se reprodujo otro defecto
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

La etiqueta real reportada sigue pendiente de identificar. Alta/traslado/etiqueta
funcionan en la reproducción aislada; no se afirma resolver ese incidente ni
certificar el lector físico. No se borraron ni modificaron datos reales.

## Referencias

- `docs/03-known-risks.md`, H-136.
- `docs/02-architecture.md`, identidad y entrada HID.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `test-h136-new-product-scan.mjs`.
