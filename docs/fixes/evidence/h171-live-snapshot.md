# H171 — captura canónica privada para el certificador

Estado: preparación local. `h171-live-snapshot.mjs` no conecta a Supabase, crea fixtures, cambia el runner, restaura datos ni genera bajas. Commit: Pendiente de commit. Su resultado es evidencia para preparar un manifiesto exacto; no es autorización de limpieza ni certificación distribuida.

Autoridades cargadas mediante Navigator: database, security, delivery y synchronization. El inventario real se deriva de `h171/authority-audit-before.json` (columnas y tipos) y `h171/cleanup-catalog-before.json` (PK), con las 64 tablas de BALAM fijadas por SHA256. R-DB-09 se verifica ejecutando el SQL en PGlite. La procedencia de fixtures y las pruebas remotas corresponden al libro y al certificador principal de H171.

## Uso y formato

```js
const catalog = recordedSnapshotCatalog({ authorityAudit, cleanupCatalog });
const sourceUrl = 'https://api.supabase.com/v1/projects/telohdbvbvsfmwyriflz/database/query';
const sql = buildLiveSnapshotSql({ catalog, sourceUrl });
// El ejecutor autorizado ejecuta SQL en esa conexión y conserva el resultado.
const saved = await writePrivateLiveSnapshot({
  input: result, catalog, sourceUrl,
  file: '/ruta/real/.evidence-h171-private/live-snapshots/baseline.json',
  privateRoot: '/ruta/real/.evidence-h171-private/live-snapshots',
});
```

La ruta anterior es un ejemplo; el manifiesto devuelto declara la ruta absoluta real, bytes, SHA256, número de tablas/filas y huella del catálogo. Por defecto la raíz es `.evidence-h171-private/live-snapshots` dentro del directorio de trabajo. La escritura exige permanecer dentro de una raíz privada declarada, crea el archivo exclusivamente sin sobreescribir, sincroniza su contenido y compara los bytes leídos. Un error deja el archivo para revisión; no elimina ni reemplaza automáticamente evidencia anterior. La protección de acceso en Windows depende también de las ACL heredadas del workspace.

El ejecutor debe capturar y conservar el baseline **antes de crear fixtures** y un nuevo snapshot después del recorrido y su resolución/limpieza aprobada. Debe ligar ambas huellas al mismo run, artefacto final y libro durable. No se debe reemplazar el baseline por una captura posterior. El módulo no introduce llamadas ni captura remota automáticamente al importarse o ejecutarse como archivo.

`buildLiveSnapshotSql` produce una transacción `REPEATABLE READ READ ONLY`, UTC, DateStyle ISO y `search_path=pg_catalog`. Antes de devolver filas exige base/sesión/usuario `postgres`, sin rol asumido, existencia del actor real BALAM y coincidencia completa de las 64 tablas, columnas/tipos/nullabilidad y PK revisadas. Un cambio de catálogo, PK ausente o nueva columna sensible detiene la captura. El guard es sólo lectura.

La URL de transporte se limita al proyecto `telohdbvbvsfmwyriflz`; no admite credenciales, querystring ni fragmento. El ejecutor debe verificar que realmente utiliza esa conexión. **El texto `expected_project_ref` no prueba por sí solo la identidad de un servidor PostgreSQL**: el informe declara expresamente la vinculación externa y el ancla del actor. No se leen secretos de configuración para intentar inferirla. La captura no consulta Storage y sólo consulta `auth.users.id` para comprobar el ancla, sin devolver usuarios, identidades, sesiones o credenciales Auth.

El resultado `report` tiene formato `balam-canonical-snapshot-v1` e incluye sesión, hora, snapshot MVCC, omisiones, `catalog` y `tables`. Cada una de las 64 tablas aparece incluso vacía con `row_count: 0, rows: []`. El catálogo incluye tablas/RLS, columnas y tipos, PK, hashes de defaults, FK entrantes/salientes de `pos`, triggers (incluidos internos) y huellas de todas las funciones `pos` y de sus handlers. Los cuerpos de funciones, defaults y argumentos de triggers no se exportan; se comparan sus huellas.

`buildLiveSnapshotCatalogSql()` exporta las mismas CTE y expresión JSON usadas por la captura, como un SELECT de columna `catalog`, sin BEGIN ni datos comerciales. El consumidor debe fijar `search_path=pg_catalog`; permite comparar el catálogo con el mismo contrato durante una revisión posterior.

Cada fila contiene:

| Campo | Evidencia |
|---|---|
| `pk_json_text` | Clave primaria serializada por PostgreSQL; se conserva como texto para no redondear números grandes. |
| `row_json_text` | Texto canónico PostgreSQL de la proyección con columnas sensibles omitidas. |
| `projected_row_md5` | MD5 de ese texto, validado de nuevo en Node. |
| `full_row_md5` | MD5 de `to_jsonb(fila)::text` calculado dentro de PostgreSQL, incluyendo columnas omitidas sin devolver su valor. |
| `omitted_column_nullity` | Sólo booleanos por columna omitida. |
| `restorable_row_json_text` | Texto PostgreSQL completo sólo en las cinco tablas con omisiones cuando todas las columnas omitidas son NULL; en otro caso NULL. Sin omisiones, el texto completo ya es `row_json_text`. |
| `monotonic` | Contador como texto entero, relojes como epoch decimal exacto y huella del resto de campos, cuando corresponde a una autoridad monotónica. |

El almacenamiento serializa el contenedor del informe, **no parsea y vuelve a serializar el texto de cada fila**. Su MD5 se vuelve a verificar al leerlo. Esto conserva escala `numeric`, precisión de `bigint` y microsegundos de `timestamptz`.

## Omisiones y restauración

Se excluyen exactamente `physical_card_redemptions.claim_token`, `point_zero_backups.preview_token`, `point_zero_operations.preview_token`, `sellers.password_hash` y `sync_device_recoveries.write_token`. Una columna nueva con nombre sensible obliga a revisar el catálogo; no se añade por inferencia.

Cuando una omitida no es NULL, sólo salen su condición de nulidad y la huella de la fila completa. Así un cambio exclusivamente sensible produce diferencia aunque la proyección visible sea idéntica. Esa fila afectada queda `HELD_SENSITIVE_COLUMNS_NOT_RESTORABLE` y no adquiere permiso de baja o restauración por aparecer en un manifiesto QA.

Si todas las omitidas son NULL, el texto completo seguro debe coincidir con `full_row_md5`; un seller QA con `password_hash=NULL` puede respaldarse sin un HELD automático. Las pruebas reconstruyen ese cuerpo con el tipo PostgreSQL original y comprueban la huella completa. Las restauraciones deben usar también UTC e ISO; estos ajustes de captura son locales a su transacción y no configuran por sí solos una conexión posterior. Tener un cuerpo completo no equivale a autorizar restaurarlo: se deben revisar dependencias, reglas y efectos de cada operación en su plan propio.

## Comparación por PK

`diffLiveSnapshots({baseline, final, catalog, sourceUrl, exactQaDeltas})` valida ambas capturas y devuelve `new`, `removed`, `changed` y `blocking`. Compara `full_row_md5`, no sólo la proyección. Nunca clasifica por prefijo de ID/correo, nombre, fecha o coincidencia de folio.

Una atribución QA exige una entrada exacta `{table, pk_json_text, before_full_md5, after_full_md5, provenanceSha256}` derivada del intento y recibo reales; ausencia se representa con NULL. Cualquier huella distinta, duplicado o objetivo ausente rechaza el manifiesto. La función compara la atribución entregada; el ejecutor sigue siendo responsable de demostrar esa procedencia. Los IDs del baseline no se convierten automáticamente en fixtures eliminables.

`nonQaExactlyEqual` exige igualdad de todo lo ajeno al alcance QA exacto y del catálogo. `nonQaPreservedWithMonotonicAdvances` distingue los avances permitidos de la igualdad literal. Se reconocen `folio_counters.last_seq`, `online_snapshot_revision.revision`, `config_sync_state.version`, `sync_domain_versions.version` y `screen_permission_catalog_state.catalog_version`; sus timestamps se comparan con precisión decimal de epoch. El resto de sus campos debe conservar la misma huella para considerar un avance.

Un contador o reloj que retrocede y una autoridad eliminada se bloquean incluso con una atribución QA. Una fila de contador nueva requiere revisión. Un avance se conserva y se informa como `MONOTONIC_ADVANCE_TO_PRESERVE`: no se propone devolverlo al valor del baseline. La comparación nunca genera SQL de restauración o baja y siempre devuelve `restorationAuthorized: false`.

La igualdad de huellas permite comparar filas que contienen columnas omitidas, pero no recuperar sus valores. Las filas con esas columnas no nulas se cuantifican por separado. Una diferencia de catálogo invalida la afirmación de igualdad aun cuando los datos no cambien. MVCC da consistencia dentro de cada captura; no prueba ausencia de escrituras externas entre ambas ni reemplaza la conciliación del libro del certificador.

## Pruebas y límites

`node test-h171-live-snapshot.mjs` ejecuta doce casos en PostgreSQL PGlite con las columnas/tipos/PK reales de las 64 tablas: cobertura vacía, texto canónico y reconstrucción tipada, nulidad/ocultación de sensibles, atribución exacta, diffs, bigint fuera del rango seguro de JavaScript, relojes con microsegundos, contadores sin retroceso, catálogo compartido, drift de FK/triggers/funciones, ausencia de PK, proyecto/sesión ajenos, integridad de archivos y evidencia manipulada.

El primer corte tuvo 9/12 PASS: dos reconstrucciones se hicieron con la zona local `Etc/GMT+7` heredada por PGlite; se reprodujo el mismo instante con offsets distintos y se corrigió el contexto de restauración a UTC/ISO. La tercera aserción omitía que los handlers internos de FK también se incluyen; se sustituyó el conteo supuesto por comprobación de la función exacta. Esos fallos pertenecían al harness y permanecen en `h171-live-snapshot-local-validation-initial.json`.

Evidencia final: `h171-live-snapshot-local-validation.json`; SQL: `h171-live-snapshot.sql`. Estos archivos públicos no contienen cuerpos de filas reales. Las pruebas locales no ejecutaron captura ni cambios remotos, y no certifican jornadas A/B/C ni aptitud de entrega por sí solas.
