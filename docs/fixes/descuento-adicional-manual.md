# Porcentaje e importe manual administrables

**Riesgo:** H-53
**Estado:** resuelto
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y evidencia

El motor de H-52 ya aceptaba valores libres, pero el catálogo inicial no
ofrecía porcentaje ni importe manual. Una configuración histórica tampoco
incorporaba ítems nuevos dentro de un catálogo existente. La reproducción
`test-manual-additional-discount.mjs` obtuvo 0/7 antes de implementar.

## Corrección

`additional_benefit` incorpora `MANUAL_PERCENT` y `MANUAL_AMOUNT`. Ambos usan
el modal, snapshot, prorrateo y autoridad `DATA.saleQuote()` existentes. El
vendedor captura un valor mayor que cero y un motivo; la vista previa muestra
el resultado antes de aplicarlo.

Configuración conserva el apartado independiente “Descuentos adicionales y
beneficios”. El administrador puede renombrar, activar, desactivar, eliminar y
definir `% máximo` o `$ máximo`. La migración interna
`benefits.manualOptionsV1` agrega las dos opciones una sola vez a estados
locales o remotos históricos; las decisiones administrativas posteriores no
se revierten.

## Compatibilidad

No hay migración SQL ni campos nuevos. Las opciones viajan por el catálogo y
la sincronización de configuración existentes. Ventas históricas, fórmulas,
IVA, comisiones, pagos, posventa y documentos permanecen sin cambios.

## Pruebas

- Captura y configuración manual: 12/12.
- Regresión H-52: 27/27.
- Coherencia financiera: 20/20.
- Contratos de módulos: 38/38.
- Navegación: 15/15.
- Guardián UX: 11 interacciones, 2 validaciones.
- Build reproducible: 8/8.
- Smoke del bundle: 17/17.
- `build-offline.mjs`: correcto, 69 assets.

## Despliegue y riesgo residual

Pendiente de commit y publicación. No requiere cambios en Supabase. Riesgo
residual bajo: `$ máximo = 0` significa sin límite administrativo adicional,
pero la autoridad nunca permite descontar más que el total elegible.
