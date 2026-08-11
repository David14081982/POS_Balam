# Modelo definitivo de referencias físicas V2

**Riesgo:** H-94
**Estado:** PUBLICADO Y VALIDADO CON DATOS DE PRUEBA — NO LISTO PARA PRODUCCIÓN
**Fecha:** 10/08/2026
**Commit técnico:** `136c8d0`

## Problema y reproducción

V1 reúne varias tallas en `stock[]`, deriva Code128 de `SKU+talla` y conserva
rutas que pueden resolver la primera coincidencia. CONFIG no separaba los
atributos de identidad física de los segmentos visibles del SKU. Dos piezas
físicamente distintas con SKU repetido podían perder trazabilidad documental.

La prueba `test-h94-reference-model-v2.mjs` reproduce color de ornamento,
Material y Cuello distintos con igual talla/SKU, barcode ambiguo, edición física
usada, reintento de reclasificación y documentos de venta/posventa/préstamo.
Durante la regresión descubrió además que el lado entregado de un cambio con SKU
repetido copiaba barcode y atributos de la línea vendida; el stock iba al ID
correcto, pero el snapshot era falso.

## Causa raíz

`products.id`, SKU, talla y barcode crecieron como identidad compuesta implícita.
El stock no tenía un contrato V2 escalar y la evidencia de algunas operaciones
seguía buscando por texto comercial. En cambios, la búsqueda de la línea vendida
se ejecutaba también para el lado entregado.

## Diseño

La transición es aditiva:

- V1 conserva `stock[]`, H-83 y lectura `SKU+talla` sólo si es inequívoca.
- V2 usa una fila por combinación física: `products.id` UUID, una talla,
  `stock_quantity`, `barcode_code`, SKU y firma derivada de
  `CONFIG.referenceParts()`.
- `EN REFERENCIA` y `EN SKU` son dimensiones independientes. SKU duplicado
  advierte; ID, barcode y firma física duplicados bloquean.
- Code128 codifica sólo barcode; POS, inventario, Excel y posventa operan por
  `products.id`.
- Una referencia usada es inmutable. La reclasificación mueve stock entre IDs
  con operación auditada, idempotente, atómica y reversible.
- Los documentos congelan identidad de línea/referencia, atributos y dinero.

No se crea `variant_id`; la identidad existente es `products.id`. No se convierte
V1, no se ejecuta punto cero y no se carga ni etiqueta inventario real.

## Solución

- `balam/config.jsx`: catálogo independiente Color de ornamento, metadato
  `inReference`, receta de firma y bloqueo de redefinición tras altas V2.
- `balam/data.jsx`: alta/edición V2, firma y multicolor canónicos, barcode corto,
  stock escalar, diagnósticos de colisión, snapshots, adaptador V1 inequívoco y
  reclasificación local. El lado entregado de un cambio se congela desde su
  propio `productId`.
- `balam/barcodes.jsx`, `pos.jsx`, `returns.jsx`, `loans.jsx`: resolución exacta
  barcode→ID y propagación de identidad sin primera coincidencia.
- `balam/inventory.jsx`, `settings.jsx`: alta V2 de una talla, etiquetas con SKU
  visible/barcode oculto, reclasificación y advertencias de SKU con diferencias
  y simulación de segmentos faltantes.
- `balam/xlsx-io.jsx`: esquema 2, round-trip V1/V2, identidad por ID/barcode,
  conflicto V1↔V2 y preflight sin mutaciones.
- `balam/store.jsx`: mapeo V2, snapshots, cola de reclasificación y compuerta de
  versión de esquema antes de escribir.
- migraciones `20260810013400`/`13500`: columnas e índices aditivos, escritor V2,
  guardas documentales, reclasificación transaccional, ACL y verificación.
- artefactos offline/PWA regenerados desde `balam/`.

## Pruebas

- `node test-h94-reference-model-v2.mjs`: 48/48.
- `node test-h86-inventory-xlsx-contract.mjs`: 42/42.
- `node test-h84-product-form-ux-e2e.mjs`: 19/19.
- `node test-store-queue.mjs`: 162/162; `test-module-contracts`: 42/42.
- ventas 20/20; devoluciones 17/17; saldo por línea 38/38.
- modelo/commit de cambios 28/28 y 32/32; préstamos V1 117/117 y sync 69/69.
- tallas 9/9; H-83 32/32; comprobantes H-85 20/20; etiquetas H-88B 19/19.
- migraciones 31/31; smoke del bundle 17/17; build reproducible 8/8.
- `git diff --check`: sin errores.

`supabase db lint --local --level error` no pudo ejecutarse porque no existe una
instancia local en `127.0.0.1:54322`. No se sustituyó por una afirmación de
validación SQL en PostgreSQL.

El despliegue enlazado del 10/08/2026 aplicó exclusivamente `13400` y `13500`.
La primera tentativa se revirtió completa por un falso positivo de la compuerta
de huella: `movements.product_id` ya existía en el remoto. Corregida la medición,
la transacción acreditó sin cambios 1,378 productos V1, una línea de venta y un
movimiento; devoluciones y cambios estaban vacíos. `13500` verificó estructura,
índices, restricciones, RPC, ACL y ausencia de conversión V1. Después,
`migration list` mostró ambas versiones local/remoto y el dry-run respondió
`Remote database is up to date`.

La regresión previa a publicación detectó que la nueva clave de préstamo por ID
rompía controles V1 que todavía usan `SKU|talla`. Se preservó esa clave sólo para
V1 y se mantuvo `products.id|talla` para V2; pantalla 117/117, sincronización
69/69 y H-94 48/48 confirmaron ambos contratos.

## Riesgo residual y pendientes

La implementación, las pruebas locales, el esquema remoto y la publicación del
cliente están completos. GitHub Pages run `31465090935` terminó en `success` para
`136c8d0`; `origin/main` coincidió con el SHA completo
`136c8d054a2441e8e0cbfdd530de378379df5853`. El sitio sirvió 8,950,198 bytes,
SHA-256 `F9EC47BFC7833E1B7E26CC670AC9C2279CA11C30E70004772C1DBC782C08DCB0`.
Pages normalizó las 171 terminaciones CRLF del blob a LF; tras esa única
normalización el contenido fue idéntico, sin otra diferencia.

Sobre la descarga real de Pages: H-94 16/16 —incluidas dos terminales que no
fusionan referencias con SKU iguales—, smoke V1 17/17, préstamos V1
117/117, apartados 28/28, formulario 19/19, colores de ornamento 17/17,
comprobantes 20/20 y etiquetas 19/19. Después de publicar se repitieron Excel
42/42, sincronización de préstamos entre terminales 69/69, convergencia 7/7 y
cola offline 162/162. La reversa retira primero el cliente; el esquema aditivo
queda y cualquier corrección de base es hacia adelante.

No se declara listo para producción. Falta la validación manual del propietario
y una historia separada para punto cero, CONFIG/SKU definitivo, inventario real
y etiquetas reales.

Punto cero, fijación de CONFIG/SKU, carga real e impresión de etiquetas reales
siguen expresamente fuera de este trabajo.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-94---referencias-físicas-v2-carecen-de-identidad-logística-y-stock-propios`
- `docs/02-architecture.md`
- `docs/architect/authorities/inventory.md`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
