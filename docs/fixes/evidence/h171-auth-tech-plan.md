# H171 — Revisión exacta de Auth QA y auditoría técnica

Estado de ejecución actualizado: OWNER autorizó continuar el retiro técnico/Auth
demostrado dentro de H171. Comercial149 y técnico317 están eliminados y verificados.
El primer intento técnico SQLv2 se revirtió íntegramente tras timeout; SQLv3
confirmó el mismo conjunto317 y la lectura posterior verificó63 tablas protegidas.
Las11 identidades Auth están ausentes:10 DELETE y una ya ausente por la solicitud
real7054, cuyo nuevo estado/hash se conserva. Dos recoveries siguen excluidas. Los párrafos de
censo siguientes describen la línea base inicial, no sustituyen ese estado actual.
Evidencia vigente: [revisión317](h171-technical-cleanup-review.md) y
[COMMIT técnico](h171/technical-cleanup-outcome.json),
[retiro Auth](h171/auth-retirement-result.json) e
[integridad posterior](h171/after-auth-protected-integrity.json).

BALAM solamente, Supabase `telohdbvbvsfmwyriflz`. Este artefacto prepara
lecturas y un archivo privado de auditoría. **No contiene una baja, no cambia
FK, no modifica Auth y no autoriza la eliminación de ninguna fila.**

Se aplicaron Navigator, metodología y playbooks database/security/delivery,
además de la autoridad de autorización. R-SEC-03 impide tratar la ejecución
local como defensa remota; R-DB-09 impide aprobar SQL sólo por buscar texto.

## Identidades y procedencia

El manifiesto contiene once IDs Auth exactos: seis actores y cinco cuentas
creadas. No selecciona por email, nombre, prefijo ni ventana de fechas.
Los IDs y hashes de procedencia están en
[h171-auth-tech-provenance.json](h171-auth-tech-provenance.json).

Tres runs se apoyan en sus fixtures y hashes H164/H169/H170; dos adicionales
en los recibos exactos del seguimiento remoto. El sexto, H148
`b766e373-5279-4e4a-818e-0934a4f8757c`, incorpora la evidencia combinada de
[h171-h148-legacy-provenance.md](h171-h148-legacy-provenance.md): certificado,
runner de hash exacto y respaldo histórico con 58 actividades y tres equipos
que identifican Auth `54633260-578a-4228-b7d1-4e36e6c49144`.
Esto sustituye su clasificación inicial basada sólo en marcador candidato.

El censo directo anterior, `h171/auth-dependencies-direct-before.json`,
encontró 52 filas de `capability_operation_audit` para seis actores. La FK
declara **NO ACTION**, por lo que no es un borrado en cascada. También observó
once identidades Auth, veinte sesiones, seis asignaciones de rol y cinco
overrides de pantalla. Los cinco enlaces `updated_by` a overrides pueden
coincidir con esas mismas filas: no se suman como cinco filas adicionales.
Estos conteos anteriores necesitan contraste actualizado antes de ejecutar
cualquier retiro; no demuestran por sí mismos el motivo de un error previo
de la API Auth.

## Lecturas preparadas

1. [h171-auth-tech-inventory.sql](h171-auth-tech-inventory.sql): transacción
   READ ONLY; examina las 64 tablas `pos` del catálogo remoto registrado,
   incluye tablas vacías, PK y todas las FK relevantes. Identifica valores
   JSON exactos de actor/run/dispositivo/request/recibo, incluidas referencias
   entrantes a los recibos. Si aparecen tablas nuevas o faltan tablas/PK, la
   cobertura completa no se presume. El resultado público devuelve
   identidades, conteos, metadata QA permitida y hashes.
2. [h171-auth-tech-private-snapshot.sql](h171-auth-tech-private-snapshot.sql):
   READ ONLY; devuelve cuerpos sólo para `KNOWN_QA_TECHNICAL` y conserva
   únicamente identidad/clase/hash de todas las otras filas, incluidos los
   recibos técnicos protegidos. El resultado debe
   ir a `.evidence-h171-private/auth-tech-backup.json`, fuera del contenido
   versionado. Puede contener información comercial en resultados de
   operaciones; no debe publicarse.

3. [h171-auth-tech-six-receipts.sql](h171-auth-tech-six-receipts.sql): compara
   seis PK de recibos y su hash con las operaciones, productos y líneas de
   la venta comercial actual. Su resultado remoto es
   `h171/auth-tech-six-receipts-before.json`.
4. [h171-auth-tech-canonical-snapshot.sql](h171-auth-tech-canonical-snapshot.sql):
   respaldo privado limitado a 327 PK/hash exactas, con JSON PostgreSQL
   canónico como texto. Incluye las 321 filas iniciales y seis recibos
   revisados; ocho filas se solapan con el manifiesto comercial.
5. [h171-auth-tech-recovery-nullity.sql](h171-auth-tech-recovery-nullity.sql):
   sólo devuelve si `write_token` es nulo para dos recoveries exactas; nunca
   devuelve el token, su hash, longitud o prefijo.

El inventario público se guarda en `h171/auth-tech-before.json`.
El generador `qa-h171-auth-tech-plan.mjs` sólo lee evidencia local y escribe
estos archivos SQL; no se conecta a Supabase ni ejecuta operaciones.

Auth se limita a ID, fechas y las claves de metadata QA indicadas: no se
extrae correo, contraseña, tokens, sesiones completas ni identidades
completas. Se excluyen expresamente cinco columnas sensibles de `pos`,
enumeradas en el manifiesto. El hash de una fila es por ello
`projected_row_md5`, no el hash de una copia integral.

El archivo privado es un respaldo de auditoría técnica con esas exclusiones;
**no puede reconstruir una cuenta Auth, su contraseña o una sesión**. Tampoco
permite afirmar restauración integral de una fila que tenga una columna
omitida. Las tablas originales continúan siendo la autoridad hasta que
exista un plan de disposición revisado por identidad, hash y dependencias.

## Clasificación y protección

| Clase | Interpretación |
|---|---|
| `KNOWN_QA_TECHNICAL` | Fila de tabla técnica, PK verificada y vínculo exacto con las identidades QA. No es permiso para borrarla |
| `BUSINESS_HISTORY_TO_PRESERVE` | Autoridad comercial/global/legacy, identidad expresamente protegida o recibo técnico que referencia un documento conservado |
| `UNKNOWN` | Relación sin clasificación explícita o identidad sin PK verificada; requiere resolución antes de proponer una baja |

Los enlaces a catálogos globales quedan como
`CATALOG_OR_GLOBAL_AUTHORITY`: se reportan y el catálogo se preserva, pero
referenciar una opción del catálogo no transforma por sí solo un recibo QA
en historia comercial. Los enlaces `DOCUMENT_OR_HISTORY` a documentos que
quedan fuera del manifiesto comercial sí conservan el recibo. El ID del
propio actor QA en su perfil no se confunde con un documento comercial.

Protecciones incondicionales de este plan:

- Actor real `3f24222e-fd74-4ed2-b56f-f298af574b1e`.
- Request `70549527-4867-4342-94d2-38e770b0f2a9`, pendiente y originado por
  ese actor, aunque el target `6dd83591-9e6b-482f-95e0-78470766cbce` sea QA.
- Venta `BG-260912-0001`, operación
  `35e2c61a-7561-41b9-9535-e39e671a55d3`.
- Operación legacy `eef0157e-287a-417d-aa14-c7c3983fc3d7` y su original.
- Autoridades y documentos de negocio, con vínculos al manifiesto comercial
  separado identificados explícitamente, sin que este plan ejecute ese alcance.

El manifiesto comercial enlazado contiene 149 filas y tiene su propio
dry-run, autorización y verificación. Su respaldo privado comercial conserva
SHA256 `6a6c9b084af4432c22f313a5bb908ab54a9e1104c47ba6ea09b597252d92d825`.
Los cuatro registros dinámicos ambiguos siguen fuera de una baja automática;
la respuesta del dueño no se infiere del transcurso del tiempo.

## Validación y estado

[h171-auth-tech-sql-validation.json](h171-auth-tech-sql-validation.json)
registra ejecución de los SELECT sobre PostgreSQL local PGlite con catálogo
sintético de 64 tablas. Nueve comprobaciones pasaron: clases QA/protegido/unknown,
actor/request protegido, referencias entrantes, precedencia del documento real,
omisión de credenciales y archivo privado limitado a cuerpos QA con hashes
de la historia protegida, consulta de los seis recibos y SQL de respaldo
canónico/nulidad.
La primera prueba detectó sobreprotección por coincidencia con el propio perfil
QA; se ajustó esa relación y se volvió a ejecutar. No hubo escritura remota.

El SELECT público ya se ejecutó contra BALAM en READ ONLY:
`h171/auth-tech-before.json` registra 64/64 tablas, 4798 filas totales, once
Auth, 52 recibos de capacidad, 206 request IDs relacionados y 18 dispositivos
exactos. No hay tablas inesperadas/faltantes ni filas sin PK en el censo.
Seleccionó 2840 filas para revisión: 321 `KNOWN_QA_TECHNICAL` y 2519
`BUSINESS_HISTORY_TO_PRESERVE`; ninguna `UNKNOWN` en ese conjunto.

Ocho de las 321 filas ya pertenecen al manifiesto comercial 149: tres
asignaciones de rol y cinco overrides de pantalla, con los mismos hashes.
Por tanto el conjunto inicial tenía **313 candidatas técnicas adicionales**;
no eran 321 bajas adicionales.

El primer intento de snapshot privado falló con HTTP 524 y no produjo archivo
de respaldo. Se redujo la salida a los 321 cuerpos QA y hashes de las otras
2519 filas, sin exportar los 1557 recibos de capacidad reales ni las 657
actividades protegidas. El hash del SQL reducido está en el manifiesto de
procedencia. El segundo intento sí produjo el archivo privado
`.evidence-h171-private/auth-tech-backup.json`, 1 945 458 bytes, SHA256
`509f00cc926de97433c37c43052b71e8d195b906aa5cc315120e3ca9b400556f`.
Las 321 PK/hash coinciden con el censo; el manifiesto público está en
`h171/auth-tech-backup-manifest.json`. Este archivo inicial sigue conservado
como evidencia y no se confunde con el respaldo canónico validado después.

El censo original completo se conserva de forma privada en
`.evidence-h171-private/auth-tech-inventory-raw.json`, SHA256
`8b2d72e68bf1f6aa52958afe76be1ecd53739161be69a8ee9bfb7c3534a69b9e`.
La copia pública compacta mantiene las 2840 filas PK/hash/exact_matches y
los 479 enlaces entrantes; limita los enlaces comerciales detallados a
2862 de filas QA o con coincidencia Auth QA. Su propiedad `compaction`
declara el filtro. La ausencia de un enlace en esa copia no demuestra que
no exista; el original privado conserva todos los enlaces.

## Revisión de seis recibos y alcance concreto

La lectura remota verificó seis de seis recibos sin cambios de hash desde
el censo. Ninguno contiene la operación actual
`35e2c61a-7561-41b9-9535-e39e671a55d3`. Las dos ventas QA tienen operaciones
`38bb7974-a453-48b0-b794-0ed57e82e1a0` y
`e509bd10-6de2-4dce-9ad5-584b861c4a9b`; sus productos, documentos y actores
son los de sus runs QA. Los dos cambios tienen IDs
`cmb-99e38258-921a-42eb-aa28-b4911fe62d81` y
`cmb-a0293bc4-59df-49f6-9c88-49bc27aee2b8`, con productos de esos mismos runs.

Las reservas `702ffdf8-53ac-590f-8d99-b5b8a4928116` y
`b46e37a5-6169-5ffa-888e-7e3e8fc5b4ba` corresponden respectivamente a esas
dos operaciones QA por la derivación determinista vigente en
`balam/store.jsx` (`SHA256('folio:' + operationId)`). La venta actual deriva
una reserva distinta, `e87530f6-43d8-5841-8248-77707a0dfe7d`.
El único commit actual de las tres operaciones consultadas pertenece a
`35e2c61a-7561-41b9-9535-e39e671a55d3`; la venta preserva MD5
`4d4eccadf33a73be1303d957036886d6` y su línea/producto propios.

La revisión clasifica estos seis recibos como `KNOWN_QA_TECHNICAL` por
esa evidencia combinada. El censo original conserva su clasificación
conservadora y no se reescribe. El folio compartido por sí solo nunca fue
criterio suficiente.

| Tabla técnica | Filas revisadas | Solapadas con 149 | Adicionales con respaldo exacto | En espera |
|---|---:|---:|---:|---:|
| capability_operation_audit | 52 | 0 | 52 | 0 |
| config_commits | 6 | 0 | 6 | 0 |
| online_account_requests | 6 | 0 | 6 | 0 |
| online_requests | 199 | 0 | 199 | 0 |
| permission_change_audit | 5 | 0 | 5 | 0 |
| sync_activity | 30 | 0 | 30 | 0 |
| sync_devices | 15 | 0 | 15 | 0 |
| sync_quarantine_cases | 1 | 0 | 1 | 0 |
| user_permission_role_assignments | 6 | 3 | 3 | 0 |
| user_screen_permission_overrides | 5 | 5 | 0 | 0 |
| sync_device_recoveries | 2 | 0 | 0 | 2 |
| **Total** | **327** | **8** | **317** | **2** |

El conjunto adicional es **319: 317 candidatas respaldadas y dos en
espera**, sujeto a autorización y comprobación final de dependencias/hash
antes de cualquier acción. Todas las PK, hashes y pruebas están en
[h171-auth-tech-proposed-scope.json](h171-auth-tech-proposed-scope.json).
El inventario inicial no tenía `UNKNOWN`; eso no convierte los cuatro
registros dinámicos ambiguos ni otra fila fuera de este alcance en QA.

El SELECT de nulidad encontró `write_token_is_null = false` en ambas
recoveries de los dispositivos H148 B/C. No se leyó el valor. Al excluir
esa credencial, el respaldo no permite restaurar íntegramente esas dos
filas: quedan fuera de las 317 candidatas preparadas para revisión.

[h171-auth-tech-reference-review.json](h171-auth-tech-reference-review.json)
conserva 76 enlaces entrantes desde 18 filas ajenas al conjunto técnico y
al comercial: tres requests, tres respaldos punto cero, nueve documentos
purgados y tres registros de limpieza/auditoría. También hay seis enlaces
a dispositivos desde tres requests y tres respaldos punto cero; ninguno
es una fila dependiente por FK de actividad/recovery/quarantine fuera del
alcance. Son relaciones por valor, no una autorización de cascada. Estas
18 filas y la historia real permanecen intactas; su auditoría referenciada
requiere conservar de forma duradera el archivo técnico exacto.

## Respaldo canónico y comprobación local

El archivo `.evidence-h171-private/auth-tech-canonical-backup.json`,
840 566 bytes, tiene SHA256
`b37b3f4cf8518d5ab87754a48e60c62fab9418a23d396157cbe80530ba86b326`.
La consulta remota encontró 327/327 PK y 327/327 hashes sin cambios.
La validación local verificó esos 327 hashes y restauró 325/325 cuerpos
con los tipos originales del catálogo PostgreSQL, zona UTC y hash idéntico:
317 adicionales y ocho solapados. No incluyó las dos recoveries.

[h171-auth-tech-canonical-restore-validation.json](h171-auth-tech-canonical-restore-validation.json)
registra la prueba sobre tablas efímeras locales, sin escrituras remotas.
Esto verifica tipos/cuerpos/hashes; no simula las FK, triggers, políticas
ni recreación Auth de una restauración productiva.

La primera prueba, conservada en
`h171-auth-tech-restore-validation-initial.json`, encontró diferencias por
la zona local -07:00; al usar UTC quedaron 110 diferencias de representación
en los cuerpos JSON iniciales. La comparación del respaldo canónico mostró
114 diferencias de representación numérica en 327 filas, con cero
diferencias semánticas JSON. Por eso el procedimiento validado pasa
`row_json_text` directamente a `jsonb_populate_record`, sin
`JSON.parse`/`JSON.stringify` intermedios, y conserva UTC para los hashes.

Estado: **preparación de lectura, respaldo y revisión completada;
317 filas técnicas adicionales preparadas para revisión, dos recoveries
en espera y ninguna baja ejecutada**. La baja de las once cuentas Auth
no queda autorizada por este archivo ni es reconstruible con sus metadatos.
La solicitud 7054 y el actor real siguen protegidos aunque su target sea QA.
No se cambian FK ni se elimina auditoría para desbloquear Auth. El objetivo
global H171 sigue pendiente de las decisiones y acciones autorizadas del
corte; no se declara completo con esta preparación. Commit: Pendiente de commit.
