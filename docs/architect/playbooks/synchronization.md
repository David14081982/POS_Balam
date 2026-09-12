---
capa: reglas
applies_to: [sync, client, database, realtime, offline]
related_histories: [H-06, H-09, H-13, H-14, H-16, H-62, H-68, H-77, H-79, H-121, H-148, H-164]
severity_max: blocking
no_alcance: "Los dominios concretos viven en docs/02-architecture.md y el código ejecutable."
---

# Playbook · Autoridad online y lectura entre terminales

`ADR-015` reemplaza las obligaciones local-first de este playbook. Los IDs
conservan su trazabilidad; cola, replay, cursores y rebootstrap descritos por
ADR-006/012/014 son historia y no habilitan rutas comerciales actuales.

**R-SYNC-01 · BLOCKING · Toda persistencia compartida tiene una ruta declarada.**
Inventariar tablas, comando servidor, lectura autoritativa, permisos, dependencias
y prueba entre terminales. No admitir excepciones comerciales en almacenamiento local.

**R-SYNC-02 · BLOCKING · Realtime invalida; nunca aplica datos de negocio.**
La consulta a Supabase reconstruye la proyección completa. Perder el WebSocket o
un evento no impide corregir el estado al refrescar. Origen: H-77; `ADR-015`.

**R-SYNC-03 · BLOCKING · Confirmación remota antes de efectos visibles.**
No guardar negocio local, mostrar éxito, imprimir ni descontar stock antes del
recibo servidor y la lectura autoritativa. La obligación anterior «cola primero»
queda reemplazada por `ADR-015`; tampoco se admite una cola como fallback.

**R-SYNC-04 · BLOCKING · Borrador y proyección confirmada permanecen separados.**
Una lectura no confirma, descarta ni cierra la captura. La versión base viaja al
servidor; una edición obsoleta se rechaza sin instalar el borrador en DATA.

**R-SYNC-05 · BLOCKING · Un cliente incompatible falla cerrado en servidor.**
La identidad de build no prueba incompatibilidad por sí sola. Comprobar el
contrato efectivo; no inventar avisos de actualización por telemetría obsoleta.

**R-SYNC-06 · BLOCKING · Una base anterior nunca sobrescribe autoridad vigente.**
Las versiones esperadas, bajas e invariantes se validan dentro de PostgreSQL.
Al activar online-only se cercan clientes anteriores; no se confía en locks locales.

**R-SYNC-07 · REQUIRED · Efectos y versión se confirman juntos.**
Las transacciones mantienen integridad, permisos e idempotencia. Un recibo parcial,
un booleano `false` o una respuesta vacía no se interpreta como confirmación.

**R-SYNC-08 · REQUIRED · La recuperación no depende de Realtime.**
Arranque, reconexión, foco, visibilidad y actualización manual verifican autoridad.
Refrescar permisos y estado remoto antes de habilitar negocio; nunca drenar colas.

**R-SYNC-09 · BLOCKING · Los documentos conservan su autoridad SQL.**
No reconstruirlos desde eventos, cachés o expedientes ni crear otra ruta de escritura.
Conservar identidad, snapshots históricos y fórmulas financieras existentes.

**R-SYNC-10 · REQUIRED · Activación controlada y verificable.**
Preparar migración aditiva y cliente, verificar su contrato y activar el cerco
servidor de forma coordinada. Inventariar evidencia legacy antes de retirarla.
El antiguo modo sombra no autoriza conservar una segunda ruta comercial activa.

**R-SYNC-11 · REQUIRED · «Actualizado» requiere lectura remota demostrada.**
Sesión, permisos, conectividad real y snapshot completo deben estar comprobados.
No deducir actualidad de conteos cero, heartbeat, versión local o ausencia de error.

**R-SYNC-12 · BLOCKING · Un dominio trae pruebas de sus riesgos distintos.**
Cubrir propagación por consulta, evento perdido, formulario, concurrencia,
sin Internet, reconexión, cliente antiguo, permisos, volumen e históricos según
el alcance. Ejecutar una vez cada escenario acordado; ampliar o repetir sólo
ante cambios relevantes, fallos o evidencia faltante, respetando la solicitud del usuario.

**R-SYNC-13 · BLOCKING · Ningún almacenamiento local es autoridad comercial.**
No persistir colecciones, comandos, payloads de reintento ni proyecciones
comerciales durables. Se permiten preferencias, tokens, UI, recursos técnicos,
borradores sin efectos y referencias de resultado sin payload. `ADR-015`
reemplaza la excepción de intención offline que antes permitía `ADR-014`.

**R-SYNC-14 · BLOCKING · La ausencia sólo significa baja con cobertura demostrada.**
El snapshot completo, incluido el conjunto vacío, sustituye la proyección.
Una búsqueda o ventana parcial no autoriza una poda global. Conservar borradores
separados no convierte una fila ausente del servidor en documento operativo.

**R-SYNC-15 · BLOCKING · La regresión de autoridad es una puerta de entrega.**
Demostrar cero nuevas mutaciones/colas offline, rechazo de bases obsoletas,
snapshot vacío, resultado perdido tras commit, recuperación sin Realtime,
integridad financiera y retiro legacy con recibo. Conservar la evidencia real
no reconciliada: retirar su clave sin original verificable no prueba cero pérdidas.

**R-SYNC-16 · BLOCKING · La certificación distribuida exige Supabase real y A/B/C.**
La publicación y la certificación son evidencias distintas. Cuando el usuario
solicita certificación, como en H-164, no se cierra sin ejecutarla; su ausencia
se declara NO CERTIFICADO. Mocks, unitarias y una sola terminal no certifican
convergencia. Cubrir los escenarios acordados en instalaciones independientes,
incluidos concurrencia, pérdida de eventos/respuestas, recarga, reapertura,
corte y retorno de Internet, bajas sin resurrección y comparación final con
documentos y stock de Supabase. Identificar artefacto y certificador por hash;
no presentar pruebas de otro build como evidencia actual. No usar datos de
negocio como semillas. El arnés histórico H-148 sólo acredita el contrato que
realmente ejecuta; sus expectativas offline no certifican automáticamente H-164.

**R-SYNC-17 · BLOCKING · Resolver el resultado antes de permitir repetir.**
Identidad estable y hash viven en servidor; una referencia local sin payload
permite consultar tras recargar. Un ID ausente se cancela atómicamente antes de
permitir otro intento para impedir un commit tardío. Esperar recibo terminal y
reconstrucción remota antes de éxito. Auth exige además resolver sus pasos
servidor. Los expedientes que requieren decisión se conservan individualmente,
sin replay ni conversión de rechazo en aceptación. Reemplaza el checkpoint
local durable de H-148; no introduce un nuevo cursor comercial.
