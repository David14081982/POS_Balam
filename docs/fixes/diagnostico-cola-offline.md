# Diagnóstico y recuperación de la cola offline

**Riesgo:** H-14
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit inicial:** `cabfccf`
**Commit de cierre:** `6f6a874`
**Corrección aditiva:** Pendiente de commit

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
serializa la cola completa en IndexedDB y espera ese respaldo antes de enviarla.
Un arranque nuevo hidrata el espejo antes del drenado y del pull. Cuando
`localStorage` vuelve a funcionar, elimina el espejo después de persistir el
snapshot vigente.

`balam/app.jsx` integra los diagnósticos en la campana administrativa siguiendo
los componentes y colores existentes. Pulsar una operación permite reintentarla.

## Pruebas

- `node test-store-queue.mjs`: 89 pasaron, 0 fallaron.
- Casos cubiertos: red, 401, 403/RLS, esquema, restricción, inventario, cuota,
  operación independiente, reinicio, reintento explícito y cola histórica.
- `node test-concurrency.mjs`: 9 pasaron, 0 fallaron.
- `node test-sale-coherence.mjs`: 17 pasaron, 0 fallaron.
- `node test-returns.mjs`: 17 pasaron, 0 fallaron.
- `node test-role-access.mjs`: 10 pasaron, 0 fallaron.
- `node build-offline.mjs`: correcto; regeneró ambos artefactos desde `balam/`.
- El fallo anterior de `node test-smoke.mjs bundle` correspondía al arnés y fue
  corregido posteriormente bajo H-15. Su evidencia de cierre está en
  `docs/fixes/arnes-smoke-confiable.md`; no cambia las pruebas funcionales H-14.

## Riesgo residual y pendientes

Ninguno conocido mientras el navegador ofrezca al menos uno de sus dos
almacenamientos persistentes. Si `localStorage` e IndexedDB fallan
simultáneamente, la cola queda en memoria y se muestra una alerta crítica; no
hay otro almacenamiento web durable disponible sin introducir infraestructura
externa.

## Retiro quirúrgico de una operación bloqueada

H94-PILOT demostró una brecha operativa distinta de la clasificación: una
entrada sintética reconstruida quedó bloqueada por `commit_mismatch`, pero la
única primitiva de descarte era `clearQueue()`. Usarla habría podido borrar
operaciones independientes.

`STORE.discardOperation(id, guards)` exige escritor local, que la operación
esté bloqueada y que coincidan el `op.id` más las guardas declaradas: tipo,
`op.key`, folio, ID de cabecera, estado y código diagnóstico. Una discrepancia
devuelve `guard_mismatch` y conserva la cola. Al acertar retira una sola entrada
y usa `saveQ()`, por lo que también actualiza el espejo durable.

Prueba roja: la nueva frontera terminó con `TypeError: S.discardOperation is not
a function` después de 174 comprobaciones aprobadas. Prueba verde:
`test-store-queue.mjs` 176/176, incluyendo operación independiente, guarda
incorrecta sin efecto y retiro exacto. No requiere migración SQL.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-14--cola-offline-sin-diagnóstico-ni-política-de-recuperación`
- Arquitectura: `docs/02-architecture.md#cola-offline`
