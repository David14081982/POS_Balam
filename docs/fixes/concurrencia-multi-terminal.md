# Control de concurrencia multi-terminal

**Riesgo:** H-06
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit de corrección:** `23bec3b`
**Commit de verificación:** Pendiente de commit
**Despliegue Supabase:** `20260725001300`, proyecto
`telohdbvbvsfmwyriflz` (Balam)

## Problema y reproducción

Precondiciones:

- dos terminales leen la misma fila y su misma versión;
- la terminal A modifica y sincroniza primero;
- la terminal B conserva el snapshot anterior y guarda después.

Antes del cambio, B enviaba la colección completa mediante `upsert` por `id`.
La fila antigua sustituía silenciosamente a la escrita por A. Una eliminación
física también podía revivir cuando una terminal vieja reenviaba la fila.

`test-concurrency.mjs` reproduce stock restaurado, edición obsoleta,
eliminación seguida de snapshot antiguo y el mismo conflicto en productos,
clientes, vendedores y promociones. Antes de implementar pasaron 1 y fallaron
4 de los primeros 5 escenarios.

## Causa raíz

`DATA` entregaba colecciones completas a `STORE.pushRows()`. `STORE` ejecutaba
`upsert` usando únicamente el identificador; no transmitía la versión leída ni
verificaba qué fila devolvía Supabase. Los borrados eran físicos.

`updated_at` existía, pero no se renovaba en cada actualización ni formaba parte
de una precondición. Por tanto, el servidor no podía distinguir una edición
vigente de un snapshot antiguo.

## Diseño

- Cada fila protegida tiene `sync_version`, iniciada en cero para datos
  históricos.
- Cada escritura incluye `sync_base_version`, la versión que leyó la terminal.
- El trigger acepta únicamente la versión vigente, incrementa la versión y
  actualiza `updated_at`.
- Una versión antigua conserva la fila vigente, registra un intento en
  `pos.sync_conflicts` y devuelve esa fila al cliente.
- `STORE` solicita representación después del `upsert`; `DATA` avanza la versión
  local cuando la escritura fue aceptada o restaura la fila vigente y avisa
  cuando hubo conflicto.
- Las eliminaciones son tombstones (`deleted_at`) mediante
  `pos.soft_delete_entity`; un snapshot viejo ya no puede reinsertarlas.
- La cola sigue siendo local-first, durable y compactable. Las operaciones
  antiguas se migran a `kind` y los deletes pendientes se convierten a
  tombstone.
- Política de conflicto: primera escritura de una versión gana. La segunda no
  se fusiona automáticamente; se rechaza, se audita y la interfaz recibe la
  versión vigente.

## Solución

- `supabase/migrations/20260725001300_pos_013_concurrency.sql`: columnas,
  trigger, auditoría, RLS y RPC de
  tombstone.
- `balam/store.jsx`: identificador de terminal, versión base, respuesta
  verificable, migración de cola, avisos y borrado lógico.
- `balam/data.jsx`: aplicación de resultados, conservación de versiones y
  filtrado de tombstones.
- `test-concurrency.mjs`: simulación determinista de dos terminales.
- `index.html` y `POS Balam (offline).html`: regenerados desde la fuente.

## Pruebas

- `node test-concurrency.mjs`: 9 pasaron, 0 fallaron.
- `node test-store-queue.mjs`: 34 pasaron, 0 fallaron.
- `node test-sale-coherence.mjs`: 15 pasaron, 0 fallaron.
- `node test-commission.mjs`: 10 pasaron, 0 fallaron.
- `node build-offline.mjs`: correcto; ambos artefactos regenerados.
- `node test-smoke.mjs bundle`: arranque, modo producción, ausencia de errores de
  página, inventario y formulario aprobados; después quedó bloqueado por el
  overlay de errores de recursos interceptados del entorno de prueba.
- Las pruebas de navegador sobre `POS Balam.html` no arrancaron porque requieren
  recursos externos que no estuvieron disponibles.
- `test-discounts.mjs`: 30 pasaron, 2 fallaron en el piso de margen; fallo previo
  y fuera del alcance H-06.

Despliegue remoto:

- `npx supabase db push --linked --dry-run`: confirmó que únicamente se
  aplicaría `20260725001300_pos_013_concurrency.sql`.
- `npx supabase db push --linked --include-all --yes`: migración aplicada
  correctamente.
- `npx supabase migration list --linked`: versión local y remota
  `20260725001300`.
- `npx supabase inspect db table-stats --linked`: confirmó
  `pos.sync_conflicts` en el esquema remoto, con cero conflictos iniciales.
- `npx supabase db dump --linked --schema pos ...`: no ejecutado; la CLI exige
  Docker Desktop y no estaba disponible. No se cuenta como prueba aprobada.
- `20260725002600_pos_h06_concurrency_verification.sql`: verificación remota
  autocontenida sobre productos, clientes, vendedores y promociones.
- Las dos terminales lógicas leyeron versión 1. La terminal A confirmó versión
  2; los cuatro intentos posteriores de B con base 1 conservaron A.
- Una promoción eliminada en versión 3 no revivió cuando B reenvió el snapshot
  de versión 2.
- `pos.sync_conflicts` registró exactamente cinco eventos: cuatro ediciones
  obsoletas y un intento de resurrección, con versiones y `device_id`
  esperados.
- La migración eliminó las cuatro entidades y las cinco auditorías temporales
  antes de finalizar.

Regresiones finales:

- `node test-concurrency.mjs`: 9/9;
- `node test-store-queue.mjs`: 55/55;
- `node test-role-access.mjs`: 10/10;
- `node test-sale-coherence.mjs`: 17/17;
- `node test-returns.mjs`: 17/17;
- `node test-folio-concurrency.mjs`: 4/4.

## Riesgo residual y pendientes

No queda riesgo conocido de sobrescritura silenciosa dentro de las cuatro
entidades protegidas. Los snapshots completos siguen siendo ineficientes y un
conflicto no fusiona campos automáticamente: por diseño, la primera escritura
confirmada gana, la segunda terminal recibe la versión vigente y debe reaplicar
su intención si todavía corresponde.

Las ventas simultáneas usan la reserva transaccional resuelta en H-01; los
folios multi-terminal quedaron resueltos en H-02.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-06--sobrescritura-multi-terminal-de-entidades`
- Arquitectura: `docs/02-architecture.md`
- Riesgo relacionado: H-01 — Inventario concurrente.
