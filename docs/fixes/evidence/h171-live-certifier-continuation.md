# H171 — Continuación del certificador de la misma entrega

Estado: diseño de continuación; el journal previo a HTTP y su integración ya
están implementados y probados localmente, como describe
[el soporte del journal](h171/live-journal.md). La reconciliación, limpieza y
jornada live siguen pendientes, sin nuevas escrituras remotas. El bloqueo del
runner permanece activo. Este archivo apoya el informe BALAM FINAL READINESS;
no abre otra historia ni representa una certificación.

La matriz histórica usa APIs del artefacto y conserva sus fixtures. Cambiar
el `finally` por DELETE no cubre pérdidas de ACK, registros derivados ni la
jornada por interfaz solicitada. Para habilitar la ejecución final se requiere:

1. Guardar manifiesto durable antes de cada escritura. Preasignar el UUID Auth
   principal antes de `createUser`; el SDK instalado admite `AdminUserAttributes.id`.
   La observación de requests actual no impide que HTTP salga antes del journal.
2. Instalar la puerta de transporte en el contexto, incluyendo la página C
   reabierta. Registrar solicitudes y resultados de folios, documentos, pagos,
   productos, clientes, permisos, auditorías y dispositivos por identidad exacta.
3. Reconciliar todas las solicitudes con la autoridad antes de retirar fixtures.
   Detener emisores y exigir cero solicitudes en ejecución para impedir commits
   tardíos. Una respuesta incierta conserva el manifiesto y `certified:false`.
4. Respaldar datos canónicos y preparar el cierre de referencias por PK/hash,
   con guardas sobre filas ajenas y retiro Auth/técnico explícito. El plan comercial
   de 149 filas existente sólo cubre sus propios registros históricos.
5. Declarar certificación después de limpiar y verificar ausencia de residuos;
   conservar por separado el resultado de escenarios y el resultado de limpieza.
6. Añadir la jornada operativa por UI: las 22 pruebas históricas de dominio no
   sustituyen guardar/cobrar/imprimir/consultar desde la interfaz final.

Límites del runner que motivaron este diseño, antes de integrar el journal H171
(las líneas siguientes corresponden a esa versión anterior):

- `test-h164-live-online.mjs:399`: el Auth principal se registra después del ACK.
- `:435` observa HTTP; no garantiza persistencia previa. `:707` reabre C sin
  instalar ese observador en la página nueva.
- `:108`–`:114` y `:389`: el baseline cubre 18 tablas y omite metadatos.
- `:537`–`:569`: configurar una clave pasa por `commit_config`, que también
  reescribe lookup/settings y avanza su versión. La restauración debe comprobar
  contenido y actor actuales; no puede sobreescribir actividad real concurrente.
- `:604`–`:689`: ventas y documentos generan hijos, commits y auditorías; los
  folios consumen contadores compartidos, incluso si la venta no termina.
- `:720` y `h164-qa-retirement.mjs:70`: el retiro anterior bloquea identidades
  pero conserva la historia QA. `:730` fija certificación antes de ese retiro.

Folios, secuencias, revisiones de snapshot y versiones de configuración son
autoridades monotónicas. Su avance legítimo no debe rebobinarse para simular
igualdad byte a byte con el estado anterior. Se deben distinguir esos avances
de filas cuyo contenido pertenece a fixtures QA, preservando la historia ajena.

Los 22 escenarios vigentes no suben objetos Storage. Si la jornada final prueba
imágenes, debe registrar bucket/ruta antes de subir y verificar ausencia al final;
el propietario del objeto no demuestra por sí mismo que sea QA.
