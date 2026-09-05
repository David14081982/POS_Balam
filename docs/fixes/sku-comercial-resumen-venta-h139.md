# SKU comercial visible en el resumen de venta

**Riesgo:** H-139; seguimiento de H-136.
**Estado:** RESUELTO Y PUBLICADO.
**Fecha:** 05/09/2026
**Commit:** `7550ba89142f64533a7aea27d3ca41a9b57418f9`.

## Problema y reproducción

El usuario pide que una lectura agregue la referencia exacta y muestre su SKU
comercial. Se amplió la reproducción: crear una referencia con 5 piezas por
Inventario, sincronizarla, descargar su etiqueta, editarla a 3 piezas, crear
otra referencia con 2 y descargar la etiqueta nueva. La separación por estos
formularios son dos operaciones existentes, no se afirma una transferencia
atómica ni se introduce una nueva función de separación.

UI, DATA y STORE reales enviaron altas/edición a las funciones SQL actuales
en PostgreSQL aislado. Ambos códigos agregaron sus productos correctos antes
y después de recargar con pull, pero las líneas omitían el SKU. Rojo: 27/31;
cuatro fallos de presentación, dos referencias y dos momentos.

## Causa raíz

El resumen en `balam/pos-ticket.jsx` mostraba nombre, talla, color, ornamento,
cantidad y precio, sin renderizar `l.p.sku`. El SKU y barcode ya estaban
separados y persistían correctamente. Esta omisión de presentación no explica
la etiqueta desconocida `30328899392999898742908026` del incidente original.

## Diseño

Mostrar directamente el SKU persistido en la referencia exacta del carrito.
Sin reconstruirlo desde CONFIG, tomar un representante familiar ni usar
barcode como sustituto. Campo ausente no produce un SKU inventado. El texto
se adapta al ancho del resumen y permite lectura completa en móvil.

## Solución

Una línea de presentación en `balam/pos-ticket.jsx`; artefactos regenerados
desde fuente. Barcode/aliases, products.id, receta SKU, stock, persistencia,
cola, permisos, cobro y documentos históricos conservan sus autoridades.

`test-h136-scan-sync.mjs` extiende la base SQL de H-138 mediante `--scan-cycle`.
El transporte de altas/edición llama SQL real local; usa PGlite 0.5.8. Catálogos,
cliente genérico, autenticación y telemetría son fixtures. Las definiciones de
alta remotas se obtuvieron previamente por sólo lectura y se ejercieron en
el mismo recorrido. No se escriben datos comerciales en Supabase.

## Pruebas

- `node test-h138-registration-sql.mjs --scan-cycle`: verde ampliado **43/43**,
  incluyendo las 18 comprobaciones SQL H-138. La ejecución contrastada añadió
  `--live-defs=C:/tmp/balam-h138-server-after-defs.json`.
- `BALAM_PGLITE_MODULE` apunta a `dist/index.js` de PGlite; `PYTHONPATH` a
  PyMuPDF, Pillow y zxing-cpp instalados externamente. `test-h136-decode-label.py`
  rasteriza los PDF descargados y ZXing decodifica sus barras; esos resultados
  alimentan el input de POS. No se usa el texto del PDF como sustituto de las barras.
- La referencia anterior conserva barcode/SKU al editar stock; la nueva tiene
  identidad propia; SQL y cliente conservan existencias 3/2. Vaciar la caché
  del contexto aislado obliga al pull a reconstruir ambas referencias.
- SKU visible y completo en 320, 360, 390, 430, 768, 1024, 1280 y 1440 px;
  capturas móvil/escritorio y etiqueta rasterizada inspeccionadas. Sin errores
  de navegador. Lectura no altera las filas confirmadas de inventario.
- Los primeros fallos del arnés correspondían a catálogos/cliente genérico
  ausentes en el transporte simulado y un aviso deprecado de Python mezclado
  con JSON. Se corrigió el arnés. Otra comparación de texto detectó el escape
  ASCII de metadatos invisibles del PDF para `—`; el raster imprime el SKU
  correcto. No se clasifica como fallo de impresión. Fixture final usa `SIN`.
- H-136 lector existente: **24/24**; H-132 identidad: **7/7**.
- H-135 ticket continuo: **61/61**; navegación: **15/15**.
- Smoke desarrollo: **15/15**; smoke bundle: **17/17**.
- `node build-offline.mjs`; reproducibilidad: **8/8**.

Publicación: Pages `built`, HTTP 200, bytes idénticos al blob Git aprobado;
SHA-256 `b653b424f4ac9a7fdcfe25feb07aa680566434201a3682ccccfe43fce6a15870`.
El mismo comando con `https://david14081982.github.io/POS_Balam/` ejerció el
sitio publicado: **43/43**, incluido PDF decodificado, lectura, recarga y ocho
viewports. Red de negocio interceptada; SQL aislado. Sin migración nueva.

## Riesgo residual y pendientes

H-139 resuelve la visibilidad del SKU. H-136 conserva estado parcial: el
producto real asociado a la cadena proporcionada sigue sin identificar. No
se atribuye a hardware ni se afirma haber reproducido aquella etiqueta. La
prueba no certifica red/RLS reales, un escáner físico o el corte de impresora.
El recorrido funciona con los contratos vigentes; no garantiza ausencia de
otros bugs en flujos distintos.

## Referencias

- `docs/fixes/lectura-desconocida-pos-h136.md`.
- `docs/fixes/altas-servidor-contrato-v3-h138.md`.
- `docs/03-known-risks.md`, H-136 y H-139.
