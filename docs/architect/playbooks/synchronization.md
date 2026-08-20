---
capa: reglas
applies_to: [sync, client, database, realtime, offline]
related_histories: [H-06, H-09, H-13, H-14, H-16, H-62, H-68, H-77, H-79, H-121]
severity_max: blocking
no_alcance: "Los dominios concretos viven en docs/02-architecture.md y el registro ejecutable."
---

# Playbook · Protocolo de sincronización

**R-SYNC-01 · BLOCKING · Toda persistencia compartida pertenece a un dominio
registrado.** Declara tablas, cola, pull, aplicación, dependencias, actividad,
roles y prueba multi-terminal. Si es local, se justifica.

**R-SYNC-02 · BLOCKING · Realtime invalida; nunca aplica datos de negocio.**
El cursor detecta brechas y el pull conserva paginación, fusiones, tombstones y
compatibilidad. Origen: H-77 · Decisión: `ADR-012`

**R-SYNC-03 · BLOCKING · Cola primero, reconciliación después.** Un dominio
con operación activa no aplica remoto. El cursor avanza tras aplicar todo.

**R-SYNC-04 · BLOCKING · Un borrador o transacción es una compuerta.** Puede
registrarse la invalidación, no sustituirse el estado ni cerrarse la interfaz.

**R-SYNC-05 · BLOCKING · Un cliente incompatible falla cerrado y conserva
su cola.** Build, protocolo, esquema y época son identidades separadas.

**R-SYNC-06 · BLOCKING · Una línea base anterior nunca se publica.** Las
operaciones de reemplazo validan época en PostgreSQL y quedan en cuarentena.

**R-SYNC-07 · REQUIRED · Todo commit aumenta sus dominios en su misma
transacción.** Versión sin datos o datos sin versión rompen el timbre durable.

**R-SYNC-08 · REQUIRED · La recuperación no depende del WebSocket.** Compara
versiones al suscribirse, reconectar, volver visible, cambiar sesión y escritor.

**R-SYNC-09 · BLOCKING · Los documentos conservan su autoridad SQL.** No se
reconstruyen desde eventos ni adquieren otra ruta de escritura.

**R-SYNC-10 · REQUIRED · Activación por dominio y modo sombra.** Servidor
compatible → cliente apagado → sombra → canario → activo.

**R-SYNC-11 · REQUIRED · «Sincronizado» es demostrable.** Cola, invalidaciones,
pulls y conflictos en cero; cursores, protocolo y época vigentes. Offline no cuenta.

**R-SYNC-12 · BLOCKING · Un dominio nuevo trae prueba de evolución.** Cubre
A→B, evento perdido, formulario, concurrencia, offline, cliente antiguo,
permisos, volumen y datos históricos.

**R-SYNC-13 · BLOCKING · Ningún caché es autoridad de un documento
confirmado.** Supabase confirma; la cola durable conserva únicamente una
intención offline exacta; `DATA`/`localStorage` son proyección reconstruible y
la telemetría sólo observa. Una versión o bandera local nunca sustituye esos
roles. Origen: H-121 · Decisión: `ADR-014`

**R-SYNC-14 · BLOCKING · La ausencia remota sólo significa baja dentro de una
cobertura demostrada.** Un snapshot completo —incluido el conjunto vacío—
reemplaza; una ventana sólo reconcilia identidades dentro de sus límites; un
incremental necesita tombstone o versión. Se prohíbe una poda global genérica.

**R-SYNC-15 · BLOCKING · La regresión de autoridad es una puerta de entrega.**
Antes de publicar cambios de pull, cola o rebootstrap se prueban: remoto vacío,
ventana parcial, cursor que no avanza ante aplicación incompleta, mapa de todos
los efectos pendientes, captura offline preservada, ajustes de comisión
remotos, periodo derivado del cierre remoto y lectura multi-terminal.
