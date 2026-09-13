# H171 — retiro exacto de Auth QA: módulo preparado

Estado: **EJECUTADO Y VERIFICADO** contra GoTrue real. Pertenece al retiro técnico autorizado dentro de H171; no amplía el manifiesto comercial, las317 filas técnicas ni las cuatro filas ambiguas excluidas. Commit: Pendiente de commit.

Resultado a las04:47:03 UTC: diez DELETE con registro durable previo, once
GET404 y ninguna repetición;6dd8 ya estaba ausente por7054.
[Resultado](h171/auth-retirement-result.json), [libro durable](h171/auth-retirement-journal.json)
y [SQL independiente final](h171/auth-retirement-final-preflight.json).
Los198 conteos FK de esosUUID son cero y el actor real conserva acceso de
administración. [La comprobación global](h171/after-auth-protected-integrity.json)
mantiene63 hashes protegidos, inventario973/251/3483, venta0001 y7054 completada.
La revisión avanzó655→725 mediante las FK existentes; no hubo rebobinado.

Actualización posterior a la limpieza149: la solicitud real `7054…` completó su
baja de `6dd83591-9e6b-482f-95e0-78470766cbce` a las 04:05:49.478195 UTC.
La [lectura remota exacta](h171/request7054-completion-inspection.json) confirma
actor real, acción delete, target QA exacto, resultado OK y cuenta ausente.
El nuevo MD5 protegido es `8fdc987d8fe491f467f968da4c5306e0`; el anterior
`331b08f4f73f7480c93f57ffd3bf88e1` se conserva como evidencia histórica.
Este adaptador no produjo esa transición. Quedan diez Auth presentes de los
once UUID originales; GET404 del ya ausente se registra sin repetir DELETE.
La prueba añadida rechaza el estado anterior y preserva el completado.

Autoridades: Navigator → `playbooks/database.md`, `playbooks/security.md`, `playbooks/delivery.md` y `authorities/security.md`; la API vigente se contrastó con `@supabase/auth-js/src/GoTrueAdminApi.ts` instalado por BALAM (`getUserById`, `deleteUser(id, false)`). Se preserva el contrato Only Online. El riesgo y la autorización de H171 los registra el informe principal; la clasificación histórica de procedencia no se convierte en autorización por editarla.

## Alcance y barreras

`h171-auth-retirement.mjs` exporta una fábrica Node y dos funciones puras. Importarlo o ejecutarlo directamente no inicia solicitudes ni realiza cambios. El cliente Admin de GoTrue y la consulta SQL los inyecta el ejecutor autorizado; el módulo no carga credenciales, no usa el navegador y no contiene bajas SQL de Auth.

La lista se toma de `h171-auth-tech-provenance.json` y se comprueba contra la huella SHA256 de los once UUID ordenados. Cualquier ampliación, sustitución, duplicado, proyecto distinto o inclusión del actor real `3f24222e-fd74-4ed2-b56f-f298af574b1e` falla antes de consultar la API. La identidad viva requiere UUID, MD5 exacto del correo, fecha de creación y los marcadores QA permitidos iguales a la evidencia revisada. No se selecciona ni elimina por prefijo de correo, folio o nombre.

`buildAuthIdentityBaseline({provenance, authorityAudit, inventory})` obtiene esos once metadatos de `h171/authority-audit-before.json` y del censo compacto `h171/auth-tech-before.json`. La procedencia conjunta H148 complementa el rótulo UNKNOWN de la primera auditoría; véase `h171-h148-legacy-provenance.md`. La huella de la proyección y de ambos archivos queda en `h171-auth-retirement-local-validation.json`. No se imprimen correos ni respuestas completas de GoTrue.

La fábrica exige un libro `openLiveJournal` de BALAM ligado al artefacto `cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437`. Antes de cada solicitud de baja persiste con `beforeMutation` el UUID, acción, huella de identidad, manifiesto, evidencia y preflight. El libro debe conservarse y reutilizarse en toda reanudación; abrir otro libro vacío anularía la memoria del intento. El archivo de bloqueo evita dos escritores del mismo libro. No se incorpora reintento de transporte al cliente Admin.

## Contrato de integración

```js
const identities = buildAuthIdentityBaseline({ provenance, authorityAudit, inventory });
const retirement = createAuthRetirement({
  admin: supabase.auth.admin,       // sólo Node; URL Auth exacta de BALAM
  journal,                        // libro durable persistente ya abierto
  provenance,
  identities,
  readiness: executedAndRevalidatedEvidence,
  preflight: async () => executeReadOnlySql(preflightSql),
});
```

`readiness` es una declaración normalizada del ejecutor de confianza, derivada de los resultados reales completos y sus archivos verificados. **Las huellas y los estados escritos a mano no prueban una ejecución remota.** El ejecutor debe verificar los archivos originales y el éxito de COMMIT más la consulta posterior, antes de construirla. El módulo exige:

- `projectRef` exacto; `ownerApprovalSha256` de la autorización registrada.
- `identityEvidence: {baselineSha256, auditSha256, inventorySha256}`; la primera debe coincidir con la proyección recibida.
- `commercial: {status: 'COMMITTED_AND_VERIFIED', removedRows: 149, remainingExactRows: 0, evidenceSha256, postcheckSha256, backupSha256, manifestMd5}`. Respaldo y manifiesto deben ser los revisados, fijados en `AUTH_RETIREMENT`.
- `technical: {status: 'COMMITTED_AND_VERIFIED', removedRows: 317, remainingExactRows: 0, evidenceSha256, postcheckSha256, canonicalBackupSha256, heldRecoveries: 2, protectedHistoryRows: 18, implicitCascadeRows: 0}`. Respaldo canónico fijo en `AUTH_RETIREMENT`.

Un resultado dentro de una transacción que luego falla, una revisión previa o el resultado sintético de las pruebas no cumplen este contrato. La fase 149 y la fase 317 deben haberse confirmado y revalidado antes de llamar a `retireOne(id)` o `retireAll()`.

`preflight` debe ejecutar nuevamente `h171-auth-retirement-preflight.sql` en BALAM, no devolver siempre un archivo anterior. El SELECT está delimitado por `BEGIN READ ONLY`, no lee cuerpos de sesiones, tokens ni credenciales y devuelve únicamente conteos, UUID, huellas y marcadores QA permitidos. Inventaría el catálogo completo de FK entrantes a `auth.users`; exige exactamente las 18 relaciones/columnas/efectos ya revisadas, validadas y dirigidas a `id`. Una FK nueva, faltante o compuesta bloquea.

Todas las referencias en `pos` al objetivo deben contar cero: NO ACTION, SET NULL y CASCADE. Sólo se permiten los dependientes Auth propios de las ocho familias conocidas, cuyo retiro corresponde a GoTrue. Antes y después se exige la existencia y capacidad administrativa del actor real, y que la solicitud original `70549527-4867-4342-94d2-38e770b0f2a9` conserve el MD5 de su estado completado `8fdc987d8fe491f467f968da4c5306e0`. Su objetivo Auth QA no autoriza a cambiar el estado, borrar ni ocultar esa historia. El SELECT no trata esa referencia semántica preservada como una FK inexistente.

La consulta se verifica antes de leer identidad viva, se repite inmediatamente antes del intento y no puede tener más de 120 segundos (o el límite menor elegido). Se verifica otra vez al conciliar. La API y PostgreSQL son transacciones diferentes: **no hay bloqueo atómico entre preflight y baja Auth**. El ejecutor debe mantener una ventana sin operaciones administrativas concurrentes; si aparece deriva, se detiene. Las comprobaciones posteriores prueban actor y solicitud protegidos, no una comparación completa de todos los cuerpos comerciales; esa comparación corresponde a los informes remotos del corte principal.

## Estados e idempotencia

`retireOne(id)` comprueba las barreras, persiste el intento y llama una sola vez a `admin.deleteUser(id, false)`. El resultado del DELETE no basta: sólo una respuesta de `getUserById(id)` con error de estado 404 y sin usuario acredita `ABSENT_VERIFIED`. Un usuario ausente con respuesta 200, un error lanzado que mencione 404 o una respuesta malformada quedan sin verificar.

Un intento ya registrado sólo admite lectura, aunque el proceso haya caído después de persistir y antes de enviar. `reconcile(id)` sirve para esa lectura aun cuando no se vuelva a habilitar la preparación de nuevas bajas. No repite DELETE. Si el usuario permanece, devuelve `REVIEW_REQUIRED`; si GET es incierto, `UNKNOWN`. Si falla la comprobación posterior de historia, registra `REVIEW_REQUIRED` y por separado si se observó ausencia. `retireAll()` avanza secuencialmente y se detiene en el primer resultado distinto de ausencia verificada o en un error. No se deben reiniciar automáticamente los intentos rechazados o inciertos.

El respaldo de metadatos Auth **no restaura cuentas, contraseñas, identidades ni sesiones**. Esta preparación implementa el retiro autorizado y conserva su trazabilidad; no presenta los once metadatos como un respaldo integral reversible de GoTrue. Los dos recoveries con `write_token` no nulo siguen fuera de la baja técnica y este módulo no los lee ni modifica.

## Verificación

`node test-h171-auth-retirement.mjs` ejecuta 22 casos locales con Admin falso, libro real en disco y PostgreSQL PGlite. Comprueba los once UUID, durabilidad previa, reanudación, respuesta perdida, GET incierto, cero reintentos, cambios de identidad, todas las variantes FK en `pos`, deriva del catálogo, caducidad, protección del actor y 7054, fallo de disco, concurrencia y omisión de datos sensibles del libro.

El SELECT se ejecuta sobre un esquema PostgreSQL sintético con las 18 FK y 198 conteos; la prueba agrega una FK y observa el catálogo de 19, conserva usuarios y confirma `transaction_read_only=on`. Eso valida sintaxis y comportamiento local conforme a R-DB-09. **No certifica el catálogo real ni el retiro remoto.** Evidencia: `h171-auth-retirement-local-validation.json`; SQL generado: `h171-auth-retirement-preflight.sql`. No se modificaron app, runner, migraciones ni artefactos generados.
