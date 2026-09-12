# Importación de familias UUID v5 exportadas por BALAM

**Riesgo:** H-161
**Estado:** PARCIALMENTE RESUELTO — corregido localmente, sin publicación
**Fecha:** 11/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Inventario → Importar → seleccionar uno de los archivos proporcionados por el
usuario aborta antes de mostrar la vista previa. El aviso humano solicita una
plantilla nueva, pero volver a exportar conserva los mismos identificadores.

| Archivo | Productos | Filas con familia UUID v5 |
|---|---:|---:|
| `Inventario_Balam_2026-09-09 (1) (1).xlsx` | 973 | 830 |
| `Inventario_Balam_2026-09-11.xlsx` | 975 | 830 |

La evidencia inicial de la auditoría local encuentra en DA2, para PRESIDENCIAL,
la familia `bfdb4fe0-5227-5cee-bfa0-6408495e7e9d`. La validación vigente produce:
`Fila 2 · «_BALAM_REFERENCE_FAMILY_ID»: debe ser un UUID v4 válido.`
Los originales se conservan fuera del repositorio y no se modifican.

El resultado esperado es leer la familia original y continuar al preflight.
La lectura correcta no implica que el archivo pueda aplicarse al inventario
actual: el preflight debe comprobar existencia, versiones y demás contratos.

## Causa raíz

`analyze-h133-barcode-v3-manifest.mjs` genera familias deterministas con versión
5 y la migración `20260830017300_pos_h133_execute_inventory_v3.sql` contiene la
familia de la primera fila. PostgreSQL la almacena como `uuid`. H-101 define la
familia como relación administrativa, separada de la identidad física.

`writeInventoryWorkbook()` conserva `referenceFamilyId` al exportar; en cambio,
`buildProduct()`, invocado por `parseFile()`, exigía versión 4 exclusivamente.
La traducción de H-134 explica el mensaje visible, pero la incompatibilidad nace
en esa validación del lector.

Las pruebas H-86/H-133 existentes usan familias v4 y no ejercen este recorrido
con una familia v5 realmente generada por H-133.

## Diseño

Ampliar únicamente la validación de familia para aceptar UUID v4 y v5 bien
formados, con variante válida. Conservar el identificador recibido y las demás
validaciones. `_BALAM_ID_PRODUCTO` sigue siendo la autoridad de actualización;
familia, SKU, nombre y posición nunca reemplazan esa identidad.

El lector continúa sin mutaciones. El preflight conserva conflictos por IDs
ausentes, versión obsoleta, barcode incompatible y datos inválidos. El plan
completo sigue siendo atómico y debe permanecer vigente antes de aplicarse.

No se cambian DATA, CONFIG, AUTH, STORE, SQL, permisos, cola offline, generación
de IDs ni documentos históricos. Los dos HTML se regeneran desde la fuente.

## Solución

`balam/xlsx-io.jsx` amplía la versión aceptada de la familia a `[45]` y ajusta
el detalle técnico. La estructura UUID, su variante y las demás guardas se
conservan. `test-h86-inventory-xlsx-contract.mjs` añade siete comprobaciones de
compatibilidad y rechazo, sin modificar los caminos productivos de persistencia.

El cambio se preparó en el checkout aislado `.work/h161-excel`, rama
`fix/h161-import-family-uuid`, base `eef071d`. Esta base conserva las
correcciones publicadas posteriores a la copia raíz.

## Pruebas

La línea base `node test-h86-inventory-xlsx-contract.mjs` pasó **42/42** antes
de añadir la cobertura. Las siete comprobaciones nuevas sobre el artefacto
`eef071d` produjeron **44 aprobadas y 5 fallidas**, código de salida 1. Fallaron
la lectura mixta v4/v5 y las cuatro comprobaciones que dependen de leer v5.

Ambos Excel originales fueron leídos mediante `parseFile()` y reprodujeron el
rechazo de UUID v4 en la fila 2; sin mutaciones y con hashes originales intactos.

`node build-offline.mjs`: **código 0**, 73 recursos. El primer intento en el
worktree nuevo falló por ausencia de sus dependencias locales; se enlazaron las
ya existentes y el build terminó correctamente, sin descargar dependencias.

| Comando final | Resultado |
|---|---:|
| `node test-h86-inventory-xlsx-contract.mjs` | 49/49; código 0 |
| `node test-xlsx-security.mjs` | 17/17; código 0 |
| `node test-smoke.mjs bundle` | 17/17; código 0 |
| `node test-ui-navigation.mjs` | 15/15; código 0 |

Las **98 comprobaciones** incluyen exportación y reimportación real de un XLSX,
libro mixto v4/v5, conservación del estado completo y seis UUID inválidos en la
última fila rechazados sin mutación. Se ejercen también las guardas de versión
obsoleta, ID ausente, ID repetido y barcode repetido, incluido el rechazo al
intentar aplicar esos planes.

La prueba específica de los dos archivos originales terminó el 12/09/2026 a
las 00:59:20 UTC (11/09 en Hermosillo). Usó `parseFile()` y la pantalla real del
HTML final, con red de negocio bloqueada y catálogos reconstruidos únicamente
desde cada Excel. No representa la configuración vigente de Supabase.

| Comprobación | Archivo 09/09 | Archivo 11/09 |
|---|---:|---:|
| Filas leídas / omitidas | 973 / 0 | 975 / 0 |
| Vista previa visible | Sí | Sí |
| ID, familia, barcode, stock, precios, costo y versión conservados | Sí | Sí |
| Conflictos `ID_NOT_FOUND` ante inventario vacío | 973 | 975 |
| Confirmar deshabilitado ante esos conflictos | Sí | Sí |
| Inventario y Excel originales intactos | Sí | Sí |

El primer intento del arnés privado usó la página `inventory`; se corrigió el
instrumento al identificador estable `inventario`. Ese ajuste no cambió el
producto ni se contabiliza como defecto de BALAM.

La comparación del bundle encuentra **72/73 recursos idénticos** a la base:
cambió sólo el módulo XLSX. Los dos HTML finales son idénticos:
`ece24479d2ef006c0c6de50f680a7fcb487800ee56c5c048b8f7434ff4185a14`.
El service worker regenerado tiene SHA-256
`51cdbbb33d1a6fdd07b7a0db8560352d3c5eac368962e80f566dc717c9cf6d1c`.

Resumen sin filas comerciales ni capturas en
`docs/fixes/evidence/h161-local-verification.json`. Los logs, JSON originales y
captura de preview quedan en `.evidence-h161/`; los XLSX privados no se incorporan
al repositorio. Los hashes de ambos archivos originales coinciden antes/después.

## Riesgo residual y pendientes

H-160 registra un Punto Cero ejecutado, con inventario remoto en cero y época
10. Un export anterior contiene IDs que pueden haber dejado de existir: esa
condición es un conflicto de preflight legítimo, no otro error de formato.
Esta corrección no restaura inventario ni autoriza recrear identidades borradas.

Certificación distribuida **NO CERTIFICADO** mientras no se complete la matriz
real A/B/C y se identifique por hash el artefacto final, conforme a R-SYNC-16 y
R-SYNC-17. `test-h148-sync-certification.mjs` rechazó el certificado anterior,
código 1: `tested build differs from delivery`. Ese resultado demuestra que la
puerta exige evidencia de este HTML; no demuestra una divergencia del importador.
No se cambió la puerta ni se reutilizó el certificado como aprobación.

La revisión del runner real encontró que exige un evento de limpieza selectiva
para la época vigente y productos V2 preexistentes antes de crear las semillas.
Estas condiciones no corresponden al inventario vacío/época 10 documentado en
H-160. Su arranque también puede reservar numeración mediante `ensureFolioBlock`
en `folio_counters`, tabla fuera de las 17 huellas de conservación y limpieza
del runner. No se ejecutó ese ensayo remoto ni se adaptó el certificador dentro
de la corrección quirúrgica; tampoco se consumió ni revirtió numeración.

Commit y publicación pendientes. No se ejecutó una importación sobre Supabase
real ni se modificaron productos comerciales. La adopción de la actualización
por la terminal del usuario tampoco se ha comprobado.

El defecto debió quedar cubierto con el export de familias generado por H-133.
La regresión permanente v4/v5 cierra ese hueco local sin crear otra autoridad,
cambiar el esquema Excel ni ampliar el alcance a restauración de inventario.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-161.
- `docs/02-architecture.md` § Contrato Excel canónico de Inventario.
- `docs/fixes/contrato-excel-inventario.md` y `atributos-opcionales-canonicos.md`.
- `docs/fixes/captura-edicion-masiva-v2.md`.
- `docs/fixes/migracion-inventario-barcode-v3-h133.md`.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `docs/fixes/punto-cero-enlaces-inventario-h160.md`.
- `docs/architect/playbooks/synchronization.md`.
