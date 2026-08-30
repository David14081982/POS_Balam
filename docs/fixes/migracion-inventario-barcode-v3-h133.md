# Migración integral del inventario a V2 y BARCODE CONTRACT V3

**Riesgo:** H-133
**Estado:** RESUELTO EN SOFTWARE — HARDWARE NOT_TESTED
**Fecha:** 29/08/2026
**Commit funcional:** `a01562e`

## Problema y reproducción

El inventario vivo combinaba 219 productos V1 activos —830 combinaciones
vendibles y 3,250 piezas— con 138 referencias V2 y 310 piezas. V1 codificaba
datos comerciales dentro de Code128 y no podía satisfacer a la vez unicidad,
resolución exacta y geometría 60×40. La coexistencia tampoco ofrecía un mapa
obligatorio y unívoco desde cada producto+talla histórico a la referencia
operativa vigente.

El snapshot autenticado reprodujo el problema sobre todo el inventario, no una
categoría: 357 productos activos, 3,560 piezas y 830 referencias vendibles V1.
El manifiesto previo detectó cero colisiones de firma, destino o barcode y cero
operaciones de inventario pendientes que impidieran el corte.

## Causa raíz

V1 hacía que la identidad de lectura dependiera del SKU materializado y de una
talla incluida en el texto. Ese contrato mezclaba presentación comercial con
identidad técnica, aumentaba los módulos Code128 y permitía generaciones activas
diferentes. El antiguo V2 tenía identidad propia, pero no un contrato versionado,
aliases normalizados ni una función cliente/SQL que demostrara el mismo valor a
partir de `products.id`.

Durante los ensayos, la primera fórmula —80 bits iniciales del UUID— colisionó
en fixtures que compartían prefijo. Se sustituyó antes de tocar datos por los 80
bits finales. Dos invocaciones reales posteriores abortaron todo el lote al
detectar claves JSON dobladas a minúsculas. La ausencia de cambios parciales y
los recibos de error prueban que las guardas y la atomicidad operaron como se
diseñaron; el generador se corrigió y se regeneró el manifiesto sellado.

## Diseño

BARCODE CONTRACT V3 es `3` seguido por los 80 bits finales del UUID expresados
en decimal y rellenados a 25 posiciones. Siempre son 26 dígitos, por lo que
Code128 usa Code Set C. El espacio de identidad procede del UUID servidor, no
del SKU ni de un contador humano. El mismo barcode identifica una referencia
física; todas sus piezas llevan la misma etiqueta y el stock decide cuándo deja
de venderse.

La operación servidor cumple esta secuencia dentro de una única transacción:
snapshot y backup con hash; drain; advisory lock; manifiesto y hash; validación
de IDs/barcodes; creación V2; transferencia exacta de stock; mapa histórico;
aliases; retiro operativo V1; reconciliación; epoch/protocolo; commit. Cualquier
diferencia lanza excepción y revierte el lote completo.

La identidad histórica es
`source_v1_product_id + size_scale + raw_size_value`. Devoluciones y cambios
traducen esa tupla a un único V2 activo. Las filas V1, documentos y movimientos
no se reescriben. Las 28 referencias V2 eliminadas continúan como tombstones y
quedan deliberadamente fuera de las restricciones del inventario activo.

## Solución

- `balam/data.jsx` comparte la fórmula determinista V3, preserva el SKU visible,
  el contrato y los aliases.
- `balam/barcodes.jsx` genera/certifica exclusivamente el barcode actual en
  etiquetas, pero resuelve también aliases exactos al mismo `products.id`.
- `balam/store.jsx` transporta contrato/aliases y exige protocolo 3 y esquema
  `20260830017500`, impidiendo que clientes viejos resuciten V1.
- Las migraciones H-133 agregan tablas normalizadas de aliases y mapa histórico,
  estado contractual, backup/restauración, ejecución atómica, guardas de forma,
  certifier permanente y verificación funcional.
- La migración de ejecución sólo consume el manifiesto vivo cuando existe
  inventario. Una instalación limpia activa V3 vacío y omite las cifras/backup
  exclusivos de producción, conservando reconstrucciones reproducibles.
- El generador y los auditores producen manifiestos reproducibles y censos
  completos sin usar SKU como autoridad.

La ejecución confirmada creó 831 destinos V2: 830 vendibles y uno histórico sin
stock. Las 138 V2 existentes recibieron V3 y conservaron su barcode anterior
como alias. Los 219 V1 quedaron no operativos, con stock cero y autoridad
histórica intacta. Epoch avanzó 5→6, protocolo mínimo/actual quedó en 3 y los
equipos se marcaron `must_rebootstrap`.

## Pruebas

- Operación: `42c03d11-9463-59d3-aecf-822d0bb6444a`.
- Hash final del manifiesto:
  `5e7193f0e7718fc9e92a17302041e042a55982b56f5e59742f8930900a50dab2`.
- Backup restaurable: `54abdb94-a2db-44cb-a9e7-a3b1d0248d08`; payload
  `b0a7b5af46bd18de8c41d5f8202c1733a66e62e4e0dd9abad42a07a627b3b1c5`;
  `verified_restorable=true`, `hash_verified=true`, no restaurado.
- Certifier SQL vivo: V1 activa 0; V2 activa 969; V2 vendible 948; piezas 3,560;
  aliases 138; mapas 831; todos los contadores de invalidez en 0.
- Censo de aplicación desde un pull remoto fresco: 948/948 certificadas,
  3,560 piezas, `OK` 948, `NEAR/DENSE/ENCODING_ERROR` 0, ANGEL 5/5, once grupos
  de SKU visible duplicado 11/11 y fallos 0.
- H-133: 8/8; vector cliente/SQL, Code Set C, 178 módulos, X=0.277778 mm,
  alias exacto, certificación y diez escaneos del mismo código hasta stock 0;
  sólo el once se bloquea por falta de stock y la identidad continúa resolviendo.
- Regresiones: H-132 7/7 + 2/2; H-94 49/49; H-100 10/10; H-102 15/15;
  H-127 9/9 + 11/11; H-128 11/11 + QA 9/9; H-99 23/23 + 12/12;
  H-130 7/7; H-131 23/23; migraciones 31/31; módulos 42/42; cola 186/186;
  sync vivo 20/20; navegación 15/15; arranque 5/5; reproducibilidad 8/8;
  smoke del bundle 17/17.
- Build offline correcto. Venta, devolución, cambio, préstamo, apartado,
  import/export, PDF, offline y multiterminal conservan sus regresiones verdes.

## Riesgo residual y pendientes

El manifiesto físico requiere reimprimir 3,560 etiquetas una vez confirmado el
corte. Cada terminal debe abrir el cliente publicado y completar su rebootstrap;
los clientes de protocolo anterior permanecen cercados hasta hacerlo.

No había impresora ni lector físicos delegables. Su estado es
`HARDWARE_NOT_TESTED`: no invalida ni revierte la migración certificada por
software. La aceptación física debe usar muestras corta/media, SKU largo,
SKU duplicado y stock mayor a uno. No existe otro riesgo residual conocido en
el inventario activo certificado.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-133--inventario-operativo-v2-único-y-barcode-contract-v3`
- `docs/fixes/certificacion-integral-identidad-barcode-h132.md`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
