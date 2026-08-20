# Consistencia entre Devoluciones y limpieza selectiva

**Riesgo:** H-120
**Estado:** RESUELTO — PENDIENTE DE PUBLICACIÓN
**Fecha:** 19/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

La captura de una terminal mostraba como `Devolución parcial` las ventas
BG-260812-0004, BG-260812-0001 y BG-260811-0015, mientras la misma versión
publicada mostraba `Devoluciones: 0` al seleccionar exclusivamente ese grupo en
Administración / Datos. El build público y el blob Git eran idénticos:
9,008,603 bytes, SHA-256
`0fc59871029158c0f595ecbde8c58561e4c09f35e46ea39020aeecf168911962`.

La contradicción era real desde el contrato del usuario, pero las pantallas no
leían la misma proyección:

- Devoluciones elegía ventas con `DATA.sales[].estado` igual a `Pagado`,
  `Entregado`, `Enviado` o `Devolución parcial`.
- El historial lateral leía `DATA.returns`.
- H-113 contaba exclusivamente cabeceras autoritativas `pos.returns`; no exigía
  `return_items`, no contaba `sales.estado`, commits, movimientos ni datos
  locales. Ese criterio es correcto para borrar: un estado o un hash no prueban
  piezas, importe ni efecto de stock.

La regresión aislada confirmó el defecto funcional: venta de dos piezas
`Pagado` → devolución de una → venta `Devolución parcial`; limpiar únicamente
Devoluciones eliminaba el documento y revertía el stock, pero conservaba la
venta como `Devolución parcial`. El primer rojo fue
`H120_PRIOR_SALE_STATE_CONTRACT_MISSING`.

## Evidencia real read-only

La lectura autoritativa actual no encontró ventas, partidas, devoluciones,
partidas de devolución, movimientos, pagos ni tombstones para los tres folios.
Tampoco existen respaldos/eventos H-98 o H-113 que permitan reconstruirlos. Los
reportes H-68 terminan el 10/08/2026 y declararon cero devoluciones; las
operaciones observadas ocurrieron el 12 y 13/08, por lo que H-68 no explica su
desaparición.

| Folio | Evidencia durable actual | Evidencia histórica | Clasificación segura |
|---|---|---|---|
| BG-260811-0015 | `return_commit` sin cabecera; sin venta/items/movimientos/pagos | venta sincronizada 12/08 06:27:59Z; devolución sincronizada 06:28:04Z | Parcial: commit huérfano |
| BG-260812-0001 | `return_commit` sin cabecera; sin venta/items/movimientos/pagos | venta sincronizada 12/08 07:26:25Z; devolución sincronizada 07:26:32Z | Parcial: commit huérfano |
| BG-260812-0004 | ninguna fila comercial/commit vigente | venta sincronizada 13/08 00:24:02Z; devolución sincronizada 00:24:06Z | Indeterminable; sólo telemetría histórica |

`return_commits` conserva identidad y hash, no el payload. Por eso no se pueden
recuperar producto, talla, cantidad, reembolso, stock, comisión o forma de pago.
La captura prueba que una terminal conservaba la proyección local de las ventas;
un perfil nuevo, después del pull autoritativo, no contiene ninguno de esos
folios. No hay evidencia suficiente para atribuir la desaparición a H-113,
H-98, H-68 u otra acción concreta. Repararlos o descartarlos sería inventar.

## Causa raíz

`DATA.recordReturn()` actualizaba `sale.estado` y creaba el documento de
devolución, pero el documento no congelaba el estado anterior. H-113/H-119
eliminaba `returns`, `return_items`, commit, movimiento y efecto de stock por
identidad, conservaba la venta y no restauraba su estado. Los arneses H-119
sembraban una devolución junto a una venta todavía `Pagado`, evitando el ciclo
real que habría expuesto el fallo.

Separadamente, la pantalla Devoluciones confiaba en el estado de venta aunque
no existiera el documento local que lo justificara, y el preview no mostraba los
`return_commits` huérfanos. El conteo cero era correcto, pero la explicación era
incompleta.

## Diseño

- `returns.prior_sale_state` congela hacia adelante `Pagado`, `Entregado` o
  `Enviado` antes de la primera devolución. Las devoluciones posteriores heredan
  exactamente la misma evidencia.
- `NULL` significa histórico no demostrable. No se rellena ni se interpreta.
- Una limpieza que conserve la venta sólo es ejecutable si todos los documentos
  del folio demuestran un único estado anterior válido.
- PostgreSQL restaura ese estado en la misma transacción/lock que elimina la
  devolución. El plan, respaldo, resultado y evento contienen la misma
  identidad `folio + prior_state`.
- El protocolo selectivo sube a 4. Un cliente 3 ignora el evento nuevo y la época
  lo obliga a rebootstrap; no puede aplicar una proyección incompleta.
- Un `return_commit` sin `returns` se presenta como evidencia histórica y bloquea
  Devoluciones, pero no incrementa el conteo borrable ni autoriza eliminar nada.
- Devoluciones falla cerrado en ambas inconsistencias: estado parcial/devuelto
  sin documento, o documento existente sin estado de venta coherente.
- Ninguna regla cuenta `sales.estado` como devolución.

## Solución

- `20260819015900_pos_h120_return_state_cleanup.sql` agrega el snapshot, endurece
  plan/respaldo/ejecución/evento, publica evidencia huérfana y eleva esquema y
  protocolo selectivo.
- `20260819016000_pos_h120_return_state_cleanup_verification.sql` verifica la
  definición final sin tocar filas comerciales.
- `balam/data.jsx` concentra `returnLifecycle()`, congela el estado previo y
  aplica la restauración exacta local/remota con rollback.
- `balam/store.jsx` transporta el snapshot y declara esquema H-120/protocolo 4.
- `balam/returns.jsx` separa las ventas inconsistentes, impide reprocesarlas y
  pide resincronización/revisión sin modificar su estado.
- `balam/settings.jsx` muestra folio, fecha e identidad técnica de commits
  huérfanos y explica por qué no son devoluciones borrables.

## Ciclo E2E

Fixture aislada UI real → DATA/STORE real → PostgreSQL 18:

1. Venta de dos piezas: stock 10→8, estado `Pagado`, pago/commit/reserva y
   movimiento Venta presentes.
2. Devolución de una desde la pantalla: `returns=1`, `return_items=1`, movimiento
   Devolución, stock 8→9, estado `Devolución parcial`, snapshot `Pagado` local y
   remoto, una sola RPC.
3. Preview sólo Devoluciones: conteo 1, stock 9→8, CTA habilitado.
4. Respaldo: venta conservada y movimiento de devolución incluidos; movimiento
   Venta excluido del alcance de borrado.
5. Ejecución: devolución/item/commit/movimiento eliminados; venta/item/pago/
   commit/reserva/movimiento Venta/producto conservados; stock 8; estado
   restaurado a `Pagado`.
6. Reload y segunda terminal: `returns=0`, H-113 bloquea el no-op, la venta es
   devolvible como `Pagado` y no aparece ningún estado parcial/inconsistente.

Resultado: 37/37, incluido el caso huérfano, la proyección inconsistente y
responsive 320, 360, 375, 390, 430, 768, 1024, 1280 y 1440 px.

## Auditoría de los siete grupos H-113

| Grupo | Autoridad de UI | Autoridad SQL borrable | Conteo real | Resultado |
|---|---|---|---:|---|
| Ventas y apartados | `DATA.sales` | `pos.sales` | 1 | Coincide |
| Devoluciones | documento `DATA.returns`; `sales.estado` sólo proyección coherente | `pos.returns` | 0 + 2 evidencias huérfanas no borrables | Coincide después de separar evidencia |
| Cambios | `DATA.exchanges` | `pos.exchanges` | 0 | Coincide |
| Préstamos | `DATA.loans` | `pos.loan_documents` | 0 | Coincide |
| Comisiones | liquidaciones/ajustes; saldo derivado aparte | `pos.liquidations` + `pos.commission_adjustments` | 0 | Coincide |
| Reclasificaciones | operaciones de referencia | `pos.reference_reclassifications` | 0 | Coincide |
| Clientes de prueba | `DATA.clients` no genéricos | clientes activos no genéricos y no referenciados por ventas conservadas | 0 elegibles | Coincide |

La venta real BG-260810-0011 es el único documento incluido al marcar Ventas;
el preview demostró stock 1→2. Los otros seis grupos no contienen documentos
borrables. La falta histórica de evidencia de comisiones de esa venta continúa
como guarda independiente y no se ocultó.

## Pruebas

- Rojo H-120 y verde PostgreSQL con rollback.
- Verificación estructural H-120 verde sobre esquema H-119 completo.
- H-119 funcional verde con estado restaurado.
- Devoluciones local: 21/21.
- E2E ciclo/UI/PostgreSQL: 37/37.
- H-113 contrato 35/35 y UI 21/21.
- H-116 contrato 20/20 y UI 29/29.
- H-117 A–H 65/65; H-118 10/10.
- Cola 176/176; módulos 42/42; migraciones 31/31.
- Responsive general 492/492; smoke bundle 17/17; build reproducible 8/8.
- Revisión visual manual de evidencia huérfana y venta inconsistente a 390 y
  1440 px: jerarquía, texto, CTA, detalle técnico y scroll correctos.

## Riesgo residual y pendientes

Los tres folios reales siguen sin payload recuperable. H-120 evita repetir y
ocultar la inconsistencia, pero no repara historia. Los dos commits huérfanos
quedan bloqueados y visibles para revisión; BG-260812-0004 sólo conserva
telemetría. Cualquier reconstrucción exige una fuente externa autoritativa
(ticket, respaldo, inventario físico y evidencia de reembolso) y autorización
separada.

Datos comerciales reales modificados: **NO**. No se ejecutó limpieza, respaldo,
devolución, reintento, descarte, cuarentena, retiro, heartbeat artificial ni
escritura de stock/ventas/pagos/comisiones/movimientos. La migración es aditiva y
las pruebas comerciales usaron exclusivamente PostgreSQL aislado.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-120--limpiar-devoluciones-conserva-un-estado-de-venta-sin-evidencia`
- `docs/fixes/limpieza-solo-devoluciones.md`
- `docs/architect/authorities/sales.md`
- `docs/architect/authorities/inventory.md`
- `docs/architect/authorities/synchronization.md`
