# Venta transaccional e idempotente

**Riesgo:** H-04
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** `23bec3b`

## Problema y reproducción

`test-store-queue.mjs`, caso 14, reprodujo el flujo anterior inyectando un fallo
en `sale_items`: la reserva H-01 y la cabecera ya habían quedado confirmadas,
los renglones no existían y la cola sólo podía intentar reparar después el
estado parcial.

## Causa raíz

`STORE.applyOp()` traducía una venta a solicitudes independientes:
`reserve_sale_stock`, `sales`, `sale_items` y `movements`. `DATA` enviaba pagos,
cliente y vendedores mediante operaciones adicionales. La cola agrupaba la
intención local, pero no existía una frontera transaccional SQL común.

## Diseño

- Conservar escritura local inmediata y cola offline.
- Un RPC constituye la única unidad remota de venta.
- Confirmar o revertir juntos stock, cabecera, renglones, movimientos, pagos y
  deltas de cliente/comisiones.
- Usar el ID durable de la cola como clave de commit y el `operation_id` estable
  de la venta para la reserva de stock.
- Guardar hash de payload: mismo ID y contenido es idempotente; contenido
  distinto se rechaza.
- Un abono de apartado es un commit nuevo; la liquidación reserva stock con el
  identificador estable original.
- Migrar operaciones antiguas en cola sin perderlas.

## Solución

- `balam/data.jsx` persiste pagos y agregados localmente sin crear pushes
  independientes durante la venta; entrega a `pushSale` el historial completo
  y los deltas exactos. La liquidación de apartado produce un solo push.
- `balam/store.jsx` reemplaza la secuencia PostgREST por `pos.commit_sale()`,
  conserva la operación completa en cola y reconcilia las filas devueltas.
- `20260725001900_pos_transactional_sale.sql` crea `pos.sale_commits` y el RPC
  atómico e idempotente.
- `20260725002000_pos_transactional_sale_verification.sql` ejecuta aserciones
  remotas autocontenidas y elimina sus filas temporales.
- `balam/data.jsx` agrupa también los efectos locales de devolución y evita los
  pushes separados de producto, venta, cliente y vendedor.
- `balam/store.jsx` confirma la devolución exclusivamente con
  `pos.commit_return()` y migra operaciones antiguas pendientes a modo
  compatible.
- `20260725002100_pos_transactional_return.sql` agrega `return_commits`,
  asociación de renglones/movimientos y el RPC transaccional.
- `20260725002200_pos_transactional_return_verification.sql` valida rollback,
  idempotencia, sobredevolución y devoluciones parciales concurrentes.
- `balam/store.jsx` adopta operaciones de devolución antiguas con objetivos
  exactos y versiones base persistidos desde el snapshot local; una cola sin
  contexto suficiente permanece pendiente con `legacy_context_incomplete`.
- `20260725002300_pos_legacy_return_adoption.sql` agrega
  `pos.commit_legacy_return()`: aplica objetivos sólo sobre su versión base,
  reconoce el estado ya aplicado y rechaza versiones posteriores sin escribir.
- `20260725002400_pos_legacy_return_adoption_verification.sql` valida ambas
  rutas de adopción, el reintento idempotente y el conflicto conservador.
- `index.html` y `POS Balam (offline).html` se regeneraron desde `balam/`.

## Pruebas

Supabase real:

- migraciones 019 y 020 desplegadas;
- fallo de pago inyectado después de reserva/cabecera/renglones/movimientos:
  rollback total y stock restaurado;
- commit válido: exactamente una cabecera, un renglón, un movimiento y un pago,
  con cliente y comisión actualizados;
- reintento idéntico: `idempotent=true`, sin duplicar efectos;
- misma clave con payload distinto: `commit_mismatch`;
- eliminación de producto, cliente, vendedor, venta, pago, movimiento, reserva
  y commit temporales antes de confirmar.

Supabase real, devolución:

- fallo tardío después del reingreso de stock: rollback de todas las tablas,
  estado y agregados;
- devolución parcial válida: una cabecera, renglón y movimiento, stock +1,
  venta parcial y reversos exactos;
- reintento idéntico sin duplicados;
- intento de devolver dos unidades cuando quedaba una:
  `invalid_return_quantity`, sin efectos;
- segunda devolución válida: venta `Devuelto`, stock totalmente restaurado y
  ambos movimientos conservados;
- payload distinto con la misma clave: `commit_mismatch`;
- cero filas o perfiles temporales al finalizar.

Supabase real, cola antigua:

- objetivo pendiente aplicado exactamente una vez junto con la devolución;
- reintento reconocido sin incrementar nuevamente las versiones;
- snapshot previamente sincronizado reconocido en `base_version + 1`;
- tercera versión rechazada como `legacy_version_conflict`, sin crear la
  devolución;
- migraciones 023 y 024 desplegadas y datos temporales eliminados.

Regresiones:

- `node test-store-queue.mjs`: 52/52;
- `node test-sale-coherence.mjs`: 17/17;
- `node test-returns.mjs`: 17/17;
- `node test-concurrency.mjs`: 9/9;
- `node test-role-access.mjs`: 10/10;
- `node test-commission.mjs`: 10/10;
- `node build-offline.mjs`: correcto.

`test-liquidations.mjs` no inició por timeout al cargar el HTML fuente con
dependencias externas; no produjo una falla de dominio.

## Riesgo residual y pendientes

H-04 queda resuelto para las dos operaciones compuestas identificadas: venta y
devolución, incluidas las operaciones antiguas válidas que ya estuvieran en la
cola durable. No queda riesgo residual conocido dentro de H-04. Una cola
dañada o sin el snapshot local necesario no se confirma parcialmente: queda
pendiente con un error explícito para reconciliación.

La colisión del folio visible, que no era una escritura parcial ni parte de
H-04, quedó resuelta posteriormente en H-02.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-04--escrituras-sin-transacción-única`
- Arquitectura: `docs/02-architecture.md#commit-transaccional-de-venta`
