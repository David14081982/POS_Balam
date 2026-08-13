# Jerarquía visual de la etiqueta 60×40

**Riesgo:** H-99
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 13/08/2026
**Commits técnicos:** `c1ed627` (jerarquía), `1f5785e` (paridad),
`0ca8a17` (marco físico del preview) y `e43c263` (PDF físico).

## Problema y reproducción

La referencia `C:\Users\david\Downloads\Etiquetas Balam.pdf` presenta nombre,
barcode, SKU y precio con jerarquía progresiva y distribución equilibrada. La
plantilla vigente mantenía la identidad V2 correcta, pero usaba nombre 9 pt,
SKU 8 pt y precio 12 pt; el SKU largo podía envolver y todo el bloque estaba
centrado verticalmente.

La revisión posterior del sitio publicado encontró una segunda causa: el modal
de Inventario no consume la plantilla imprimible. Recrea la etiqueta con un
árbol React/Tailwind independiente, con padding, `gap`, barcode y tipografías
propios. Por ello el render aislado aprobado puede ser correcto mientras la
vista previa mantiene proporciones distintas. El arnés original no comparaba
ambas superficies y no detectó la divergencia.

El arnés H-99 recorrió Inventario → detalle → Imprimir etiqueta → vista
imprimible con tres referencias V2 sintéticas ADRIANO/$1,150. La línea base
pasó **4/9**: conservaba 60×40, orden e identidades ocultas, pero fallaba
jerarquía, tamaño, ajuste de SKU y protagonismo del barcode.

## Causa raíz

El defecto estaba exclusivamente en `buildLabelDocument()` y su CSS. Las
constantes 9/8/12 pt, `overflow-wrap:anywhere`, barcode de 60 px y
`justify-content:center` producían la composición observada. `BARCODES.codeOf`,
`barcode_code`, Code128, SKU, precio y stock llegaban correctamente.

## Diseño

- conservar 60×40 mm, 56 mm útiles, quiet zones, `object-fit:contain` y
  `displayValue:false`;
- asignar a nombre, barcode, SKU y precio zonas verticales independientes;
- calcular sólo la tipografía del SKU según su longitud y el ancho físico útil;
- prohibir wrap, truncamiento y ellipsis; el precio nunca depende del SKU;
- conservar toda autoridad de datos e identidad H-94 sin mutaciones.

## Solución

`balam/inventory.jsx` usa nombre 14 pt, barcode 15 mm, SKU hasta 12.5 pt con
reducción proporcional y precio 20 pt/900. `labelSvg()` es la autoridad visual
única: fija un `viewBox` 60×40 y las coordenadas físicas de todas las zonas.
Preview y documento imprimible insertan el mismo SVG; el preview únicamente
escala la etiqueta completa. El PDF rasteriza ese SVG exacto a 720×480 y lo
coloca sin recomposición en una página de 60×40 mm. `labelItem()` comparte
también la proyección de datos. No se modificó `balam/barcodes.jsx` ni otra
lógica de identidad, precio o stock.

## Pruebas

- `node test-h99-label-visual.mjs`: contrato original verde **9/9** y paridad
  preview/impresión **3/3**; total **12/12**;
- SKU corto **12.5 pt**, típico **12.5 pt** y largo **5.57 pt**, todos completos
  y en una línea; precio constante **20 pt**;
- H-88B **19/19** y H-94 **49/49**;
- navegación **15/15**, smoke bundle **17/17**;
- `node build-offline.mjs`: correcto.
- `node test-h99-label-pdf.mjs`: **23/23**; PDF 1.4, MIME, xref, multipágina,
  MediaBox 60×40, JPEG/Code128, contenido y paridad exacta con el master;
- `node test-h89-pwa.mjs`: **19/19**.

La ampliación del arnés compara posiciones normalizadas de nombre, barcode,
SKU y precio, proporción 3:2 y jerarquía tipográfica entre preview e impresión
para las tres longitudes.

La comparativa A/B/C y los renders están en `.evidence-label-visual/`.

## Riesgo residual y pendientes

La impresión física depende de driver, calibración y densidad de la impresora.
Se conservó la guarda mínima Code128 de H-88B; conviene validar una muestra
física antes de imprimir un lote real.

## Publicación

Pages sirve el blob Git exacto `36753c63213031d2aac5d6a9caed0a641a7a1ae8`:
8,970,967 bytes y SHA-256
`c1adc6242a909bebea1ccff4bd7a046c22f1f34951e755db170443fa2fddaa8c`.
Sobre la descarga pública, H-99 pasó **9/9** y H-88B **19/19**.

La corrección de paridad quedó publicada en `1f5785e`. `origin/main` apunta a
ese SHA y Pages entrega el blob Git exacto
`a87db4da74fc262586d955667342b0eeb5b9ad07` (8,971,523 bytes de transferencia;
SHA-256 `c86f019e5d318bfcdcb7ebdd3491a16b95ae1ed434fe9e943a39b6c65c863e4e`).
Sobre esos bytes públicos, el H-99 ampliado pasó **12/12**: contrato maestro
**9/9** y paridad preview/impresión **3/3** para SKU corto, típico y largo.

El cierre visual `0ca8a17` retiró el redondeo de tarjeta UI sin cambiar el
layout maestro. Pages sirve su blob exacto
`db7ef56081b81537ec086ef93ed75e127e65ff64` (8,971,523 bytes; SHA-256
`9c4c79e0377c3d95253e29abc07b086873ae53aaeeed3048c1ab1e84c975449c`).
H-99 volvió a pasar **12/12** directamente sobre esos bytes públicos.

## Reapertura: descarga PDF

La versión publicada conserva paridad preview/impresión, pero
`downloadLabelDocument()` y el script de la vista imprimible entregan
`text/html` con extensión `.html`; compartir usa el mismo archivo. Todos los
puntos de entrada convergen en `LabelModal`, por lo que la corrección debe
mantener esa costura y reemplazar la salida pública por un PDF real de una
página 60×40 mm por etiqueta, sin depender de `window.print()`.

### Causa demostrada

No había una biblioteca ni un generador PDF. `downloadLabelDocument()` creaba
un `Blob` `text/html` y el script del popup creaba/compartía un `File`
`text/html`; ambos se llamaban `etiquetas-balam.html`. La impresión sólo era
correcta si el navegador ejecutaba `window.print()` y el usuario elegía PDF.

### Corrección local

`buildLabelPdf()` construye un PDF 1.4 válido y multipágina, una página física
60×40 por copia. La generación usa el mismo `labelSvg()` del preview y del
documento imprimible, conserva el Code128 como imagen y añade una capa de texto
invisible sólo para nombre, SKU y precio. Descargar entrega `.pdf` con MIME
`application/pdf`; compartir sólo se ofrece cuando el dispositivo acepta ese
archivo. Sin Web Share, Descargar PDF permanece disponible y no existe fallback
HTML. La vista imprimible queda exclusivamente para imprimir/reintentar.

La prueba roja pasó **4/16** y falló precisamente extensión, MIME, firma,
páginas, medidas y compartir. La verde pasó PDF H-99 **23/23**, paridad visual
**12/12**, H-88B **19/19**, H-94 **49/49**, navegación **15/15**, smoke
**17/17** y PWA H-89 **19/19**. El PDF multipágina de evidencia está en
`.evidence-label-visual/etiquetas-h99-multipagina.pdf`.

### Publicación verificada

El commit técnico `e43c263c16b1ac73c0b59677beabb2558065e34c` quedó en
`main` y el workflow Pages `31719749980` concluyó correctamente. El
`index.html` descargado de Pages con cache-buster coincide exactamente con el
blob Git `744f3e2bb11dd40b55221e47fce9f7c5d5272c1a`: 8,974,595 bytes y
SHA-256 `7c1eefbb38c18e58e6616f0ab93e08ca719cc642219ae445b2a0b9ad19b08e2b`.
Ejecutados directamente sobre esa descarga pública: PDF H-99 **23/23**,
paridad visual H-99 **12/12** y móvil H-88B **19/19**.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-99
- `docs/fixes/impresion-etiquetas-movil.md`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
