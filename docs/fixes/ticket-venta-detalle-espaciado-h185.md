# Detalle y espaciado del ticket de venta

**Riesgo:** H-185
**Estado:** RESUELTO EN CÓDIGO — publicación y confirmación física pendientes
**Fecha:** 05/10/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El propietario mostró tickets con cadenas SKU largas, una línea completa de
ornamento y un vacío excesivo entre método de pago y agradecimiento. Aprobó
quitar únicamente esos datos impresos de venta normal/reimpresión, conservar
nombre, importe, talla, color de prenda y cantidad, y reducir el espacio sin
disminuir tipografía ni separación entre productos. Ambas copias incluidas.

Antes de cambiar la fuente, `node test-h185-sale-ticket-layout.mjs --baseline`
dio **13/18** sobre el artefacto anterior SHA
`857f07700fb0a793986cb472a1da24f26a1a5dddb61dbc1068ed036b5530218a`:
fallan las cinco ventas por SKU/ornamento, pasan integridad, datos y siete
variantes fuera de alcance. H-178 con el nuevo contrato dio **11/12** por el
SKU todavía visible. La suite H-178 original había pasado 12/12 en análisis.

## Causa raíz

Es un ajuste de presentación solicitado, no un error financiero. `BalamTicket`
imprimía SKU junto a talla/color y añadía ornamento para todos los documentos.
El pie acumulaba padding inferior del pago 16 px, margen del pie 48 px,
divisor 1 px y separación inferior 24 px: **89 px** medidos entre el texto del
método y el agradecimiento. El SKU largo también provocaba envoltura de línea.

## Diseño

Reutilizar `ventaNormal` de H-178, sin cambiar su clasificación: no hay
`payment`, `exchange`, apartado, cortesía ni historial de anticipo/abono/
liquidación. Un apartado liquidado conserva su comprobante completo; una
reimpresión de venta con cambio posterior sigue siendo venta normal.

Sólo cuatro expresiones de `balam/pos-ticket.jsx`: prefijo SKU condicionado,
ornamento condicionado, margen del pie 48→16 y separación del divisor 24→8.
Conservar nombre/importe, talla/color congelados, cantidad, tipografía,
separación entre prendas, método/icono, texto de cambios, tagline y web.
Los documentos ajenos a venta conservan incluso el HTML del comprobante.

No cambia TicketPanel/carrito (H-139), DATA, CONFIG, AUTH, STORE, fórmulas,
inventario, snapshots, Supabase, permisos ni transporte. No requiere migración.
H-164/ADR-015 sigue siendo el contrato online vigente; no se reintroduce
operación local-first ni cola comercial. Históricos sin color congelado siguen
sin inventar uno desde el catálogo actual.

## Solución

- `balam/pos-ticket.jsx`: los cuatro ajustes visuales anteriores.
- `test-h185-sale-ticket-layout.mjs`: línea base/final, coste, garantías y
  completitud, dos copias, siete documentos de control y límite refijable.
- H-177/H-178: expectativas ajustadas al contrato aprobado; conservan controles
  de tinta, legibilidad, método, contenido restante y variantes.
- Workflow: H-185 se ejecuta antes de publicar; ambos HTML y SW regenerados
  con `node build-offline.mjs`. No se editan artefactos a mano.

## Pruebas

- H-185: **13/18 → 30/30** tanto Chrome 154 como Chromium 1223
  (148.0.7778.96, igual a CI). Doce casos y 22 PNG completos: venta corta,
  larga, legacy, mixta, reimpresión; apartado, anticipo, abono, liquidación,
  apartado liquidado reimpreso, cambio y cortesía.
- Pausa método→agradecimiento **89→41 px (−53.93%)** en las cinco ventas.
  PNG corto **2277→2065**, largo de 12 renglones **5811→4463**;
  con marca cliente/tienda corto **2383→2172**, largo **5917→4569**.
  Los tamaños describen fixtures concretos, no una promesa de ahorro universal.
- Mismos datos, fuentes y separación entre prendas. Siete variantes no-venta:
  mismo texto, HTML, dimensiones y PNG (hash exacto con el mismo navegador).
  Otro navegador compara siempre contenido/HTML/geometría, sin fingir igualdad
  de rasterizadores distintos. Chrome final queda preservado por separado.
- `node test-h183-usb-receipts.mjs`: **16/16**, raster íntegro comparado con
  PNG, ambas copias, consecutivos, desmontaje, error parcial incierto y recursos.
- `node test-h184-all-thermal.mjs`: **15/15**, reporte, apartados, cambios,
  devolución y reimpresiones reales de UI con USB simulado. A4 conservado.
- `node test-h180-system-print.mjs`: **18/18**, documento completo y hash en
  frontera de transporte en Windows/Android/Android escritorio simulados.
- `node test-h173-ticket-thermal-output.mjs`: **28/28**.
- Inspección visual de PNG corto: detalle y pie completos, legibles y separados.
  Revisión independiente del diff sin hallazgos accionables.
- Regresión adicional: H-177 **8/8**, H-178 **12/12**, H-179 **13/13**,
  H-168 **41/41**, UI online **6/6**, PWA **2/2**, arquitectura online PASS.
  Total final de once suites: **189 comprobaciones aprobadas**, más la guarda
  estática de arquitectura. Refijado después de regresión verde con
  `node test-h185-sale-ticket-layout.mjs --fijar "H-185: menor longitud con garantías conservadas"`:
  **30/30**, límites nuevos versionados en `h185-sale-ticket-ceiling.json`.
- H-168 escribió inicialmente su salida histórica por omitir el destino de
  evidencia: se conservó la salida nueva en `h185-website/` y se repusieron
  exclusivamente los cuatro archivos históricos modificados. El PDF ausente
  antes de esta historia se mantiene ausente; no se incluye trabajo ajeno.
  H-183/H-184 también escriben sus JSON históricos: las salidas de esta corrida
  quedaron en `h185-usb-sale.json`/`h185-usb-variants.json` y los originales se
  restauraron desde HEAD. Toda la evidencia anterior permanece intacta.

Evidencias `docs/fixes/evidence/h185-*.json`. HTML probado SHA-256:
`7b590607dcedd76e3bc788893b2a8f81cc63d87376250659292f8f97faf80346`.

FF-01/02: contrato visual solicitado, no cambio de negocio. FF-03/04: plantilla
única y datos congelados son las autoridades. FF-05/06/07: mismo discriminador
de venta y mismo pipeline por copia/terminal; no se extiende a otros documentos.
FF-08: documentos persistidos intactos. FF-09: capacidades de todos los roles
intactas; SQL/RLS/service_role no aplican sin cambio de permisos/escritura.
FF-10/11: antes/después sobre bundle, imágenes completas y transporte real de
software simulado; UI de emisión y reimpresión cubierta por H-183/H-184.
Aprendizaje: cada omisión de contenido debe acotarse por tipo de comprobante
y demostrar que los demás conservan su artefacto, no sólo contar llamadas.

## Despliegue

Pendiente del workflow aprobado; sin migraciones ni escrituras comerciales.

## Riesgo residual y pendientes

HARDWARE NOT_TESTED: no hubo impresora física conectada para esta presentación.
La integridad de imágenes y bytes entregados no acredita papel ni corte físico.
Certificación distribuida A/B/C NO CERTIFICADO, no solicitada ni necesaria para
esta modificación de presentación según H-162.

## Referencias

- `docs/03-known-risks.md`, H-185.
- `docs/02-architecture.md`, evidencia visual del comprobante histórico.
- `ticket-venta-corto-h178.md`, `sistema-de-comprobantes-historicos.md`.
- `impresion-usb-comercial-h183.md`, `otros-tickets-usb-h184.md`.
