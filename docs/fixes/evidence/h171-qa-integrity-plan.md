# H-171 — Inventario QA y plan de separación revisable

Estado: diagnóstico remoto de lectura confirmado; ninguna limpieza ejecutada.
Proyecto exclusivo: BALAM, Supabase `telohdbvbvsfmwyriflz`.
Corte: 13/09/2026 02:08:22 UTC (12/09 en Hermosillo).
Autoridad: ADR-015, `online_runtime.enabled` y PostgreSQL; ningún caché es inventario.

## Evidencia y validación

- [Consulta inicial](h171-authority-audit.sql): BEGIN READ ONLY, timeout 60 s,
  un único JSON de resultados. El responsable ejecutó la consulta contra BALAM.
- [Resultado inicial](h171/authority-audit-before.json): 35 tablas con conteos y
  huellas completas y semánticas; catálogo real de 729 columnas y FKs.
- [Consulta de procedencia](h171-provenance-followup.sql): seguimiento mínimo de
  candidatos, recibos, movimientos, referencias y Storage; todavía sin resultado
  al redactar este corte.
- SQL inicial validado en PGlite sin red: esquema vacío; seis comprobaciones con
  datos sintéticos en memoria acreditan conteos, transacción read-only, marcador
  UNKNOWN y atribución correcta de un folio reutilizado.
- Seguimiento validado en PGlite con el catálogo remoto: 68 tablas, 729 columnas,
  17 secciones del informe, transacción read-only. El enum técnico de Storage
  se materializó únicamente en memoria para compilar el catálogo.

Los archivos SQL no crean funciones, semillas, tablas, usuarios, backups ni
solicitudes; tampoco ejecutan RPC comerciales. Su resultado no es un respaldo.

## Estado que impide declarar cero contaminación

| Concepto | Resultado remoto |
|---|---:|
| Productos totales / activos | 987 / 985 |
| Familias activas / piezas V2 | 263 / 3,596 |
| Productos con ID exacto de manifiesto QA | 14; 12 activos |
| Familias QA activas / piezas QA actuales | 12 / 113 |
| Ventas QA con actor, recibo, cliente y productos concordantes | 7 |
| Devoluciones / cambios / préstamos QA presentes | 2 / 2 / 2 |
| Clientes QA exactos | 3; uno con lápida |
| Promociones / claves de configuración QA exactas | 3 / 3 |
| Perfiles QA exactos / cuentas Auth exactas | 15 / 6 |
| Otros candidatos Auth sin manifiesto local completo | 5 |
| Instalaciones activas / QA activas | 1 / 0 |
| Archivo legacy / operación legacy en needs_review | 1 / 1 |
| Objetos Storage | 2,520: 1,927 barcodes y 593 fotos |

Las referencias ajenas a los 14 productos QA suman por diferencia 973 productos
activos, 251 familias y 3,483 piezas. La consulta de seguimiento compara sus
huellas por separado. Estas cifras no autorizan restaurar un inventario anterior.

Los siete folios QA con evidencia concordante son:
`BG-260912-0002`, `0004`, `0007`, `0008`, `0009`, `0010`, `0014`
(todos con prefijo `BG-260912-`).

**Preservar BG-260912-0001.** Un manifiesto antiguo contiene ese mismo folio,
pero el cliente y las referencias actuales no coinciden. Los folios 0002/0003
también fueron reutilizados entre ensayos. Un folio por sí solo nunca acredita
pertenencia ni habilita borrado.

## Procedencia disponible y faltante

Se sellaron tres manifiestos completos mediante SHA-256 en el SQL inicial:

- `.h164-sync-evaluation/.evidence-h164/live-0f05350/fixtures.json`,
  run `ca80e903-4239-4fde-9a98-a93d163a5190`.
- `.h161-release/.evidence-h169-live/fixtures.json`,
  run `2607cae4-404d-48bc-bdfc-6381b9c4a173`.
- `.h161-release/.evidence-h170-live/fixtures.json`,
  run `8a89fd93-552a-489d-ae6b-e0afabf899e7`.

La búsqueda completa en el workspace BALAM, incluidos directorios ocultos y
excluyendo dependencias/Git, no encontró manifiestos de los runs
`69237da3-b20c-4a37-93fb-831fd846d867` y
`6d340d65-7e61-486e-9a2f-f189a57bf7ec`.
El servidor conserva actores, declaraciones de run y recibos. El campo
`protected_run` del seguimiento proviene de `raw_user_meta_data` y es modificable
por el usuario: ese nombre no acredita protección. Sólo el marcador
`balam_account_request_id` procede de `raw_app_meta_data`. La procedencia se
acredita conjuntamente mediante actor exacto, recibos del servidor, solicitud
de cuenta, fórmula de IDs del runner y fechas coherentes.

Las 36 coincidencias iniciales por texto incluyen 13 líneas documentales que ya
son dependencias de documentos QA. No son 36 entidades adicionales: quedan 23
candidatos raíz en clientes, promociones, perfiles y configuración por revisar.
Un nombre/prefijo sigue siendo UNKNOWN hasta verificar procedencia.

## Dependencias y alcance del futuro respaldo

La consulta inicial encuentra como candidatos dependientes 7 líneas de venta,
11 pagos, 11 recibos de venta, 7 reservas, 2 recibos de liquidación de apartado,
2 devoluciones con 2 líneas/2 recibos, 2 cambios con 4 líneas/2 recibos,
2 liquidaciones, 17 movimientos y 2 reclasificaciones. Son candidatos de alcance;
los recibos y folios reutilizados deben cruzarse otra vez por identidad.

`movements` tiene `ref`, `operation_id`, `return_id` y `product_id`;
no tiene `folio` ni `folio_ref`. La primera consulta conservó estos movimientos
para revisión externa; el seguimiento usa los campos reales y sus recibos.
No hay aliases ni mapas V1/V2 referenciando los 14 productos QA actuales.

Antes de cualquier limpieza, preparar un manifiesto cerrado de IDs con huellas,
dependencias entrantes y salida esperada. Exportar a respaldo privado verificable:

1. Filas QA exactas y todos sus hijos/recibos/pagos/reservas/movimientos;
   reclasificaciones completas y cualquier enlace cruzado.
2. Perfiles y permiso de los actores QA, metadatos Auth permitidos y solicitudes
   de cuenta; nunca imprimir o incorporar credenciales en un informe público.
3. Recibos online, auditorías y registros de instalaciones relacionados, con la
   decisión de conservación histórica separada del inventario operativo.
4. Las 35 huellas comerciales y las filas/huellas protegidas fuera del alcance,
   incluida venta 0001 y productos reales, antes y después.
5. Para un objeto Storage cuya pertenencia QA se pruebe, original descargable,
   identificador, ruta, bucket, metadatos y hash del contenido, antes de retirarlo.

El orden de limpieza debe derivarse de las FKs reales y de las relaciones lógicas,
y ejecutarse únicamente tras la revisión del manifiesto y respaldo. No usar
Punto Cero global, borrado por prefijo/fecha, desactivar triggers o resetear
contadores como atajos. El reporte no contiene SQL destructivo.

## Storage y expediente de cuenta

252 objetos tienen referencias URL literales actuales en la primera consulta.
Los otros 2,268 NO están demostrados como huérfanos: pueden estar referenciados
mediante otra forma de URL, un snapshot o un respaldo. Ninguno de los 2,520 coincide
con propietario o ID de producto de los tres manifiestos QA conocidos.
El seguimiento amplía el cruce a histórico y agrupa procedencia por fecha/owner/hash.
Una referencia ausente no autoriza borrar.

El diagnóstico inicial de la solicitud de cuenta
`70549527-4867-4342-94d2-38e770b0f2a9` NO acredita ausencia de filas FK: usó
`query_to_xml(..., tableforest=true)` con XPath `/table/row/rows`, incompatible
con la raíz real `/row/rows`. Los NULL resultantes no son conteos cero.
El censo posterior demuestra un override `reportes` para el destino
`6dd83591-9e6b-482f-95e0-78470766cbce`; una FK existente no prueba por sí sola
la causa del fallo Auth. Se requieren los conteos directos y su semántica
ON DELETE, además del error real. La hipótesis previa queda sin acreditar.
La solicitud sigue siendo un expediente individual y no autoriza limpiar
recibos para ocultarla.

La bandera `same_run_confirmed_operation` del primer seguimiento tampoco
acredita un recibo de movimiento cuando `operation_id` es NULL: JSONPath puede
igualar NULL con un NULL del recibo. El dry-run posterior lo corrige exigiendo
operación no nula, o producto QA y referencia exacta de venta/cambio comprobado.

## Prevención de nueva contaminación

`test-h164-live-online.mjs` conserva deliberadamente historia QA;
`h164-qa-retirement.mjs` sólo desactiva cinco perfiles, bloquea dos cuentas y
retira tres instalaciones. El nuevo DoD requiere corregir ese contrato antes de
otra corrida sobre este proyecto, o ejecutar la jornada en un entorno BALAM
aislado que no sea la autoridad productiva. No volver a sembrar para certificar
cero residuos.

El inventario del navegador físico, la operación legacy needs_review y la
procedencia restante no se deducen de un heartbeat. Permanecen pendientes de
evidencia; no se confunden con los datos QA ya demostrados.
