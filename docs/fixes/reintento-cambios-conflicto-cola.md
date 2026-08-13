# Idempotencia durable de Cambios

**Riesgo:** H-96
**Estado:** RESUELTO
**Fecha:** 12/08/2026
**Commit técnico:** `b04d1ea`

## Problema y reproducción

En H94-PILOT se confirmó un Cambio V2 de A Dorado a B Azul y después se
reenviaron el mismo documento y sus efectos mediante `STORE.pushExchange()`.
La primera operación había salido de la cola; la segunda recibió
`exchange_id_conflict`, quedó como `retry_wait` y alcanzó 159 intentos con
`pending=1`, `blocked=0` y `synchronized=false`.

La reproducción automatizada añadió dos fronteras. Antes de la corrección,
`node test-exchange-commit.mjs` terminó **33/36** y
`node test-store-queue.mjs` **170/173**.

## Causa raíz

`pos.commit_exchange()` ya era idempotente cuando recibía el mismo
`p_commit_id`: `pos.exchange_commits` guarda clave y hash y la verificación
13700 comprueba que el segundo envío no cambia documentos, movimientos ni
stock. El cliente rompía ese contrato antes de llegar al RPC:

1. `recordExchange()` no recibía ni congelaba `operationId`.
2. `pushExchange()` no definía `op.key`.
3. `run()` crea correctamente un `op.id` nuevo para cada entrada de cola.
4. La llamada usaba `p_commit_id = op.key || op.id`; cada reenvío llegaba con
   la identidad técnica nueva de la cola.
5. El ledger no encontraba esa clave y el ID de Cambio existente producía
   `exchange_id_conflict`.

Además, `classifyFailure()` no incluía ese código entre los conflictos
permanentes y lo reintentaba indefinidamente.

## Diseño

- `operationId` identifica la intención comercial y se genera una sola vez.
- `op.id` identifica exclusivamente una entrada durable de cola.
- `op.key` transporta la identidad comercial hasta `p_commit_id`.
- Repetir clave y payload devuelve el documento local/remoto existente.
- Reutilizar la clave con otro payload devuelve `operation_mismatch` o
  `commit_mismatch` y se bloquea.
- `products.id` sigue siendo la identidad de cada renglón; SKU no participa.
- No se añade esquema ni se modifica historia: el SQL existente ya soportaba
  el contrato.

## Solución

- `balam/returns.jsx` conserva un `operationId` por flujo de Cambio y lo entrega
  a `DATA.recordExchange()` incluso ante doble clic.
- `balam/data.jsx` materializa `cmb-{operationId}`, congela la huella comercial
  local y reconoce una repetición exacta antes de cualquier efecto. Un payload
  distinto queda bloqueado. Stock, movimientos, pago y comisión se aplican una
  sola vez.
- `balam/store.jsx` conserva `op.key`, envía esa clave a
  `commit_exchange_checked`, la reconstruye del ID moderno después de un pull y
  clasifica `exchange_id_conflict` como `blocked_conflict`.
- No existe migración SQL H-96: no fue necesaria.

## Pruebas

- Roja: `test-exchange-commit.mjs` 33/36; `test-store-queue.mjs` 170/173.
- Verde: `test-exchange-commit.mjs` 36/36; `test-store-queue.mjs` 173/173.
- Cambio E2E 37/37; pantalla 45/45; comisión 30/30.
- Identidad posventa 16/16; cobro del Cambio 14/14.
- SQL H-94 Cambio 10/10; Venta/Devolución 15/15; modelo V2 48/48.
- H-95 16/16; H-86 opcionales 17/17; Excel 42/42; seguridad Excel 17/17.
- Contratos de módulos 42/42; migraciones 31/31.
- Build offline correcto; smoke bundle 17/17; navegación 15/15.

Los casos H-96 cubren envío normal, doble invocación, timeout después del
commit remoto, replay, reconexión, clave con payload distinto, dos
`products.id` con SKU homónimo, diferencia positiva, diferencia cero, pago,
comisión y cola final limpia.

## Riesgo residual y pendientes

Ninguno conocido dentro de H-96. Un `exchange_id_conflict` genuino queda
bloqueado para revisión y nunca entra en reintento automático. El piloto H-94
debe ejecutarse nuevamente desde limpio para acreditar el recorrido remoto
completo con el cliente publicado.

## Publicación

El commit `b04d1ea` quedó en `origin/main`. GitHub Pages sirve el blob de
`index.html` idéntico byte a byte: 8,962,127 bytes, SHA-256
`08ab2fd2bfd3303e7bc3b1b12c12629404caaa4da8df93655d8f59eca5227454`.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-96---el-reintento-de-un-cambio-confirmado-entra-en-conflicto-y-no-abandona-la-cola`
- `docs/04-contrato-del-cambio.md`
- `docs/architect/decisions/ADR-006-local-first-y-transaccion-sql.md`
- `docs/architect/decisions/ADR-010-materializacion-del-cambio.md`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
