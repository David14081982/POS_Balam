# Flujo Excel de inventario: altas y mensajes incoherentes

**Riesgo:** H-163
**Estado:** CORREGIDO Y VERIFICADO LOCALMENTE — publicación pendiente
**Fecha:** 11/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Etapa 1 — comprender. La solicitud cubre Plantilla, Importar y Exportar desde
Inventario: las altas y actualizaciones válidas deben poder completarse con
mensajes comprensibles, identidad conservada y persistencia verificable.

Etapa 2 — reproducir. La captura privada
`.evidence-h161/new-inventory-preview.png` muestra 973 altas y confirmación
habilitada junto con mensajes que presentan advertencias como errores.
El ensayo aislado `.evidence-h161/new-inventory-evidence.json` registra
973 altas, cero actualizaciones, cero conflictos y `planOk: true`; su vista previa
está visible y habilitada. Este ensayo no acredita una importación comercial
remota.

La evidencia equivalente en fuente mostraba que `exportTemplate()` usaba el
escritor compartido y que `buildProduct()`, invocado por `parseFile()`, asignaba
V1 cuando `_BALAM_MODELO_REFERENCIA` estaba vacío. La baseline automatizada
`.evidence-h161/full-cycle-baseline.json` descarga la plantilla mediante la
función pública, rellena sólo campos visibles y ejecuta el parser y el plan
reales: genera tres altas V1, cero conflictos, cuando se esperaban tres V2.
El mismo ensayo registra una intención de escritura con tres IDs al reimportar
filas sin campos modificados. No confirmó la importación por UI ni realizó
escrituras remotas; el inventario de ensayo termina vacío.

`.evidence-h163/messages-baseline.json` contiene cinco sondas de clasificación:
ID inexistente, SKU compartido, catálogo desconocido y reclasificación física
usan códigos vigentes. La quinta usa `STALE_VERSION`, que el importador no emite;
su código vigente es `VERSION_CONFLICT` y ya recibe la clasificación general
de conflicto. Otro ensayo de exportación y reimportación de V2
con talla XS inactiva falla antes del plan con `REFERENCE_SIZE_INVALID`; con
la talla activa el mismo recorrido produce una actualización sin cambios.

La revisión independiente del primer parche detectó dos mensajes que aún
requerían distinguir contextos: los grupos V1 duplicados no admiten el aviso de
SKU permitido, y `DUPLICATE_SKU_CURRENT` describe ambigüedad del inventario, no
filas repetidas del archivo. También reprodujo, ejecutando `confirmImport()`
extraído de la fuente, que `saveProducts() === false` podía terminar anunciando
una actualización incluso si la guarda restauraba el producto anterior.

## Causa raíz

Etapa 3 — localizar la ruptura. `planImport()` emitía
`SKU_DUPLICATE_WARNING` cuando varias referencias comparten SKU, sin convertirlo
por ello en conflicto de identidad. En `shared.jsx`, `classifyUserMessage()`
carecía de una clasificación contextual para esa advertencia, que recibía el
error genérico `unknown`; `inventory.jsx` la mostraba mediante `HumanMessage`.
IDs inexistentes, valores fuera de
catálogo y cambios físicos recibían `file_format`, cuya recomendación de descargar
otra plantilla no describía las causas respectivas.

El modelo V1 predeterminado para metadatos vacíos también rompía el contrato de
altas V2 desde la plantilla, como confirmó la baseline automatizada.
`planImport()` contabilizaba como actualización toda fila existente, aunque su
estado canónico no cambiara; `applyImportPlan()` devolvía todos esos IDs y la UI
los entregaba a `saveProducts()`. Esa cadena generaba la intención redundante.
Por último, `buildProduct()` invocaba
`DATA.createReference()` antes de resolver el producto existente por ID: aplicaba
la validación de talla activa para altas a una referencia histórica exportada.

El retorno booleano de `saveProducts()` no se comprobaba. Puede ser falso por
una guarda de apartado que restaura datos, o por caché local fallida aunque se
conserve la intención en la cola. Tratar ambos casos como éxito es incorrecto;
revertir ambos indiscriminadamente también puede contradecir una intención ya
emitida. Las guardas y el resultado de almacenamiento requieren tratamientos
distintos dentro del mismo recorrido de confirmación.

## Diseño

Etapa 4 — fijar el contrato antes de corregir.

- Un archivo exportado conserva identidad, versiones, barcode, familia y datos
  comerciales al volver a importarse; un archivo sin cambios no crea duplicados.
- Una plantilla nueva permite altas válidas con los campos visibles y las
  autoridades actuales, sin exigir edición manual de columnas ocultas. La
  presentación prioriza referencias V2 y conserva las columnas de compatibilidad
  legacy; un V1 explícito mantiene su modelo.
- Las advertencias describen su causa y mantienen habilitada la confirmación
  cuando el plan es válido. Los conflictos reales indican la corrección pertinente.
- Se preservan V1 histórico, V2, catálogos y alias válidos; compartir SKU no equivale
  a compartir identidad. IDs inexistentes, versiones obsoletas, identidades
  duplicadas y planes caducados continúan bloqueados.
- Una talla inactiva se conserva sólo al corresponder al mismo producto histórico
  identificado por ID. Altas y cambios hacia tallas inactivas siguen bloqueados;
  las listas para nuevas altas publican únicamente opciones activas.
- Confirmar sólo comunica éxito cuando la operación cumple el contrato vigente
  de persistencia local y cola offline; se verifican los caminos de fallo.
- El aviso de SKU compartido corresponde a grupos V2; los bloqueos legacy por
  SKU ambiguo mantienen su motivo propio. Duplicidades en el inventario actual
  se distinguen de filas repetidas en el archivo.
- Las referencias modificadas pasan por `DATA.assertLayawayProductsUnlocked()`
  antes de aplicar; las filas sin cambios no requieren escritura. El plan vuelve
  a comprobar esa guarda al aplicarse para cubrir cambios posteriores al preflight.
- Si la caché no se confirma, se comunica guardado pendiente y se conserva la
  intención emitida; no se aplica un rollback ciego que pueda contradecirla.

## Solución

Etapa 5 implementada. Los cambios productivos se concentran en tres fuentes:

- `balam/xlsx-io.jsx`: la plantilla vacía oculta las columnas de captura legacy,
  conserva el esquema y crea V2 desde campos visibles. Exige existencia escalar
  explícita, acepta cero y rechaza existencias contradictorias de otras tallas.
  Las listas de alta usan valores activos; el mapa histórico y la lectura V1 se
  conservan. Un valor inactivo sólo se conserva en su referencia existente.
  La comparación canónica identifica filas sin cambios y excluye sus IDs de la
  intención. Preflight y aplicación consumen la guarda vigente de apartados.
- `balam/shared.jsx`: mensajes específicos por causa, avisos neutrales de SKU V2,
  ambigüedad del inventario distinta de filas repetidas y guardado pendiente
  distinto de éxito. Los datos técnicos permanecen restringidos por rol.
- `balam/inventory.jsx`: vista previa con altas, cambios y filas idénticas;
  cierre sin escrituras cuando todo coincide; persistencia sólo de IDs afectados;
  feedback persistente por resultado y fallo de lectura. Un retorno falso de
  almacenamiento conserva la intención emitida y muestra guardado pendiente.
  El contenedor permite desplazamiento horizontal real hasta la última columna.

La revisión independiente originó regresiones adicionales para SKU legacy,
duplicidad en el inventario, apartados y fallo de caché. El hallazgo responsive
se corrigió cambiando el contenedor de `overflow-hidden` a `overflow-auto`.
Los artefactos se regeneraron desde `balam/`; el BUILD 3 final quedó verificado.
No se modificaron DATA, STORE, SQL, los XLSX originales ni datos comerciales remotos.

## Pruebas

Etapa 6 completada localmente. Evidencia previa: inspección directa del clasificador y del
parser, captura de vista previa y ensayo aislado con 973 altas válidas. Baseline
automatizada: contrato de altas V2 incumplido (tres V1 de tres), y contrato de
reimportación sin intención de escritura incumplido (una llamada, tres IDs).
Cinco sondas de clasificación en `messages-baseline.json`, cuatro con códigos
vigentes y una exploratoria de versión; no equivalen a cinco fallos del importador.
Referencia V2 histórica con XS inactiva rechazada antes de resolver su ID.
La reproducción determinista de confirmación distingue tres caminos: sin cambios
no llama a guardar; guardado falso emitía éxito; guardado falso con restauración
de la referencia también emitía éxito. Esta última reproducción aísla la función
de UI y no acredita un fallo de cola real.
Los resultados de H-161 no se contabilizan como pruebas ejecutadas de H-163.

Resultados del BUILD 3 definitivo; sustituyen los recorridos previos de BUILD
1/2 y no acumulan repeticiones:

| Comprobación | Resultado | Alcance |
|---|---|---|
| `node test-h163-inventory-xlsx.mjs` | 23/23, salida 0 | Suite específica contra bundle; plantilla, legado, catálogos, no-op y apartados |
| `node test-h86-inventory-xlsx-contract.mjs` | 49/49, salida 0 | Contrato Excel; el locator distingue correctamente «sin cambios» de actualizaciones |
| `node test-xlsx-security.mjs` | 17/17, salida 0 | Seguridad del lector |
| `node test-h163-inventory-messages.mjs` | 16/16, salida 0 | Mensajes contextuales, duplicidades y datos técnicos por rol |
| `node test-smoke.mjs bundle` | 17/17, salida 0 | Artefacto integrado |
| `node test-ui-navigation.mjs` | 15/15, salida 0 | Navegación |
| `node test-h163-inventory-excel-e2e.mjs --private-only` | 14/14, salida 0 | 973 referencias, 251 familias, 3484 piezas, datos comerciales exactos, recarga, reimportación sin cambios y alta repetida bloqueada |
| `node test-h163-inventory-excel-e2e.mjs` | 37/37, salida 0 | Plantilla → altas → recarga → exportación → edición → importación; cuatro anchuras, scroll horizontal real y fallo de cuota |

Regresiones adicionales durante la implementación: `node test-h134-human-messages.mjs`
43/43 y `node test-store-queue.mjs` 186/186, ambos con salida 0. La cola es simulada.

Las baselines específicas fallaron: XLSX inicial 3/16; la suite final de mensajes
con `--baseline` contra `f529b0c` obtuvo 3/16, salida 1, frente a 16/16 en la
fuente final. Las regresiones añadidas durante revisión ampliaron XLSX a 23;
el último ajuste de duplicidad pasó de 15/16 a 16/16. Estos checkpoints no son
casos adicionales acumulables.

HTML y offline finales comparten SHA-256
`a68d115f9771c648d5ee3a17a79302ba7e5dd35ca580843debb4e4301b4061e0`;
SW `fb65ba622af054d2d18308ae579d40b3c2a315088c16a49760f6081aa839448c`.
La regresión final y ambos E2E acreditan ese mismo HTML. Evidencia local:
`.evidence-h163/final-regression/result.json`, `final-ui/result.json` y
`private-ui/result.json`. Se inspeccionaron las capturas del archivo privado a
320 y 1440 px: 973 altas, aviso neutral, confirmación accesible y última columna
alcanzable mediante desplazamiento horizontal.

Los E2E ejecutan DATA, `saveProducts()`, `persistProducts()` y `localStorage`
reales en un navegador aislado. El gateway CORE registra tipo e IDs; no ejecuta
la cola IndexedDB ni acredita convergencia remota. En la prueba de cuota se
induce el fallo sólo en la clave de productos: conserva el cambio en memoria,
la caché previa y la intención registrada, con feedback de guardado pendiente.
El ensayo sintético bloqueó 83 solicitudes externas y el privado 108; ambos
permitieron cero. Los datos y capturas privados no se versionan.

## Riesgo residual y pendientes

Etapa 7: expediente, H-163, contrato de arquitectura y registro de autoridad
actualizados con la implementación y evidencia del artefacto final. Etapa 8:
commit y despliegue pendientes; la entrega real aún no se declara publicada.

La matriz real A/B/C es opcional conforme a H-162 y no bloquea el despliegue.
**NO CERTIFICADO:** no se ejecutó la matriz distribuida ni una importación comercial
remota. Los XLSX originales permanecen intactos y los IDs retirados por Punto Cero
no se recrean silenciosamente. La adopción en la terminal del usuario no está
comprobada.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-163--flujo-excel-de-inventario-altas-y-mensajes-incoherentes`.
- Metodología: `docs/01-engineering-methodology.md`.
- Contratos relacionados: H-86 (Excel), H-95 (persistencia por IDs), H-101 y
  H-133 (referencias V2), H-134/H-137 (mensajes), H-160 (Punto Cero),
  H-161 (familias UUID válidas) y H-162 (certificación opcional).
- Autoridad: `docs/architect/authorities/inventory.md`.
