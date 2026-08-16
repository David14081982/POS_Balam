# Color tela en el detalle familiar V2

**Riesgo:** H-107
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 15/08/2026
**Commit técnico:** `2594d27`
**Commit documental:** `31bc186`

## Problema y reproducción

Inventario → Detalle de producto mostraba la card «Color Tela» vacía para
una familia V2 aunque sus referencias conservaran `color = 'BL'`. La misma
card de un producto V1 mostraba «Blanco» y su swatch.

La línea roja `node test-h107-family-detail-color.mjs` obtuvo 3/5: V1 seguía
correcto, V2 conservaba `projection.color = 'BL'`, pero no tenía
`colorName`/`colorHex` y la card no mostraba valor.

## Causa raíz

`STORE.MAP.products.fromRow` transporta `products.color` a `product.color` y
`DATA.hydrate()` aplica `colorDisplay()` a referencias V1/V2. H-102 construye
después una proyección derivada nueva: `referenceFamilyProjection()` copiaba
correctamente el código común a `projection.color`, pero no pasaba esa nueva
estructura por `colorDisplay()`.

`DetailDrawer` consume `p.colorName` y `p.colorHex`, el mismo contrato legible
de una referencia hidratada. Por ello el dato no se perdía en el campo ni en
la agrupación; faltaba exclusivamente su presentación derivada en la proyección.

## Diseño

La autoridad familiar conserva la decisión H-102: un campo estructural sólo es
común si todas las hermanas coinciden. Después de calcular los campos comunes,
la proyección invoca la autoridad existente `colorDisplay()` únicamente cuando
`projection.color` contiene un código.

Una familia con colores de tela distintos mantiene `color = null`; no elige la
primera referencia, no recibe un swatch gris y no se inventa una representación
nueva. `color` y `ornament_color` permanecen independientes.

## Solución

- `balam/data.jsx`: resuelve `colorName`/`colorHex` en la proyección familiar
  sólo para un Color tela común.
- `test-h107-family-detail-color.mjs`: cubre V1, familia V2, CONFIG, campos
  comunes, AZL histórico, caso mixto y ocho viewports.
- `index.html`, `POS Balam (offline).html` y `sw.js`: regenerados desde fuente.

No cambiaron `DetailDrawer`, CONFIG, catálogos, productos, stock, SKU, barcode,
IDs, familias, Excel, POS, STORE, persistencia, migraciones ni Supabase.

## Auditoría del bloque Atributos

| Atributo | V1 | V2 | Fuente | Proyección familiar | Estado |
|---|---|---|---|---|---|
| Categoría | `cat` → `DATA.CAT` | igual | `products.cat` | `common('cat')` | correcto |
| Modelo | nombre en encabezado | igual | `products.nombre/modelo` | ambos comunes | correcto |
| Manga | `manga` → `DATA.MANGA` | igual | `products.manga` | `common('manga')` | correcto |
| Material | `tela` → `DATA.TELA` | igual | `products.tela` | `common('tela')` | correcto |
| Color tela | `colorName/colorHex` hidratados | faltaban derivados | `products.color`; CONFIG `color` | `common('color')` + `colorDisplay()` | corregido |
| Cuello | `cuello` → `DATA.CUELLO` | igual | `products.cuello` | `common('cuello')` | correcto |
| Ornamento | `orn` | igual | `products.orn` | `common('orn')` | correcto |
| Color de ornamento | no es card del bloque | desglose de variante | `ornamentColorCodes`; CONFIG `ornament_color` | `ornamentColorGroups` | independiente, sin cambio |
| Corte | no se muestra en el drawer | no se muestra | `attrs.corte` | `commonAttributes`/`mixedAttributes` | preservado, sin campo nuevo |
| Características | no se muestra en el drawer | no se muestra | `attrs.caracteristicas` | `commonAttributes`/`mixedAttributes` | preservado, sin campo nuevo |

## Verificación remota

La evidencia publicada de H-102 documenta a VICTOR como siete referencias de
una sola familia y 70 piezas, preservadas en Supabase antes de la proyección.
En este ciclo, la consulta REST anónima y la conexión `cli_login_postgres`
dirigidas exclusivamente a VICTOR devolvieron `42501 permission denied for
schema pos`. No se elevó la sesión a `postgres` y no se ejecutó ninguna
escritura. Por tanto, no se presenta una tabla remota actual como si hubiese
sido obtenida.

La cadena ejecutable sí queda comprobada con referencias equivalentes:
`color = BL` sobre todas las hermanas, CONFIG `Color Tela`/`Blanco`/
`#f3f4f6`, proyección familiar y card final.

## Pruebas

- H-107/BALAM QA: rojo 3/5; verde 17/17 en
  320/360/390/430/768/1024/1280/1440 px, sin overflow ni errores de página.
- H-101: contrato 26/26; editor 12/12; captura V1 10/10; mixtas 10/10.
- H-102: contrato 15/15 y E2E 16/16.
- H-103: 15/15; H-104: 8/8 + 18/18; H-105: 6/6;
  H-106: 159/159.
- Responsive global H-87: 492/492; navegación: 15/15; smoke bundle: 17/17.
- Build offline correcto. Los dos HTML locales son idénticos: 8,989,509 bytes,
  SHA-256 `b35b93f781ff9ebe139823d8120649c5b17c4423540fddbfd490ed388da3af17`.
- Evidencia visual: `.evidence-h107/detail-v2-color-320.png` y
  `.evidence-h107/detail-v2-color-1440.png`.
- GitHub Pages run `31916608231`: `success` para `2594d27`.
- Pages sirve 8,989,338 bytes, SHA-256
  `fafb91e77301f9beaf5a1911f636978112610e32f475bdc0aedabd823c0a7419`;
  coincide exactamente con el artefacto técnico tras CRLF→LF.
- El mismo H-107 ejecutado sobre esos bytes publicados obtuvo 17/17.

## Riesgo residual y pendientes

La verificación SQL actual de las filas reales VICTOR queda pendiente de una
sesión autenticada con `SELECT` sobre `pos.products`; la corrección no depende
de alterar esos datos. La familia mixta conserva el estado H-102 (`color =
null`) y no recibe UI nueva.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-107--el-detalle-familiar-v2-pierde-la-presentación-del-color-tela`
- `docs/fixes/proyeccion-comercial-familias-v2.md`
- `docs/fixes/catalogo-color-ornamento-h105.md`
- `docs/fixes/selector-color-ornamento-legible.md`
