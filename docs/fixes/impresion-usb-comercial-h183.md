# Impresión USB directa de los comprobantes comerciales

**Riesgo:** H-183
**Estado:** RESUELTO EN CÓDIGO — publicación y aceptación comercial física pendientes
**Fecha:** 02/10/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El botón habitual con THERMER apagado ejecuta `host.print()` y Android ofrece
Guardar como PDF/Carta. El usuario confirmó esa acción y entregó las capturas.
La prueba independiente H-182 sí imprimió físicamente el texto completo y,
posteriormente, las dos copias con el diseño correcto según el propietario.
El contrato pendiente es utilizar ese mismo transporte en comprobantes reales.

Recorrido vigente: confirmar venta en Supabase → SuccessModal →
useReceiptAutoPrint (si print.auto) o botón receipt-print → UI.printReceipt →
PrintManager.enqueue → browser/thermer. Configuración → Impresión monta
USBPrintCheck independiente; abandonar esa tarjeta cierra el dispositivo.
Reimpresiones, apartados, abonos y devoluciones comparten UI.printReceipt.

## Causa raíz

Contrato ausente, demostrado por la selección exclusiva browser/thermer en
PrintManager y por el cierre incondicional de USBPrintCheck. No se atribuye al
ancho, al PDF ni a un fallo de impresora el centímetro de papel blanco anterior.

## Diseño

Preferencia técnica local `balam.print.usb`, activada explícitamente con una
impresora conectada. USB precede a THERMER únicamente para comprobantes
balam-ticket/balam-return-receipt; PC sin elección USB conserva su transporte.
La preferencia persiste desconectada, sin degradación silenciosa a otro destino.
No hay CONFIG sincronizada, migración ni escritura comercial nueva.

Un trabajo de PrintManager congela todas sus copias antes de cualquier espera y
utiliza receiptGraphic sin tocar plantillas ni dimensiones. print.twoCopies
controla una o dos imágenes; el caso del propietario conserva cliente/tienda.
La cola no libera el turno hasta resolver transferOut de todas las bandas.
Se mantiene la conexión al salir de Configuración cuando USB está habilitado y
el diagnóstico está inactivo; chooser/diagnóstico pendiente sí se cancela.

La impresión manual envía tras preparar el documento; print.auto solicita lo
mismo sólo desde el comprobante confirmado. Si falta conexión hay una acción
con gesto «Conectar e imprimir». Android puede pedir permisos; nunca se solicita
selector automáticamente. PWA debe permanecer abierta y CORE registra actividad
hasta concluir/cancelar cada trabajo. No se guarda cola ni contenido comercial.

Una bandera técnica durable marca envío iniciado/incierto y se limpia sólo tras
transferencia completa o reconocimiento explícito de reinicio físico. Una salida
parcial bloquea nuevos envíos hasta reinicio y reconexión, no reintenta ni abre
PDF/THERMER. El estado UNCERTAIN conserva progreso y no equivale a NOT_SENT.
La confirmación humana de cierre de diálogo no puede terminar un trabajo USB.

## Solución

`shared.jsx` elige USB local antes de THERMER y conserva el hook de cobro
confirmado. `print-manager.jsx` añade la ruta USB agrupada, progreso, suspensión
tras fallo y actividad CORE; `usb-receipt.js` añade elección local y cuarentena
durable. `usb-print-check.jsx` administra modo/conexión y conserva las pruebas.
`settings.jsx` explica la precedencia, autoimpresión y copias. El build regenera
ambos HTML y SW; no se modifican las plantillas ni el renderer de tickets.

La revisión independiente ejecutó además 14 aserciones de cola, exclusión,
cancelación, actividad y salida incierta sobre PrintManager en VM, sin encontrar
defecto bloqueante. La recuperación en Configuración permite conectar/reconocer
reinicio aunque haya un trabajo esperando, sin autorreanudarlo.

FF-01/02: contrato de salida ausente, no negocio nuevo. FF-03/04: documento
histórico y renderer existentes siguen siendo autoridades; ambas copias se
congelan antes de esperar. FF-05/06/07: la costura es PrintManager y todos sus
comprobantes; cada cola es local, una segunda terminal conserva su destino.
FF-08: documentos y negocio confirmados no cambian. FF-09: mismos permisos de
venta/Configuración, sin nuevas facultades para anónimos o perfiles inactivos;
SQL/RLS/service_role no aplican porque no hay operación remota nueva. FF-10/11:
se ejercen tarjeta real, hook automático y botón manual con artefactos completos
y frontera USB, no sólo contadores. Aprendizaje: una conexión persistente debe
conservar también su incertidumbre tras recarga y no depender de la pantalla
que la abrió; ambas defensas quedan automatizadas.

## Pruebas

- `node test-h183-usb-receipts.mjs --baseline`: 0/1 sobre `2a3ce65:index.html`.
  USB conectado/selección local sembrada: dos diálogos del sistema y cero bytes
  USB. Se conservan dos documentos completos de 80 mm y el negocio intacto.
- `node test-h183-usb-receipts.mjs`: 16/16. Auto y manual, una/dos copias,
  comparación completa PNG/raster por píxel, hashes, consecutivos, doble toque,
  origen desmontado, permiso bajo gesto, cancelación, desconexión sin fallback,
  UNCERTAIN en segunda copia, cola detenida al reconectar y liberación CORE.
  Normal: dos PNG 576×2538; largo: dos 576×4849, 700715 bytes entregados; una
  copia 576×2432; siguiente en cola dos 576×2810. PC y THERMER preservados.
- Guardián refijado en el instrumento: cero diálogos y cero clics posteriores al
  comprobante automático (clics DOM reales), frente a dos diálogos de la línea
  base. Mantiene dos copias íntegras, negocio intacto y physicalPrintConfirmed
  false; falla si empeoran coste, garantías o completitud.
- `node test-h182-webusb.mjs`: 32/32, incluida denegación de almacenamiento,
  bandera antes del byte, recarga incierta, cierre rechazado, parciales y timeout.
- `node test-h182-webusb-ui.mjs`: 13/13 sobre bundle final. Tarjeta real,
  persistencia local/navegación y recursos; dos trabajos completos de dos copias:
  576×2477 (357963 bytes) y 576×5752 (831195 bytes). Capturas 360/390/1024
  inspeccionadas: controles legibles y sin desbordamiento.
- `node test-h181-thermer.mjs`: 16/16 sobre bundle final. La primera ejecución
  concurrente dio 14/16: el arnés adelantaba sólo el reloj cliente, mientras el
  servidor congelado devolvía una URL ya vencida, creando otra renovación al
  segundo. Reproducido en HEAD y código nuevo con el mismo instrumento: tres
  intentos frente a dos esperados. Se coordina `backend.advance(600001)` y se
  restaura Date.now con finally: dos intentos, aserciones originales conservadas.
  No se modifica el manejo de relojes del producto ni el servicio THERMER.
- `node test-h164-online-ui.mjs`: 6/6; `node test-h164-online-pwa.mjs`: 2/2;
  arquitectura online: PASS; `node test-h164-online-settings.mjs`: 3/3;
  `node test-h180-system-print.mjs`: 18/18. Todos sobre fuentes/bundle finales.
  CI se ejecutará antes de Pages. Comando inicial `test-settings.mjs` inexistente
  sustituido por el arnés vigente, sin cambios de producto por ese error de ruta.

Evidencia versionada: `evidence/h183-commercial-baseline.json`,
`h183-commercial-final.json`, `h183-usb-transport.json`, `h183-usb-ui.json`.
SHA-256 del HTML final probado:
`807f92ab9173084076d0c65a919f4ca319f275fa51609ac15cb2dafba2a10a1e`.

## Despliegue

Pendiente de commit y workflow Pages. No requiere migración ni cambios remotos.

## Riesgo residual y pendientes

Diagnóstico H-182 aceptado físicamente por el usuario. Integración comercial nueva
HARDWARE NOT_TESTED; pruebas locales usan USBDevice simulado. No certificación
distribuida A/B/C, no solicitada. Permisos nativos pueden reaparecer al reconectar.

## Referencias

- `docs/03-known-risks.md`, H-183 y H-182.
- `docs/fixes/prueba-usb-pwa-h182.md`.
- `docs/02-architecture.md`, transporte de comprobantes.
