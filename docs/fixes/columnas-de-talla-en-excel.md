# Las columnas de talla del Excel salían con la identidad interna, no con la talla

**Riesgo:** H-67
**Estado:** RESUELTO
**Fecha:** 01/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

En Configuración cada talla tiene dos valores: un **código interno** a la
izquierda —`0`, `A`, `B`, `C`, `D`, `E`, `G`— y un **nombre visible** en el campo
de texto —`38`, `40`, `42`, `44`, `46`, `48`, `50`—. Al exportar el inventario,
Inventario → «Exportar» producía columnas llamadas **`T0`, `TA`, `TB`, `TC`,
`TD`, `TE`, `TG`**. El dueño no puede leer su propio inventario: `TA` no
significa nada; la columna que contiene las prendas talla 40 debe llamarse `T40`.

Es el pendiente 2 de H-64, donde quedó documentado y sin resolver.

**Reproducción ejecutada** sobre el módulo del commit anterior (`fc4ac77`),
cargado dentro de la misma página para exportar el mismo catálogo y las mismas
existencias:

```
✅ REPRO · el código anterior genera T0, TA y TB · T0, TA, TB, TC, TD, TE, TG, TF
✅ REPRO · el código anterior NO genera T38, T40 ni T42
✅ REPRO · las piezas ya estaban bien: sólo la columna estaba mal nombrada
          T0=5 TA=7 TB=3 total=55 vs 55
```

La tercera línea acota el defecto: las cantidades y su reparto por talla siempre
fueron correctos. Lo único equivocado era el **nombre** de la columna.

## Causa raíz

`balam/xlsx-io.jsx` § `sizeItems()` componía el encabezado con el mismo valor con
el que localiza las piezas:

```js
const value = Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : item.code;
return { value, header: (prefix || '') + String(value) };
```

`value` es la **identidad** de la talla: lo que guarda `stock[].talla` y con lo
que se encuentra la variante. `item.label` —lo que el administrador escribe en
Configuración y lo único que significa algo para la tienda— no se usaba en
ninguna parte del Excel. Es el defecto que `ADR-011` nombra: un solo campo
haciendo de identidad técnica y de valor de intercambio a la vez.

## Diseño

**Se separan las dos funciones dentro de la exportación, sin tocar el modelo:**

| Qué | De dónde sale | Para qué |
|---|---|---|
| identidad | `meta.value ?? item.code` | localizar las piezas en `stock[].talla` |
| encabezado | `prefix + item.label` | el título que se lee en Excel |

**Invariante: cero piezas movidas.** `stock[].talla` no se toca, no se renombran
códigos internos, no se migran existencias y no se modifica ningún documento
histórico. La huella del inventario debe ser idéntica antes y después.

**La importación no puede resolver por el texto visible.** Es la mitad difícil:
`T0` significó la identidad `0` —la talla 38— en todos los archivos anteriores, y
significaría la identidad `s` —la talla 0 real— en un archivo nuevo. Adivinar
está prohibido (`ADR-011` § 4). Por eso:

1. **El archivo viaja con su propio mapa.** La hoja «Catálogos» termina con un
   bloque `MAPA DE COLUMNAS DE TALLA` que declara, para cada columna, la
   identidad interna a la que escribe, su etiqueta y su categoría. Al importar,
   la cantidad de cada talla se lee de la columna que el archivo declaró.
2. **Un archivo sin ese mapa se lee con la regla histórica** —encabezado =
   identidad—, que es exactamente el comportamiento anterior: los archivos que la
   tienda ya tiene se siguen importando igual.
3. **Un archivo con columnas nuevas al que le falta la hoja «Catálogos» se
   bloquea.** Si trae `T38` y no trae `T0`, es un archivo de esta versión que
   perdió su mapa; leerlo como histórico pondría en cero todas esas tallas. Se
   detiene con un mensaje que dice qué hacer.
4. **Dos tallas con la misma etiqueta bloquean exportación e importación**, con
   el nombre en conflicto y las dos identidades implicadas en el aviso. Dos
   columnas con el mismo título se pisan entre sí: no se elige una en silencio.

**No alcance:** editar el código interno (H-66 · `ADR-011`, sin autorizar),
mover existencias, renombrar códigos, migrar datos, tocar documentos históricos
y cualquier cosa de H-65.

## Solución

**`balam/xlsx-io.jsx`**

- `sizeItems()` devuelve ahora `{ kind, value, label, header, legacyHeader }`:
  `value` es la identidad, `header` se compone con la etiqueta y `legacyHeader`
  conserva el encabezado de los archivos anteriores.
- `sizeColumns()` es el punto único que arma las dos escalas y valida sus
  encabezados; `assertSizeHeaders()` bloquea etiquetas duplicadas y choques con
  una columna ya existente del Excel.
- La hoja «Catálogos» publica el bloque `MAPA DE COLUMNAS DE TALLA`.
- `sizeMapFromWorkbook()` lo lee al importar; `columnOf()` decide de qué columna
  sale cada talla; `assertLegacyReadable()` detiene el archivo nuevo sin mapa.
- `exportInventory()` y `exportTemplate()` avisan con el mensaje del bloqueo en
  vez de fallar en silencio.

**`balam/inventory.jsx`** — la importación muestra el mensaje del lector cuando
es un bloqueo accionable, en lugar del genérico «No se pudo leer el archivo».

**Artefactos** regenerados con `node build-offline.mjs`.

## Pruebas

`node test-h67-size-headers.mjs` → **27 pasaron, 0 fallaron**. El arnés no se
queda en el código: exporta con el navegador, **guarda el .xlsx que se descarga**
en `.evidence-h67/Inventario_H67.xlsx`, lo vuelve a leer del disco con el motor
de Excel y lo reimporta.

| Comprobación | Resultado |
|---|---|
| 1 · el archivo real exporta T38, T40, T42, T44, T46, T48, T50 | ✅ |
| 2 · no exporta T0, TA, TB, TC, TD, TE ni TG | ✅ |
| 3 · las cantidades quedan en su columna lógica (T38=5, T40=7, T42=3, T50=2) | ✅ |
| 4 · el total de piezas no cambia (archivo 55 · inventario 55) | ✅ |
| 5 · la talla interna `0` sigue leyendo `stock[].talla = 0` | ✅ |
| 6 · la talla interna `A` sigue leyendo `stock[].talla = A` | ✅ |
| 7 · importar `T38` resuelve a la identidad `0` | ✅ |
| 8 · importar `T40` resuelve a la identidad `A` | ✅ |
| 9 · etiquetas duplicadas bloquean exportación e importación, con aviso | ✅ |
| 10 · la talla inactiva conserva columna y piezas | ✅ |
| 11 · Talla (Letra) sin regresiones | ✅ |
| 12 · el resto de columnas del Excel intacto | ✅ |
| archivo anterior (`T0` = identidad `0`) se importa igual que siempre | ✅ |
| archivo nuevo sin hoja «Catálogos» → bloqueado, no vacía el stock | ✅ |
| exportar e importar no mueve una sola pieza | ✅ |

**Encabezados del archivo real descargado:** `SKU · Modelo · Categoría · Manga ·
Tela · Color · No. Modelo · Ornamento · Colores Orn. · Cuello · Precio ·
Foto (URL) · Categoría por talla · T38 · T40 · T42 · T44 · T46 · T48 · T50 ·
T49 · CHICO · MEDIANO · GRANDE`, y su mapa `T38→0 · T40→A · T42→B · T44→C ·
T46→D · T48→E · T50→G · T49→F`.

**Regresión ejecutada:** `test-export-modelo.mjs` 14/0 · `test-import-fotos.mjs`
23/0 · `test-xlsx-security.mjs` 17/0 · `test-product-sizes.mjs` 9/0 ·
`test-h59-size-persistence.mjs` 12/0 · `test-h63-size-protection.mjs` 34/0 ·
`test-size-categories-audit.mjs` 23/0 · `test-pos-size-filter-groups.mjs` 19/0 ·
`test-filtros-inventario.mjs` 18/0 · `test-module-contracts.mjs` 41/0 ·
`test-smoke.mjs` 15/0 · `test-ui-navigation.mjs` 15/0 ·
`test-build-reproducibility.mjs` 8/0 · `test-ux-metrics.mjs` sin retroceso
(11 interacciones · 2 validaciones · recorrido completo).

Sin migraciones: el cambio es del cliente y no toca el esquema.

## Riesgo residual y pendientes

1. **La hoja «Catálogos» es ahora parte del contrato del archivo.** Si el dueño
   la borra, ese archivo deja de ser importable —se bloquea con aviso, nunca se
   interpreta a medias—. La solución es volver a exportar.
2. **Los códigos internos siguen siendo los históricos.** Esto no los corrige:
   sólo deja de mostrarlos. Corregirlos es H-66 (`ADR-011`), con diseño aceptado
   e implementación no autorizada.
3. **Un archivo anterior con columnas `T38` vacías** —los gemelos que H-64
   eliminó— se sigue leyendo como histórico: `T0` es la identidad `0` y la
   columna `T38` se ignora por no existir esa identidad. Es el comportamiento
   correcto para ese archivo, y el mismo de antes de este cambio.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-67.
- Historia que documentó el pendiente: H-64
  (`docs/fixes/talla-mal-codificada-en-catalogo.md` § Riesgo residual, punto 2).
- Decisión que gobierna la ambigüedad de los archivos: `ADR-011`
  (`docs/architect/decisions/ADR-011-identidad-y-codigo-canonico-de-talla.md`).
- Autoridades: `docs/architect/authorities/inventory.md`.
