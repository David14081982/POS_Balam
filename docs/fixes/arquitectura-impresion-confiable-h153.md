# Impresión consecutiva con documento aislado y ciclo controlado

**Riesgo:** H-153
**Estado:** RESUELTO EN SOFTWARE — publicación pendiente; hardware NOT_TESTED
**Fecha:** 10/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario reporta tickets consecutivos incompletos. Se parte de `9b7dcbe`
(`origin/main`) en `C:/tmp/balam-h153-print`, rama `fix/h153-print-lifecycle`.
La carpeta original permanece en `dc74757` con trabajo ajeno intacto.
La publicación inicial conserva el artefacto de H-152, cuya última revalidación
vive en `revalidacion-impresion-2026-09-09.md`.

`node test-h153-print-races.mjs` reproduce **0/3** sobre el código anterior:
capturar A y sustituir inmediatamente su DOM por B produce el PNG de B;
tres solicitudes entregan tres intents sin regreso y tres llamadas nativas
sin cierre de diálogo. Son carreras equivalentes demostradas, no evidencia
de que el hardware haya cortado un ticket específico por esa causa.

## Causa raíz

`prepareReceipt` registraba el HTML de A como clave, pero `receiptGraphic`
clonaba el elemento vivo después de esperar recursos. Clave y contenido podían
pertenecer a documentos distintos. `printReceipt` terminaba al llamar `print`
o pulsar el enlace de Android: no había trabajo identificable ni exclusión hasta
una señal de finalización. Apartados además desmontaba el documento inmediatamente
después de invocar impresión. Listados de Apartados y Préstamos cerraban sus
ventanas por tiempo, independientemente del estado del diálogo.

La revisión agrega un caso rojo **11/12**: Reportes se pulsa en una ventana hija
con gesto activo, pero el padre ya perdió su activación. Consultar el gesto del
padre bloqueaba el intent legítimo. El adaptador ahora usa la ventana que recibió
el gesto; la prueba final de errores da **12/12**. No usa esperas para conservarlo.

No se encontraron comandos ESC/POS, CUT, WebUSB, WebSerial, Bluetooth directo,
socket, QZ ni colas del dispositivo dentro del código de BALAM. No hay evidencia
para afirmar intercalación de CUT ni atribuir el síntoma a Bluetooth o hardware.

## Inventario y ciclo anterior

Consulta reproducible: `rg -n 'print|Print|imprimir|iframe|RawBT|copies|copias|PDF|canvas|toDataURL|createObjectURL|afterprint|beforeprint' balam -g '!vendor/**'`.
Se revisan llamadas y consumidores; menciones de ticket promedio, exportación
Excel e imágenes de catálogo no son transportes de impresión.

| Sección / botón | Archivo / entrada | Documento y render autorizado | Transporte anterior / plataforma | Copias y fin anterior | Riesgo |
|---|---|---|---|---|---|
| POS / Imprimir ticket, automática | `pos.jsx` / `SuccessModal`, `useReceiptAutoPrint` | `BalamTicket` en `pos-ticket.jsx` | navegador escritorio/PDF; PNG RawBT Android | Una por pulsación; timers automáticos; sin señal de fin | DOM mutable y solapamiento |
| Reportes / Historial / Reimprimir | `reports.jsx` / `ReprintSaleModal` | `BalamTicket` histórico | mismos dos transportes | auto al abrir en escritorio y manual | auto/manual sin exclusión |
| Apartados / Reimprimir | `layaway.jsx` / `Reimpresion` | `BalamTicket` + último pago | navegador directo; RawBT manual | una; escritorio desmonta tras `print()` | destrucción prematura |
| Apartados / Abonar o liquidar / comprobante | `layaway.jsx` / `ReciboModal` | `BalamTicket` + pago congelado | navegador / RawBT | una, automática según CONFIG | frontera compartida sin ciclo |
| Cambios / comprobante | `returns.jsx` / modal de éxito | `BalamTicket` + exchange | navegador / RawBT | una por solicitud | misma frontera |
| Devoluciones / comprobante | `returns.jsx` / acuse | `BalamReturnReceipt` | navegador / RawBT | una por solicitud | misma frontera |
| Reportes / ticket por método | `reports.jsx` / `openPaymentMethodTicket` | snapshot `paymentMethodReportView`, HTML propio | ventana propia, navegador / RawBT | manual; ventana hasta cierre humano | comparte transporte; tamaño `80mm auto` inválido para PDF |
| Reportes / Resumen / Imprimir y PDF | `reports.jsx` / `openReportDocument` | HTML A4 propio con snapshot | navegador, ambas plataformas | una; timer 100 ms, sin fin | envío antes de recursos |
| Reportes / Métodos / Imprimir y PDF | mismas funciones | snapshot financiero H-90 | navegador A4 | una; timer 100 ms | mismo ciclo |
| Apartados / Imprimir listado | `layaway.jsx` / `imprimirListado` | `filaExport`, HTML A4 horizontal | navegador | una; onload + cierre 400 ms | cierre no confirmado |
| Préstamos / Vale | `loans.jsx` / `imprimirVale` → `abrirImpresion` | HTML de préstamo congelado | navegador A4 | una; onload + cierre 400 ms | mismo cierre |
| Préstamos / Listado | `loans.jsx` / listado → `abrirImpresion` | HTML A4 horizontal | navegador | una; mismo cierre | mismo cierre |
| Inventario / Etiquetas | `inventory.jsx` / `LabelsModal`, generador HTML/PDF | `BARCODES`, PNG certificado por referencia | ventana nativa propia; descarga PDF/PNG | copias configuradas o stock dentro del mismo documento; cierre manual | independiente; no rediseñada |

Los seis comprobantes comerciales usan rollo 80 mm, altura variable y recursos
locales: logo, fuentes y decoraciones SVG/HTML existentes. RawBT recibe 576 px,
tinta negra/blanca y altura proporcional; límite vigente 24,000 px y URI de
500,000 caracteres. Ticket por método usa 80 mm y fuentes Arial, sin logo.
A4 usa 210×297 mm (o apaisado), fuentes del sistema, sin raster térmico.
Etiquetas conservan 60×40 mm, PNG/barcode propios y páginas por copia.

**Tres copias antes:** BALAM no tenía selector de copias térmicas. Tres clics
RawBT eran **tres handoffs sin confirmación** (D). Tres solicitudes nativas
eran llamadas independientes sin exclusión. Las copias seleccionadas dentro del
diálogo o RawBT pertenecen al driver y BALAM no puede observar su número.
El selector de Etiquetas sí repite elementos dentro de un único documento.
No se altera ningún número de copias requerido por negocio.

## Diseño

La primera capa corregida es captura/ciclo de salida, no documentos ni finanzas.
`UI.printReceipt` delega a `PrintManager.enqueue`. El Print Job congela HTML,
CSS, texto, ID documental, tipo, sección y copia antes de cualquier await.
La preparación anticipada H-144 también clona antes de leer recursos. Renderer
reutiliza exclusivamente la plantilla autorizada, espera fuentes e imágenes y
produce un Payload completo o un error. No hay plantilla financiera nueva.

La Queue conserva un solo trabajo activo. Cada Native Payload dispone de su
iframe propio sin scripts y con modales permitidos; se mide una página térmica
de 80 mm con altura explícita y 1 mm de resguardo. A4 conserva su CSS. Los PNG
son cadenas inmutables independientes. Preparar B no recicla recursos de A.

Browser Transport conserva el frame hasta `afterprint` y el retorno de la
llamada. Si el navegador no notifica, el operador puede indicar «Ya cerré el
diálogo». Android Transport entrega un único intent desde gesto; mantiene
exclusión hasta observar ocultamiento→visibilidad o «Ya regresé de impresión».
El siguiente PNG exige otro gesto. «No se abrió» permite reintento explícito.
Ninguna continuación asíncrona ni timer abre RawBT.

**Handoff no equivale a Physical confirmation.** `afterprint` tampoco distingue
imprimir de cancelar en el diálogo. Los resultados registran diálogo terminado,
regreso de aplicación o confirmación del operador, siempre con confirmación
física falsa. No existe acuse de papel por estos transportes. La confirmación
manual es una declaración del operador, no detección automática del dispositivo.

Cancellation retira un trabajo todavía no enviado y aborta recursos pendientes
cuando ninguna otra copia los necesita. Un evento tardío de recursos no puede
reactivar un trabajo cancelado. No pretende retractar uno
ya entregado. Retry reutiliza el payload preparado cuando existe, o vuelve a
preparar el mismo snapshot, nunca la venta o catálogo actuales. Un error no
crea ni modifica documentos comerciales. Cerrar un modal o cambiar pantalla
no pierde una solicitud ya creada. Una recarga comienza sin replay automático;
el historial y solicitudes de impresión son de esta sesión, separados de la
cola durable de negocio. No se cambia la recuperación del escritor H-147.

El diagnóstico mantiene hasta 100 trabajos, hashes de documento/render/payload,
etapas, tiempos, dimensiones, resultado y error sanitizado. Nunca guarda nombres
de clientes, teléfonos, tokens ni contenido del documento en el historial.
Administración puede consultar el historial en Configuración → Impresión y
desplegar detalles técnicos; las acciones del vendedor usan lenguaje humano.

## Solución

`shared.jsx` conserva la autoridad de raster y prepara snapshots aislados;
`print-manager.jsx` coordina ciclo y adaptadores. Los puntos directos de Reportes,
Apartados y Préstamos pasan por esa misma frontera, conservando sus documentos.
`pos-ticket.jsx` sólo añade metadatos inertes; fórmulas y contenido intactos.
Configuración añade el diagnóstico de sesión. Fuentes regeneran los artefactos.

V1/V2 e históricos siguen en sus plantillas y snapshots; no cambian products.id,
stock, pagos, permisos, DATA/STORE, SQL, cola offline, Excel, barcodes ni etiquetas.
Impresión es una salida local: no es una nueva función distribuida ni necesita
migración o escritura remota. Se ejecutan regresiones H-148 sin presentarlas
como una nueva certificación de convergencia A/B/C de la flota.

## Pruebas

H-153: **80/80** en Chromium, Android emulado con gesto y transporte interceptado.
La primera ejecución conservó 32 artefactos y pasó 32/32. La ejecución posterior
evita PDF duplicados de idéntico hash: **26/26** archivos, 16 PNG y 10 PDF;
todos los envíos siguen comparándose individualmente con su SHA-256 preparado.
El lector independiente valida PNG (firma, CRC, DEFLATE, dimensiones, sólo 0/255
y margen final) y PDF (una página, 80 mm, ninguna palabra fuera de página,
último artículo y pie).
Inspección visual de devolución PDF y ticket largo Android sin recortes.
Comandos reproducibles: `test-h153-print-races.mjs`,
`test-h153-print-lifecycle.mjs`, `test-h153-print-errors.mjs` y
`test-h153-artifacts.py <directorio> [PyMuPDF]`.

| Suite ejecutada (`node <archivo>`) | Resultado |
|---|---:|
| `test-h153-print-races.mjs` | 3/3; base anterior 0/3 |
| `test-h153-print-lifecycle.mjs` | 80/80 |
| `test-h153-print-errors.mjs` | 12/12 |
| `test-h135-continuous-ticket.mjs` | 61/61 |
| `test-h143-android-tickets.mjs` | 41/41; H-145/H-146 y ocho anchos incluidos |
| `test-h144-ticket-design.mjs` | 61/61 |
| `test-h147-local-writer-resume.mjs` | 16/16 |
| `test-h148-reconciliation.mjs` | 15/15 |
| `test-h148-projection-durability.mjs` | 32/32 |
| `test-h148-sync-certification.mjs --self-test` | 20 certificados falsos rechazados; no certifica flota real |
| `test-store-queue.mjs` | 186/186 |
| `test-sale-coherence.mjs` | 20/20 |
| `test-returns.mjs` | 21/21 |
| `test-cambio-e2e.mjs` | 37/37 |
| `test-h73-comprobante-del-cambio.mjs` | 29/29 |
| `test-layaway-screen.mjs` | 55/55 |
| `test-loans-screen.mjs` | 117/117 |
| `test-commission.mjs` | 10/10 |
| `test-h85-receipts.mjs` | 20/20 |
| `test-h90-payment-method-ticket.mjs` | 17/17 |
| `test-h90-payment-method-ticket-e2e.mjs` | 21/21 |
| `test-role-access.mjs` | 15/15 |
| `test-module-contracts.mjs` | 42/42 |
| `test-h127-code128-physical-authority.mjs` | 9/9 |
| `test-h132-inventory-identity-certification.mjs` | 7/7 |
| `test-h133-inventory-v3.mjs` | 8/8 |
| `test-h99-label-pdf.mjs` | 23/23 |
| `test-xlsx-security.mjs` | 17/17 |
| `test-smoke.mjs bundle` | 17/17; fuente de desarrollo adicional 15/15 |
| `test-ui-navigation.mjs` | 15/15 |
| `test-build-reproducibility.mjs` | 8/8 |

`node build-offline.mjs`: 73 recursos, bundle de 9.06 MB, sin dependencias nuevas.
QA actualizada en `AGENTS.md` y skill `balam-qa`; `quick_validate.py`: válida.
La descarga de PyYAML para ese validador vive sólo en un directorio temporal.

Los arneses históricos que simulaban `window.print` o ventanas sin DOM se
adaptan a la frontera real de iframe mediante `test-print-transport.mjs`.
El arnés captura el HTML entregado y emite `afterprint`; la matriz H-153 retiene
esa señal para verificar exclusión. Sus PDF se generan desde ese HTML exacto.
H-147 encontraba el gate de recuperación H-149 incluso sobre la base anterior;
su fixture declara sólo recuperación terminada, conservando Web Locks, DATA y
las 16 verificaciones reales de escritor. H-144 usa un getter de configuración
sintético para el logo, pues el setter administrativo rechaza una sesión sin
autenticación. Ninguna de esas adaptaciones modifica autorización productiva.

## Revisión y entrega

La autoridad financiera sigue siendo el documento histórico; el nuevo concepto
es una solicitud local de salida. La extensión deliberada es el adaptador de
transporte, no el catálogo ni el generador de etiquetas. La cola controla los
consumidores inventariados y sus ventanas hijas. Cada copia conserva documento
y recursos hasta terminar; una segunda terminal requiere coordinación externa.
No aplica migración ni verificación de RLS: no hay SQL ni cambios de permisos.
Vendedor conserva acciones humanas; administrador y soporte autorizado pueden
ver diagnóstico conforme a `UI.technicalMessageViewer`. Anónimo, perfiles
inactivos y `service_role` no reciben nuevas facultades por esta historia.

Se revisó el diff de fuentes y consumidores y se recorrieron flujos comerciales
con red de negocio interceptada. El aprendizaje queda en las instrucciones:
probar la integridad del artefacto y el ciclo, no sólo contar llamadas.
Commit técnico, hash servido y comprobación Pages se registran tras publicar.

## Riesgo residual y pendientes

HARDWARE NOT_TESTED. No se afirma haber conectado Android nativo, RawBT físico
ni impresora. El síntoma físico específico permanece sin atribución concluyente;
sí se demuestra y corrige la clase de carreras de software descrita.
No se certifica concurrencia entre terminales distintas que compartan impresora
física: BALAM carece de acuse/servidor de cola común entre esos dispositivos.
Etiquetas conserva su arquitectura independiente. Drivers pueden imponer
papel, copias o cortes; esas decisiones no son observables mediante estas APIs.
Los límites de memoria/longitud rechazan documentos completos, nunca los truncan.

## Referencias

- `docs/03-known-risks.md`, H-153; H-135 y H-143–H-147.
- `sistema-de-comprobantes-historicos.md`, `ticket-impreso-paginado.md`.
- [Contrato de impresión HTML](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing).
- [Gesto humano en intents Android](https://developer.chrome.com/docs/android/intents).
- [Contrato de RawBT del autor](https://github.com/402d/DemoRawBtPrinter/blob/master/app/src/main/java/ru/a402d/demorawbt/MainActivity.java).
