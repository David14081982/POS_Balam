# Diagnóstico y recuperación de la cola offline

**Riesgo:** H-14
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Una operación rechazada por red, sesión, RLS, esquema, restricciones o reglas
de dominio permanecía en `balam_sync_queue`, pero sólo recibía `retry=true`.
No quedaban código, mensaje, intentos ni una acción de recuperación. Todos los
errores se repetían automáticamente. Además, dos drenados iniciados casi juntos
podían pasar el candado mientras esperaban al cliente de Supabase.

La reproducción inyectó fallos de red, HTTP 401, HTTP 403/`42501`,
`PGRST205`, `23505`, `insufficient_stock` y cuota agotada. Antes del cambio los
casos no podían observar el diagnóstico ni una política diferenciada.

## Causa raíz

`applyOp()` reducía cualquier resultado a booleano y su `catch` descartaba la
excepción. `flushQueue()` sólo persistía `retry=true`. El candado `flushing` se
activaba después de `await ensureClient()`, dejando una ventana para un segundo
ejecutor. Si `saveQ()` fallaba, `run()` intentaba escribir directo sin respaldo.

## Diseño

- Conservar el formato histórico y añadir metadatos de manera aditiva.
- Persistir estado, intentos, fechas y diagnóstico por operación.
- Reintentar automáticamente sólo fallos transitorios.
- Detener errores permanentes hasta una acción explícita.
- Permitir que una operación fallida no bloquee otra independiente.
- Tomar el candado antes de cualquier espera asíncrona.
- Nunca degradar silenciosamente a una escritura remota sin cola.

## Solución

`balam/store.jsx` clasifica red, servidor, autenticación, permisos, esquema,
restricciones, inventario y conflictos. Expone `queueStatus()` y
`retryOperation()`, reanuda pendientes de autenticación al iniciar sesión y
mantiene compatibilidad con operaciones antiguas. Cuando falla la cuota,
conserva la cola completa en memoria y emite una alerta crítica.

`balam/app.jsx` integra los diagnósticos en la campana administrativa siguiendo
los componentes y colores existentes. Pulsar una operación permite reintentarla.

## Pruebas

- `node test-store-queue.mjs`: 86 pasaron, 0 fallaron.
- Casos cubiertos: red, 401, 403/RLS, esquema, restricción, inventario, cuota,
  operación independiente, reinicio, reintento explícito y cola histórica.
- `node test-concurrency.mjs`: 9 pasaron, 0 fallaron.
- `node test-sale-coherence.mjs`: 17 pasaron, 0 fallaron.
- `node test-returns.mjs`: 17 pasaron, 0 fallaron.
- `node test-role-access.mjs`: 10 pasaron, 0 fallaron.
- `node build-offline.mjs`: correcto; regeneró ambos artefactos desde `balam/`.
- `node test-smoke.mjs bundle`: el arranque y siete verificaciones pasaron, pero
  el arnés terminó por timeout porque `#__bundler_err` interceptó el clic tras
  errores de recursos bloqueados por la propia jaula. No se contabiliza como
  prueba aprobada de cierre.

## Riesgo residual y pendientes

Si `localStorage` está lleno, el respaldo en memoria evita la pérdida silenciosa
durante la sesión y advierte no cerrar la pestaña. Sin embargo, no sobrevive a
un cierre o recarga hasta que se libere espacio y se vuelva a persistir. Falta
un almacenamiento durable alternativo para cerrar esa parte del riesgo.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-14--cola-offline-sin-diagnóstico-ni-política-de-recuperación`
- Arquitectura: `docs/02-architecture.md#cola-offline`
