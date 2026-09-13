# H171 — revisión del contexto de mantenimiento para las 149 filas

Estado: el dueño aprobó explícitamente la copia SHA256 `c2ef25b409b2abe56e793e4e152bd9c2e89b29efa4933c49fd5134cd1721e440`; la ejecución y verificación remota las coordina el agente principal. Ningún cambio remoto ejecutado por este agente. El SQL original aprobado conserva SHA256 `b2e9f41489667861a3713aa2dcef0066ab3d483f027ec5e8af3d98f6c33fa4f6`. La ejecución remota del original falló en el trigger de recuperación durante `DELETE products`; la comprobación independiente de su rollback corresponde a `h171-commercial-rollback-integrity.sql` y su resultado.

## Causa reproducida y autoridad

La inspección remota de lectura `h171/retirement-fence-inspection.json` confirma sesión `postgres`, `auth.uid() IS NULL`, ningún header de dispositivo y `pos.h149_rpc` sin establecer. Ocho de los catorce productos QA conservan un `sync_device_id` perteneciente a un equipo retirado. El trigger vivo `pos.guard_device_recovery_row()` usa ese origen histórico si no hay header de dispositivo ni contexto RPC. `pos.assert_device_recovery_write()` encuentra el dispositivo retirado y levanta `DEVICE_RETIRED`. El ensayo local reproduce exactamente ese error con el SQL original y prueba el rollback.

Existe un mecanismo explícito de mantenimiento del mismo BALAM en `h164-qa-retirement.mjs:35–39,66–71`. Exige propietario PostgreSQL sin actor Auth y modo `preproduction`; establece el build de cliente y los dos parámetros de contexto sin atribuir un dispositivo. Su comentario especifica que un origen almacenado es evidencia histórica y que esa transacción de mantenimiento no tiene actor de dispositivo. El helper se limita al retiro de cinco perfiles exactos por corrida: no otorga una autorización genérica para borrar registros.

Los archivos generados por ese helper existen en las evidencias originales de H169 y H170:

| Archivo BALAM | SHA256 |
|---|---|
| `.h161-release/.evidence-h169-live/qa-retirement.sql` | `8560a141cbb3c9b3fee5d4c6c0bc904778fa9ba37857c7e4fccaffee756b2414` |
| `.h161-release/.evidence-h170-live/qa-retirement.sql` | `e574f20d4b08847fb3bc1ef8ec7c3c146caa5f0dea841d3abd8ed004a7d5fc8e` |
| `h164-qa-retirement.mjs` vigente | `c8c09d50c4e108bf05a52aa229ac419c623f8c15237094b1a48ad3d0d2635ee1` |

La guardia vigente `pos.guard_online_commercial_write()` permite expresamente mantenimiento con sesión PostgreSQL privilegiada sin actor Auth. Reutilizar aquel contexto es compatible con la guardia existente: no requiere cambiar funciones, permisos, triggers ni estados de dispositivos. La autorización de las eliminaciones sigue dependiendo de las 149 identidades y respaldos revisados y de la aprobación de esta copia; no se deriva del nombre del helper.

## Diferencia exacta propuesta

Archivo `h171-cleanup-owner-context-reviewed.sql`, SHA256 `c2ef25b409b2abe56e793e4e152bd9c2e89b29efa4933c49fd5134cd1721e440`.

Es el original byte por byte más un único prólogo después de `SET LOCAL DateStyle`. El prólogo exige propietario sin actor Auth, modo `preproduction`, y que las definiciones remotas de `assert_device_recovery_write(text,text[])` y `assert_online_device()` conserven los hashes inspeccionados. Luego fija solamente:

```sql
SET LOCAL request.headers='{"x-balam-client-build":"2026-09-12-h166-online"}';
SET LOCAL pos.h149_rpc='on';
SET LOCAL pos.h149_device='';
```

El manifiesto de 149 PK y hashes, el orden de eliminación, los locks, las comprobaciones de referencias, las 35 comparaciones fuera del alcance, el control de inventario y venta real y el `COMMIT` son los del original. No se agrega un ID de dispositivo ni token de recuperación. No se elimina, reactiva o actualiza ninguna recuperación o dispositivo. Los cuatro registros ambiguos expresamente protegidos por el dueño permanecen fuera del alcance.

## Ensayo ejecutable

Harness local privado: `.evidence-h171-private/verify-h171-owner-fence.mjs`. Resultado público: `h171-owner-context-validation.json`. Se ejecuta mediante `node .evidence-h171-private/verify-h171-owner-fence.mjs` desde este worktree.

Carga el respaldo comercial de 35 tablas y las filas técnicas canónicas como texto; preserva tipos originales, UTC/ISO y claves primarias reales. Instala las 29 definiciones de funciones necesarias y verifica cada hash original obtenido mediante `pg_get_functiondef`. Instala las 112 definiciones reales de triggers sin reemplazarlas ni deshabilitarlas, 36 FK originadas en `pos` y las 16 restricciones CHECK disponibles en el catálogo de soporte.

Pruebas:

1. Original149: reproduce `DEVICE_RETIRED`; rollback deja intactos inventario, venta real, dispositivos y recuperaciones.
2. Contexto owner con operación candidata retenida: sigue rechazando `TEST_PENDING_DISCARDED`.
3. Contexto owner con dispositivo retirado explícito: sigue rechazando `DEVICE_RETIRED`.
4. Copia en modo producción: rechaza `H171_QA_PREPRODUCTION_REQUIRED`.
5. Copia con actor Auth no nulo: rechaza `H171_QA_OWNER_CONTEXT_REQUIRED`.
6. Copia en el contexto permitido: elimina exactamente 149 filas, conserva las 35 comparaciones fuera del alcance, 973 productos, 251 familias, 3483 piezas y la venta `BG-260912-0001`; los 18 dispositivos del ensayo permanecen retirados e idénticos y las dos recuperaciones conservan sus hashes proyectados. El trigger existente incrementa la revisión de snapshot en 22.

Límites explícitos: las identidades Auth y los tres dispositivos padre históricos H148 son representaciones locales; los tokens de recuperación son UUID sintéticos y no se han extraído secretos remotos. Las FK y CHECK se crean con `NOT VALID` porque faltan cuerpos de algunos padres históricos ajenos: PostgreSQL sí las aplica a todas las escrituras y eliminaciones nuevas. La prueba no certifica la ejecución remota ni reemplaza la verificación posterior contra BALAM real.

## Aprobación y orden

La aprobación anterior exigía SQL149 exacto; por ello esta copia se presentó por separado y recibió aprobación explícita por su SHA256. `docs/architect/WORKFLOW.md`, condiciones 2 y 5, exige detener la ejecución destructiva cuando las pruebas demuestran que la solución aprobada no era viable. Preparar la copia y sus pruebas sí pertenecía al trabajo autorizado. No se modificó retrospectivamente el original.

Las 317 filas técnicas siguen pendientes y deben conservarse mientras se ejecuta y verifica el retiro comercial: sus recibos online participan en la comprobación de procedencia de las ventas QA. Primero completar y verificar las 149 comerciales; después reevaluar el preflight técnico con la línea base resultante. Los 11 Auth y los dos recovery holds siguen fuera de esta transacción.
