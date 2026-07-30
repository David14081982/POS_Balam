# Duplicación de beneficios administrables

**Riesgo:** H-55
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Crear una variante de un beneficio obligaba a volver a capturar todos sus
campos. La reproducción `test-benefit-duplicate.mjs` obtuvo 1/6 antes del
cambio.

## Causa raíz

`BenefitEditor` sólo ofrecía alta vacía. El catálogo ya permitía crear y mover
elementos, pero la interfaz no componía esas operaciones para copiar una
configuración existente.

## Diseño y solución

Cada tarjeta incorpora “Duplicar”. La acción crea una identidad interna nueva,
clona profundamente todos los ajustes, activa la copia, antepone “Copia de” al
nombre, la coloca inmediatamente después de la original y abre su edición.
Original y copia son objetos independientes; modificar una no altera la otra.

## Pruebas

- Contrato de duplicación: 6/6.
- Chrome real: 7/7, incluida posición contigua y edición aislada.
- Editor H-54: 7/7.
- Captura manual H-53: 12/12.
- Regresión H-52: 27/27.
- Contratos: 38/38.
- Navegación: 15/15.
- Build reproducible: 8/8.
- Smoke bundle: 17/17.

## Riesgo residual y pendientes

Pendiente de commit y publicación. No requiere migración ni modifica ventas.

## Referencias

- `docs/fixes/editor-simple-de-beneficios.md`
