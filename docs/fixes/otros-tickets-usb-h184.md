# USB directo en los demás tickets térmicos

**Riesgo:** H-184
**Estado:** PARCIALMENTE RESUELTO — código verificado; publicación y aceptación física pendientes
**Fecha:** 02/10/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario confirmó la impresión física correcta de venta USB y pidió revisar
los demás tickets. Todos los comprobantes comerciales existentes pasan por
`UI.printReceipt` y usan `BalamTicket` o `BalamReturnReceipt`. El reporte de
métodos de pago también es térmico de 80 mm, pero su raíz es
`main[data-payment-method-ticket="true"]`, excluida de la selección USB.
`node test-h184-all-thermal.mjs --baseline`: 0/1 sobre el HTML de `ef97003`.
Pantalla Reportes y popup reales, USB conectado/seleccionado: un diálogo del
sistema, cero transferencias USB; una copia de 80 mm y datos conservados.

## Causa raíz

La selección de transporte en `PrintManager.enqueue` utiliza los dos IDs de
comprobantes comerciales como si fueran el conjunto de todos los tickets
térmicos. El botón `payment-ticket-print` entrega explícitamente su elemento
y ventana, pero ese documento termina en `host.print()` con USB habilitado.
No es un problema de diseño, tamaño, cálculo ni datos de la impresora.

La revisión reprodujo además una frontera de permisos: la ventana del reporte
tiene `opener=null`. Tras expirar el gesto inicial (6 segundos), pulsar dentro
del popup activa sólo ese popup, no la ventana principal propietaria de USB.
Ofrecer allí «Conectar e imprimir» produciría `USB_GESTURE` al desconectarse.

## Diseño

Ampliar sólo la elegibilidad USB con la raíz explícita del reporte por método.
Reutilizar el snapshot, renderer y transporte de H-183. Mantener los dos IDs
como autoridad de copias cliente/tienda: el reporte sigue saliendo una vez,
sin marcas comerciales. A4, préstamos en hoja y etiquetas conservan su ruta.
El reporte se imprime al pulsar su botón; no se añade impresión al abrirlo.
Si falta conexión mientras se ve el popup, su aviso permite volver a BALAM;
la conexión se autoriza con un toque en la ventana principal. Cerrar la vista
no cancela el documento ya congelado ni lo reenvía. La sesión USB mantiene
un solo propietario y no depende de la vida del popup.

Ningún cambio en DATA, CONFIG, AUTH, STORE, SQL, roles, persistencia comercial
ni documentos históricos. Mismos controles de conexión, permisos, exclusión,
incertidumbre y recursos. Una selección USB desconectada espera reconexión,
sin degradación a PDF o THERMER. No hay red ni escritura de negocio nueva.

## Solución

`balam/print-manager.jsx` distingue documentos USB de comprobantes con copias
comerciales. Incluye la raíz térmica por método, conserva el resto de destinos y
pasa el contexto de la ventana a PrintStatus. Sólo el aviso de una ventana
externa sin conexión ofrece «Volver a BALAM para conectar»; la principal ofrece
la autorización existente y mantiene el trabajo congelado. Artefactos
regenerados con `node build-offline.mjs`; plantillas y renderer sin cambios.

| Tipo | Entrada existente | Copias con ajuste doble |
|---|---|---|
| Venta, mixto y cortesía | POS / BalamTicket | Cliente y tienda |
| Apartado inicial / anticipo | POS / BalamTicket | Cliente y tienda |
| Abono y liquidación | Apartados / ReciboModal | Cliente y tienda |
| Cambio con o sin cobro | Posventa / ExchangeReceipt | Cliente y tienda |
| Devolución | Posventa / BalamReturnReceipt | Cliente y tienda |
| Reimpresión de apartado/último pago | Apartados / TicketPrint | Cliente y tienda |
| Reimpresión de venta histórica | Reportes / ReprintSaleModal | Cliente y tienda |
| Reporte por método de pago | Reportes / ventana térmica | Una copia |

Los siete primeros tipos ya seleccionaban USB desde H-183; H-184 los verifica
sin reescribir sus pantallas. Reimpresiones conservan su disparo al abrir;
comprobantes nuevos conservan `print.auto`. No se crean rutas de reimpresión
histórica de cambios/devoluciones que el sistema no ofrezca.

FF-01/02: cobertura incompleta del transporte, no una regla de negocio nueva.
FF-03/04: PrintManager decide el destino y captura el snapshot existente;
DATA.paymentMethodReport sigue siendo la única autoridad de las cifras.
FF-05/06/07: misma costura para comprobantes y reporte térmico, selección local,
otra terminal mantiene su destino; reportes en hoja y etiquetas fuera.
FF-08/09: datos históricos, roles y capacidades comerciales intactos; SQL/RLS y
service_role no aplican porque no hay nueva operación remota. FF-10/11: prueba
del popup real y sus gestos, reimpresiones reales, PNG completo y frontera USB.
Aprendizaje: verificar sólo el ID del ticket de venta omite documentos térmicos
con otra raíz; el inventario completo queda protegido por la regresión H-184.

## Pruebas

- Línea base `node test-h184-all-thermal.mjs --baseline`: **0/1** sobre
  `ef97003`, HTML SHA `807f92ab9173084076d0c65a919f4ca319f275fa51609ac15cb2dafba2a10a1e`.
  Reportes → Métodos de pago → vista térmica → botón real: USB conectado y
  activado, pero un diálogo del sistema y ninguna transferencia USB.
- El instrumento cuenta clics DOM confiables en la vista ya abierta, no
  estimaciones: antes un clic/un diálogo, después un clic/cero diálogos. Exige
  simultáneamente copia única de reporte, negocio intacto, estado físico honesto,
  completitud y PNG/raster idénticos. Fija cero diálogos como límite explícito.
- `node test-h184-all-thermal.mjs`: **15/15** en Chromium 1223
  (148.0.7778.96), con USBDevice simulado. Reporte normal/reimpreso/con ventana
  cerrada y reconectado: 576×1789, 129276 bytes, una copia íntegra. Apartado,
  anticipo, abono, liquidación, cambio cobrado/con sobrante/igual, devolución y
  las dos reimpresiones reales entregan ambas copias completas. Cada píxel se
  compara contra el PNG del renderer y cada hash contra su snapshot. A4 sigue
  enviándose al sistema. Sin mutaciones comerciales ni recursos pendientes.
  Inspección visual de reporte, abono y cambio: bloques y pie completos.
- `node test-h183-usb-receipts.mjs`: **16/16**, incluido automático, dos copias,
  largo, consecutivos, parcial incierto, cancelación, desconexión y recursos.
  Evidencia `h184-usb-regression.json`; la evidencia histórica H-183 se conserva.
- `node test-h180-system-print.mjs`: **18/18**. Primera ejecución: 15/18 por
  ENOSPC al guardar HTML y un timeout posterior. Se comprimieron/verificaron
  exclusivamente archivos temporales de pruebas H-180 y se deduplicaron copias
  byte a byte idénticas, preservando resultados; la repetición completa pasó sin
  modificar el producto.
- `node test-h164-online-ui.mjs`: **6/6**;
  `node test-h164-online-pwa.mjs`: **2/2**. Build correcto; revisión independiente
  del diff sin hallazgos bloqueantes. Las pruebas usan el artefacto distribuido.
- Reproducción independiente de gesto en popup: **3/3**, Chrome real, sin
  dispositivo USB. Sólo el popup recibe activación tras el clic; evidencia
  `h184-popup-gesture.json`. La matriz integrada verifica el regreso a BALAM.

Los documentos de prueba se siembran como confirmados, con importes y pagos
coherentes; no se ejecutan RPC comerciales. Se validan etiquetas/importes
seleccionados y la integridad total de las imágenes, no se recertifican reglas
financieras. Se corrigió el instrumento para observar activación sin concederla
(`Runtime.evaluate` sin userGesture), medir clics reales y conservar la relación
del pago con el folio del cambio y el método de la venta original.

SHA-256 del HTML probado:
`857f07700fb0a793986cb472a1da24f26a1a5dddb61dbc1068ed036b5530218a`.
Evidencia en `docs/fixes/evidence/h184-*.json`.

## Despliegue

Pendiente de commit y workflow. Sin migraciones ni escrituras de negocio.

## Riesgo residual y pendientes

La venta fue aceptada físicamente por el usuario. Los demás tipos de ticket
siguen HARDWARE NOT_TESTED; la simulación no acredita papel ni corte físico.

## Referencias

- `docs/03-known-risks.md`, H-184.
- `docs/02-architecture.md`, transporte de comprobantes.
- `docs/fixes/impresion-usb-comercial-h183.md`.
- `docs/fixes/copias-cliente-tienda-h179.md`.
- `docs/fixes/autoridad-monetaria-y-reporte-por-metodo.md`.
