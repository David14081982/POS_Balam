# H-171 · Controles de Configuración sin efecto

**Fecha:** 12/09/2026, Hermosillo. **Base:** `c148a8c0935ea533035387a391965df9b0748082`.
**Commit:** Pendiente de commit. **Alcance:** seis editores de Configuración.

Navigator vigente enruta `ADR-015`, cliente, dominio y la autoridad de ventas.
No se cambia ninguna regla comercial ni se elimina una clave histórica.

## Reproducción y causa

La búsqueda literal en `balam/` y `supabase/`, excluyendo librerías vendorizadas,
encontró las seis claves únicamente en la semilla de `balam/config.jsx`, sus
editores de `balam/settings.jsx` y los INSERT de configuración SQL 001.
No hay lectores operativos ni decisiones SQL que consuman esos valores.

| Clave | Editor anterior | Evidencia adicional |
|---|---|---|
| `currency` | Moneda | `UI.fmt()` fija `$` y formato `es-MX` en `shared.jsx`; guardar USD sigue mostrando `$1,234.50`. |
| `pos.allowLayaway` | Permitir apartados | Apagarlo conserva `Apartado` en `payment_method`, la autoridad del selector de pago; ya documentado como deuda en `pantalla-apartados.md`. |
| `pos.askSize` | Pedir talla al escanear | Ningún consumidor fuera de semilla/editor. |
| `commission.auto` | Cálculo automático de comisión | Ningún consumidor fuera de semilla/editor; el cálculo financiero mantiene su autoridad vigente. |
| `pos.sound` | Sonido al agregar al ticket | Ningún consumidor fuera de semilla/editor. |
| `print.lowStockAlert` | Alerta de stock bajo | Ningún consumidor fuera de semilla/editor. |

Chromium recorrió Negocio, Ventas y POS e Impresión sobre el artefacto anterior
`ae53f13541729ecb3fff768d4a974a44fd5fe790f7d7961d6fde1dd28801665d`.
Los seis editores aceptaron cambios de CONFIG mediante confirmación controlada.
Moneda y apartados mantuvieron los resultados descritos; no se crearon productos,
ventas ni pagos. Toda solicitud externa estaba bloqueada.

## Corrección y verificación

Se retiraron **seis editores**, conservando las claves en CONFIG y SQL. El título
restante es «Impuestos y folios». `commission.bonus` permanece con su aclaración
informativa. `print.auto` sigue visible y confirmó una edición en la misma prueba.
El principio 7 de `PHILOSOPHY.md` ahora expresa el contrato online de ADR-015.

- `node test-h171-settings-controls.mjs --before`: reproducción comprobada; seis controles visibles y seis cambios de sus valores.
- `node test-h171-settings-controls.mjs --source`: PASS; cero controles retirados visibles, seis valores históricos conservados, bono informativo e impresión automática conservados.
- `node test-h164-online-settings.mjs`: 3/3 PASS.
- `node test-h164-online-config.mjs`: 3/3 PASS.

[Antes](h171-controls-before.json) y [después sobre la fuente](h171-controls-after.json)
identifican artefacto, hash de `settings.jsx`, resultados y cero escrituras reales.
El campo `result.writes` cuenta sólo los seis editores evaluados; después se
comprueba por separado la confirmación del control funcional `print.auto`.
Las acciones del arnés usan `data-testid` o envolturas de fixture por la clave
funcional `k` que ya recibe CONFIG. El texto visible sólo se observa; no sirve
de selector para accionar botones. Los callbacks del componente no se sustituyen.

La prueba sobre la fuente carga el bundle anterior y sustituye sólo
`settings.jsx` en el navegador. La comprobación definitiva del bundle regenerado
se ejecuta con `node test-h171-settings-controls.mjs`, sin `--source`.
Build, publicación y certificación distribuida se registran en el cierre H-171.
