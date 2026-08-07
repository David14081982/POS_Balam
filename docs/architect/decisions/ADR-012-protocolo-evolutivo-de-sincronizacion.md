# ADR-012 · La sincronización entrante es un protocolo versionado

**Estado:** decisión arquitectónica aceptada · implementación en curso
**Historia:** H-77 · **Fecha:** 06/08/2026

## Contexto

BALAM conserva operaciones salientes en una cola durable, pero sólo baja el
estado remoto durante `STORE.init({pull:true})`. Realtime transportando filas
duplicaría fusión, tombstones, paginación y documentos que pertenecen al pull.
Una terminal offline puede además volver tras reemplazar una línea base: su cola
debe sobrevivir, pero su conocimiento antiguo no puede repoblar el servidor.

## Decisión

La sincronización usa cuatro identidades: build del cliente, protocolo, esquema
y época de datos. Todo dato compartido pertenece a un dominio registrado. Un
commit aumenta la versión durable de sus dominios en la misma transacción.
Realtime publica sólo la invalidación; el cliente compara cursores y reutiliza el
pull autoritativo. Realtime nunca aplica datos de negocio.

Una invalidación no se aplica sobre un dominio con borrador, transacción o cola
pendiente. Al liberarse, la cola se drena antes de reconciliar. Un evento perdido
se recupera al reconectar, recuperar visibilidad, cambiar sesión o asumir el rol
de escritor local.

Una operación capaz de reemplazar una línea base lleva época. PostgreSQL rechaza
una época anterior; el cliente conserva la operación en cuarentena y exige
rebootstrap. Un protocolo incompatible falla cerrado y nunca descarta la cola.

## Contratos

1. Cola antes de red y salida sólo tras confirmación remota.
2. SQL conserva atomicidad, idempotencia y validación de versión/época.
3. Cada dominio declara pull, aplicación, pendientes, dependencias, actividades,
   roles y verificación multi-terminal.
4. Los documentos conservan sus RPC; el protocolo sólo provoca lectura.
5. Un cursor avanza sólo después de aplicar el estado completo.
6. Offline no significa sincronizado; sí significa protegido y recuperable.
7. Persistencia compartida sin dominio registrado bloquea la entrega.

## Despliegue

Servidor compatible primero; cliente apagado; sombra; canario; activación por
dominio; punto cero al final. Las banderas retiran entrada viva sin retirar cola
saliente ni local-first. Migraciones aplicadas se corrigen hacia adelante.

## Alternativas descartadas

- Payloads Realtime: duplican autoridades y dependen de entrega perfecta.
- Sondeo de snapshots: tráfico constante y sin cursor durable.
- Recargar la página: destruye trabajo abierto.
- Activación global: no aísla regresiones.

## Referencias

`ADR-006` · `docs/02-architecture.md` § Sincronización ·
`docs/architect/playbooks/synchronization.md` · H-77
