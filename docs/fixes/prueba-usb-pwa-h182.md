# Prueba de impresión USB directa desde BALAM PWA

**Riesgo:** H-182
**Estado:** RESUELTO EN SU ALCANCE — diagnóstico publicado; texto y diseño aceptados por el usuario
**Fecha:** 02/10/2026
**Commit:** `6f509a7e46872be11e7cd451c4334537b330e48b`

## Problema y reproducción

El usuario necesita dos copias por USB END-80TEUX conservando el diseño actual.
Prefiere PWA y autoriza una prueba acotada antes de integrar impresión comercial.
THERMER imprime texto e imágenes de galería, pero Browser Print no imprime los
tickets. La tablet no está disponible durante el desarrollo.
Antes del cambio, PrintManager sólo ofrece browser y thermer: no hay acceso USB
directo desde BALAM. Es un contrato ausente, no una causa demostrada del fallo físico.
Línea base `node test-h182-webusb.mjs --baseline`: 0/1, módulo ausente en HEAD.
La prueba lee el commit anterior aunque haya nuevas fuentes en el workspace.

## Causa raíz

La PWA existente delega a otro proceso. Instalarla no añade por sí mismo acceso
USB ni transforma window.print en impresión directa. WebUSB permite probar una
frontera local explícita; su disponibilidad en END-80TEUX aún no está demostrada.

## Diseño

Recorrido existente: Configuración → sección Impresión (permiso config.impresion)
→ ajustes e historial. Se añade una tarjeta independiente con conectar bajo
gesto, texto ficticio, ticket ficticio cliente/tienda y desconectar. BalamTicket
es la autoridad del diseño; captureReceipt congela ambas copias y receiptGraphic
produce los PNG originales de 576 puntos para el papel de 80 mm. No se monta
ReceiptPrintHelp ni useReceiptAutoPrint en el diagnóstico.

Se selecciona una interfaz printer/vendor con endpoint bulk OUT real, sin
inventar VID/PID, configuración ni endpoint. Un único trabajo por conexión;
transferencias secuenciales comprobando status y bytesWritten. Raster ESC/POS
GS v 0, escala 1:1, bandas de 32 filas sin espacios entre bandas. Ancho del
comando en bytes: 72 para 576 puntos. Avance/corte sujeto a aceptación física.
Todo fallo después de iniciar salida detiene el trabajo sin reenvío; exige
reiniciar físicamente la impresora antes de otra prueba. ESC @ no vacía el
buffer de recepción y no constituye recuperación de un raster interrumpido.

No hay cola durable, escritura comercial, SQL, nuevos permisos ni URLs de
descarga. El soporte USB se libera al salir, desconectar o fallar; una respuesta
tardía no resucita la sesión. La compatibilidad del navegador, permisos de
Android, impresión con PWA abierta y firmware son condiciones verificables,
no garantías implícitas. No se afirma optimización comercial antes de probarla.

## Solución

- `balam/usb-receipt.js`: selección explícita, apertura exclusiva, descriptores
  reales, estado efímero, raster 1:1 y envío secuencial. Verifica cada bloque
  completo, detiene ante error y conserva exclusión durante operaciones nativas
  pendientes. No reenvía después de timeout ni confunde recepción con papel.
- `balam/usb-print-check.jsx` y tarjeta en `settings.jsx`: prueba sintética,
  botones accesibles, estado visible, cancelación y detalles sanitizados. Ambas
  capturas ocurren antes de esperar; el portal se desmonta inmediatamente.
  Desmontaje de pantalla aborta renderizado e invalida selección pendiente.
- Source HTML incorpora los módulos; build regenera ambos HTML y SW. Workflow
  exige transporte y raster completos además de regresiones existentes.

La revisión independiente reprodujo un cierre USB rechazado que dejaba el
handle abierto pero permitía reconectar. Se corrigió antes de publicar: el
handle permanece retenido y bloquea nuevos trabajos/reconocimiento de reinicio
hasta un cierre exitoso o evento real de desconexión. También se distingue
cancelación del selector de desconexión posterior. No se atribuyen estos
defectos del prototipo al fallo anterior de THERMER.

Las preguntas FF se resuelven por estos contratos: FF-01/02 describen una nueva
salida para un comprobante existente, no un nuevo negocio. FF-03/05/07 mantienen
BalamTicket y receiptGraphic como autoridades, y separan diagnóstico de la cola
comercial. FF-04/06 congelan copias y excluyen intercalación; FF-08 preserva
artefactos e históricos, regenerando sólo la distribución. FF-09 utiliza la
sección autorizada de Configuración sin cambiar permisos; políticas SQL y
service_role no aplican porque no hay operación remota. FF-10 exige bytes y
píxeles completos, FF-11 recorre la tarjeta real de Configuración y su limpieza.
Como aprendizaje, un fallo de close no puede contarse como recurso liberado;
el arnés queda como defensa permanente sin añadir un playbook duplicado.

## Pruebas

- `node test-h182-webusb.mjs --baseline`: 0/1, ausencia del transporte.
- `node test-h182-webusb.mjs`: 25/25. Permiso/gesto, descriptores no triviales,
  ambigüedad, exclusión, texto consecutivo íntegro, salida parcial con progreso
  exacto, stall, timeout, llegada tardía, desconexión, cierre rechazado y reinicio
  explícito. Sin red ni persistencia. Evidencias `h182-usb-baseline.json` y
  `h182-usb-final.json` en `docs/fixes/evidence/`.
- `node test-h164-online-ui.mjs`: 6/6; `node test-h164-online-pwa.mjs`: 2/2.
- `node test-h180-system-print.mjs`: 18/18; `node test-h181-thermer.mjs`: 16/16.
  Ambos terminaron con exit 0 y cierre normal de navegador. Sin cambios en
  `pos-ticket.jsx`, `shared.jsx` ni `print-manager.jsx`.
- `node test-h164-online-architecture.mjs`: PASS; settings 3/3; build PASS.
- `node test-h182-webusb-ui.mjs --baseline`: 0/1 por ausencia del módulo en el
  artefacto anterior. `node test-h182-webusb-ui.mjs`: 10/10 en Configuración real.
  Dos copias 576×2477 y segundo trabajo largo con dos copias 576×5752: todos
  los píxeles del PNG comparados contra el flujo ESC/POS reconstruido; 357,963
  y 831,195 bytes respectivamente. No sólo se contaron llamadas.
  Selector bajo gesto, doble toque, salida parcial en segunda copia sin otro
  corte, reinicio explícito, fallo de renderer, cancelación y limpieza. Sin
  mutaciones comerciales ni THERMER/print(). Responsive 360/1024, capturas
  inspeccionadas. Evidencias `h182-ui-baseline.json` y `h182-ui-final.json`.

Los arneses UI/PWA/impresión anteriores prueban el HTML
`db52796b32ba70bc146dc3d174a5c4ccee851a0a424a866e585527c021dde696`.
HARDWARE NOT_TESTED. No certificación A/B/C solicitada.

## Despliegue

Publicado por Actions
[36965972877](https://github.com/David14081982/POS_Balam/actions/runs/36965972877):
regresión y despliegue SUCCESS; A/B/C omitida, no solicitada. Verificación HTTP
a las 04:56:14 UTC del 02/10/2026 (01/10 en Hermosillo): `index.html`, HTML
offline y `sw.js` coinciden byte por byte con el commit probado. HTML 9,380,841
bytes, SHA-256 `db52796b32ba70bc146dc3d174a5c4ccee851a0a424a866e585527c021dde696`.
Evidencia: `docs/fixes/evidence/h182-deploy.json`. No se aplicó SQL, Edge Function,
cambio de permisos ni configuración remota.

Uso previsto: actualizar BALAM en Chrome de la tablet y abrir Configuración →
Impresión → Prueba de impresión por USB. Conectar END-80TEUX y aceptar permisos;
primero texto, después dos tickets de prueba. Mantener BALAM abierta. No hace
falta activar THERMER para esta tarjeta. Salir de la sección libera USB.

## Riesgo residual y pendientes

El 02/10/2026 el propietario conectó la tablet/END-80TEUX con el selector USB
de BALAM, entregó una foto de las tres líneas de texto completas y confirmó
«sí salieron con el diseño correcto» después de pulsar dos tickets de prueba.
Esta es aceptación física aportada por el usuario, no una prueba local del agente.
La integración en venta y cobro automático continúa en H-183.

Corte, trabajos consecutivos y reconexión físicos quedan pendientes de evidencia.
Los resultados de transferOut no demuestran papel. La versión original H-182 no
activaba esta salida automáticamente en ventas; H-183 amplía ese alcance. La prueba
puede requerir cerrar otras apps que tengan ocupada la interfaz; Windows puede
tener un controlador que impida el acceso que Android permita. Una prueba en
laptop no certifica la tablet. No se promete ejecución con la PWA cerrada, un
permiso permanente, ni compatibilidad de firmware sin aceptación física.

## Referencias

- H-181, H-180, H-179 y H-153; `docs/02-architecture.md`.
- https://developer.chrome.com/docs/capabilities/usb
- https://developer.chrome.com/docs/capabilities/build-for-webusb#android
- https://wicg.github.io/webusb/
- https://www.enduropos.com/product/impresora-termica-80mm/
- https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html
- https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html
