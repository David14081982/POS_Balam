# H171 — transacción técnica posterior a las 149 comerciales

Estado: **EJECUTADA Y VERIFICADA**. El agente principal ejecutó v3 bajo la
autorización del OWNER:317 filas retiradas, revisión654→655 y63 tablas protegidas
sin cambios. La consulta independiente confirmó317 PK ausentes y63 hashes iguales:
[resultado](h171/technical-cleanup-outcome.json),
[postcheck](h171/technical-post-delete.json).
Después del retiro Auth, [otro postcheck](h171/after-auth-protected-integrity.json)
conserva esos63 hashes, inventario973/251/3483, venta0001 y7054 completada.
El agente revisor realizó únicamente preparación y pruebas locales.

SQL vigente propuesto: `h171-auth-tech-cleanup-reviewed-v3.sql`, SHA256 `791cc2cd7f399c847843293a6d4c54469313f40f42f7f0d564cd2c78491a41f4`. Incluye `COMMIT`. Antes de ejecutarlo, usar `h171-auth-tech-cleanup-preflight-v2.sql`; cualquier diferencia obliga a detenerse sin ampliar el alcance. Se conservan intactos el original `h171-auth-tech-cleanup-reviewed.sql` (SHA256 `013e02fc65391b0906602881053d9e7828df4809717eb6de0c99dfa6244004f9`) y la copia v2 (`dc37650694cda4885a5aa41d2ab3f7a3ca0a1be477fa5d296b365007b1dc2f0b`).

La copia v2 conserva exactamente las 317 PK y hashes y todo el orden de eliminación. Actualiza únicamente la protección de la solicitud real 7054: `completed`, hash `8fdc987d8fe491f467f968da4c5306e0`, actor y target exactos, acción `delete`, `result.ok=true`; exige que Auth6dd8 permanezca ausente y que existan los otros diez Auth conocidos. El recibo se conserva completo; no se selecciona ni modifica.

La ejecución remota v2 terminó con SQLSTATE57014 al alcanzar 90 segundos. El contexto `DO` línea118 corresponde a la comparación posterior a las eliminaciones, en `point_zero_backups`; línea112 ya comprueba que se intentaron las 317 eliminaciones. No se afirmó que el fallo fuese anterior a los DELETE. El rollback quedó verificado remotamente: 317 hashes originales, 21 protegidas, diez Auth y 7054 completada, en `h171/technical-cleanup-rollback-check.json`. El intento consta en `h171/technical-cleanup-attempt-v2.json`.

V3 cambia sólo los dos agregados de protección: una CTE `MATERIALIZED` calcula `md5(proyección::text)` una vez por fila y el agregado ordena esos digests de 32 caracteres. No ordena payloads JSON completos ni evalúa dos veces la proyección. El anti-join del alcance se omite únicamente para las tablas fuera de las nueve seleccionadas. Antes y después usan la misma fórmula `md5-of-sorted-projected-row-md5-v1`, declarada en el reporte. Los hashes individuales de las 317 filas, las 21 protecciones, los catálogos de funciones/triggers/FK, las omisiones de credenciales, los locks, el orden de borrado y los 90 segundos permanecen idénticos a v2. El verificador posterior debe usar el mismo algoritmo y comprobar su etiqueta; los hashes agregados de v2 y v3 no son intercambiables.

Medición remota de lectura: cinco filas de `point_zero_backups`, 3 866 624 bytes de relación, 1319.745 ms con la fórmula original y 933.032 ms con la candidata (29.3 % menos), en `h171/hash-cost-original.json`, `h171/hash-cost-optimized.json` y la inspección de tamaños correspondiente. No es una promesa sobre el tiempo total de la transacción. El benchmark local con dos payloads históricos BALAM reales de unos 12 MB mide 1671→1001 ms y detecta una mutación del contenido; `h171-protected-hash-benchmark-local.json`. No se aumentó el timeout.

## Alcance demostrado y respaldo

| Tabla | Filas exactas adicionales |
|---|---:|
| `capability_operation_audit` | 52 |
| `config_commits` | 6 |
| `online_account_requests` | 6 |
| `online_requests` | 199 |
| `permission_change_audit` | 5 |
| `sync_activity` | 30 |
| `sync_devices` | 15 |
| `sync_quarantine_cases` | 1 |
| `user_permission_role_assignments` | 3 |
| Total | 317 |

El manifiesto de PK y hashes está en `h171-auth-tech-proposed-scope.json`; su procedencia y referencias están en `h171-auth-tech-provenance.json` y `h171-auth-tech-reference-review.json`. Ocho filas del respaldo técnico pertenecían ya a las 149 comerciales y se excluyen de estas 317. También se excluyen las dos recuperaciones retenidas. La única cuarentena seleccionada usa PK triple `device_id, operation_id, remote_epoch`, incluida así en el preflight y SQL final.

Respaldo canónico privado: `.evidence-h171-private/auth-tech-canonical-backup.json`, SHA256 `b37b3f4cf8518d5ab87754a48e60c62fab9418a23d396157cbe80530ba86b326`. Su restauración debe enviar cada `row_json_text` directamente como parámetro a PostgreSQL. No analizar y volver a serializar los cuerpos JSON, porque puede perderse la representación numérica de `jsonb`. El ensayo usa el texto canónico y conserva los 317 hashes originales remotos. La comprobación independiente de restauración consta en `h171-auth-tech-canonical-restore-validation.json`.

## Preservación y abortos

La transacción conserva todos los Auth aún existentes, las 149 identidades comerciales, la venta real `BG-260912-0001`, los 973 productos, los cuatro registros ambiguos que el dueño ordenó conservar, Storage y sus 2520 objetos. Conserva por PK y hash 18 registros históricos, la solicitud real `70549527-4867-4342-94d2-38e770b0f2a9` ahora `completed` y las recuperaciones H148 B/C con tokens no nulos. No selecciona los tres dispositivos H148 que son padres de esas recuperaciones. Tampoco cambia la capacidad administrativa del actor real `3f24222e-fd74-4ed2-b56f-f298af574b1e`.

Las 18 filas históricas conservadas contienen referencias por valor a recibos técnicos respaldados; no son hijos físicos ni operaciones pendientes que dependan de un padre seleccionado. La comprobación de recuperaciones inspecciona identidades de operación/solicitud, sin confundirlas con un `device_id` compartido. Si aparece una referencia operativa nueva o un hijo de dispositivo fuera del manifiesto, la transacción aborta. Antes del último `DELETE sync_devices` exige que no quede ningún hijo en `sync_activity`, `sync_quarantine_cases` ni `sync_device_recoveries`: ninguna fila se elimina implícitamente por cascada.

Usa aislamiento SERIALIZABLE, timeout, el advisory lock de recuperación y locks sobre las 64 tablas de `pos` y Auth. Verifica la sesión PostgreSQL estándar sin actor Auth, Only Online activo, cero solicitudes ejecutándose, el catálogo completo de tablas, 12 funciones por su hash, los cinco triggers de las tablas afectadas y las nueve FK físicas reales. Valida cada PK/hash y estado terminal antes de borrar. No modifica ni deshabilita triggers, funciones, permisos o controles de retiro.

Captura bajo lock y compara al final todas las filas fuera del alcance en 63 tablas. Omite cinco columnas de credenciales de esas proyecciones; ninguna de sus tablas se borra salvo las filas de vendedores ya tratadas separadamente en la limpieza comercial. `online_snapshot_revision` se comprueba por separado: el trigger existente debe incrementar exactamente una revisión y conservar sus demás campos. También compara identidades y estado seguro de Auth. Fuerza las restricciones diferidas antes del `COMMIT`.

## Evidencia ejecutada

Preflight remoto original: `h171/auth-tech-cleanup-preflight-before.json`, consulta de lectura exit0: 317/317 hashes exactos, cero fallos de estado/actor/protección, 21/21 protegidas, cero hijos ajenos, 11 Auth QA, solicitud 7054 aún pendiente y dos recovery holds con token no nulo. El preflight posterior `h171/auth-tech-cleanup-preflight-after-commercial.json` detectó correctamente la transición de 7054 y la ausencia de Auth6dd8, manteniendo intactos los 317 objetivos; por ello se detuvo el original317.

La lectura `h171/request7054-completion-inspection.json` demuestra la transición real: el mismo actor3f242 y target6dd8, acción `delete`, estado `completed`, resultado correcto y actualización `2026-09-13T04:05:49.478195+00:00`, posterior al reporte149 `04:05:49.367`. Auth y perfil6dd8 ya no existen; los restantes diez Auth sí. No se atribuye a una persona ni proceso determinado el reintento que completó la solicitud.

El incremento adicional de revisión 647→654 tiene un mecanismo reproducido con las FK reales: eliminar sólo Auth6dd8 después de149 dispara siete acciones referenciales sobre tablas con trigger H166 de sentencia, aunque cada acción afecte cero filas. El ensayo `h171-auth-delete-revision-reproduction.json` reproduce +7 y mantiene los 35 hashes comerciales idénticos. La limpieza149 por sí sola no difiere su incremento al COMMIT: reporte local y SELECT posterior coinciden en1022. Nunca se rebobinó la revisión ni un folio o contador comercial.

Harness local privado: `.evidence-h171-private/verify-h171-owner-fence.mjs --technical`, que importa `.evidence-h171-private/verify-h171-technical-cleanup.mjs`. Comando:

```powershell
node .evidence-h171-private/verify-h171-owner-fence.mjs --auth-cascade --technical --completed7054 --optimized
```

El resultado original de cinco pruebas PASS está en `h171-technical-cleanup-validation.json`; v2 también pasó cinco pruebas en `h171-technical-cleanup-validation-v2.json`. El ensayo v3 se guarda por separado en `h171-technical-cleanup-validation-v3.json`, incorpora dos payloads históricos reales a las tablas conservadas e incluye la baja Auth local antes de las mismas cinco pruebas:

1. Una fila seleccionada con hash modificado aborta.
2. Un hijo nuevo ajeno en un dispositivo seleccionado aborta sin cascada.
3. Una solicitud `executing`, con representación válida según el CHECK real, aborta.
4. Una mutación inyectada en la solicitud protegida 7054 después de los DELETE causa rollback de las 317 filas; las 64 tablas y Auth vuelven al estado anterior del ensayo.
5. La transacción elimina exactamente 317 después de simular149 y la baja Auth6dd8; preserva los 63 hashes fuera del alcance, los Auth restantes, 973 productos, tres dispositivos históricos, dos recuperaciones y el recibo7054 completado. La revisión técnica incrementa exactamente uno sobre la línea base presente.

El entorno local contiene las funciones y triggers vivos capturados, con hashes de definición exactos. Las nueve FK relevantes para317 están además completamente validadas y sus definiciones coinciden con las remotas; no se retiparon ni sustituyeron para que pasara la prueba. El verificador independiente comercial `h171-commercial-post-delete.sql` se ejecuta entre149 y317 y confirma `verified=true`, 35 tablas intactas y 149 identidades ausentes.

Límite del ensayo: el respaldo técnico no contiene los cuerpos completos de 19 registros históricos/solicitud protegidos. Se usan cuerpos sintéticos locales con sus PK reales, recalculando solamente sus hashes esperados en una cadena SQL en memoria. Los 317 hashes objetivo, los dos hashes proyectados de recuperaciones y el archivo ejecutable remoto permanecen intactos. El preflight remoto comprueba las 21 protecciones originales. Auth y los tres dispositivos históricos tienen representaciones locales; los tokens locales son sintéticos. Estos límites impiden equiparar el ensayo con una certificación remota, que debe quedar respaldada por el resultado real y su SELECT posterior.

## Orden de aplicación y verificación posterior

1. Confirmar el resultado y SELECT independiente de las 149 comerciales.
2. Ejecutar el preflight técnico v2 de lectura y comparar 317 objetivos, 21 protecciones, recibo7054 completado, Auth6dd8 ausente y diez Auth conocidos presentes.
3. Comprobar el SHA256 exacto del SQL317 y ejecutar una sola vez bajo la autorización vigente.
4. Verificar mediante un SELECT independiente que las 317 PK estén ausentes, que las 21 protecciones y los hashes fuera del alcance coincidan, que el incremento de revisión sea uno y que inventario/venta real continúen intactos. No repetir el SQL ante un resultado incierto.
5. Tratar Auth y los recovery holds por sus contratos separados; ninguna aprobación para317 convierte los holds o los cuatro registros ambiguos en filas eliminables.

Documentación y commit de H171: a cargo de la coordinación principal. No se abrió otra H.
