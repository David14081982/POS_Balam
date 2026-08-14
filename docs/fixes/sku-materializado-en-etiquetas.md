# SKU materializado por talla en etiquetas

**Riesgo:** H-100
**Estado:** RESUELTO LOCALMENTE
**Fecha:** 13/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El PDF reportado mostraba cinco veces ADRIANO con
`1-ARO-MC-ALG-AMAR-TRA-ALF--T`. La reproducción sintética conserva ese SKU V1
base y crea existencias 38, 40, 42, M, L y XL; además crea seis referencias V2
con esas tallas e intenta inyectar el mismo SKU defectuoso. Antes del cambio el
arnés H-100 obtuvo **3/10**: preview, PDF e impresión repetían `T`, y V2 aceptaba
el SKU entrante.

## Causa raíz

El recorrido exacto era:

1. `CONFIG.skuParts()` publicaba `effective_size` correctamente.
2. `DATA.skuPartToken()` devolvía `SIZE_MARK = "T"` para V1 y
   `DATA.effectiveSize().skuToken` para V2.
3. `BARCODES.codeOf()` sí materializaba la talla V1 para el Code128.
4. `LabelModal.labelItem()` descartaba esa proyección para el texto y leía
   `s.p.sku`; allí la talla efectiva volvía a quedar como `T`.
5. Preview, impresión y `buildLabelPdf()` compartían el mismo item incorrecto;
   el PDF no reinterpretaba el SKU.

Dos causas adicionales completaban el defecto. `createReference()` usaba
`p.sku || sku(p)`, por lo que un SKU entrante podía imponerse a la autoridad V2.
Y `DATA.sku()` unía todos los tokens sin omitir vacíos: en ADRIANO el segmento
vacío era `ornament_color`, que participa en SKU pero es opcional y no tenía
valor. El `--` era el separador alrededor de ese token vacío, no un catálogo
desconocido ni un defecto del PDF.

## Diseño

`DATA.materializedSku(producto, tallaExplícita)` es la única autoridad del SKU
visible de una pieza. V1 conserva sin reescritura masiva su SKU base y recibe la
talla explícita de `resolveProductSizes()`; V2 persiste desde el alta el SKU
derivado de la referencia exacta. Los segmentos opcionales sin valor se omiten
al serializar, igual que ya hacía `skuPreview()`.

La talla nunca se obtiene del nombre, del stock inicial, de la primera talla ni
de una inferencia del SKU. La búsqueda exacta de `T` sólo localiza el slot
histórico V1; el valor sustituto siempre es la talla seleccionada.

## Solución

- `balam/data.jsx` publica `materializedSku()`, compacta tokens opcionales y
  obliga a `createReference()` a derivar el SKU V2.
- `balam/barcodes.jsx` consume esa autoridad sólo para el adaptador V1; V2
  continúa devolviendo `barcodeCode` sin cambios.
- `balam/inventory.jsx` entrega a preview, PDF e impresión el mismo SKU
  materializado.
- El arnés H-94 de SKU homónimos ahora crea una colisión válida mediante
  `EN REFERENCIA = Sí / EN SKU = No`; ya no inyecta manualmente un SKU V2.

No se regeneró ni reescribió ningún producto V1, no se ejecutó Punto Cero y no
se modificaron `products.id`, `barcode_code`, precio, Code128 ni diseño H-99.

## Pruebas

- H-100 roja: **3/10**; verde: **10/10**.
- H-94 modelo V2: **49/49**.
- H-94 CONFIG objetivo: **30/30**.
- H-99 PDF: **23/23**; H-99 visual: **12/12**; H-88B móvil: **19/19**.
- Excel H-86: **42/42**; atributos opcionales H-86: **17/17**.
- Tallas: **9/9**; contratos de módulos: **42/42**.
- Smoke del bundle: **17/17**; navegación: **15/15**.
- Build offline correcto. `index.html`: 8,975,122 bytes, SHA-256
  `d7fe250a29471d94a8b1377ad3f1a1e08179d4db35b6ce4bfec7dd0749710721`.

Evidencia: `.evidence-h100/etiquetas-adriano-multitalla.pdf`, 12 páginas
(seis V1 y seis V2), 611,381 bytes, SHA-256
`9ba27034464cffcb9b94d808ca0beb10016519493ebc5de0f3c3bb5173697f61`.

## Riesgo residual y pendientes

Falta verificar que GitHub Pages sirva byte a byte el artefacto del commit. No
hay migración ni cambio de datos remotos que desplegar.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-100---el-sku-visible-de-etiquetas-conserva-el-marcador-de-talla`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
- `docs/fixes/jerarquia-visual-etiqueta-60x40.md`
