# Editor sencillo y responsivo de beneficios

**Riesgo:** H-54
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** `8dc7533`

## Problema y reproducción

El editor genérico mostraba en una sola fila el código interno y once controles
sin etiqueta. La captura evidenció términos como `fixed`, `ticket`, `true` y
`false`, además de controles fuera del margen. La reproducción automatizada
inicial obtuvo 1/7.

## Causa raíz

`additional_benefit` reutilizaba `CatalogEditor`, diseñado para catálogos
compactos de producto, aunque un beneficio representa varias decisiones de
negocio que necesitan nombre, explicación y distribución vertical.

## Diseño

Se conserva el mismo catálogo y sus escrituras. Un editor específico presenta
una tarjeta resumida por beneficio y despliega sus opciones sólo al editar.
Todos los valores internos se traducen a lenguaje administrativo y los campos
se organizan en una o dos columnas según el ancho disponible.

## Solución

`BenefitEditor` permite crear, renombrar, activar, ordenar y eliminar opciones.
Expone preguntas claras: de dónde proviene, cómo se calcula, dónde se aplica,
si el vendedor escribe el valor, cuál es el límite, si pide explicación y si
puede combinarse. Las tarjetas físicas muestran su regla de folio y conexión
como explicación, no como control técnico.

## Pruebas

- Contrato visual H-54: 7/7.
- Chrome real a 1280, 768 y 390 px: 5/5, sin desbordamiento de tarjetas.
- Captura manual H-53: 12/12.
- Regresión H-52: 27/27.
- Contratos: 38/38.
- Navegación: 15/15.
- Guardián UX: 11 interacciones y 2 validaciones.
- Build reproducible: 8/8.
- Smoke bundle: 17/17.

## Riesgo residual y pendientes

No cambia datos ni requiere migración. El commit `8dc7533` se publicó en
`main`; GitHub Pages sirve `index.html` idéntico byte a byte:

    SHA-256  EF266A741A977ED0FD078912786455602BA894819CA59CEEBD38047F5CF108D0
    bytes    8 739 269

## Referencias

- `docs/fixes/descuento-adicional-manual.md`
- `docs/architect/playbooks/client.md`
