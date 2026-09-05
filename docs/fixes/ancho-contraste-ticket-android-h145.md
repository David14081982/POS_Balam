# Ancho útil y negro sólido en el ticket Android

**Riesgo:** H-145
**Estado:** EN CURSO
**Fecha:** 05/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Papel confirmado de 8 cm. El usuario confirma diseño correcto, pero contenido
de unos 6 cm y letras claras, frente a la autoprueba oscura de la impresora.
Se trabaja desde `bcc3d28` en worktree aislado.

## Causa raíz

El PNG previo mide 576 puntos, pero incluye los 24 px de padding horizontal
por lado de la hoja CSS de 80 mm. La tinta ocupa sólo 485 puntos: 60.625 mm
a 8 puntos/mm. La imagen también contiene grises intermedios (195406 píxeles
en el caso histórico), que el controlador puede tramar. La autoprueba oscura
reportada por el usuario es compatible con este defecto de proyección; no
demuestra la densidad física final del nuevo raster.

## Diseño

La salida de 576 puntos cubre 72 mm a 8 puntos/mm: ancho útil del cabezal para
un rollo de 80 mm, no impresión hasta los bordes del papel. Excluir del raster
el margen horizontal de la plantilla, manteniendo un pequeño resguardo y la
composición proporcional. Conservar márgenes verticales y todo el contenido.
Usar negro/blanco sólidos para que el texto no dependa del tramado de grises
de RawBT. Los bordes de separación deben sobrevivir a esta conversión.

| Capacidad/ciclo | Garantía |
|---|---|
| POS, Reportes, Apartados, Cambio, Devolución | Única proyección compartida |
| V1/V2 y datos históricos | Documento original intacto |
| Largo→corto, reintento, cancelación | Cache por contenido, sin envío tardío |
| Offline, recarga y errores | Sin nuevas dependencias/red; nunca truncar |
| Escritorio y PDF | Geometría y colores originales |
| Pagos, stock, cola, permisos, reversas | No cambian |

## Solución

`receiptGraphic()` conserva el HTML/CSS original a 80 mm, pero recorta sólo
el padding horizontal exterior, dejando 1 px CSS de seguridad por lado.
Escala ese rectángulo proporcionalmente a 576 puntos. Convierte los bordes
de la copia térmica a negro y binariza la luminancia con umbral 200. El PNG
mantiene formato gris de 8 bits, pero sus únicos valores son 0 y 255.
No hay otro diseño ni configuración persistida. Chrome conserva sus tonos
y márgenes originales. La salida medida ocupa 571 puntos (71.375 mm).

## Pruebas

Rojo: `node test-h144-ticket-design.mjs`, 47/61 antes de corregir: fallan
las 14 comprobaciones nuevas de ancho y grises en siete documentos.
Verde: 61/61, incluido V1, V2 de 24 prendas, logo personalizado,
largo→corto, abono, cambio y devolución de 12 prendas. Cero píxeles grises;
571 puntos de ancho de tinta en cada caso. Todos los folios y totales siguen
presentes, sin truncamiento de altura ni mutación de negocio.

La referencia visual es una captura independiente de Chrome a 3x, recortada
al mismo rectángulo y binarizada. La comparación admite 2 puntos de diferencia
espacial por redondeo de screenshot/SVG, exige menos de 1% de tinta sin
correspondencia bidireccional y una diferencia de cobertura inferior al 10%.
No se exige igualdad puntual de bordes rasterizados en escalas distintas.
Inspección visual del ticket corto y devolución confirma campos, importes y
líneas completos. Offline probado de 320 a 1440 px; errores, cancelación y
reintento conservan su contrato. Pruebas de Reportes H-143: 37/37, incluidos
ancho y negro sólido del PNG de su ventana propia. H-135: 61/61 (Chrome/PDF).

Regresiones: `node test-h85-receipts.mjs` 20/20,
`node test-h90-payment-method-ticket.mjs` 17/17,
`node test-h90-payment-method-ticket-e2e.mjs` 21/21,
`node test-smoke.mjs` 15/15, `node test-ui-navigation.mjs` 15/15,
`node test-build-reproducibility.mjs` 8/8.
Dos builds iguales: SHA-256 local
`4810d60bb2b0ed1f30c2cca5e42eb9d08eae08d59269c1b9c240ccfccf09c978`.
Los tests interceptan Supabase; no se escribieron datos comerciales reales.
QA inspecciona también el PNG de Reportes: neto, conciliación y pie completos.
Self-review: el único cambio productivo está en la proyección de `shared.jsx`;
las autoridades de POS, pagos, documentos, identidad y permisos no cambian.
V1/V2 usan el mismo recorrido de preparación, clic, error, reintento y cierre.
Excel, etiquetas y préstamos no consumen esta salida y no cambian.

Publicación: pendiente de registrar.

## Riesgo residual y pendientes

No se puede configurar RawBT remotamente. El controlador debe corresponder a
rollo de 80 mm y ancho de 576 puntos; el cabezal no imprime 80 mm de tinta.
La aceptación física final pertenece al usuario. No se atribuye avería a la
impresora por un fallo de la proyección de BALAM.

## Referencias

- `diseno-ticket-android-h144.md`.
- `docs/02-architecture.md`, transporte de comprobantes Android.
