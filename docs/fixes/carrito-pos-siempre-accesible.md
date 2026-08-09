# Carrito del POS siempre accesible

**Riesgo:** H-88A
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 09/08/2026
**Commits:** `979e4db`, `ff518db`, `70643d0`

## Problema, causa y solución

Entre 320 y 1024 px el catálogo y `TicketPanel` formaban una sola columna. Con
el catálogo demo, el resumen comenzaba entre 4,285 y 16,050 px y permanecía
fuera del viewport después de agregar una prenda.

El POS conserva un único `TicketPanel` editable. En teléfono se abre dentro de
un bottom sheet desde una barra inferior persistente; en tablet se abre como
drawer lateral; desde 1280 px permanece el panel lateral existente. La barra
sólo proyecta cantidad, total y confirmación de la última línea. Incluye
safe-area, foco atrapado, Escape y restauración de foco.

No cambiaron ticket, precios, descuentos, stock, checkout, DATA ni STORE.

## Pruebas y publicación

- H-88A: **30/30** en 320, 360, 390, 430, 768, 1024, 1280 y 1440 px.
- Responsive H-87: **492/492**; filtros POS **19/19 + 6/6**; navegación
  **15/15**; guardián UX **2 validaciones y 11 interacciones**; smoke **17/17**;
  build reproducible **8/8**.
- GitHub Pages sirvió contenido equivalente al build. Build H-88A SHA-256
  `C0457626323FA3AC2F07E2424CE5075EA108817033AAA588BFEEB3ABFB7E8371`;
  bytes servidos, tras normalización de finales de línea,
  `921678516A0EAF6885023B265E4040E295185C6265059F7B32ADEB35C7C3C882`.
- El arnés H-88A volvió a pasar **30/30** sobre los bytes públicos finales.

## Riesgo residual

Ninguno funcional conocido. El bottom sheet no se abre automáticamente: la
confirmación temporal vive en la barra para no interrumpir la búsqueda.

