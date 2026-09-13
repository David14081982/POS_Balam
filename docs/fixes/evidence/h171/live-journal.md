# H171 — Journal preventivo e integración del certificador

Estado: implementado y probado localmente; pendiente de commit. No hubo
escrituras remotas ni cambios al contrato comercial de
[ADR-015](../../../architect/decisions/ADR-015-autoridad-comercial-online.md).
Este soporte complementa el informe único de readiness; no certifica entrega.

`h171-live-journal.mjs` guarda la intención con identidad de ejecución, artefacto,
actor, checkpoint, comando y hashes encadenados. Serializa escritura, fsync,
rename atómico y fsync del archivo instalado antes de liberar cada callback HTTP.
Los callbacks pueden coincidir: la protección conserva la carrera A/B. No guarda
contraseñas ni encabezados; `admin-users` registra únicamente identidad y hash
de correo. Presence, adoption y `resolve_online_request` también quedan
registrados porque escriben estado. La resolución puede insertar un recibo
cancelado aunque la solicitud comercial original no haya llegado.

La integración de `test-h164-live-online.mjs` cubre las escrituras Node vigentes
de Auth, perfiles, roles, preparación/avance de cuentas y retiro SQL. El UUID
Auth principal existe antes de provisionar. La guardia del contexto cubre C
reabierta y los interceptores de carrera/pérdida de respuesta vuelven a usarla
antes de `continue` o `fetch`. Solo permite GET/HEAD de assets en el origen local
exacto. Bloquea una clave de servicio tanto en `apikey` como en Authorization
antes de entrar al journal. RPC desconocida, escritura REST/Storage sin contrato
y archivo legacy quedan bloqueados. El journal se abre dentro del `try`; las
excepciones de bootstrap previas no dejan un lock abierto.

La revisión reprodujo un fallo restante en el `finally` real, extraído por VM:
al fallar la lectura del hash del certificador quedaba el lock. El resultado
[anterior](runner-journal-integration-before.json) fue 9/10. El cierre de recursos
ahora está protegido por un `finally` envolvente; el resultado
[actual](runner-journal-integration.json) es 10/10 con runner SHA-256
`9e20c07e23d0352d7f76a85fbba4eff98e653bb10b83d8d6c6bf5e90718e8983`.
La misma prueba comprueba fallos al guardar el índice de fixtures: conservan la
intención durable y abortan antes de HTTP. Una excepción después de iniciar
`fetch` se distingue de un envío bloqueado; nunca se interpreta como rollback.

Validación local ejecutada: [journal 15/15](live-journal.json), integración real
por VM 10/10, `test-h170-certifier-recovery.mjs` 10/10 y
`test-h171-live-fixture-gate.mjs` 5/5. Los checkpoints históricos conservan sus
recibos y la prueba de recuperación bloquea actor ajeno, resultado incierto,
contenido distinto y un segundo intento nuevo. El test del journal también usa
Chromium con transporte completamente interceptado. Ninguna de estas pruebas
ejecuta el entrypoint live ni convierte la matriz histórica en certificación.

Límites: este journal acredita preparación, no ACK ni cierre de hijos derivados.
Un `.pending` o lock de un proceso interrumpido requiere revisión explícita;
Windows prueba fsync de archivos y rename, sin simular corte eléctrico. Los
comandos completos pertenecen al expediente privado. Faltan reconciliación,
backup canónico, guardas de contenido/actor, retiro exacto, residuo QA cero y la
jornada final. Los contadores y revisiones monotónicos no deben rebobinarse ni
la restauración puede sobrescribir actividad real concurrente. El runner sigue
bloqueado antes de efectos y conserva `certified:false`,
`deliveryCertified:false` y `cleanupVerified:false`; `scenariosPassed` solo
describe los escenarios.
