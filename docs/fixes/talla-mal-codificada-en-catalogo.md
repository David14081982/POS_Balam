# La talla 38 estaba codificada como «0» en el catálogo

**Riesgo:** H-64
**Estado:** RESUELTO
**Fecha:** 01/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El dueño del producto aportó el archivo de origen del inventario y confirmó un
hecho físico: **la tienda tiene 398 prendas de talla 38**. El sistema mostraba
**cero** en la talla 38 y **428** en una talla `0`.

Comparando el archivo contra el snapshot real, SKU por SKU:

- en **100 productos** la cantidad que el archivo pone en `T38` estaba en el
  sistema bajo la talla `0`, con la cifra idéntica;
- la talla `0` del archivo suma **62** piezas, y el sistema tenía exactamente
  **12 productos con 62 piezas** que el archivo no asigna a 38 —coinciden al
  dígito—;
- los totales casi coincidían —archivo 3,517 · sistema 3,525—, así que no se
  habían perdido piezas: **estaban en la casilla equivocada**.

Consecuencia operativa: la tienda **no podía vender talla 38** y ofrecía 366
prendas bajo «talla 0», que no significa nada comercialmente. Diez ventas ya
habían quedado registradas con talla `0` siendo prendas 38.

## Causa raíz

El export del inventario del **24/07/2026** —anterior a H-59, H-61 y H-63—
conserva el orden real del catálogo `size_number` de entonces, y ese orden es la
prueba:

| posición | columna | piezas | talla que ocupa esa posición |
|---|---|---|---|
| 36 | `T36` | 161 | 36 |
| 37 | `T37` | 0 | 37 |
| **38** | **`T0`** | **398** | **38** |
| 39 | `T39` | 0 | 39 |
| **40** | **`TA`** | **382** | **40** |
| **42** | **`TB`** | **375** | **42** |
| **44** | **`TC`** | **311** | **44** |
| **46** | **`TD`** | **190** | **46** |
| **48** | **`TE`** | **161** | **48** |
| **49** | **`TF`** | **0** | **49** |
| **50** | **`TG`** | **115** | **50** |
| **52** | **`TH`** | **84** | **52** |
| 53 | `Ts` | 62 | *(la talla «0» real)* |
| 54 | `TPZ` | 803 | PIEZA |

Los códigos `A`…`H` ocupan exactamente las posiciones de 40, 42, 44, 46, 48, 49,
50 y 52, y sus etiquetas coinciden. **El código `0` ocupa la posición de la talla
38** y llevaba etiqueta `0`: un error de captura del propio catálogo. Las
existencias siempre estuvieron bien contadas; lo que estaba mal escrito era el
código de la talla.

Esto corrige también un supuesto de H-63, que emparejó cada código histórico con
el numérico de su misma etiqueta y acertó en ocho de nueve: dio por hecho que el
código `0` era la talla `0` cuando es la **38**, y que `s` era su gemelo. El mapa
correcto es `0→38 · A→40 · B→42 · C→44 · D→46 · E→48 · F→49 · G→50 · H→52 · s→0`.

## Diseño

La primera lectura llevaba a **reclasificar existencias**: mover 366 piezas de la
talla `0` a la `38` en 115 productos, y de paso consolidar las 1,460 piezas de los
códigos históricos. Eso arrastraba una ventana sin documentos vivos, un arnés de
migración, un respaldo y el riesgo de que un apartado o una devolución resolviera
su talla congelada contra un stock que ya se movió.

Demostrada la causa, esa ruta resultó innecesaria: **el error estaba en el
catálogo, no en las existencias**, así que se corrigió donde estaba.

**Invariante del diseño: cero piezas movidas.** La huella de `stock` debe ser
idéntica antes y después. Si cambia, la corrección está mal.

Se simularon las dos variantes sobre una copia del snapshot real con el artefacto
de producción —apagar los gemelos vacíos o eliminarlos— y ambas dieron el mismo
resultado funcional. Se eligió **eliminarlos** porque la exportación a Excel
incluye también los códigos inactivos: apagarlos habría dejado nueve columnas
`T38`, `T40`, `T42`… siempre en cero junto a las que sí llevan piezas, que es
exactamente la confusión que originó la investigación.

## Solución

Once ediciones del dueño en Configuración → Catálogos de producto → «Categorías
por talla · Números». **Ni una línea de código.**

1. Renombrar la etiqueta del código `0`: «0» → «**38**».
2. Eliminar los nueve gemelos numéricos vacíos: `38`, `40`, `42`, `44`, `46`,
   `48`, `49`, `50`, `52`.

Los nueve estaban sin referencia alguna —cero piezas, cero precios especiales,
cero códigos de barras, cero promociones y **cero documentos**: ninguna venta,
devolución, préstamo ni cambio los citaba—, así que la guarda de H-63 los admitió
y la reconciliación de `pushConfig` los retiró también de `pos.lookup`.

## Pruebas

| Medida | Antes | Después |
|---|---|---|
| Piezas bajo la etiqueta **38** | **0** | **358** |
| Etiquetas duplicadas en el filtro | 8 | **0** |
| Piezas ofrecidas en el POS | 3,524 | 3,524 |
| Productos con existencias invisibles | 0 | 0 |
| Opciones del filtro «Talla (Número)» | 70 | 61 |
| Entradas del catálogo | 71 | 62 |
| Errores de página | — | 0 |

**Invariantes:** 240 productos · 3,524 piezas · huella de `stock`
`34ed009694a1eeb2` **idéntica antes y después** · ventas, devoluciones, préstamos,
pagos, movimientos y promociones sin variación.

**Verificación remota:** `pos.lookup` confirma el código `0` con etiqueta `38`,
activo y en `sort_order 37`; `s, A, B, C, D, E, G, H` presentes y activos; `F`
inactivo; ninguno de los nueve borrados; `size_number` 61 activas / 62 totales;
`size_letter` 14/14 intacta.

**Validación del dueño:** las 358 prendas de talla 38 ya aparecen en el Punto de
venta.

Sin migraciones y sin cambios de artefacto: H-64 no tocó código, así que
`index.html` sigue siendo el de H-63 fase 1.

## Riesgo residual y pendientes

1. **Orden del catálogo.** Tras el borrado, las tallas 40 a 52 quedaron al final
   de la lista (posiciones 55-61 de 61), porque conservan el orden de sus códigos
   históricos. Se preparó y probó un reordenamiento —62 entradas antes y después,
   mismos códigos, 3,524 piezas sin cambio, cero duplicados, cero errores— y el
   dueño prefirió hacerlo manualmente.
2. **Los códigos internos siguen siendo los históricos**, así que las columnas del
   Excel se llaman `T0` (la 38), `TA` (la 40), `TB` (la 42)… El código es el
   identificador que amarra las existencias: renombrarlo las desconectaría, y
   unificarlo exigiría mover las 1,818 piezas, que es justo lo que esta historia
   evitó. Queda como posible historia futura y sin urgencia: cada talla aparece ya
   una sola vez y con sus prendas.
3. **Defecto abierto detectado durante la verificación:** H-65 — una liquidación
   de apartado registró su movimiento pero no descontó la pieza.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-64.
- Historia previa de la misma familia: H-63
  (`docs/fixes/tallas-historicas-con-existencias.md`), cuyo supuesto sobre el
  código `0` corrige esta historia.
- Autoridades: `docs/architect/authorities/inventory.md`.
