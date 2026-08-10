# Autoridad monetaria y reporte por método de pago

**Riesgo:** H-90
**Estado:** RESUELTO
**Fecha:** 09/08/2026
**Commit:** `700faaae879b38c60d551082ec02e1f53141858e`

## Problema y reproducción

`sale_payments` sólo distinguía efectivo, tarjeta, transferencia y una bolsa
`otro`; las devoluciones guardaban únicamente un texto. La prueba roja
`node test-h90-payment-method-report.mjs` rechazó el primer mixto dinámico antes
de persistir porque cuatro componentes sumaban cero para el contrato heredado.

## Causa raíz

`DATA.paymentParts()` y el esquema modelaban columnas conocidas en vez del
concepto de componente monetario configurable. Un método nuevo era identificable
en un pago simple, pero varios métodos nuevos dentro de Mixto se fusionaban; un
reembolso mixto no tenía estructura que conservar.

## Diseño

Cada entrada y devolución nueva congela una lista no vacía de código estable,
etiqueta snapshot e importe. Los códigos `Mixto`, `Apartado` y `Cortesía` nunca
son destinos monetarios. Las columnas antiguas permanecen aditivamente y los
documentos históricos sólo se adaptan cuando la evidencia es inequívoca.
`Mismo método` distribuye el reembolso proporcionalmente sobre componentes
exactos cobrados y bloquea si existe un residuo histórico.

La autoridad `DATA.paymentMethodReport()` suma entradas de ventas, anticipos,
abonos, liquidaciones y diferencias positivas de cambios; resta devoluciones y
publica toda diferencia de conciliación. Mantiene el contrato vigente de cambios
sin reembolso por diferencia negativa.

## Solución

Las migraciones `13000/13100` agregan y validan `components` en pagos y
devoluciones sin reescribir filas existentes. STORE transporta el arreglo a
través de los RPC idempotentes vigentes. POS, Apartados y Devoluciones capturan
métodos configurables; Cambios reutiliza el checkout. Reportes incorpora filtros,
KPIs, tabla dinámica, importe sin distribución y documento A4 propio de H-85.

## Pruebas

- Línea base H-90: fallo antes de persistir el mixto dinámico.
- H-90: 24/24; incluye rechazo SQL de campos/tipos ausentes y ausencia de
  efectos locales ante un reembolso descuadrado.
- Coherencia de venta: 20/20; ingresos: 24/24; H-75: 14/14.
- Apartados: 55/55; H-65: 35/35; devoluciones: 17/17; Cambio E2E: 37/37.
- H-85 local y público: 20/20; impresión A4 y PDF desde el mismo contrato.
- Módulos: 42/42; migraciones: 31/31; responsive: 492/492.
- Supabase: se aplicaron `13000/13100` y el endurecimiento `13200/13300`; las
  verificaciones informaron suma exacta, compatibilidad NULL, rechazo de campos
  ausentes y tipos inválidos. El dry-run final informó base remota al día.
- Build reproducible: 8/8; smoke del bundle: 17/17; navegación: 15/15.
- Cambios: modelo 28/28, commit 32/32, reportes 24/24 y pantalla 45/45.
- Cola offline: 162/162; plazo de devolución: 38/38; responsive: 492/492.
- GitHub Pages desplegó exitosamente `700faaa`. El artefacto público, después
  de la normalización CRLF→LF propia del blob Git, coincide byte por byte:
  8,926,906 bytes y SHA-256
  `922FF57C9BC61E3D97D8CB723F280B94323E70231B2C5E3848A36E942926D044`.
- Chrome sobre los bytes públicos: H-90 6/6 y A4/PDF 20/20. Conciliación
  observada: `1,040 + 60 = 1,100`.

## Riesgo residual y pendientes

Los documentos históricos ambiguos permanecen deliberadamente como “Importe
sin distribución”. Docker no está disponible para volcar el esquema remoto; el
historial remoto, las cuatro migraciones aplicadas y sus verificaciones SQL
confirman el contrato. Clientes antiguos pueden escribir temporalmente NULL por
compatibilidad; se retirarán antes del punto cero productivo. No se modificaron
las autoridades de inventario, SKU, `product_id`, `variant_id`, existencias ni
comisiones; sólo se adelantó la validación monetaria de una devolución para que
un rechazo ocurra antes de ejecutar los efectos de stock ya existentes.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-90---la-autoridad-monetaria-no-conserva-componentes-configurables-ni-reembolsos-exactos`
- `docs/02-architecture.md` · Autoridad monetaria por método.
- `docs/architect/authorities/sales.md`.
