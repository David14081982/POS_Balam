# H171 — preparación local de limpieza de fixtures nuevos

Apoyo del informe único H171. `h171-live-cleanup-sql.mjs` genera una transacción; no realiza conexiones, no ejecuta DELETE y no abre el bloqueo del certificador. `reviewRequired` indica revisión técnica del plan concreto, no una nueva petición de permiso al dueño. La autorización de la jornada y su limpieza no se deduce de un hash.

## Entrada y límites

`buildLiveCleanupSql({plan,catalog,baselineSnapshot,currentSnapshot,sourceUrl})` reutiliza el validador y la consulta de catálogo de `h171-live-snapshot.mjs`. Requiere proyecto BALAM, build/artefacto, actor QA y run, reconciliación, hashes del snapshot y del archivo privado persistido. Cada objetivo contiene `table`, `pk_json_text`, `full_row_md5` y procedencia por actor/run, UUID de intención, hash de intención y de recibo/observación. Para intenciones Node, la observación del estado final no es un recibo fiscal ni una confirmación HTTP inventada.

El generador exige `cleanupManifestComplete:true` y verifica estructura, identidad y respaldo canónico; el ensamblador del plan debe demostrar la procedencia mediante el journal y los recibos exactos. Un prefijo o `qa:true` no satisfacen la entrada. No se permiten PK anteriores al run, la identidad del administrador real, la venta `BG-260912-0001`, ni tablas fuera de las 32 usadas por los contratos actuales de la matriz. Un hold sobre una fila nueva bloquea la generación hasta completar su clasificación. Los cuerpos de filas permanecen en el respaldo privado; el SQL incluye PK y hashes.

Las cinco omisiones sensibles del snapshot se declaran sin cambios. Toda fila con alguna omisión no NULL requiere un hold explícito y no puede borrarse. Auth se conserva para un paso independiente por GoTrue y Storage queda fuera del SQL. Las claves globales de configuración preexistentes tampoco se restauran aquí: necesitan una comparación previa de contenido y actor, más un plan específico que preserve cualquier actividad real concurrente.

El fallo temprano después de crear Auth y antes de escribir POS admite `targets:[]` únicamente con plan completo y revisado técnicamente, censo Auth anterior respaldado y una o dos identidades nuevas con procedencia exacta. El censo debe coincidir con el snapshot baseline y el conjunto actual; se vuelve a comprobar bajo lock. Ese caso ejecuta la transacción real y todas las guardas, sin DELETE POS, sin incremento de revisión y con `removed_rows:0` y `removed_manifest:[]`. El plan vacío sin identidades demostradas se rechaza.

## Transacción

Usa SERIALIZABLE, UTC/ISO, la cerca H149 y locks sobre las 64 tablas `pos` y `auth.users`. Exige sesión owner estándar, preproducción Only Online, actor QA exacto, administrador real operativo y ausencia de comandos ejecutándose o cuentas sin estado terminal. Compara el catálogo completo capturado: tablas, columnas, PK, FK, defaults, funciones y triggers. Mantiene triggers y restricciones.

Valida cada PK/FULL MD5 y las relaciones físicas y documentales conocidas del runner. Rechaza padres comerciales ajenos y niños fuera del alcance; antes de eliminar un padre, comprueba que no sobrevivan niños físicos que pudieran desaparecer por CASCADE. Ejecuta una sentencia DELETE por tabla en el orden de FK de BALAM y exige el conteo exacto.

Los 63 conjuntos ajenos se fijan contra el snapshot previo bajo locks y vuelven a compararse antes de COMMIT. La fórmula es `md5(concatenar(sorted(FULL_MD5_fila)))` con cada conversión de fila materializada una sola vez; no ordena los JSON históricos grandes. Incluye hashes completos de filas con columnas omitidas sin publicar esas columnas. Fuerza las restricciones diferidas antes de la comparación final y comprueba que Auth permanezca igual.

`online_snapshot_revision` se trata aparte: sólo acepta el incremento de los triggers H166 existentes. PostgreSQL dispara también la invalidación de un DELETE hijo por CASCADE aunque ya no queden filas. La prueba positiva con una venta demostró cinco incrementos: cuatro sentencias explícitas y la sentencia vacía sobre `sale_items`. El generador cuenta esos incrementos; nunca rebobina la revisión. Los demás contadores conservan exactamente el valor alcanzado antes de esta limpieza, incluso si avanzaron legítimamente durante la jornada.

## Evidencia y alcance de la prueba

Ejecutado localmente `node --test test-h171-live-cleanup-sql.mjs`: **18/18 PASS**. El resultado verificable y los SHA están en `live-cleanup-sql.json` del mismo directorio. El esquema sintético usa las 64 tablas, 658 columnas y FK del catálogo BALAM registrado; los datos y algunas funciones de guarda son fixtures locales. Cubre borrado exacto, preservación ajena/folios, hash alterado, procedencia insuficiente, PK preexistente, vendedores por ID, cascadas, padres ajenos, recibos no terminales, catálogo cambiado, efectos de triggers inmediatos/diferidos, rollback y holds sensibles. Incluye las relaciones H152 de pagos y movimientos con el folio de cambio, y el COMMIT real del caso cero POS, cuyo resultado sintético se conserva en `live-cleanup-sql-zero-scope.json`.

Estas pruebas no son A/B/C contra Supabase ni certificación del producto. No miden el costo de recorrer los respaldos históricos reales. La ejecución futura requiere emisores detenidos, catálogo revisado, respaldo durable comprobado y plan completo sin atribución pendiente; una carrera que cambie datos ajenos antes de los locks aborta, no se sobrescribe. El resultado SQL conserva `certified:false` y `cleanup_verified:false` porque Auth, Storage, holds y verificación de residuos de la jornada siguen fuera de este componente. Pendiente de commit.
