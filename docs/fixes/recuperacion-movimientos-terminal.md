# Recuperación de movimientos en una terminal nueva

**Riesgo:** H-13
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Las ventas y devoluciones guardaban sus movimientos dentro de
`pos.commit_sale()` y `pos.commit_return()`. Supabase contenía las filas de
`pos.movements`, pero una terminal nueva no las recuperaba.

Se añadió una reproducción a `test-store-queue.mjs` con un movimiento remoto y
`DATA.movements` vacío. Antes de corregir pasaron 62 pruebas y fallaron las dos
nuevas:

- `pullDomain('movements')` no aplicó ninguna fila;
- no se realizó una consulta a `pos.movements`.

Ventas, renglones, pagos y devoluciones ya tenían caminos de reconstrucción. El
snapshot financiero completo había sido corregido previamente por H-03/H-04.

## Causa raíz

`DATA.applyRemote()` contemplaba el dominio `movements`, pero `STORE.MAP` no
tenía mapper para la tabla y `STORE.init({ pull: true })` no incluía ese dominio.
El flujo nube → local quedaba desconectado aunque el flujo de escritura
transaccional sí existía.

Además, una lectura simple de toda la tabla podía recibir sólo el límite
predeterminado de PostgREST y reemplazar el kardex local con una primera página
incompleta. Una venta o devolución pendiente también necesitaba proteger sus
movimientos locales hasta confirmar el commit remoto.

## Diseño

- Mantener la escritura exclusivamente dentro de los commits transaccionales.
- Añadir un mapper de sólo lectura para `pos.movements`.
- Recuperar movimientos únicamente en el arranque administrativo; el vendedor
  sigue limitado al Punto de Venta.
- Normalizar la fecha remota al formato local existente sin inventar campos.
- Paginar por el `id` creciente e inmutable en bloques de 1 000.
- Aplicar el reemplazo sólo después de completar todas las páginas.
- Si existe una venta o devolución pendiente de la sesión activa, omitir el
  pull de movimientos para conservar el estado local-first.
- No modificar esquema, RLS, datos remotos ni cola histórica.

## Solución

- `balam/store.jsx` incorpora `MAP.movements`.
- `fetchAllMovements()` recorre rangos consecutivos ordenados por `id`.
- `init({ pull: true })` incluye `movements` para administradores.
- `hasPendingFor('movements')` reconoce ventas y devoluciones pendientes.
- `test-store-queue.mjs` cubre recuperación aislada, mapeo, protección de cola,
  arranque limpio transaccional y paginación de 1 001 filas.
- Se regeneraron `balam/_source.html`, `POS Balam (offline).html` e
  `index.html`.

## Pruebas

Reproducción anterior:

- `node test-store-queue.mjs`: 62 pasaron, 2 fallaron.

Después de la corrección:

- `node test-store-queue.mjs`: 73/73.
- `node test-sale-coherence.mjs`: 17/17.
- `node test-returns.mjs`: 17/17.
- `node test-role-access.mjs`: sin fallos; el resumen vigente reporta 10/10.
- `node test-concurrency.mjs`: 9/9.
- `node test-smoke.mjs`: 13/13.
- `node build-offline.mjs`: artefactos regenerados correctamente.

La prueba de recuperación parte de una terminal vacía y confirma venta,
renglón, subtotal/IVA/total, anticipo/saldo, pago, devolución, renglón devuelto
y movimiento. La prueba de volumen recupera 1 001 movimientos mediante dos
rangos y verifica primera/última identidad y ausencia de duplicados.

## Riesgo residual y pendientes

Los movimientos históricos que nunca llegaron a Supabase no pueden
reconstruirse y no se inventan. En el modelo vigente, los movimientos de venta
y devolución nuevos sí se persisten dentro de los commits transaccionales.

La ventana de ventas soportada continúa siendo 365 días configurables más todos
los apartados; las ventas antiguas se recuperan por folio. La medición de
volumen, índices y paginación general de otros dominios corresponde a la Fase
14 de la auditoría. H-13 pagina movimientos porque aplicar un subconjunto habría
violado la integridad de esta corrección.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-13--terminal-nueva-no-recupera-movimientos-remotos`.
- Arquitectura: `docs/02-architecture.md#recuperación-transaccional-de-terminal`.
- Correcciones relacionadas: `docs/H-03-coherencia-cobro.md` y
  `docs/fixes/venta-transaccional-idempotente.md`.
