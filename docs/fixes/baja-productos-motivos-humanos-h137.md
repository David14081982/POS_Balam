# Motivos claros cuando una baja está bloqueada

**Riesgo:** H-137
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 05/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario no puede eliminar referencias/familias. Sin identificación del caso
real todavía. La operación funciona en Chrome aislado: selección, confirmación,
baja local, solicitud durable y recarga, tanto individual como familiar.
H-114 contrato 13/13 y QA 55/55 también pasan. La consulta remota sólo lectura
encontró doce bajas recientes con estado sincronizado y sin diagnóstico; esto
no descarta un bloqueo local que todavía no haya llegado al servidor.

Se reprodujo un defecto de explicación: con cambios pendientes de enviar, el
aviso genérico oculta el motivo. La devolución vigente usa «restitución», poco
claro para quien opera el mostrador. Rojo: 36/39 en el recorrido ampliado.

## Causa raíz

Inventario entrega `guard.error`/`result.error` sin el código de la autoridad.
`messageAuthority` detecta jerga como «cola» y sustituye el mensaje por una
explicación genérica. No se encontró una falla general de la autoridad de baja.

## Diseño

Conservar las guardas y llevar su código y contexto hasta el catálogo central.
Mensajes específicos sólo en contexto `product_delete`, evitando reinterpretar
un `PRODUCT_NOT_FOUND` de otro flujo. La eliminación sigue identificando
products.id exactos; SKU no amplía el alcance. Sin cambio de datos ni SQL.

## Solución

`balam/inventory.jsx` conserva contexto/código/mensaje al mostrar el bloqueo.
`balam/shared.jsx` explica pendientes, apartado, confirmación de cobro, préstamo,
devolución vigente, producto ausente, familia cambiada y baja no guardada.
No se modifican permisos, validación, stock, cola ni documentos históricos.
Artefactos regenerados desde fuentes.

## Pruebas

- `node test-h137-delete-feedback.mjs`: rojo 36/39; verde ampliado 41/41.
  Ejercita UI + DATA + STORE reales en una sesión aislada con red bloqueada.
  Bloqueos por pendientes/apartado/préstamo/devolución; luego baja individual
  y familiar con históricos vencidos. Comprueba IDs exactos, otra familia
  intacta, documentos intactos, solicitud durable, stock y recarga.
- Ocho viewports 320–1440 px; capturas de aviso/modal móvil inspeccionadas.
- H-114 contrato 13/13 y QA 55/55; H-134 mensajes 43/43.
- H-134 E2E 26/26; H-136 lector 23/23; smoke bundle 17/17; navegación 15/15;
  build desde fuentes y reproducibilidad 8/8. Publicación pendiente.

## Riesgo residual y pendientes

El bloqueo real reportado sigue sin identificar: se solicitó familia y aviso.
No se eliminó ningún producto real ni se invocó una RPC remota de baja. La
prueba verifica la solicitud local durable y H-114 cubre tombstone/pull;
no se afirma haber certificado una nueva eliminación en producción.

## Referencias

- `docs/03-known-risks.md`, H-137.
- `docs/fixes/paridad-capacidad-baja-productos-v1-v2.md`.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `test-h137-delete-feedback.mjs`.
