# H171 — Jornada core de interfaz, fixture local

**Resultado: 8/8 etapas en escritorio y 8/8 en móvil. Supabase real:
NO CERTIFICADO por esta prueba.** No se modificó `balam/`, no se regeneró
el artefacto y no hubo llamadas comerciales a un servidor externo.

Se aplicaron Navigator, ADR-015, autoridades sales/inventory/security,
playbooks client/delivery y skill `balam-qa`. El alcance es la jornada
existente del POS; no implementa funciones nuevas ni sustituye la
certificación distribuida R-SYNC-16/R-SYNC-17.

Artefacto `index.html`:
`cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437`.
Runner `qa-h171-core-journey.mjs`:
`123f972f7a5984d39d9ac2cd9258eff34327938e0e88d513fbfdf29bbbc6c4f5`.

| Etapa | Observación ejercida desde UI | 1280×900 | 390×900 |
|---|---|---|---|
| Login | Correo/contraseña + Enter; AUTH, permisos y arranque reales | PASS | PASS |
| Buscar/seleccionar | Familia, talla 40, variante BL y una línea de carrito por ID | PASS | PASS |
| Cobro | Efectivo vacío/insuficiente bloqueado; $116 exactos habilitan | PASS | PASS |
| Vendedor/ticket | Confirmar bloqueado sin vendedor; venta confirmada y ticket del mismo folio | PASS | PASS |
| Existencias | Referencia elegida 3→2; otra referencia conserva 2; familia 5→4 | PASS | PASS |
| Consulta | Venta de $116 encontrada desde Reportes/Ventas | PASS | PASS |
| Recarga/consulta | Misma fila comercial después de recargar la página | PASS | PASS |
| Recarga/existencias | La UI reconstruye 2 unidades de la referencia y 4 de la familia | PASS | PASS |

Cada ejecución tiene un login, una venta, un pago, dos recibos técnicos
simulados —reserva de folio y venta— y una entrega al punto de impresión
interceptado. El comando recibido conserva subtotal $100, IVA $16, total
$116, saldo cero, cantidad uno e ID exacto. El servidor simulado actualiza
producto, documento, partidas, pago, movimiento, vendedor y contexto de
comisiones antes de que STORE reconstruya la proyección mediante HTTP.

No se sustituyen `AUTH`, `STORE`, `DATA` ni `App`. La construcción previa
del fixture reutiliza `DATA.createReference` para obtener referencias
válidas y restaura el estado temporal de CONFIG; no instala productos o
ventas mediante `DATA.replaceFromOnline`. Los datos comerciales llegan por
las respuestas HTTP interceptadas del SDK Supabase real.

El fixture contiene dos referencias V2 de la misma familia y talla, colores
BL/BE válidos del catálogo, cliente genérico y vendedor elegible con base
de comisión remota explícita. Sus identidades son sintéticas. El estado
del servidor simulado vive en Node y sobrevive a la recarga del navegador;
no se almacena negocio en localStorage para hacer pasar la prueba.

| Frontera observada | Escritorio | Móvil |
|---|---:|---:|
| Requests HTTP respondidos por el fixture | 26 | 29 |
| Intentos WebSocket cerrados antes de conectar | 8 | 8 |
| Requests externos permitidos | 0 | 0 |
| Requests inesperados/fallidos | 0/0 | 0/0 |
| Errores JS/consola | 0/0 | 0/0 |
| Claves locales comerciales o solicitudes pendientes finales | 0 | 0 |
| Entregas de ticket al punto de impresión interceptado | 1 | 1 |

El aislamiento permite únicamente el servidor HTTP local; las URLs de
BALAM se responden con fixtures y cualquier otra URL se aborta. Realtime
queda cercado mediante `routeWebSocket` y Service Workers deshabilitados
en el contexto. El caso no depende de Realtime para reconstruir tras reload.

## Evidencia final

- [Escritorio: journey.json](h171/core-journey-desktop-final/journey.json),
  ocho screenshots y [ticket HTML](h171/core-journey-desktop-final/receipt.html).
- [Móvil: journey.json](h171/core-journey-mobile-final/journey.json),
  ocho screenshots y [ticket HTML](h171/core-journey-mobile-final/receipt.html).
- [Stock móvil observado](h171/core-journey-mobile-final/05-stock-after-sale.png):
  ambas referencias visibles con dos unidades cada una.

El ticket se captura después de pulsar `receipt-print`, desde el iframe
real producido por `UI.receiptFrame`. Sólo se intercepta
`contentWindow.print`; se conservan documento, texto y hashes. No se
declara impresión física: **HARDWARE NOT_TESTED**. Tampoco se prueban aquí
3/5 copias, cancelación, permisos/RLS reales, idempotencia/concurrencia SQL,
persistencia remota, caída de red o convergencia A/B/C.

## Contrato reutilizable

El módulo exporta `runCoreJourney(page, expected, { onStep })`. Importarlo
no levanta un servidor ni ejecuta el caso. El llamador administra la página,
el transporte, los permisos de la futura ejecución y el observador de
impresión. `expected` contiene las credenciales del fixture y las
identidades/resultados previamente determinados:

```js
import { runCoreJourney } from './qa-h171-core-journey.mjs';
await runCoreJourney(page, {
  login: credentials, // { email, password }; nunca se devuelve en la evidencia
  search, productName, productId, sku, sellerId,
  commercialKey, sizeGroupKey, sizeCode,
  unitPrice, stockAfter, familyStockAfter,
}, { onStep: recordSafeStep });
```

El helper acciona exclusivamente contratos existentes: tipos `email` y
`password`, Enter/Escape, `aria-controls`/`aria-expanded` del menú y
`data-testid` de navegación, familia/talla/variante, carrito, efectivo,
vendedor, impresión, inventario y reportes. No acciona controles por copy,
icono, clase CSS u orden. Los textos de SKU/importes se leen para comprobar
contenido, no para elegir una acción. La observación de stock exige una
única fila visible con el SKU esperado; falla ante ausencia o ambigüedad.
Para familias cuya presentación o esquema de talla sea distinto, el
llamador debe dar los contratos e identidad equivalentes o registrar la
limitación, sin introducir un atajo que ejecute operaciones por DATA/STORE.

Reproducción local en PowerShell, desde el worktree:

```powershell
$env:BALAM_CORE_JOURNEY_OUTPUT = 'docs/fixes/evidence/h171/core-journey-rerun'
node qa-h171-core-journey.mjs
$env:BALAM_CORE_JOURNEY_WIDTH = '390'
$env:BALAM_CORE_JOURNEY_OUTPUT = 'docs/fixes/evidence/h171/core-journey-mobile-rerun'
node qa-h171-core-journey.mjs
```

La ejecución standalone siempre instala el transporte simulado. Integrar
el helper en un runner real requiere la autorización y validación remota
correspondientes; este documento no las concede.

## Intentos conservados y límites

Los directorios `core-journey`, `core-journey-second`,
`core-journey-diagnostic` y `core-journey-diagnostic-two` conservan intentos
incompletos: el fixture carecía de `commissionContext.sellerBases` para el
vendedor. La observación final de diagnóstico registra el rechazo real
`No se pudo confirmar la base de comisión del vendedor`; se corrigió el
fixture, sin alterar ese control de negocio.

`core-journey-final` completó las ocho etapas pero registró el aviso de
Chromium al inyectar el observer del harness en el iframe de impresión
sandboxed. Se retiró esa instrumentación global; el iframe de producción
mantiene su sandbox y las ejecuciones finales no tienen errores de consola.
`core-journey-mobile` conserva el primer fallo del localizador del menú:
Playwright consideraba visible el panel desplazado fuera del viewport. La
versión final usa el estado funcional `aria-expanded` y abre el menú por UI.

No se han clasificado estos defectos del harness como fallos de BALAM ni se
han usado los intentos fallidos como PASS. Los resultados finales prueban
las rutas y acciones de la interfaz contra un servidor simulado coherente;
la aptitud real para entrega continúa dependiendo de las comprobaciones y
decisiones pendientes del H171 global. Commit: Pendiente de commit.
