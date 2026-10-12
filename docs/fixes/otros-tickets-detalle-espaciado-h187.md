# Detalle limpio y pie compacto en los demás comprobantes

**Riesgo:** H-187
**Estado:** RESUELTO — publicado y verificado; confirmación física pendiente
**Fecha:** 11/10/2026
**Commit:** `759ddf4aac26ab92c7c170ebca09282ae92897c7`
**Commits de pruebas CI:** `9088820bdf4cd5c90fdec8ebed28ceeae0b86dce`,
`d2d6c2320fca9b0d4ff2b708310cfe5a751856d2`.

## Problema y reproducción

El propietario autorizó extender H-185 a las variantes restantes, con commit,
push y publicación. La venta normal ya omitía SKU/ornamento y tenía un pie
compacto; cortesías, apartados, anticipos, abonos, liquidaciones y cambios
conservaban esos detalles y los márgenes anteriores. La devolución imprimía
SKU, pero no ornamento ni agradecimiento.

`test-h187-receipt-layout.mjs --baseline` monta los documentos confirmados
sintéticos sobre el bundle anterior, sin red comercial. Dieciocho escenarios:
cinco ventas de control, siete variantes H-185, cambios cobrado/con sobrante,
apartado largo/legacy y devolución con/sin snapshot. Cada uno genera original,
COPIA CLIENTE y COPIA TIENDA completos. Evidencia previa en
`docs/fixes/evidence/h187-receipt-layout-baseline.json`.

## Causa raíz

Es una ampliación del contrato visual solicitado. `BalamTicket` condicionaba
SKU, ornamento y márgenes a `ventaNormal`. Las líneas Entrega/Recibe tenían
su propio fragmento de ornamento; `BalamReturnReceipt` su propia línea SKU.
No es un defecto de identidad ni de cálculos. La investigación previa siguió
POS → comprobante; Apartados → ReciboModal/TicketPrint; Cambios → ExchangeReceipt;
Devoluciones → BalamReturnReceipt y Reportes → ReprintSaleModal.

## Diseño

Retirar exclusivamente las expresiones de presentación indicadas. Talla,
cantidad, nombre, importes y color ya disponible continúan impresos. El pie
compartido usa margen superior 16 px y espacio bajo divisor 8 px: separación
de 25 px desde el último bloque hasta el agradecimiento, sin reducir fuentes
ni separación entre productos. Historial y notas pueden estar entre método
y pie; no se promete una distancia universal entre método y agradecimiento.

Devolución conserva sus márgenes: no tiene el mismo pie. Reporte térmico por
método no contiene esos campos y ya separa su pie con 3 mm. Reportes/listados
A4, vales y etiquetas quedan fuera. Las reimpresiones existentes y ambas
copias heredan las plantillas; no se crean nuevas rutas de reimpresión.

No cambian DATA, CONFIG, AUTH, STORE, Supabase, permisos, inventario, pagos,
snapshots, identidad, finanzas H-186 ni transporte. Sin migración. La identidad
interna de devolución sigue comparando producto/SKU/talla. ADR-015 permanece
vigente; no se reintroduce cola comercial ni operación local-first.

## Solución

- `balam/pos-ticket.jsx`: omisión general de SKU/ornamento, retirada del
  ornamento de Entrega/Recibe y pie compacto compartido; devolución sin SKU.
  Se retiran dos helpers de presentación que quedan sin consumidores.
- H-187 protege contenido restante completo, tipografía, separación, altura,
  ambas copias, datos intactos y liberación de recursos sobre el bundle.
- H-185 conserva sus garantías y adapta sólo la expectativa de variantes
  ahora incluidas; su evidencia histórica original no se sobrescribe.
- Workflow ordinario incorpora H-187 antes de publicar. HTML/SW se regeneran
  desde fuente con `node build-offline.mjs`.

## Pruebas

Línea base corregida **24/37** (13 fallos esperados de presentación) sobre HTML
`dcab70eff4fcd8ce5ec75346777b2c6db2e6b0d3c7d1779136443376cba68f3e`.
Final **55/55**, 18 documentos y 54 PNG completos. Las cinco ventas de control
conservan texto, altura y hash del HTML capturado; los demás conservan todo el
texto salvo las omisiones aprobadas. Fuentes, separación entre productos,
datos comerciales y liberación de recursos permanecen iguales.

El espacio desde el último bloque hasta el agradecimiento baja **73→25 px**.
Ejemplos de altura PNG de COPIA CLIENTE, ancho 576 px:

| Caso | Antes | Después |
|---|---:|---:|
| Apartado | 3242 | 3030 |
| Abono | 3454 | 3243 |
| Cambio cobrado | 3767 | 3470 |
| Apartado de 12 renglones | 6776 | 5428 |
| Devolución | 1475 | 1434 |

Estas cifras pertenecen a fixtures concretos, no son ahorro universal.

| Comando | Resultado |
|---|---:|
| `node test-h185-sale-ticket-layout.mjs` | 30/30 |
| `node test-h178-sale-ticket-trim.mjs` | 12/12 |
| `node test-h179-receipt-copies.mjs` | 13/13 |
| `node test-h183-usb-receipts.mjs` | 16/16 |
| `node test-h184-all-thermal.mjs` | 15/15 |
| `node test-h180-system-print.mjs` | 18/18 |
| `node test-h186-financial-ui.mjs` | 26/26 |
| `node test-h164-online-ui.mjs` | 6/6 |
| `node test-h164-online-pwa.mjs` | 2/2 |
| `node test-h164-online-architecture.mjs` | PASS |

Total: **193 comprobaciones**, más la guarda estática. USB compara todos los
píxeles del raster contra PNG y prueba consecutivos, aislamiento, copia doble,
reimpresión, desmontaje, error parcial y liberación. Sistema compara documento
completo y hash en Windows/Android/Android escritorio simulados. H-184 conserva
reporte térmico de una copia y ruta A4. H-186 protege descuentos/IVA confirmados.
Inspección visual de abono, cambio cobrado y devolución sin recortes observados;
PNG versionados en `evidence/h187-abono.png`, `h187-cambio.png` y `h187-devolucion.png`.

Después de las regresiones se ejecutó
`node test-h187-receipt-layout.mjs --fijar "H-187: detalle limpio y menor altura con datos, fuentes y separaciones conservados"`:
55/55; techo nuevo versionado en `h187-receipt-layout-ceiling.json`.
Los resultados históricos que sobrescriben H-183/H-184/H-185 se guardaron con
prefijo H-187 y se restauraron sus originales; las cinco bajas PDF preexistentes
del usuario no forman parte del cambio. `git diff --check` PASS.

HTML probado: **9,388,470 bytes**, SHA-256
`c8a10ea17f9f3fc58e2ea5e56bb0781d1b207d53fed409ed86f99a852ac30af4`.

La primera ejecución de instrumentación detectó
tres expectativas de talla incorrectas en casos nuevos sin color/snapshot;
se corrigió el instrumento y se repitió contra el HTML anterior extraído de
HEAD, sin atribuir esos fallos al producto. Chrome instalado quedó esperando
sin resultado; se canceló sólo ese proceso de prueba y se usa Chromium 1223,
el mismo navegador del workflow.

FF-01/02: ampliación visual, no regla de negocio nueva. FF-03/04: plantillas
y snapshots son autoridades, sin datos nuevos derivados o persistidos.
FF-05/06/07: consumidores y copias existentes, sin otra plantilla ni transporte.
FF-08: originales persistidos intactos. FF-09: todos los roles conservan sus
capacidades; SQL/RLS/service_role no aplican sin cambios de acceso ni escritura.
FF-10/11: bundle completo, imágenes y frontera de transporte, con escenarios
de emisión, reimpresión, consecutivos y liberación. Aprendizaje: al ampliar
una omisión visual hay que cubrir los subbloques propios de cada operación;
la omisión del detalle general no cubre Entrega/Recibe.

## Despliegue

Publicado desde main `d2d6c23`. Workflow ordinario
[38203753040](https://github.com/David14081982/POS_Balam/actions/runs/38203753040)
**SUCCESS**: regresión completa y despliegue aprobados. Certificación live
opcional omitida, no solicitada. El 12/10/2026 UTC (11/10 en Hermosillo) los
tres archivos públicos devolvieron HTTP 200 e identidad byte a byte con el
commit desplegado y con el artefacto probado:

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `index.html` | 9388470 | `c8a10ea17f9f3fc58e2ea5e56bb0781d1b207d53fed409ed86f99a852ac30af4` |
| `POS Balam (offline).html` | 9388470 | `c8a10ea17f9f3fc58e2ea5e56bb0781d1b207d53fed409ed86f99a852ac30af4` |
| `sw.js` | 4477 | `1ba9cce67945de2ccaf0cc515ada4b44b3164bc7fa1f62ffe0c29a81353e1627` |

Evidencia: `evidence/h187-deploy.json` y `h187-workflow.json`. Cada terminal
debe adoptar la actualización para imprimir con el nuevo diseño. El cierre
documental se registra aparte y no modifica estos bytes.

Durante la entrega, el workflow `38203015461` falló antes del despliegue en
`test-discounts.mjs` (34/38).
Reproducción local con `TZ=UTC`: mismo resultado. El fixture usaba el calendario
del equipo, diferente del comercial -07:00 a las 04:18Z. Prueba y motor son
idénticos al padre H-186, no es una regresión del ticket.
Se fija exclusivamente el instante del servidor y sus fechas comerciales en
la prueba: **38/38** en UTC, America/Hermosillo y Asia/Tokyo, con las mismas
aserciones y un instante en el que UTC/Hermosillo tienen fechas diferentes.
No cambió el producto ni los bytes del bundle.
La segunda ejecución `38203402576` aprobó 38/38 y los 20 casos de DATA, pero
el fixture SQL reprodujo la misma mezcla de calendarios en `current_date-1`:
110 aprobadas antes de «expired promotion is not applied». Se reprodujo con
`TZ=UTC` y se cambian sólo las dos fechas de inicio/fin del fixture a la fecha
comercial explícita `now() at time zone 'America/Hermosillo'`.
No se modifica ninguna autoridad SQL ni migración. Evidencia de las zonas:
`evidence/h187-ci-sql-timezone.json`. Los resultados financieros locales
adicionales están en `h187-ci-financial.json`: DATA 20/20, SQL 135/135 y
contratos negativos 16/16, todos sin red ni escrituras de producción.
SQL final: **135/135 en UTC, America/Hermosillo y Asia/Tokyo**. Los dos
recorridos UI H-186 restantes también pasan en UTC: cortesía/anticipo cero
3/3 y devolución 3/3 (`h187-ci-ui-utc.json`). Los tres artefactos del cliente
siguen siendo idénticos byte por byte a `759ddf4`.
Sin migraciones ni escrituras comerciales remotas.

## Riesgo residual y pendientes

HARDWARE NOT_TESTED: no se ha comprobado papel ni corte en impresora física.
La entrega completa de software no equivale a confirmación física.
Certificación A/B/C NO CERTIFICADO, no solicitada para esta presentación.

## Referencias

- `docs/03-known-risks.md`, H-187.
- `ticket-venta-detalle-espaciado-h185.md`.
- `otros-tickets-usb-h184.md` y `impresion-usb-comercial-h183.md`.
- `comprobante-del-cambio.md` y `sistema-de-comprobantes-historicos.md`.
- `docs/02-architecture.md`, evidencia visual del comprobante histórico.
