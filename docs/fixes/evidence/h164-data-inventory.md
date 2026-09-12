# H164 — inventario DATA versionado

**Fecha del corte documental:** 12/09/2026, Hermosillo. **Estado:** EN IMPLEMENTACIÓN; NO CERTIFICADO.

Copia del inventario de trabajo `.evidence-h164/data-mutation-inventory.md`.
Las líneas de fuente inicial sólo identifican la arquitectura anterior.
Esta copia separa el estado implementado de la propuesta inicial para que
ninguna recomendación histórica se interprete como contrato vigente.
El informe actual es [online-only-h164.md](../online-only-h164.md).

## Contrato implementado y evidencia registrada

Conteos confirmados por el propietario DATA: 32 entradas comerciales y
34 casos distintos de frontera. Los asignadores de folio/helpers no se suman
como nuevos dominios. No hubo ejecución adicional para preparar este documento.
La evidencia del inventario registra ejecuciones; no existe un stdout adicional
que pueda enlazarse como artifact. A/B/C y adopción física siguen pendientes.


- 32 entradas comerciales públicas convertidas a preparación separada y confirmación remota: applyOrphanFix, saveProductRows, saveProductFamily, reclassifyReference, regenerateSkus, addClient, recordSale, registrarPagoApartado, completarApartado, liquidarComision, cerrarMes, recordExchange, applyCommissionAdjustment, recordReturn, addUser, updateUser, removeUser, updateClient, removeClient, addPromo, updatePromo, removePromo, duplicatePromo, migrateSizeCodes, removeProductScope, removeProduct, clearInventory, registrarPrestamo, registrarDevolucionPrestamo, marcarPrestamoNoDevuelto, actualizarPrestamo, eliminarPrestamo.
- Dos asignadores de folio online (`nextFolio`, `nextLoanFolio`), un helper de liquidación y una frontera interna de confirmación completan 36 funciones async. No escritor ni persistencia comercial runtime en DATA.
- Datos públicos clonados; `replaceFromOnline` valida colecciones completas antes de sustituirlas. `revision` efímera invalida memos de préstamos/apartados/devoluciones/cambios/promociones aun cuando el número de registros no cambia.
- Consumidores POS, pos-ticket, clientes, vendedores, devoluciones/cambios, préstamos, apartados y promociones esperan autoridad antes de éxito/cierre/comprobante. No se modificaron el árbol visual ni estilos, salvo el comportamiento existente de confirmación.
- Eliminados save*/journals/writer/rebase/colas/flags resync/reservas folio locales/seeds/reset comercial local y sus fallbacks. `reverseSaleCommission`/`reverseExchangeCommission` retirados: cero consumidores ejecutables y no representan una cancelación comercial completa.
- Alta usuario/promo/cliente usa UUID. Venta/devolución/cambio y abono conservan ID del formulario. Abono utiliza ID independiente de la venta, fila pay-UUID y expectedSale; venta transporta versiones de producto del ticket para validación servidor. Los rechazos definitivos reinician la intención del formulario, los resultados inciertos conservan identidad.
- Reclasificación idempotente también consulta servidor; no se usa presencia en memoria como recibo.
- Cambio entrega versiones del producto seleccionado; si otra terminal editó la referencia desde la cotización, rechaza antes de recalcular y antes del envío. Una regresión específica de cotización obsoleta: PASS, cero solicitudes/efectos. El gateway recibe la misma versión para arbitraje final.
- Contexto opaco de cotización congelado desde saleQuote y la valoración de Cambio hasta el gateway; POS congela quote/ticket al confirmar cobro antes de elegir vendedor. Fechas nuevas y ventanas de promoción usan reloj monotónico derivado de servidor en America/Hermosillo, sin depender del reloj/huso del dispositivo.
- Base de comisión/periodo se reconstruye desde commissionContext agregado servidor incluso cuando RLS oculta devoluciones/cortes; no se amplían permisos. Validación pura validateOnlineSnapshot antecede la aplicación de CONFIG; missing contexto o familia V2 rechaza sin inventar estado.
- Nuevas regresiones necesarias tras cambios finales: una venta con quoteContext preservado, una comisión con histórico restringido, una identidad remota incompleta y una promoción con reloj de equipo equivocado: 4 PASS / 0 FAIL. Cada caso nuevo ejecutado una vez; venta repetida exclusivamente por el cambio del contrato de cotización. Total de casos distintos en suite DATA final: 34.
- applyRemote/mergeRemote retirados tras confirmar cero consumidores runtime. La clasificación provisional anterior se sustituye por SE ELIMINA; la única proyección comercial activa es el reemplazo completo desde servidor.
- Retirados operationToken/collisionSafeFolio/collisionSafeLoanFolio/terminalCode, sin consumidores runtime: únicamente construían folios provisionales/alternativos locales. Parsers, aliases y formatos de folios históricos siguen disponibles.
- Drawer de cliente cerrado ya no declara role=dialog/aria-modal; queda inert y aria-hidden hasta abrir, con los mismos estilos. La guarda de actualización deja de confundir el panel cerrado con un diálogo abierto.
- El arnés real conserva el await original durante una respuesta incierta prolongada y lo verifica al restaurar lectura del recibo, sin reenviar la venta. Las carreras exigen recibos servidor de ambos intentos y rechazo específico; no se acepta un fallo de red como prueba de concurrencia.
- Regresión frontera DATA: 30 escenarios PASS / 0 FAIL, una ejecución por caso. Tras corregir identidad del abono se ejecutaron sólo los dos casos afectados: 2 PASS / 0 FAIL. Spy de almacenamiento comercial: 0 accesos. Nueve módulos modificados parsean correctamente.
- `test-h164-live-online.mjs` preparado, NO EJECUTADO por este agente: A/B/C Chromium independiente, Supabase real, fuente/artefacto hash, fixtures exactos journalizados, pérdida de ACK, versiones concurrentes, stock, documentos, reconexión, recarga, Realtime desactivado. Requiere migraciones remotas revisadas y artefacto final. No declara certificación por pruebas aisladas.

## Inventario inicial conservado por histórico

Las siguientes secciones describen la fuente anterior a la conversión. En particular,
las propuestas de conservar `applyRemote`/`mergeRemote` quedaron sustituidas por su retiro.


Fecha: 2026-09-11. Auditoría estática de `balam/` previa a implementación; no se hicieron escrituras de negocio ni limpieza de navegador.

## Conclusión de diseño

No basta hacer async los handlers: DATA modifica referencias vivas, localStorage y eventos antes de llamar CORE. Tampoco basta snapshot/rollback global: `recordSale` recibe `ticket[i].p` desde UI y modifica esos mismos objetos; clones restaurados no deshacen referencias retenidas por componentes. Recomendación: mantener fórmulas y snapshots, convertir bloques de efectos en preparación pura, esperar RPC y aplicar exclusivamente la lectura/resultado remoto. STORE debe devolver confirmación después de aplicar autoridad; CORE debe preservar la promesa.

## Mutaciones por dominio

| Dominio | Función DATA / línea inicial | Efecto local actual | Ruta saliente / interfaz |
|---|---|---|---|
| Venta / apartado inicial | `recordSale` ~2780 | stock, movimientos, cliente, vendedores, venta, pago y localStorage antes de enviar | `pushSale`; `pos.jsx:247` síncrono |
| Pago parcial apartado | `registrarPagoApartado:3097` | agrega pago y altera anticipo/saldo antes de enviar | `pushSale`; `layaway.jsx:306` ya espera Promise |
| Liquidación apartado | `liquidarApartado:3055`, `finalizarApartado:2998` | preparación ya separada; depende de candado/journal comercial local para aplicar | `settleLayaway`; retirar candados/journal después de conciliarlos |
| Pago comisión | `liquidarComision:3152` | crea liquidación y pone acumulado en cero | `settleCommission`; `sellers.jsx:76` síncrono |
| Corte comisión | `cerrarMes:3165` | crea cortes, borra acumulados y persiste periodo | `closeCommissionPeriod`; `sellers.jsx:82` síncrono |
| Ajuste comisión | `applyCommissionAdjustment:4048` | documento local con estado aplicado antes de RPC | `applyCommissionAdjustment`; `sellers.jsx:312` síncrono |
| Reversa comisión venta | `reverseSaleCommission:3727` | cambia venta a Cancelado y resta vendedores | `pushSale`; costura pública sin UI propia |
| Cambio | `recordExchange:3456` | inventario y movimientos; después valida pago; comisión, pago y cambio locales | `pushExchange`; `returns.jsx:646` síncrono |
| Reversa comisión cambio | `reverseExchangeCommission:3689` | altera vendedor y documento local | `pushExchange`; costura pública sin UI propia |
| Devolución | `recordReturn:4404` | reingresa stock, movimiento, reversa vendedor/cliente y estado venta antes de enviar | `pushReturn`; `returns.jsx:290` síncrono |
| Préstamo alta | `registrarPrestamo:5207` | inserta documento y persiste | `pushLoanOperation('deliver')`; `loans.jsx:588` síncrono |
| Préstamo devolución | `registrarDevolucionPrestamo:5265` | cambia cantidades/devueltas y agrega asiento | `pushLoanOperation('return')`; `loans.jsx:826` síncrono |
| Préstamo faltante | `marcarPrestamoNoDevuelto:5310` | cambia estado y cierre | `pushLoanOperation('shortage')`; `loans.jsx:186` síncrono |
| Préstamo editar/reabrir | `actualizarPrestamo:5328` | modifica persona/fechas/estado | `pushLoanOperation('edit'/'reopen')`; `loans.jsx:581` síncrono |
| Préstamo baja | `eliminarPrestamo:5352` | elimina de colección y persiste | `pushLoanOperation('delete')`; `loans.jsx:190` síncrono |
| Cliente alta rápida | `addClient:1950` | inserta y persiste antes de enviar | `pushRows('clients')`; `pos-ticket.jsx:79` síncrono |
| Cliente alta completa | bypass `clients.jsx:82–91` | `D.clients.push(client); D.saveClients(...)` | requiere nueva alta DATA que acepte campos completos |
| Cliente editar | `updateClient:4657` | asigna sobre objeto vigente y persiste | `pushClient`; `clients.jsx:71` síncrono |
| Cliente baja | `removeClient:4675` | elimina colección | `deleteRow('clients')`; `clients.jsx:78` síncrono |
| Personal alta/editar/baja | `addUser:4591`, `updateUser:4614`, `removeUser:4635` | inserción/asignación/baja y persistencia | `pushRows('sellers')` / `deleteRow`; settings:1776,2887,2910,2918,2921,2937 |
| Promociones alta/editar/duplicar/baja | `addPromo:4688`, `updatePromo:4693`, `removePromo:4699`, `duplicatePromo:4706` | mutaciones colección y persistencia | `pushRows('promotions')` / `deleteRow`; discounts:177–179,300 |
| Productos editar | `updateReference:1187` | asigna al objeto vivo; caller persiste | inventory:216,237; necesita preparación independiente |
| Reclasificación | `reclassifyReference:1223` | mueve stock en dos IDs y crea movimientos | `commitReferenceReclassification`; requiere esperar RPC |
| Productos huérfanos | `applyOrphanFix:925` | asigna catálogo y persiste | `saveProducts`; settings:585 |
| SKU regeneración | `regenerateSkus:1288` | reescribe atributos y SKU colección entera | `saveProducts`; settings:285 |
| Migración tallas | `migrateSizeCodes:4755` | CONFIG+products+promos; rollback local | settings:367; necesita autoridad transaccional conjunta |
| Producto baja | `removeProductScope:4916`, `removeProduct:4945` | borra local antes de RPC | `deleteProductScope` / `deleteRow`; inventory:269 |
| Inventario vaciar/reset | `clearInventory:5011`, `resetProducts:5037` | reemplazo local y guardas cola | settings:479; reconciliar uso autorizado y ruta remota existente |
| Pruebas/Punto Cero | `resetEmpty:5390`, `applyPointZero:5406`, `applySelectiveCleanup:5458`, `resetTestData:5723`, `seedDemo:5810` | modificación masiva local, folios, journals, demo | no pueden permanecer como capacidad comercial local; proyecciones después de RPC se distinguen de seeds |

## Bypasses de DATA en consumidores

- `inventory.jsx:185–201`: Excel aplica `XLSXIO.applyImportPlan(plan,D.products)` sobre arreglo vivo, guarda y muestra éxito; rollback también toca el vivo. Pasar colección clonada, enviar sólo IDs/cambios, aplicar remoto.
- `inventory.jsx:207–247`: familia y producto individual mutan objetos/arreglo `D.products`; familia invoca `STORE.pushProductFamilyBatch` sin esperar y fallback `D.syncProducts`.
- `inventory.jsx:2017–2021`: upload de etiqueta altera `s.p.barcodeUrls` y después guarda producto sin esperar. El asset remoto puede existir sin metadato confirmado; no anunciar guardado comercial antes de ambas confirmaciones.
- `settings.jsx:1039–1058`: conversión de imágenes base64 altera producto vivo antes de `saveProducts` por lotes.
- `store.jsx:4416–4436`: otro consumidor automático de subida de imágenes hace el mismo patrón.
- `clients.jsx:90`: alta completa modifica `D.clients` directamente.
- `xlsx-io.jsx:1073–1084`: `applyImportPlan` modifica el arreglo suministrado; convertirlo en preparación pura o suministrar copia exclusivamente.
- `CORE.registerCatalogProducts.list()` devuelve productos vivos; CONFIG puede modificarlos indirectamente al cambiar catálogos. Inventariar junto al agente CONFIG.

## Persistencia comercial y clasificación propuesta

| Mecanismo | Clasificación | Condición |
|---|---|---|
| `balam_pos_products_v2` | SE ELIMINA como runtime | inventario legacy conciliado antes de retirar clave |
| `balam_pos_sellers_v1`, `clients_v1`, `sales_v1`, `moves_v1`, `promos_v1`, `liq_v1`, `returns_v1`, `payments_v1`, `exchanges_v1`, `loans_v1`, `commission_adjustments_v1` (todos prefijo `balam_pos_`) | SE ELIMINA como runtime | reemplazar arranque por remoto; no adoptar contenido como autoridad |
| `balam_pos_sale_commit_journal_v1`, `balam_pos_sale_commit_journal_v2:*` | SE ELIMINA | conciliar identidad/recibo antes; contienen snapshots comerciales |
| `balam_pos_layaway_product_locks_v1` | SE ELIMINA | sustituir candado local por servidor y resultado incierto consultable |
| WebLock `balam-pos-local-writer-v1` / rebase de colecciones / eventos focus-pagehide | SE ELIMINA | sólo coordina persistencia comercial local antigua |
| `balam_pos_periodo_v1` | SE ELIMINA | periodo se deriva de cortes remotos; conservar cálculo |
| `balam_pos_folio_v1`, `balam_pos_folio_v2` | SE ELIMINA reserva offline | folio visible histórico se conserva; asignación online servidor |
| `balam_demo` | SE ELIMINA como modo comercial | pruebas usan entornos explícitos, no estado alterno en instalación |
| `catalogResyncReasons`, `catalogResyncRequired`, `h65-cache`, `products-cache`, `product-conflict` | SE ELIMINA | disponibilidad online del coordinador reemplaza bloqueos de caché |
| `_syncStatus`, `_syncDetail`, `markSaleSync` | SE ELIMINA de documentos nuevos/UI normal | resultado incierto técnico separado; histórico tolerado sin efectos |
| `_syncVersion`, `_loanVersion` | SIGUE SIENDO NECESARIO | versiones recibidas del servidor para control optimista, sólo memoria |
| `DATA.applyRemote` / hidratación / proyecciones e informes | SIGUE SIENDO NECESARIO | memoria efímera, sin persistencia comercial, snapshot completo sustituye |
| `mergeRemote` | SIGUE SIENDO NECESARIO para consultas parciales | cobertura explícita; no protege intenciones locales |
| Folios/aliases/snapshots de precios/comisiones | SE CONSERVA POR HISTÓRICO | autoridad y evidencia en Supabase; lectura compatible |

DATA no accede directamente IndexedDB: los consumidores están en STORE. Root audita durable_queue, snapshots, cursors y recuperación global.

## Fronteras y trampas de extracción

- `recordExchange` modifica stock antes de validar `paymentParts`: eliminar toda anticipación es además necesario para errores locales sin efectos.
- `save*` mezclan persistir/avisar y enviar; convertir cada función en no-op de persistencia y seguir llamándola desde mutaciones no resuelve anticipación en memoria.
- El wrapper `localWriterMutators` no incluye `updateClient`, `updateReference`, `removeProductScope`, `migrateSizeCodes`; no usarlo como inventario completo ni única defensa.
- `syncUp` y muchas RPC están envueltas en `catch { /* offline */ }`: deben propagar fallo y conservar formulario. CORE no-op antes de registrar STORE no puede considerarse confirmación.
- `recordSale` genera UUID internamente; devolver y repetir requiere identidad estable desde el inicio de la intención, persistida sólo como metadato consultable de resultado incierto.
- `recordReturn` genera ID aleatorio y carece de operationId en entrada; mismo ajuste idempotente requerido.
- `recordExchange` ya recibe `operationId` y consumidor guarda `operationIdRef`; conservar esa identidad y no confundir recibo remoto con mera presencia en memoria.
- Contrato vigente de préstamos: no alteran stock; conservar sus fórmulas y estados. Concurrencia se prueba sobre documento/versionado, sin inventar reservas.
- `reverseSaleCommission` no constituye cancelación comercial completa; no añadir reembolso/reingreso de stock fuera de contrato durante esta conversión.
- Históricos, IVA, promoción congelada, comisión escalonada, suministro/consumo por renglón y aliases permanecen sin recalcularse con configuración vigente.

## Interfaz propuesta con STORE

Todas las rutas existentes `pushRows/pushClient/pushSale/pushReturn/pushExchange/pushLoanOperation/settleLayaway/settleCommission/closeCommissionPeriod/applyCommissionAdjustment/deleteRow/deleteProductScope/commitReferenceReclassification` deben devolver Promise que sólo resuelve éxito después de commit y proyección autoritativa. Fallo definitivo rechaza; respuesta incierta se consulta por identidad sin replay. DATA prepara payload y devuelve documento confirmado; UI espera esa promesa y entonces cierra formulario/muestra éxito/imprime. Si RPC confirmó y falla la recarga, el estado queda confirmando, no se permite nueva intención duplicada.
