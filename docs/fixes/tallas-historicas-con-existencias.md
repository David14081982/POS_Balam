# Existencias retenidas por códigos históricos de talla desactivados

**Riesgo:** H-63
**Estado:** PARCIALMENTE RESUELTO — fase 1 (protección) publicada; fase 2
(recuperación) pendiente de verificación remota y autorización
**Fecha:** 31/07/2026
**Commit:** `b4bfb3f` · despliegue registrado en el commit siguiente

## Problema y reproducción

La tarjeta del Punto de venta anuncia existencias que el selector de talla no
ofrece. Caso representativo, ALONSO `1-ALS-MC-AMAR-T`: la tarjeta dice
`STOCK: 6`, «Selecciona talla» sale vacío, el detalle de Inventario no muestra
ninguna talla, y el formulario de edición sí muestra las 6 piezas en una segunda
casilla rotulada «42», al final de la cuadrícula.

Auditoría de sólo lectura del 31/07/2026 sobre el snapshot real de la terminal
—copia temporal del perfil, red bloqueada, artefacto interrogado con los datos
reales—:

| Medida | Cifra |
|---|---|
| Productos | 240 |
| Piezas en `stock[]` | 3,525 |
| Productos con piezas invisibles | **142 (59 %)** |
| Piezas invisibles | **1,460 (41 %)** |
| Productos con todo su stock fuera del selector | **29** (113 piezas) |
| Piezas ofrecidas por el POS y por el detalle | 2,065 |
| Piezas contadas por `totalStock` y por el formulario | 3,525 |
| Piezas exportadas a Excel | 3,525 (bajo columnas `Ts`, `TA`…`TH`) |

Reparto por código, todos de `size_number`: `B`/42 → 74 productos y 320 piezas;
`A`/40 → 85 y 318; `C`/44 → 67 y 249; `D`/46 → 59 y 163; `E`/48 → 57 y 143;
`G`/50 → 53 y 115; `H`/52 → 44 y 83; `s`/0 → 13 y 69; `F`/49 → 0 y 0.
`size_letter` no tiene ni un código inactivo ni una pieza afectada.

`node test-h63-size-protection.mjs` sobre `HEAD` (`5333546`), en un worktree
limpio: **10 pasaron, 24 fallaron**.

## Causa raíz

El catálogo `size_number` guarda 71 entradas: 62 activas y 9 inactivas en los
índices 62–70, con códigos `s`, `A`…`H` y etiquetas `0`, `40`…`52`. Cada una
tiene un gemelo ACTIVO con la misma etiqueta y código numérico. Las existencias
siguen apuntando por valor al código histórico: la fila de ALONSO es
`{ talla: "B", escala: "N", stock: 6 }`.

Tres hechos encadenados, ninguno de ellos un error de las pantallas de venta:

1. **La importación de catálogos desactiva en silencio.** `importCatalogs()`
   nunca borra: los códigos que no vienen en el archivo se anexan al final con
   `active: false` (`balam/config.jsx` § `importCatalogs`). La semilla original
   traía códigos numéricos (migración `20260725000100`), así que los
   alfabéticos entraron por una importación anterior y una posterior los retiró.
2. **Ninguna ruta de retiro consultaba las existencias.** `setActive()` no
   preguntaba nada, e `inUse()` —que sí lo hacía— sólo protegía el **borrado**, y
   sólo por existencias: un código referenciado únicamente por precios especiales
   o códigos de barras podía borrarse.
3. **El puente de códigos huérfanos no cubre tallas.** `REMAP_FIELDS`
   (`balam/data.jsx`) re-vincula categoría, manga, tela, color y cuello cuando un
   catálogo se re-codifica, precisamente por coincidencia de etiqueta. La talla no
   entra: su referencia no es un campo del producto, vive dentro de cada fila de
   `stock[]`.

Las pantallas de operación excluyen correctamente una talla marcada como
inactiva. El defecto no está en ellas y esta historia no las toca.

## Diseño

**Contrato nuevo:** una pregunta de negocio que no tenía autoridad —«¿qué
referencias vivas tiene este código de talla?»— pasa a tenerla en
`CONFIG.sizeCodeReferences(kind, code)`. Resuelve por la **escala de la categoría**
y por el **valor real** (`meta.value` o, en los históricos, el código); jamás por
la apariencia del código o de la etiqueta. Un código `B` con etiqueta `42` es una
talla numérica legítima y se trata como tal.

Cuenta cuatro clases de referencia: existencias positivas, precios especiales por
talla, códigos de barras generados y alcance de promociones. Las promociones
llegan por el mismo gateway de `CORE` que ya usan los productos, de modo que la
dirección `DATA → CONFIG` se conserva (`R-CLI-05`): DATA registra, CONFIG
consulta.

**Invariante:** un código de `size_number` con al menos una referencia viva no
puede quedar inactivo por una acción de administración. Reactivar nunca se
bloquea.

**Atomicidad:** la importación arma el resultado completo antes de aplicarlo. Si
alguna hoja dejaría inactivo un código protegido, se rechaza el archivo entero.
Media importación aplicada es peor que ninguna: deja el catálogo en un estado que
nadie pidió y que el archivo ya no describe.

**Compatibilidad:** `inUse()` delega en la misma autoridad para `size_number`, así
que no aparece una segunda fórmula para el mismo hecho. Para `size_letter` y para
todos los demás catálogos el comportamiento es idéntico al anterior, byte a byte.

**Lo que el diseño deliberadamente NO hace:** no reactiva nada, no remapea
productos, no toca `stock[].talla`, no fusiona filas, no declara alias, no cambia
códigos y no altera ninguna regla de visibilidad. La recuperación es la fase 2 y
necesita antes una verificación remota de sólo lectura.

## Solución

- `balam/core.jsx`: `registerCatalogPromotions()` / `catalogPromotions()`, gemelos
  del adaptador de productos ya existente.
- `balam/config.jsx`: `sizeCodeReferences()` como autoridad; `updateItem()` rechaza
  desactivar un código protegido antes de mutar nada y sin emitir `configchange`;
  `importCatalogs()` se vuelve atómica y devuelve `{ ok:false, blocked:[…] }` con
  el motivo (`desactivado` por ACTIVO=NO, `ausente` por omisión) y el detalle de
  referencias; `inUse()` delega para `size_number`.
- `balam/data.jsx`: registra el adaptador de promociones. Ninguna regla de
  visibilidad cambia; `resolveProductSizes` y `totalStock` quedan intactos.
- `balam/settings.jsx`: el interruptor pasa por un manejador que muestra el motivo
  del rechazo, y la importación explica en su tarjeta de diagnóstico qué tallas
  bloquearon el archivo y con cuánto inventario.
- `test-h63-size-protection.mjs`: arnés nuevo, en sandbox de Node, que ejerce la
  fuente sin depender del artefacto.
- `test-module-contracts.mjs`: vigila el cableado de las dos puntas del gateway
  de promociones.

## Pruebas

Reproducción sobre `HEAD` con el arnés final: **10 pasaron, 24 fallaron**.
Después del cambio:

| Arnés | Resultado |
|---|---|
| `test-h63-size-protection.mjs` | **34/34** |
| `test-module-contracts.mjs` | 41/41 |
| `test-screen-registry.mjs` | 12/12 |
| `test-benefit-duplicate.mjs` · `test-benefit-settings-ui.mjs` | 6/6 · 7/7 |
| `test-permission-admin-ui.mjs` | 21/21 |
| `test-size-categories-audit.mjs` | 23/23 |
| `test-product-sizes.mjs` | 9/9 |
| `test-h59-size-persistence.mjs` | 12/12 |
| `test-pos-size-filter-groups.mjs` · `test-pos-size-filter-menu.mjs` | 19/19 · 6/6 |
| `test-filtros-inventario.mjs` | 18/18 |
| `test-export-modelo.mjs` · `test-xlsx-security.mjs` · `test-import-fotos.mjs` | 14/14 · 17/17 · 23/23 |
| `test-variant-price.mjs` | 38/38 |
| `test-exchange-model/commission/reports.mjs` | 28/28 · 30/30 · 24/24 |
| `test-folio-diario.mjs` · `test-line-balance.mjs` · `test-report-revenue.mjs` · `test-return-deadline.mjs` | 60/60 · 38/38 · 24/24 · 38/38 |
| `test-exchange-commit.mjs` | 31/1 — **el mismo fallo en `HEAD`**, comprobado en worktree limpio |

Artefactos regenerados con `node build-offline.mjs`: `index.html` y
`POS Balam (offline).html`, idénticos entre sí, 8 769 520 bytes, SHA-256
`2C1153AA91D049A35A30BEEB85EB5FE1B24F2DD18A74C7A989691C7E69C319E5`. Smoke del
bundle 17/17, navegación 15/15 y reproducibilidad 8/8 sobre el paquete nuevo.
El artefacto servido por GitHub Pages se verificó idéntico byte a byte al del
commit `b4bfb3f`, y el paquete publicado arranca sin errores en un perfil
desechable y sin sesión.

El snapshot real del terminal se releyó en sólo lectura al terminar: productos,
configuración y promociones conservan la misma huella que en la auditoría —240
productos, 3,525 piezas, los nueve códigos históricos aún inactivos, 14 tallas
de letra activas—. La protección no tocó ningún dato real.

`test-variant-price.mjs` falló durante la implementación porque su sandbox
construye un `CORE` mínimo y el contrato nuevo era obligatorio. Se corrigió en el
origen —el registro se hace bajo guarda de existencia— y el cableado quedó
vigilado por `test-module-contracts.mjs`, en vez de parchear siete arneses.

### Validación funcional por interacción real

`node test-h63-e2e.mjs` — **58/58**, ejecutado dos veces: contra `index.html`
servido por HTTP y contra `POS Balam (offline).html` abierto por `file://` con
la red apagada. Pulsa el interruptor real de Configuración y suelta archivos
`.xlsx` construidos con el SheetJS del propio paquete en el input de
importación, de modo que corre el manejador de verdad. Localiza por
`data-testid` y por `data-active`; el texto sólo se afirma en el aviso que el
administrador debe LEER, que es la excepción declarada de `AP-11`.

Rojo/verde: el mismo arnés contra el artefacto anterior da **19 fallos y 6
aciertos** antes de abortar, y los seis aciertos son vacuos —«no se persiste
ningún cambio» pasa porque no ocurre nada—.

Los `data-testid` añadidos (`catalog-row-*`, `catalog-toggle-*`,
`catalog-import-input`, `catalog-import-diag` con `data-diag`, y `toast`) son
arquitectura de pruebas: atributos inertes en producción, `R-DEL-10`.

## Riesgo residual y pendientes

1. **`CONFIG.load()` no está protegido.** Un pull de la nube o de otra terminal
   puede reintroducir la desactivación sin pasar por la guarda. Es una ruta de
   convergencia de sincronización, no de administración, y bloquearla exige una
   decisión funcional propia. Por eso la fase 2 requiere antes la verificación
   remota de sólo lectura.
2. **Las 1,460 piezas siguen invisibles.** La protección impide que el daño
   crezca; no lo repara.
3. **`size_letter` queda fuera** por decisión de alcance: hoy no tiene códigos
   inactivos ni piezas afectadas.
4. **Pendiente antes de la fase 2:** confirmar en remoto los mismos 240
   productos, `stock[].talla` coincidente con el snapshot local, los ocho códigos
   con piezas aún inactivos, ninguna terminal con configuración más nueva y
   ninguna operación remota que pueda revertir la recuperación.
5. **Pendiente de cierre:** regenerar artefactos, probar el bundle, commit y
   publicación. No autorizados todavía.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-63.
- Autoridades: `docs/architect/authorities/inventory.md`.
- Historias previas de la misma familia: H-57, H-59, H-61.
- Antipatrón relacionado: `AP-01` (varias respuestas a una misma pregunta), que
  esta historia **documenta** en las reglas de visibilidad pero no corrige, por
  decisión de alcance del dueño del producto.
