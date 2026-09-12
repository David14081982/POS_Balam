# Recuperación de la página web configurable en tickets

**Riesgo:** H-168.
**Estado:** PARCIALMENTE RESUELTO — función publicada y verificada; A/B/C real y papel NO CERTIFICADO.
**Fecha:** 12/09/2026.
**Commit técnico:** `c02ad1336051409f6698bfb05b1f209882af9430`.

## Problema y reproducción

El usuario pidió BALAMGUAYABERAS.MX y una tarjeta Página web debajo de Pie de
ticket. La implementación local fue preservada por H-165 pero no integrada.
Procedencia: `rescue/20260912/01-pos-balam-ticket-h134`, commit de rescate
`a04f676b3a25070afebaacf04c136f2b21d6722f`, documento original
`docs/fixes/pagina-web-tickets-h157.md`. Ese H-157 local colisiona con otra
historia publicada; H-168 identifica esta recuperación sin reemplazarla.

El nuevo arnés ejecuta el cliente publicado de 695e9fe: **6/32**, con 26 fallos
por campo ausente y contacto fijo incorrecto, cero excepciones de navegador.
Evidencia: `evidence/h168-before/results.json`. El HTML previo tiene SHA-256
`e0d1abbd98ca207143a20e5a376b8c550af41967f67feae80de3d3ac751c837c`.

## Causa raíz

La reconstrucción de Git conservó los archivos en ramas de rescate sin
fusionarlos. La entrega H-167 incorporó sólo Etiquetas. Main aún contenía el
literal BALAMGUAYABERAS.COM en BalamTicket; Settings carecía del nuevo campo.
La implementación rescatada dependía de persistencia local y no era trasladable
completa sobre H-164. Sus 43/43 históricos no certifican el cliente vigente.

## Diseño

Se conserva CONFIG como autoridad. `ticket.website` tiene default
BALAMGUAYABERAS.MX; si un snapshot confirmado antiguo no contiene la clave,
`CONFIG.get()` ofrece el default sólo para presentación. La lectura no modifica
el snapshot ni escribe datos. Un valor personalizado, vacío o nulo prevalece;
sin autoridad confirmada no se inventa la configuración de una cuenta.

La tarjeta reutiliza el CfgText vigente, con borrador y clave React estable:
guardar pasa por CONFIG → CORE → confirmación remota. Otro ajuste recibido no
descarta el borrador. Las actualizaciones recibidas se muestran sin reenviarlas
al perder foco. No se reintroduce el guardado offline ni el antiguo backfill.

El contacto vigente aparece en venta, reimpresión, anticipo, abono, liquidación,
cambio, devolución y ticket de Reportes. No modifica importes, folios, stock,
pagos ni snapshots históricos; el sitio es un contacto de presentación. Vacío
omite la línea. React y el escapado HTML existente impiden interpretar el texto
como marcado. No se modifican préstamos A4, etiquetas ni informes A4.

## Solución

- `balam/config.jsx`: ajuste inicial y compatibilidad de lectura específica.
- `balam/settings.jsx`: tarjeta Página web debajo de Pie de ticket.
- `balam/pos-ticket.jsx`: componente compartido ReceiptWebsite y actualización
  de un ticket abierto mediante configchange.
- `balam/reports.jsx`: contacto escapado en el ticket por método de pago.
- `test-h168-ticket-website.mjs`: escenarios rescatados adaptados al contrato
  online, ejecutados también por CI antes de Pages.

No se cambia STORE, Auth, permisos, SQL ni la pantalla de confirmación global.
No hay migración. La edición no crea otra autoridad ni publica una configuración
comercial durante el despliegue del cliente.

## Pruebas

| Comando | Resultado |
|---|---|
| `node test-h168-ticket-website.mjs` | **41/41**, cero excepciones; previo 6/32 |
| `node test-h164-online-config.mjs` | **3/3** |
| `node test-h164-online-ui.mjs` | **6/6** |
| `node test-h164-online-pwa.mjs` | **2/2** |
| `node build-offline.mjs` | exit 0; dos HTML idénticos |

El arnés agrega nueve comprobaciones cuando el control está presente. Verifica
confirmación diferida, rechazo, desconexión, ausencia de almacenamiento comercial,
recarga desde snapshot simulado, conservación de borrador, ocho tipos de ticket,
configuración recibida, texto literal, vacío, dirección larga y conservación de
documentos económicos. Genera PDF real e inspecciona layout a 320/768 px. Las
capturas de Configuración a 1280/390 px fueron inspeccionadas visualmente.
El transporte de configuración es controlado: no son pruebas Supabase reales.

Evidencias: `evidence/h168-after/`, `h168-online-ui.json` y
`h168-online-pwa.json`. HTML final, ambos archivos:
`da893c5ead81446ce608c7c824aad79fc49cc3e9e85baa9334a0275399d589d9`.
Service worker:
`719c1001147a56dab267027e271837f589b7cfa825674f777f13be4b0209645c`.

## Publicación

Commit `c02ad1336051409f6698bfb05b1f209882af9430` enviado a main con autorización
explícita del usuario. El [workflow 34723299369](https://github.com/David14081982/POS_Balam/actions/runs/34723299369)
completó regresiones y Pages en SUCCESS, incluida la prueba H-168.
`index.html`, `POS Balam (offline).html` y `sw.js` descargados desde la web dieron
HTTP 200 y coincidencia byte a byte con los blobs del commit y los archivos
locales probados. Hashes arriba. Evidencia con hora UTC y rutas exactas:
[`h168-publication.json`](evidence/h168-publication.json) y
[`h168-workflow.json`](evidence/h168-workflow.json).

## Riesgo residual y pendientes

Sin A/B/C real sobre Supabase ni
papel físico: **NO CERTIFICADO** para ese alcance. Se conserva la cobertura local
de interfaces y documentos; no se atribuye certificación a pruebas históricas.
La recuperación afecta una sola historia y conserva H-167 en la misma base.

## Referencias

- `docs/03-known-risks.md`, H-168.
- `docs/architect/playbooks/client.md`, R-CLI-03/06/08.
- `docs/architect/playbooks/delivery.md`, R-DEL-04/06/07.
- `docs/fixes/sistema-de-comprobantes-historicos.md`.
