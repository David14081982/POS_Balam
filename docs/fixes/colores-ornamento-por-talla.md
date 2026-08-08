# Colores de ornamento por talla

**Riesgo:** H-83
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 08/08/2026
**Commit técnico:** `b3bd58ead8e790ae17de98d248fec388f1ca188d`

## Problema y reproducción

El producto sólo podía guardar `ornColors` para todas sus tallas. No era posible
representar que XS/S/M usaran un conjunto de hilos y L/XL otro, aunque stock y
precio ya reconocían la talla como variante.

La línea base `node test-h83-ornament-colors-by-size.mjs` produjo **8 aprobaciones
y 17 fallos**: no existían forma canónica, autoridad efectiva, captura agrupada,
ida/vuelta en Excel ni evidencia congelada en documentos.

## Causa raíz

Faltaba el contrato talla → colores. `ornColors` respondía exclusivamente por el
producto completo y cada consumidor sólo podía leer ese valor vigente. Ningún
renglón de venta, devolución o cambio congelaba el ornamento efectivo usado.

## Diseño

La única fuente editable es:

```text
product.attrs.__ornamentColorsBySize = {
  "XS": ["CF", "OR"],
  "S":  ["CF", "OR"],
  "L":  ["PL"]
}
```

- Las claves son identidades de talla de la categoría asignada al producto.
- Los valores son conjuntos de códigos del catálogo `color`, deduplicados y
  ordenados por el propio catálogo. Etiquetas y orden de captura no son identidad.
- `DATA.effectiveOrnamentColors(product, talla)` es la única autoridad:
  excepción no vacía → excepción; ausencia → `ornColors`; ornamento sin colores
  → arreglo vacío.
- Las filas agrupadas son sólo una proyección de edición. No se persisten grupos
  ni una segunda matriz.
- Dos filas que repiten talla con conjuntos distintos bloquean el guardado y
  nombran los grupos. Conjuntos iguales son equivalentes; no existe «último gana».
- `allowsColors` vive como metadato del catálogo de ornamentos. Se rellena sin
  pisar decisiones existentes; Alforza y Sin ornamento nacen deshabilitados.
- Los catálogos no permiten borrar una talla o un color todavía referenciado por
  la matriz.

Compatibilidad:

- Un producto anterior equivale a mapa vacío y hereda `ornColors`.
- Una hoja Excel anterior, sin la nueva columna, no borra un mapa existente.
- Una hoja con la columna vacía sí expresa `{}` y elimina las excepciones.
- El producto sigue sincronizándose atómicamente mediante `attrs`; no hay columna
  nueva en `pos.products`.
- Venta, devolución y cambio guardan snapshots documentales separados en
  `ornamento` y `orn_colors`. Las RPC públicas conservan sus nombres y delegan en
  las transacciones vigentes antes de persistir la evidencia.

No se cambian `product_id`, `variant_id`, stock, precio, Constructor de SKU,
sufijos comerciales ni matriz de SKU.

## Solución

- `balam/data.jsx`: sanitización canónica, resolución efectiva y snapshots de
  venta/devolución/cambio.
- `balam/config.jsx`: contrato `allowsColors` y protección de referencias.
- `balam/inventory.jsx`: grupos multi-talla/multi-color, edición, eliminación,
  herencia visible y bloqueo de solapamientos.
- `balam/xlsx-io.jsx`: columna `Colores Orn. por talla` con JSON de códigos y
  compatibilidad explícita con hojas anteriores.
- `balam/pos.jsx` y `balam/pos-ticket.jsx`: resultado efectivo en selector y
  carrito; evidencia congelada en comprobante.
- `balam/store.jsx`: snapshots en cola/push/pull y versión de esquema H-83.
- Migraciones `20260808012600` y `20260808012700`: columnas documentales,
  persistencia transaccional, permisos y verificación estructural.
- `index.html` y `POS Balam (offline).html`: regenerados desde `balam/`.

## Pruebas

Línea funcional específica:

- `node test-h83-ornament-colors-by-size.mjs` → **32/32**.
- `node test-h83-ornament-colors-by-size-e2e.mjs` → **17/17** sobre el bundle,
  con el producto controlado `h83-e2e-product`, dos grupos XS/S/M y L/XL,
  reapertura, solapamiento, POS, documento e invariantes.

Regresión relacionada:

- `test-store-queue.mjs` → **162/162**.
- `test-migrations.mjs` → **31/31**.
- `test-module-contracts.mjs` → **41/41**.
- `test-h63-size-protection.mjs` → **34/34**.
- `test-h59-size-persistence.mjs` → **12/12**.
- `test-xlsx-security.mjs` → **17/17**.
- `test-h67-size-headers.mjs` → **27/27**.
- `test-precio-talla-e2e.mjs` → **19/19**.
- `test-pos-size-filter-groups.mjs` → **19/19**.
- `test-returns.mjs` → **17/17**.
- `test-h71-devolucion-identidad.mjs` → **29/29**.
- `test-h72-identidad-posventa.mjs` → **16/16**.
- `test-cambio-e2e.mjs` → **37/37**.
- `test-exchange-model.mjs` → **28/28**.
- `test-exchange-commit.mjs` → **32/32**.
- `test-h73-comprobante-del-cambio.mjs` → **29/29**.
- `test-build-reproducibility.mjs` → **8/8**.
- `node build-offline.mjs` compiló todos los JSX y regeneró ambos artefactos.
- `supabase db push --linked --include-all --yes` aplicó en producción las
  migraciones H-83 `12600/12700`, incluida su verificación transaccional.
- El dry-run posterior informó `Remote database is up to date`.
- `origin/main`, `HEAD` y el remoto verificado coinciden en `b3bd58e`.
- GitHub Pages sirve el blob `index.html` `a98e9b533846af53085daeff968cc0a28274a74f`,
  exactamente igual al blob del commit. La copia de trabajo agrega únicamente
  171 retornos CRLF por la configuración local de Git.
- `test-smoke.mjs bundle` completó sus **13 comprobaciones verdes**; el proceso
  agotó el timeout después del recorrido al cerrar su servidor, sin error de
  página ni fallo funcional.

## Riesgo residual y pendientes

Los documentos creados antes de H-83 no contienen snapshot de ornamento y no se
inventan retrospectivamente. En una devolución/cambio de uno de esos documentos,
el sistema congela la mejor evidencia disponible en ese momento; sólo los
documentos nuevos garantizan evidencia histórica exacta de origen.

La asignación a un producto del inventario productivo requiere conocimiento de
la prenda física. La verificación funcional usa un producto controlado con stock
realista y no altera inventario remoto ni inventa datos comerciales.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-83---el-producto-no-puede-representar-colores-de-ornamento-distintos-por-talla`
- `docs/02-architecture.md`
- `docs/architect/authorities/inventory.md`
- `docs/architect/authorities/synchronization.md`
- `docs/architect/decisions/ADR-002-atomicidad-y-rollback.md`
- `docs/architect/decisions/ADR-009-ownership-local-first.md`
- `docs/architect/decisions/ADR-011-identidad-de-tallas-administrables.md`
