# Tickets desde Android mediante RawBT

**Riesgo:** H-143
**Estado:** RESUELTO — IMPRESIÓN FÍSICA CONFIRMADA POR EL USUARIO
**Fecha:** 05/09/2026
**Commit:** `ee8d5bc` (funcional); cierre documental en commit posterior.

## Problema y reproducción

El usuario confirma Android, impresora POS 8360L conectada por Bluetooth y
ticket de prueba correcto desde RawBT. Los botones de POS y Reportes no abren
diálogo ni muestran error. En `39c1cbd`, las tres salidas llaman a
`window.print()`; ninguna entrega el documento a RawBT. Las pruebas anteriores
sustituyen `window.print()` por un contador: demuestran invocación, no transporte.

## Causa raíz

La frontera de salida sólo implementa impresión del navegador. Emparejar una
impresora y probarla desde RawBT no conecta ese canal con los botones de BALAM.
Además, un temporizador no constituye el gesto requerido por Chrome para abrir
una aplicación Android. No se atribuye una avería a la impresora.

## Diseño

Extender las utilidades UI con un transporte común para comprobantes ya
renderizados. Android abre RawBT mediante gesto directo y URI codificada;
escritorio conserva `window.print()`. La salida Bluetooth es texto térmico:
conserva evidencia comercial, folios, importes y pie; no transporta imágenes,
iconos ni barras decorativas. No reconstruye ventas desde catálogo.

| Capacidad y ciclo | Contrato |
|---|---|
| POS, Reportes por venta y ticket por método | Entregar el documento montado, sin recalcular |
| Histórico V1 y V2 | Mismo origen documental, ningún cambio de identidad |
| Automática Android | No abrir aplicaciones desde un timer; acción manual disponible |
| Escritorio | Conserva diálogo, autoimpresión y PDF H-135 |
| Cancelar y volver / reintentar | Conserva comprobante y permite otra pulsación |
| Error / aplicación ausente | Mensaje visible, nunca afirmar impresión física |
| Offline / recarga | Transporte local, sin servicios remotos ni nuevos datos persistidos |
| Permisos, pagos, stock, cola, reversas | Sin cambios; reimpresión no escribe negocio |
| Abono, cambio y devolución | Misma utilidad para sus botones de comprobante |
| Reportes A4, préstamos, etiquetas | Salidas independientes, fuera de esta corrección |

## Solución

`UI.printReceipt()` centraliza el destino; `receiptPrintText()` proyecta el
texto renderizado sin iconos ni comandos de control. La URI codifica el texto
antes de añadir el paquete fijo de RawBT. Un documento vacío o una URI mayor
de 500,000 caracteres se rechaza completa, con aviso: no hay truncamiento.
El enlace se activa sin temporizador ni espera asíncrona. El aviso dice
«Abriendo RawBT» y no declara éxito físico.

POS, reimpresión de ventas, ticket por método, abonos, cambio y devolución
usan esa misma salida. Android conserva además «Impresión del sistema».
La reimpresión de apartados deja un modal abierto con acción manual en Android;
en escritorio conserva el flujo previo. Los timers automáticos no abren RawBT.
No se almacena otra configuración ni se añaden dependencias.

El único cambio de `pos-ticket.jsx` es un selector inerte para ejercer el
checkout real en la regresión. No cambia el documento financiero ni H-135.
El build regenera ambos artefactos y el identificador del service worker.

## Pruebas

| Verificación | Resultado |
|---|---|
| H-143 sobre `39c1cbd` | Rojo: 1/4; Android llama al navegador y falta salida manual RawBT |
| `node test-h143-android-tickets.mjs` | 35/35; POS completo, Reportes y reimpresión de Apartados |
| H-143 contra GitHub Pages publicado | 35/35; Supabase bloqueado e intents interceptados |
| `node test-h85-receipts.mjs` | 20/20 |
| `node test-h90-payment-method-ticket-e2e.mjs` | 21/21 |
| `node test-h90-payment-method-ticket.mjs` | 17/17 |
| `node test-h135-continuous-ticket.mjs` | 61/61; PDF real de una página, largo/corto/histórico/abono/cambio/devolución |
| `node test-layaway-screen.mjs` | 55/55 |
| `node test-cambio-e2e.mjs` | 37/37 |
| `node test-smoke.mjs bundle` | 17/17 |
| `node test-ui-navigation.mjs` | 15/15 |
| `node test-build-reproducibility.mjs` | 8/8 |

BALAM QA ejerció Chrome con perfil Android táctil y escritorio, ocho anchos
320–1440, impresión del sistema alternativa, error de apertura, documento vacío
y excesivo, reintento y funcionamiento sin Internet. POS se ejerció desde
escaneo hasta cobro, elección de vendedor y clic en Imprimir. Reportes se
ejerció desde la fila de venta y desde el ticket por método. Se inspeccionaron
capturas de POS y reimpresión. No hubo errores de página ni cambios comerciales
por imprimir. Las suites interceptan Supabase y el enlace intent antes de abrir
un periférico: prueban la entrega exacta y el gesto activo, no Android nativo.

## Revisión y despliegue

La primera capa incorrecta era el transporte, no los cálculos del ticket.
Se reutilizan `BalamTicket`, `BalamReturnReceipt`, el snapshot del reporte y la
autoridad de autoimpresión. V1/V2 se leen desde el documento; no se decide otra
regla comercial, permiso, identidad, reversa ni persistencia. Cada consumidor
con autoimpresión dispone de salida manual en Android. La matriz anterior
preserva cancelación y regreso, y el test compara el estado de negocio antes
y después del envío. Impresión no exige cambios SQL ni verificaciones remotas.

El aprendizaje de H-143 es probar la frontera de transporte y sus restricciones
de gesto: incrementar un contador de `window.print()` no verifica Bluetooth.
El arnés nuevo queda como regresión. Pages run `33995416776` terminó en
`success` sobre `ee8d5bc`; la API de Pages confirma `built`. El workflow
H-132 `33995417341` también terminó en `success`.
El archivo público devuelve HTTP 200, mide 9,038,300 bytes y coincide byte a
byte con `ee8d5bc:index.html`; SHA-256
`3d7431ac06240db8bad120a8b0adcf12f0d69364a0b3878c8c2dc7857d38c4b4`.
Dos ejecuciones del build con las mismas fuentes produjeron el mismo SHA-256
local: `6bb72c44b1af4ee171638688cdcdac7c456b26a4fb4b99d4ba0d71c94ac76420`.
La publicación se compara con los bytes del blob Git normalizado.

## Riesgo residual y pendientes

RawBT y los permisos Bluetooth deben estar disponibles en cada tablet. El
05/09/2026 el usuario confirma «ya imprime» y solicita conservar el diseño de
Chrome. Esta evolución y su validación física se registran en H-144,
`diseno-ticket-android-h144.md`. Se trabaja en un worktree aislado desde
`origin/main`; se conserva el árbol original con cambios previos.
La salida RawBT usa texto, sin logo ni barras decorativas; la impresión del
sistema mantiene el diseño gráfico. Codificación física, corte y ancho se
verifican con la configuración de RawBT/impresora. No se certificaron WebKit,
Firefox ni otro dispositivo Android nativo. Reportes A4/etiquetas/préstamos
conservan sus salidas independientes.

## Referencias

- `docs/03-known-risks.md` — H-143.
- `docs/fixes/sistema-de-comprobantes-historicos.md` y `ticket-termico-continuo-h135.md`.
- [Contrato RawBT del autor](https://github.com/402d/DemoRawBtPrinter/blob/master/app/src/main/java/ru/a402d/demorawbt/MainActivity.java).
- [Intents Android y gesto de usuario](https://developer.chrome.com/docs/android/intents).
