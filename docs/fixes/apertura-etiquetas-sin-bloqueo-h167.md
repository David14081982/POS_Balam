# Apertura de etiquetas sin bloquear el navegador

**Riesgo:** H-167
**Estado:** PARCIALMENTE RESUELTO — corrección del bloqueo publicada y verificada. Guardado real y flota NO CERTIFICADO.
**Fecha:** 12/09/2026
**Commit técnico:** `fdb74b6c24587266feb5e6a808e8cfde71ef0c6f`
**Commit desplegado:** `34995b2767c4434f012844fc6fade7fc22faaea1`

## Problema y reproducción

En la página web, Inventario → Etiquetas dejaba el navegador sin respuesta antes
de poder guardar las imágenes en Supabase. El usuario reportó más de diez minutos.
Se reprodujo el recorrido con referencias sintéticas V2 válidas, contrato 3,
existencias positivas y PNG/PDF reales, bloqueando el transporte externo.

La base publicada `89d2789` se probó con el mismo instrumento usado después de
la corrección. Su HTML tiene SHA-256
`6759af519a2cc451d3b203afaf3bde5c46d2ebae53870d1644a8e8caf2894c81`.
Con 300 referencias, la ventana apareció en 14.093 s y hubo una tarea continua
de 12.687 s. Se midieron 180,900 comprobaciones de modelo, 601 lecturas de
productos y 900 renderizados Code128. La reproducción falla el límite de
trabajo lineal, conservando las garantías funcionales.

`docs/fixes/evidence/h167-before.json` conserva esa ejecución y las mediciones
anteriores de la copia local antigua. Éstas no se confunden con la base web:
el getter de productos de la versión publicada entrega copias y agrava el coste.
No se observó directamente la sesión física ni el inventario del usuario.

## Causa raíz

`LabelModal` certificaba durante cada render todas las referencias. Cada
certificación invocaba el resolvedor sobre todo `DATA.products`. Después el
diagnóstico repetía la resolución y la inspección física, además de generar
todos los PNG. Los cambios de copias, precio y disponibilidad del PDF repetían
ese trabajo. El getter vigente añade una copia del catálogo por consulta.

La evidencia aislada confirma `2*N²` visitas para certificación más diagnóstico:
20,000/500,000/2,000,000/8,000,000 con 100/500/1,000/2,000 referencias. Supabase
no interviene al abrir el modal: el upload comienza sólo con la acción explícita.

## Diseño

La autoridad de identidad sigue siendo la certificación existente: V2, contrato
3, barcode derivado del ID, resolución única al mismo ID y talla, geometría
Code128 válida y bloqueo del lote entero antes de PNG cuando una fila no cumple.
La enumeración de códigos y el algoritmo de certificación son compartidos;
el índice efímero no establece otra autoridad ni se conserva entre generaciones.
Incluye todo el catálogo, también colisiones fuera de la selección, aliases,
V2 sin stock y el adaptador histórico V1.

El modal se presenta antes de iniciar el trabajo. La preparación cede el hilo
entre bloques y conserva avance visible. Cerrar o cambiar la selección cancela
la generación anterior. La revisión comercial existente de DATA invalida el lote
cuando cambian productos o CONFIG; los eventos de otros dominios no reinician
un PDF válido. Stock, precio y textos se leen de los productos actuales.

No cambian fórmulas, inventario, identificadores, permisos, SQL, persistencia,
históricos ni el transporte vigente. Se conserva exactamente `saveToSupabase()`
de main: `assertBusinessReady()`, PNG, upload explícito y `saveProductRows()`.
El código del lector directo mantiene su conducta histórica. Las impresoras y
el resto de la operación comercial quedan fuera de esta corrección.

## Solución

- `balam/barcodes.jsx`: `createLabelCertificationBatch().certify()` construye
  una sola enumeración privada por preparación y delega en la misma certificación.
- `balam/inventory.jsx`: preparación cancelable, progreso, reutilización de
  inspección y PNG, invalidación por revisión comercial y PDF cancelable.
  Cada etiqueta distinta se rasteriza una vez por PDF aunque tenga varias copias.
- Tres arneses H-167 cubren coste/garantías/completitud, identidad y ciclo de
  vida. El workflow publicado ejecuta los tres para proteger la corrección.
- Los dos arneses H-99 usan snapshots válidos para el modelo vigente y esperan
  la preparación antes de evaluar el preview. Conservan todas sus aserciones.
- Los HTML y `sw.js` se regeneraron exclusivamente con `node build-offline.mjs`.

## Pruebas

| Comando | Resultado | Artefacto |
|---|---|---|
| `node test-h167-label-resolution.mjs` | 16/16; base 14/16. 200 certificaciones completas con 40,000 → 200 visitas | Fuente final de barcodes |
| `node test-h167-label-performance.mjs --fijar` (motivo exacto en baseline) | 155/155, exit 0; línea base refijada | Final |
| `node test-h167-label-lifecycle.mjs` | 8/8, cero errores JS | Final |
| `node test-h164-online-ui.mjs` | 6/6, exit 0 | Final |
| `node test-h164-online-pwa.mjs` | 2/2, exit 0 | Final |
| `node test-h99-label-pdf.mjs` | 23/23, exit 0 | Preliminar, mismo generador PDF |
| `node test-h99-label-visual.mjs` | 12/12, exit 0 | Preliminar, mismo layout |
| `node build-offline.mjs` | exit 0; los dos HTML idénticos | Final |

Con 300 referencias, el modal corregido apareció en 232 ms y la mayor tarea
continua fue 684 ms en la refijación final, frente a 14.093 s y
12,687 ms de la base. Las comprobaciones de modelo bajaron a 1,500 y las lecturas
de productos a tres, una de ellas del instrumento. Las 300 identidades y PNG
se conservaron. El host estaba bajo carga: preparar el lote tomó 24.126 s;
no se afirma que todo el PDF termine antes ni que esos tiempos sean universales.

El instrumento espera un Blob nuevo al cambiar opciones. El cierre detuvo los
rasters del PDF en 6 → 6. El motivo exacto de refijación se conserva en
`h167-baseline.json`; el guardián quedó en 155/155 con toda su cobertura.

El instrumento verifica precio, conteos, unicidad, identidad y conservación de
productos. Descarga PDF reales de veinte y doscientas páginas con dos copias de cada SKU.
La prueba de guardado entrega diez PNG reales al transporte controlado y exige
nombres, IDs y URLs exactos, sin modificar negocio antes de la persistencia.
V1, contrato inválido y alias duplicado mantienen cero PNG y salidas bloqueadas.

El ciclo de vida confirma cancelación durante certificación y primer JPEG,
colisión externa antes del primer PNG, cambio de stock de dos a cinco páginas,
barcode inválido, referencia desaparecida, CONFIG confirmada y cambios de
clientes que dejan terminar el PDF sin reiniciarlo.

La línea base `h167-baseline.json` conserva coste, garantías y completitud. Los
límites estrictos protegen certificación, consultas y generación repetidas;
las proyecciones baratas admiten un margen lineal documentado por los renders
de React. El raster PDF en curso de la prueba de cancelación se registra como
observación, no como un contador determinista.

### Pruebas históricas incompatibles

H-132, H-127 diagnóstico y H-100 no se declaran aprobados. H-132 obtuvo dos
aserciones verdes/cuatro rojas y timeout: `D.products.splice` no instala su
semilla con el getter actual. El código anterior produjo exactamente el mismo
resultado en el mismo navegador, con DATA vacío. H-127 tampoco instaló sus
productos; H-100 rechaza la talla de su semilla antes de emitir aserciones.
La cobertura vigente equivalente proviene de H-167, H-164 y H-99. Logs exactos,
comparación y hashes: `evidence/h167-regressions/SUMMARY.md`.

## Publicación y artefactos

La integración aislada parte de `89d2789`; sólo incorpora la corrección de
etiquetas. Se preservaron los cambios ya publicados de Excel y autoridad online.
No se despliega desde la copia de trabajo antigua cuyo `.git` está roto.

HTML final, ambos archivos:
`e0d1abbd98ca207143a20e5a376b8c550af41967f67feae80de3d3ac751c837c`.
HTML preliminar de las dos regresiones H-99:
`c4a05f90d3b3897a8428ce43a4fbaa44bd9b2ec9eca657ef43512e4c8cc21101`.
La diferencia final es la invalidación selectiva, probada en lifecycle y en las
pruebas H-164 repetidas.

El usuario autorizó explícitamente publicar, hacer commit y push el 12/09/2026,
superando el bloqueo previo de autorización. Se envió `34995b2` a `main` y el
[workflow 34721040537](https://github.com/David14081982/POS_Balam/actions/runs/34721040537)
terminó con regresiones y despliegue Pages en SUCCESS. Incluye las tres pruebas
H-167 sobre el cliente final y la comprobación de que el build coincide con el
artefacto del commit. La certificación live no se ejecutó.

Se descargaron desde [la web publicada](https://david14081982.github.io/POS_Balam/)
`index.html`, `POS Balam (offline).html` y `sw.js`, con HTTP 200. Los tres coinciden
byte a byte tanto con los archivos locales probados como con los blobs del
commit desplegado. Ambos HTML tienen el SHA-256 final indicado arriba; `sw.js`:
`0964802f86f73d3de000943ae9f8a2f67e4f266eb5601bf32cba0a60c84bc08b`.
La evidencia conserva fecha UTC, URLs exactas, tamaños, hashes y alcance:
[`h167-publication.json`](evidence/h167-publication.json) y
[`h167-workflow.json`](evidence/h167-workflow.json).

## Riesgo residual y pendientes

El render de un PDF grande sigue requiriendo tiempo y memoria, pero no debe
retener el hilo durante toda la preparación y se cancela al cerrar.
No se ejecutó upload contra la cuenta real, certificación A/B/C contra Supabase,
impresión en papel ni una prueba en la terminal física: **NO CERTIFICADO** para
ese alcance. No se hicieron escrituras comerciales remotas ni migraciones.
Cada instalación debe cargar el cliente nuevo para recibir la corrección.

## Referencias

- `docs/03-known-risks.md` — H-167.
- `docs/fixes/certificacion-integral-identidad-barcode-h132.md`.
- `docs/fixes/jerarquia-visual-etiqueta-60x40.md`.
- `docs/architect/authorities/inventory.md`.
- `docs/architect/playbooks/delivery.md` — R-DEL-13 a R-DEL-16.
- `docs/fixes/evidence/h167-before.json`, `h167-after.json`, `h167-baseline.json`,
  `h167-lifecycle.json`, `h167-loading.png`, `h167-ready.png`.
