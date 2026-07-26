# Folios únicos multi-terminal

**Riesgo:** H-02
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** `23bec3b`

## Problema y reproducción

`node test-folio-concurrency.mjs` abrió dos contextos de navegador aislados,
ambos sin red y con el mismo contador inicial. Antes de la corrección los dos
generaron `BG-1`. Tras borrar `localStorage`, la primera terminal volvió a
generar `BG-1` y ni siquiera existía `balam_device_id`.

## Causa raíz

`DATA.nextFolio()` leía únicamente `balam_pos_folio_v1`, incrementaba el número
y concatenaba el prefijo. El contador no era compartido entre navegadores y no
participaba la identidad inmutable `_operationId`; por tanto, dos terminales,
perfiles reinstalados o navegadores borrados podían producir la misma clave
primaria `sales.folio`.

## Diseño

- Conservar el consecutivo local como componente legible.
- Generar primero el `operation_id` inmutable de cada venta.
- Incorporar al folio una representación base 36 de los 128 bits del UUID:
  `PREFIJO + consecutivo + token`.
- Mantener legibles y consultables todos los folios históricos sin token.
- Extraer el consecutivo sólo del segmento inmediatamente posterior al prefijo;
  los dígitos del token no alteran la secuencia.
- Si una operación antigua recibe `folio_conflict`, reidentificar en conjunto
  venta, renglones, pagos, movimientos, devoluciones locales y operaciones
  pendientes; reintentar con el mismo `operation_id` y `commit_id`.
- Nunca renombrar una venta ya confirmada.

## Solución

- `balam/data.jsx` genera la identidad antes del folio, crea/inicializa
  `balam_device_id`, compacta UUID completos sin perder bits y expone la
  reconciliación local de referencias.
- `balam/store.jsx` detecta `folio_conflict`, actualiza toda la operación durable
  y sus dependencias pendientes, y vuelve a ejecutar el commit idempotente.
- `test-folio-concurrency.mjs` cubre terminales offline, secuencia local y
  reinstalación/borrado del navegador.
- `test-store-queue.mjs`, caso 17, cubre compatibilidad de una operación antigua
  pendiente y verifica el reintento completo.
- `20260725002500_pos_h02_folio_verification.sql` verifica el contrato contra
  Supabase con filas temporales y las elimina al finalizar.
- `index.html` y `POS Balam (offline).html` se regeneraron desde `balam/`.

## Pruebas

- `node test-folio-concurrency.mjs`: 4/4.
- `node test-store-queue.mjs`: 55/55.
- `node test-sale-coherence.mjs`: 17/17.
- `node test-returns.mjs`: 17/17.
- `node test-concurrency.mjs`: 9/9.
- `node test-role-access.mjs`: 10/10.
- `node test-commission.mjs`: 10/10.
- `node build-offline.mjs`: correcto.
- Supabase: migración 025 desplegada; primera venta confirmada, segundo
  `operation_id` rechazado con `folio_conflict` sobre el mismo folio, reintento
  con folio reconciliado confirmado, dos identidades preservadas y temporales
  eliminados.

## Riesgo residual y pendientes

La unicidad depende de `crypto.randomUUID()` cuando está disponible. El fallback
para navegadores antiguos combina identidad de terminal, tiempo y aleatoriedad;
su riesgo de colisión es extremadamente bajo, pero no matemáticamente nulo. El
servidor conserva la defensa `folio_conflict` y nunca sobrescribe una venta con
otro `operation_id`.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-02--folios-generados-localmente`
- Arquitectura: `docs/02-architecture.md#identidad-y-folio-de-venta`
