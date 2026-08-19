# Paridad de capacidad de baja de productos V1/V2

**Riesgo:** H-114
**Estado:** RESUELTO
**Fecha:** 18/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Inventario mostraba `Eliminar` para una fila V1, pero la ocultaba en toda
proyección familiar V2, incluso singleton. El rojo inicial obtuvo 1/13 en el
contrato y 2/5 en navegador: V2 no tenía entrada, selección de alcance,
confirmación ni operación remota familiar.

La matriz cubrió V1 individual; V2 singleton, multitalle y misma talla con
referencias distintas; stock cero/positivo; historial vigente/vencido;
préstamo, cola, familia parcial, tombstone, pull y reload. Se usaron únicamente
fixtures locales con Supabase interceptado; no se borraron datos reales.

## Causa raíz

H-102 sustituyó la fila física V2 por una proyección comercial que representa
una familia y deliberadamente no posee un `products.id`. `DetailDrawer` evitaba
pasar esa identidad inexistente a `removeProduct(id)`, pero dejó huérfana la
baja equivalente. La autoridad remota existente aceptaba un solo ID y no podía
garantizar atomicidad ni conjunto familiar exacto.

## Diseño

- V1 y V2 singleton eliminan un `products.id` exacto.
- Una familia con varias referencias obliga a elegir entre una referencia
  humana concreta o todas sus referencias activas.
- La selección humana usa talla y sólo atributos físicos que realmente difieren;
  no muestra UUID, familia, firma, SKU ni posición interna.
- Stock positivo conserva la semántica inequívoca de V1 y se declara en la
  confirmación. No se modifica stock para permitir la baja.
- Se bloquean con autoridades existentes: liquidación/apartado activo, préstamo
  abierto, cola previa y saldo posventa aún restituible por devolución/cambio.
- Históricos vencidos no bloquean: ventas, tickets, devoluciones, cambios,
  préstamos y movimientos permanecen como snapshots.
- La familia viaja en una sola operación durable. PostgreSQL exige
  `inventory.delete`, versión exacta de cada fila y que los IDs coincidan con
  todo el conjunto activo; crea tombstones en una sola transacción y audita la
  clave idempotente.
- `delete_product_checked_v2` delega la baja individual a la misma autoridad,
  evitando una segunda implementación.

## Solución

- `balam/inventory.jsx`: acción V2, selector de alcance/referencia y confirmación
  responsive usando el modal existente.
- `balam/data.jsx`: `productDeletionGuard` y `removeProductScope`; baja local
  exacta, rollback si la cola durable no está disponible y adaptador V1/H-76.
- `balam/store.jsx`: operación única `productDeleteScope`, replay durable y RPC
  `delete_products_checked_v2`.
- `20260818015100_pos_h114_product_delete_scope.sql`: permiso, protocolo/época,
  versión, conjunto familiar, apartado, préstamo, restitución, tombstone e
  idempotencia.
- `20260818015200_pos_h114_product_delete_scope_verification.sql`: verificación
  estructural sin fixtures comerciales.
- Se regeneraron `index.html` y `POS Balam (offline).html` desde `balam/`.

## Pruebas

- Rojo: contrato 1/13; E2E 2/5.
- Verde H-114: contrato 13/13; E2E 5/5.
- BALAM QA independiente: 55/55 en 320, 360, 390, 430, 768, 1024, 1280 y
  1440 px; IDs ocultos, exactitud, guardas, tombstone, pull y reload.
- Puerta H-115 reabierta: 13/13.
- Regresiones: migraciones 31/31; módulos 42/42; capacidades 40/40; cola
  176/176; H-94 49/49; H-101 26/26; H-102 15/15; plazos 38/38; préstamos 69/69.
- Build productivo: correcto; bundle precompilado y PWA regenerados.

## Publicación y riesgo residual

Las migraciones se aplicaron a Supabase remoto después de un dry-run que enumeró
exclusivamente `20260818015100` y `20260818015200`. Su ejecución sólo cambió
funciones, permisos e historial técnico de migraciones: no hizo backfill ni
modificó productos, stock, identidades o documentos comerciales. La verificación
remota confirmó RPC, ACL, guardas, tombstone e idempotencia sin invocar una baja.

Firefox, WebKit, dos equipos físicos y periféricos continúan no verificados;
Chrome aislado sí cubrió 320–1440 px, pull/reload, offline y convergencia por
tombstone. No se ejecutó ninguna eliminación real durante la validación.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-114.
- `docs/architect/authorities/inventory.md`.
- `docs/05-operational-capabilities.md`.
- `docs/fixes/modelo-referencias-fisicas-v2.md`.
- `docs/fixes/captura-edicion-masiva-v2.md`.
- `docs/fixes/proyeccion-comercial-familias-v2.md`.
