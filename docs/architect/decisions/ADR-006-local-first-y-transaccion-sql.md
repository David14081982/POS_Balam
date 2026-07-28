# ADR-006 — Local-first: la cola da durabilidad, la transacción vive en SQL

**Estado:** vigente · **Historias:** H-01, H-04 (origen), H-09, H-13, H-14

## Contexto

Una venta se traducía en cabecera, renglones, movimientos y pagos enviados como
solicitudes independientes desde la cola. Un fallo inyectado en `sale_items`
después de aceptar la reserva y la cabecera dejaba stock y cabecera remotos, sin
renglones. La cola mejoraba la durabilidad, pero por sí sola no convertía varias
escrituras en una transacción.

## Decisión

Dos responsabilidades separadas y explícitas. El cliente garantiza que la acción
funciona sin conexión y deja una operación durable y recuperable: toda operación
se encola **antes** de intentar enviarse y sale sólo tras éxito remoto. La
atomicidad la garantiza PostgreSQL: `pos.commit_sale()` y `pos.commit_return()`
confirman o revierten todos los componentes juntos, con idempotencia por clave
más hash del payload.

## Trade-off

**Beneficio obtenido:** el mostrador cobra sin red y ningún fallo parcial deja
la nube en un estado intermedio. Un reintento no duplica ventas, pagos,
devoluciones ni movimientos.

**Costo aceptado:** lógica de negocio significativa vive en PL/pgSQL, lejos del
código del cliente y más cara de cambiar —cada modificación de `commit_sale`
exige una migración, una verificación y el método aditivo de `AP-05`—. La
sincronización es eventual, así que la interfaz muestra estados que la nube aún
no conoce, y una venta capturada sin inventario remoto puede quedar
`stock_pending` en la cola. La cola misma se convirtió en un subsistema con
diagnóstico, propietario por sesión y espejo en IndexedDB.

**Alternativa descartada:** que el cliente orquestara las escrituras con
compensaciones ante fallo. Se descartó porque una compensación fallida deja el
sistema peor que el fallo original, y porque el cliente puede cerrarse en
cualquier momento.

## Cómo se revierte y qué se rompería

No se revierte: es el modelo del producto. Cualquier operación nueva que escriba
varias tablas debe entrar por una función transaccional propia, no por
escrituras sueltas desde la cola.

## Referencias

`docs/fixes/venta-transaccional-idempotente.md` ·
`docs/fixes/inventario-concurrente.md` · `docs/fixes/diagnostico-cola-offline.md` ·
`docs/02-architecture.md` § Cola offline
