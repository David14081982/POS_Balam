# H171 · Retiro de Auth nuevos de la jornada

Estado: preparación local verificada; **NO CERTIFICADO en remoto**. Pendiente de commit. Este componente no abre el gate del certificador, no crea clientes de red, no tiene CLI destructiva y no concede autorización por flags. El retiro histórico `h171-auth-retirement.mjs` conserva su implementación y evidencia independientes.

## Alcance y autoridades

`h171-live-cleanup-auth.mjs` consume el plan concreto de `h171-live-cleanup-plan.mjs`: un principal QA obligatorio y, únicamente si su creación quedó demostrada, una segunda cuenta. Un fallo temprano no obliga a crear otra cuenta para poder limpiar. Exige procedencia exacta del run/intención/solicitud, UUID ausente del censo Auth previo completo y respaldo. Excluye siempre al actor real `3f24222e-fd74-4ed2-b56f-f298af574b1e` y cualquier UUID previo; conserva la solicitud histórica `70549527-4867-4342-94d2-38e770b0f2a9` con su huella **vigente del postcheck**, sin fijar un estado histórico anterior.

Enrutamiento aplicado: Navigator → database/security/synchronization; R-SEC-03 (local no certifica remoto), R-SEC-05 (administración sólo Node), R-DB-06 (intento durable y ausencia de reenvíos). El adapter no cambia funciones, tablas, fuentes de producto ni artefactos generados. SQL y GoTrue son transacciones separadas.

## Interfaz

```js
const identityEvidence = buildLiveAuthIdentityEvidence({ plan, users, observedAt });
// users son resultados GET PRESENT comprobados por el ejecutor; nunca se archivan
// ni se imprimen. Archivar la proyección devuelta en un archivo privado durable.
const adapter = createLiveCleanupAuth({
  admin, journal, plan, identityEvidence, identityEvidenceFileSha256,
  proof, preflight: async id => freshValidatedReadOnlyReport(id),
});
// Sólo el ejecutor autorizado invoca retireOne(id), retireAll() o reconcile(id).
```

`admin` es GoTrue Admin inyectado con `getUserById`, `deleteUser(id, false)` y URL exacta BALAM. El libro durable debe conservar el prefijo completo usado por el ensamblador: proyecto, run, artefacto y `plan.journalSha256`. Se permiten entradas posteriores de limpieza; se valida la secuencia/hash/intención de cada target. El plan incluye `authBaseline`, `authBaselineSha256`, `authTargets[].emailSha256` y `marker {namespace,key,value}`. Se exige plan completo, reconciliado y sin bloqueadores; `readyForReview` sólo expresa preparación técnica.

La evidencia de identidad devuelve `balam-live-auth-identities-v1`, vínculos del plan/libro/run/build, fecha de observación y por identidad: UUID, hash de correo normalizado, fecha de creación, los marcadores QA exactos, hash de todos los metadatos y estado previo PRESENT. No devuelve correo, metadatos completos, contraseña ni tokens. El ejecutor conserva el archivo en `.evidence-h171-private/` y aporta su SHA256 real. La factory vuelve a comparar la identidad actual, incluidos metadatos completos por hash, antes del intento.

## Prueba de limpieza SQL necesaria

`proof` tiene formato `balam-live-auth-sql-proof-v1`, los mismos `projectRef/run/actorId/artifactSha256`, `planSha256 = journalHash(plan)`, `journalSha256`, estado `COMMITTED_AND_VERIFIED` y `commitConfirmed: true`. Requiere hashes de `sqlSha256`, `sqlManifestSha256`, `resultFileSha256` y `postcheckFileSha256`.

`proof.result` es el reporte original `balam-new-fixture-cleanup-result-v1`: proyecto/run/manifiesto SQL coincidentes, cantidad exacta retirada, 63 tablas externas verificadas y Auth sin cambios dentro de SQL. Se comparan todas las PK y huellas de `removed_manifest` con `plan.targets`, sin ampliar por prefijo. Un fallo inmediatamente después de crear Auth puede tener cero targets POS: se admite únicamente una **transacción SQL real** con las mismas verificaciones de catálogo/64 tablas/Auth y COMMIT, `removed_rows: 0`, `removed_manifest: []` y postcheck independiente. No se fabrica un COMMIT por deducir que no hubo cambios. El plan sigue necesitando al menos un Auth nuevo demostrado.

`proof.postcheck` es la proyección comprobada de una lectura independiente **posterior al COMMIT**, respaldada por su archivo original:

| Campo | Evidencia requerida |
| --- | --- |
| `at`, `readOnly`, `sourceUrl` | Fecha, `true`, origen exacto `https://telohdbvbvsfmwyriflz.supabase.co/` |
| `remainingExactRows`, `exactRowsChecked` | Cero residuos de las PK SQL exactas; todas comprobadas |
| `protectedRequest` | `{id,fullRowMd5}` de 7054 vigente |
| `posCatalogSha256`, `authDependencyCatalogSha256` | Catálogos completos de POS y dependencias Auth, sin cuerpos de credenciales |
| `posFingerprints` | 64 tablas reales: `{table,row_count,full_rows_md5}` calculados sobre filas completas en PostgreSQL |
| `nonTargetAuthIds`, `foreignAuthFingerprint` | IDs Auth fuera del scope iguales al censo previo y huella completa agregada de esas cuentas |
| `storageOwnerCatalog` | Todas las columnas `owner`/`owner_id` de Storage: `{relation,column,type}`; incluye ambas de `storage.objects` |
| `snapshotRevision` | `{value,other_fields_md5,full_row_md5,delta_per_delete,contract_sha256}` calculados por PostgreSQL y el validador de catálogo |

Los flags y hashes no prueban por sí solos una ejecución remota. El ejecutor debe leer, validar, respaldar y vincular los resultados originales; este adapter no accede al disco para comprobar esos archivos ni ejecuta SQL.

## Preflight fresco y revisiones

`preflight(id)` entrega el resultado validado del lector READ ONLY separado `h171-live-cleanup-auth-preflight.mjs`. La fecha tiene vigencia máxima de 120 segundos, se repite después del GET y se comprueba de nuevo inmediatamente antes del envío. Se exige sesión y usuario PostgreSQL `postgres`, origen BALAM y lectura exclusivamente de metadatos, PK, conteos y hashes.

El contrato snake case es `project_ref`, `source_url`, `at`, `read_only`, `current_user`, `session_user`, `database`, `real_actor_exists`, `real_actor_can_manage`, `protected_request`, `pos_catalog_sha256`, `auth_dependency_catalog_sha256`, `pos_fingerprints`, `foreign_auth_fingerprint`, `non_target_auth_ids`, `snapshot_revision` y los campos de dependencias siguientes:

- `fk_catalog`: exactamente las 18 FK Auth revisadas, validadas y referidas a `auth.users.id`. Incluye sus columnas y efecto de eliminación. Las ocho familias propias Auth pueden tener dependientes; cada una de las diez referencias POS debe tener **cero filas**, también CASCADE y SET NULL.
- `fk_counts`: conteo para cada FK y target, `{id,relation,column,effect,rows}`. Catálogo agregado o incompleto obliga a revisión.
- `storage_owner_catalog_complete`, `storage_owner_catalog`, `storage_owner_counts`: inventario completo y conteo exacto por target/columna. Cualquier propiedad en Storage, tipo desconocido, falta o cambio de catálogo detiene la baja. No se acceden bytes de objetos.

Las 63 tablas distintas de `online_snapshot_revision` conservan exactamente sus huellas completas. Para esa única revisión se mantiene el resto de la fila y se exige incremento **exactamente +7 por UUID con intento durable y GET404 confirmado**, derivado del contrato H166 revisado: cinco UPDATE por SET NULL y dos DELETE por CASCADE sobre tablas con invalidación de sentencia, aun con cero filas. La huella del contrato y el catálogo deben mantenerse. Un intento sin GET404, un incremento adicional, un retroceso o cambio de otros campos detiene la operación. Las observaciones durables permiten reconciliar después de reiniciar sin volver a incrementar el conteo. No se reescribe ni rebobina la revisión.

## Libro, errores y límites

Antes de cada DELETE se escribe y sincroniza `live-cleanup-auth-attempt`, con `requestId = UUID` y sólo identidad/hashes seguros. Una intención existente vuelve la baja permanentemente inelegible en ese libro, incluso si hubo caída entre persistencia y transporte. `reconcile` únicamente consulta. No se reenvía tras respuesta perdida, error SDK o estado incierto. El resultado sólo verifica ausencia con GET que devuelve explícitamente 404; usuario nulo con 200, 500 o excepción 404 no cuentan.

Las observaciones usan `live-cleanup-auth-observation`. Si la cuenta ya está ausente, sólo se registra `alreadyAbsent` cuando existe la evidencia previa de identidad y el preflight sigue cumpliendo las protecciones; no se atribuye la baja al adapter. Cualquier cambio posterior de protección conserva `absenceObserved` y devuelve `REVIEW_REQUIRED`; el lote se detiene. La cuenta secundaria se procesa antes del principal. Credenciales, correos y mensajes crudos del SDK nunca entran al libro.

Un fallo de escritura del libro impide el despacho. Invocaciones concurrentes en la misma factory se rechazan; el intento durable protege además reanudaciones. La lectura SQL y el DELETE GoTrue no comparten un bloqueo transaccional: un tercero puede actuar entre ellos. El postcheck detecta diferencias, pero no ofrece atomicidad entre servicios ni atribuye causalidad a una ausencia. El operador debe mantener el contexto de ejecución controlado y conservar toda evidencia de un resultado incierto.

## Verificación local

`node --test test-h171-live-cleanup-auth.mjs`: 27/27 PASS, con archivos reales del libro durable y GoTrue inyectado, sin red. Casos: ámbito 1–2, exclusión del actor real/preexistentes, binding del run/build/libro, COMMIT y manifiesto exacto, identidad respaldada, cambios de correo/metadata/fecha, las diez FK POS, catálogo Auth, propiedad Storage, errores/404, pérdida de respuesta, caída antes de enviar, persistencia fallida, concurrencia dentro de una factory y entre dos factories, expiración después de persistir, reanudación, conservación de datos ajenos y revisión H166 exacta. El caso adicional verifica la entrada normalizada de cero targets y rechaza COMMIT supuesto, manifiesto nulo y cero Auth; la ejecución SQL real pertenece a la suite del generador SQL, no a estos dobles GoTrue.

Evidencia: `h171-live-cleanup-auth-local-validation.json`, con hashes de módulo/prueba. Se conserva `h171-live-cleanup-auth-local-validation-initial.json`: 19/20; el caso fallido quitaba el conteo Storage de otro UUID y se corrigió para quitar el target solicitado. Estas pruebas verifican la máquina de estados del adapter; el lector separado ejecuta su SQL en PostgreSQL local. Ninguna de estas pruebas acredita una baja Auth remota ni la certificación final del producto.
