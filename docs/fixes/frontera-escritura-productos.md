# Frontera explícita de escritura de productos

**Riesgo:** H-95
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 11/08/2026
**Commit:** `3973499`

## Problema y reproducción

Una intención acotada como `pushRows('products', subset)` conservaba `rows` al
encolarse, pero no conservaba su alcance como contrato durable. Justo antes de
enviarla, `STORE.applyOp()` sustituía el payload por un mapeo de todo
`DATA.products`. La prueba roja reprodujo que solicitudes de una y once filas
podían expandirse al inventario local completo. La suite H-95 inicial quedó
2/11 y la extensión de cola quedó 162/168.

El mismo permiso implícito existía en `DATA.saveProducts()`: persistir la caché
local podía llamar a sincronización remota sin IDs. Además,
`remapOrphanCodes()` mutaba productos y llamaba ese guardado desde el listener
global de `configchange`, por lo que una invalidación de CONFIG podía terminar
en un upsert de inventario.

## Causa raíz

La operación durable de productos no separaba tres conceptos:

1. el snapshot capturado al crear la operación;
2. los IDs que formaban la intención autorizada;
3. el estado local más reciente usado para rebasar versiones antes del envío.

Al faltar el segundo, el rebase usaba el arreglo completo como sustituto. En la
capa DATA, `saveProducts(sync = true)` mezclaba persistencia local y permiso de
red, y `configchange → remapOrphanCodes() → saveProducts()` convertía una
notificación en una escritura.

## Diseño

- Todo upsert de `products` declara `rowIds` no vacíos, únicos y exactos.
- El rebase puede refrescar los datos de esos IDs, pero nunca ampliar el
  conjunto. Si falta una fila, la operación se bloquea como
  `product_scope_incomplete`.
- Una operación histórica obtiene `rowIds` exclusivamente de su payload
  persistido; si no puede demostrarlos, queda bloqueada y no se reconstruye.
- `persistProducts()` sólo guarda localmente. `syncProducts(ids)` concede la
  intención remota. `saveProducts(ids)` compone ambas; sin IDs sólo persiste.
- `configchange`, CONFIG remota, pull, Realtime, reconexión y relevo de terminal
  no conceden intención de escritura.
- `remapOrphanCodes()` es diagnóstico puro. Una corrección exige preview,
  confirmación visible y aplicación de un plan inmutable sobre un ID concreto.
- Los flujos que sí modifican productos —alta/edición, Excel, fotos, catálogo y
  migración administrativa de tallas— transportan sus IDs explícitos.

## Solución

- `balam/store.jsx`: `rowIds` obligatorio para productos, migración segura de
  cola histórica, reconstrucción exacta, compactación por alcance y lotes de
  fotos por ID.
- `balam/data.jsx`: separación persistencia/sincronización, diagnóstico puro de
  huérfanos y reparación administrativa en dos fases.
- `balam/core.jsx` y `balam/config.jsx`: el gateway de catálogo transporta los
  IDs realmente modificados.
- `balam/inventory.jsx`, `balam/settings.jsx` y `balam/xlsx-io.jsx`: alta,
  edición, importación, códigos y fotos declaran el alcance exacto.
- `test-h95-product-write-boundary.mjs`, `test-store-queue.mjs`,
  `test-module-contracts.mjs` y `test-concurrency.mjs`: contratos ejecutables de
  invalidación, cola, payload y dos terminales.

No se restauró, reinterpretó ni regeneró ninguno de los 222 SKU V1 observados
durante el piloto H-94. Esta historia no contiene migración SQL.

## Pruebas

- Roja: `node test-h95-product-write-boundary.mjs` → 2/11; fallaban CONFIG,
  `configchange`, Realtime CONFIG, diagnóstico, relevo, dos terminales y
  estabilidad V1.
- Roja: `node test-store-queue.mjs` → 162/168; fallaban IDs/payload exactos de
  1 y 11 filas, cola offline y reintento.
- Verde: `node test-h95-product-write-boundary.mjs` → 16/16.
- Verde: `node test-store-queue.mjs` → 168/168.
- Verde: `node test-concurrency.mjs` → 15/15.
- Verde: contratos de módulos 42/42, CONFIG H-94 30/30, referencias H-94 48/48,
  H-63 34/34, H-74 25/25 y H-76 38/38.
- Regresión ampliada: sincronización viva 20/20, convergencia de equipos 7/7,
  escritor local 13/13, H-86 42/42, H-94 SQL 10/10, arranque 5/5, fotos
  automáticas 11/11, importación con fotos 23/23, exportación 14/14 y filtros
  18/18.
- Build reproducible 8/8 y smoke del bundle 17/17, con Supabase interceptado y
  cero tráfico de escritura real.
- Artefacto local: 8,959,245 bytes; SHA-256
  `e16d889824e5b773e9de3a5bfb8223a601e945b4c640203fe37a4b215e49138e`.

- `npx supabase db push --dry-run --linked` →
  `Remote database is up to date`; ninguna migración H-95 pendiente.
- Huella remota antes/después: 1,378 V1, 0 V2, 0 piloto, 3,334 piezas,
  `v1_fingerprint=d8bd3f2ed327f3e330c814d0bf9e8731`, versión máxima 79 y
  último `updated_at=2026-08-11 22:38:29.754181+00`, sin cambios.
- La última `inventory.adjust` sigue siendo
  `05e6b23e-afd4-4ea5-9806-c704ce2018f9`, la operación H-94 de 233 filas;
  no apareció ninguna operación posterior.
- `origin/main` y HEAD coinciden en
  `3973499f22f3307d5702b56d10c84cbb79047329`.
- GitHub Pages run `31552891080` → `success`.
- Artefacto servido: 8,959,074 bytes, SHA-256
  `f24fdb926036fe6eb088e7793f36ca3b3b918f9423f4e4d4cf26f35f89d76aa2`.
  Coincide exactamente con el build aprobado después de la única
  transformación de Pages: CRLF→LF en 171 líneas.
- `node .evidence-h95/verify-h95-published.mjs` sobre los bytes descargados →
  11/11: alcances 1/11, persistencia local, CONFIG, Realtime, dos terminales,
  diagnóstico, preview y aplicación por ID.

## Riesgo residual y pendientes

Ninguno conocido dentro de la frontera de escritura H-95. H-94 permanece
detenido y la canonicalización H-86 es otra historia; no se inició ni se
modificó aquí.

La tabla remota de observabilidad `sync_activity` conservó sin cambios 38 filas
no completadas, incluidas 2 bloqueadas. No equivale por sí sola a la cola local
activa y no se limpió ni reinterpretó en esta historia. La puerta global
`cola=0 / bloqueos=0 / CONFIG sincronizada` corresponde al cierre posterior de
ambas historias, tal como autorizó el dueño.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-95---una-escritura-acotada-de-productos-puede-expandirse-al-inventario-local-completo`
- `docs/architect/authorities/sync.md`
- `docs/architect/authorities/inventory.md`
- `docs/architect/decisions/013-live-multi-terminal-sync-protocol.md`
