# H171 — Procedencia H148 y operación legacy pendiente

Fecha de revisión: 2026-09-13 UTC. Alcance: BALAM, proyecto Supabase
`telohdbvbvsfmwyriflz`. Investigación local de solo lectura; no se ejecutaron
SQL, peticiones remotas, clasificaciones, limpieza ni reenvíos de operaciones.
Esta evidencia delimita procedencia; no certifica entrega ni resuelve H171.

## Ejecución histórica H148 identificada

- Run exacto: `b766e373-5279-4e4a-818e-0934a4f8757c`.
- Certificado local: `C:/tmp/balam-h154-live-mXd8pe/matrix.json`.
  SHA256: `b4c86b1bc8a63464f44d3d45a203bc46d8f9b937b541fd3220c58a99faa3ee38`.
- Declara el proyecto BALAM y comienzo `2026-09-10T22:11:58.151Z`;
  contiene 27 casos aprobados, `cleanup: null` y no tiene `finishedAt`.
  No demuestra que concluyera la limpieza.
- Su `certifierSha256` es
  `ade64ab0199a456770f4f2053bd768fc223a99799c3c83210a727645fc71bbf3`,
  idéntico al SHA256 calculado del runner conservado en
  `C:/tmp/balam-h154-sync/test-h148-live-convergence.mjs`.
- El runner exacto genera el prefijo del run (línea 22), los IDs de los dos
  vendedores (35), crea Auth con `user_metadata.balam_sync_test` (62), inserta
  esos vendedores (64–65) y escribe la clave de configuración del run (487).
  El marcador histórico se llama `balam_sync_test`, no `balam_online_test`.
  Un marcador de metadata por sí solo no acredita procedencia.
- El respaldo privado `RESPALDO-PREVIO-PUNTO-CERO-20260911.json`, de
  `2026-09-11T23:44:09.761019+00:00`, tiene SHA256
  `803166f47a602349ece8f739a4f9133789c56aa8e455ad010784a52452b4075d`.
  Sus 58 registros de actividad y tres dispositivos exactos A/B/C vinculan
  el run con Auth `54633260-578a-4228-b7d1-4e36e6c49144`; los dispositivos
  declaraban build `2026-09-10-h154`. También conserva una cuarentena
  rechazada del mismo actor/dispositivo. No se publica el respaldo comercial.

Así, la procedencia del run y de Auth se apoya en certificado, runner de hash
exacto y registros históricos con identidad; no solamente en el email.
El censo H171 todavía observó Auth activo y los dos vendedores activos.

Los registros deterministas, con hashes del censo
`h171/provenance-followup-before.json`, son:

| Tabla | ID o clave | MD5 de la fila en el censo |
|---|---|---|
| sellers | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-admin` | `f3e6b4ffadf83b5592c8e3ed2bf5a49d` |
| sellers | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-seller` | `d87dd99e19882795dae3c7f672bd9fab` |
| settings | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c` | `7e25dca923994c69d4198d24c34a6ac2` |

No se encontró un manifiesto de IDs dinámicos del run. Este runner histórico
no guardaba `fixtures.json`; clientes y promociones usaban upsert directo,
sin recibo inmutable por ID. Dos clientes candidatos fueron modificados
después por el dispositivo real `dev-mtx72mib-oua9kgz8`. Los nombres y la
coincidencia temporal no bastan para ampliar automáticamente el alcance de
una limpieza exacta. La procedencia no sustituye respaldo, revisión de
referencias, verificación de hashes actuales ni autorización de una baja.

## Operación legacy que requiere decisión

Identidad exacta: operación `eef0157e-287a-417d-aa14-c7c3983fc3d7`, actor
`3f24222e-fd74-4ed2-b56f-f298af574b1e`, dispositivo
`dev-mtx72mib-oua9kgz8`, hash de payload
`85da8da2202ffcfbae93ad2787d3f52e`. El censo H171 conserva `needs_review`.

Las evidencias privadas de `.h164-sync-evaluation/.evidence-h164/`
`legacy-exact-reconciliation-raw.json`,
`legacy-product-identity-coverage-raw.json` y
`legacy-queue-original-raw.json` establecen:

- Es un upsert de `products`, creado `2026-09-12T02:49:56.722Z`, después del
  Punto Cero completado. Contiene 973 filas/IDs distintos y 3484 piezas.
  `rowIds` coincide con los IDs de `rows`; `submittedRows` coincide con `rows`.
- Acumuló 80 intentos y quedó en cuarentena por `REBOOTSTRAP_REQUIRED`.
- La lectura de autoridad de 2026-09-12 no encontró IDs existentes ni recibo
  confirmado. No representa una comparación renovada contra la autoridad.
- Los respaldos previos coincidían en 973 nombres y 959 firmas físicas;
  coincidían en cero IDs/barcodes. Esa semejanza no prueba ejecución ni
  autorización para descartar.

Integridad local del original: SHA256 de `legacy-queue-original-raw.json`
`24fda22f70ff787f1101584ca7d6082e5ba42dfe9088e58a91cc3796f5af54cd`;
hash SHA256 registrado de los bytes de la cola
`aff93b956a4f5054a6dc84b868f05106e407330f4241c62effa2b636a187ca79`.

Una comprobación adicional debe ser SELECT en transacción READ ONLY,
limitada a actor/dispositivo/operación/hash exactos: comprobar tabla, IDs,
hash del original y hashes de cada fila frente a los mismos campos en
autoridad. El recibo válido para este upsert requiere además
`capability_operation_audit` con el mismo `operation_id`, actor,
`capability_key = 'inventory.adjust'` y
`payload_hash = md5(coalesce(submittedRows, rows)::text)`.
La igualdad de campos o existencia de IDs no sustituye ese recibo.

Disposición pendiente: conservar la intención archivada para revisión, o
registrar autorización explícita de descarte de esta operación exacta,
preservando el original. No hay evidencia suficiente para clasificarla como
caché técnica o fixture QA; no se autoriza su reproducción automática.
