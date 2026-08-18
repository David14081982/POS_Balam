# Reconciliación quirúrgica Codex ↔ Opus — guardas V2

**Fecha:** 18/08/2026
**Estado:** auditoría consolidada; H-115 corregido sin cambiar identidad
**Commit de corrección:** `126e98e`

## Resumen ejecutivo

El mensaje no se dispara por “cualquier edición” ni bloquea el formulario entero. `DATA.updateReference()` primero calcula la firma física del candidato y sólo bloquea si esa firma cambia y la referencia tiene `physicalIdentityLocked`, stock actual distinto de cero o alguna operación local asociada por `products.id`.

La arquitectura V2 —una fila por referencia física, ID y barcode inmutables, documentos por `productId` y firma física— es correcta. Hay tres problemas distintos:

1. **P1 confirmado y corregido (H-115):** Editar V2 descartaba los valores generales nuevos de Corte y Características antes de llamar a `updateReference()`. En referencias sin candado guardaba los valores viejos con un toast de éxito; con stock también ocultaba el cambio a la guarda y producía éxito falso.
2. **G1 corregido:** el mensaje decía “ya tiene operaciones” aunque bastaba stock actual o el candado monotónico. Ahora dice que la referencia tiene o tuvo existencias u operaciones, y separa los datos comerciales.
3. **Decisiones pendientes, no modificadas:** Corte y Características siguen en identidad; no se cambió `CONFIG.inReference`, firmas históricas, candado, trigger, stock, IDs, barcode, baja ni reclasificación.

Recomendación: **mantener las altas en V2 y corregir V2**, no volver a V1. V1 permite mutaciones físicas históricas porque carece de la integridad de V2; usarlo como escape aumenta deuda y ambigüedad posventa.

## 1. Estado autoritativo común

| Autoridad | Valor auditado |
|---|---|
| Base de código | `origin/main` y bundle publicado en `37e83cc7b367f63721272e0788aab6cb7f42ed43` antes de H-115 |
| Bundle publicado | 8,999,907 bytes; SHA-256 `F7388F3EE572395F9EA16BF3DC5CA49B2BF82A36D8C273BC94908A7097671DB4`; Git blob `e8871ac8ec2bbc67bfb46634ab26918ade0c11b5` |
| CONFIG remoto | `config_sync_state.version=36`; dominio CONFIG `version=180`; actualizado `2026-08-17T18:07:22.900932Z` |
| Productos remotos | dominio `version=395`; actualizado `2026-08-18T15:01:45.360266Z` |
| Esquema | manifest `20260817014900`, data epoch 2 |
| Última migración remota | `20260817015000`; lista local/remota alineada |

La reproducción se ejecutó contra una copia byte-a-byte del bundle publicado y contra fixtures locales con Supabase interceptado. Las consultas a datos reales fueron agregadas y read-only.

## 2. Por qué aparece “tiene operaciones”

Autoridad cliente: `referenceHasOperations(productId)` y `updateReference(candidate)` en `balam/data.jsx`. Condición exacta anterior y actual:

```text
physicalSignature(candidate) != physicalSignature(actual)
AND (
  actual.physicalIdentityLocked
  OR actual.stockQuantity != 0
  OR referenceHasOperations(actual.id)
)
```

Por tanto:

- evalúa el **cambio físico concreto**, no toda edición;
- precio, costo, foto, nombre comercial y POP no cambian la firma y pasan;
- una operación cerrada o antigua basta: no hay filtro de estado ni fecha;
- el stock actual importa por separado;
- aunque el stock vuelva a cero, `physicalIdentityLocked` permanece `true` una vez que hubo stock;
- no importa que la operación siga activa.

### Qué significa “operaciones” en el cliente

| Evidencia | ¿Cuenta? | Cómo se detecta | ¿Estado importa? |
|---|---:|---|---:|
| Venta | Sí | `sales[].lineas[].productId` | No |
| Apartado | Sí | Es una venta/documento en `sales` con líneas | No |
| Devolución | Sí | `returns[].lineas[].productId` | No |
| Cambio | Sí | `exchanges[].lineas[].productId` | No |
| Préstamo | Sí, cliente | `loans[].lineas[].productId` | No |
| Movimiento | Sí | cualquier `movements[].productId/product_id` | No |
| Reclasificación | Sí | produce movimientos; servidor además consulta su ledger | No |
| Etiqueta/impresión | No | no crea documento ni movimiento de inventario | N/A |
| Importación | No por sí misma | intenta crear/actualizar y entonces ejecuta las guardas | N/A |
| Ajuste u “otra” operación | Sí si genera `movement` con el ID | `movements` | No |

Mensaje corregido:

> No se puede cambiar la identidad física de esta referencia porque tiene o tuvo existencias u operaciones. Puedes editar datos comerciales; para cambiar atributos físicos se requiere un flujo de reclasificación.

Código estable: `REFERENCE_RECLASSIFICATION_REQUIRED`.

## 3. Matriz de campos

“V2 sin historial” en esta tabla significa stock 0, `physicalIdentityLocked=false` y sin documentos/movimientos. “Con historial” incluye candado, stock o una operación histórica.

| Campo | Clase | V1 editable | V2 sin historial | V2 con historial | Motivo vigente |
|---|---|---:|---:|---:|---|
| Nombre comercial | Comercial | Sí | Sí | Sí | No forma firma |
| Modelo/código de producto | Identidad física | Sí | Sí | No | CONFIG/firma y columna `modelo` |
| Categoría | Identidad física | Sí | Sí | No | Forma firma y columna física |
| Manga | Identidad física | Sí | Sí | No | Forma firma |
| Material | Identidad física | Sí | Sí | No | Forma firma |
| Color tela | Identidad física | Sí | Sí | No | Forma firma |
| Cuello | Identidad física | Sí | Sí | No | Forma firma |
| Ornamento | Identidad física | Sí | Sí | No | Forma firma |
| Color de ornamento | Identidad física | Sí | Sí | No | Forma firma; puede ser obligatorio |
| Corte | Identidad física por CONFIG actual | Sí | Sí | No | `inReference=true`, aunque `inSku=false` |
| Características | Identidad física por CONFIG actual | Sí | Sí | No | `inReference=true`, aunque `inSku=false` |
| Familia de tallas | Identidad física | Sí con confirmación si pierde datos | Sólo altas/agregar referencias; no muta talla existente | No | Categoría/talla efectiva forman identidad |
| Talla | Identidad física | Sí mediante stock legacy | Sí al crear; selector de referencia existente deshabilitado | No | Una V2 es una talla física |
| Existencia | Stock | Sí | Sí | Sí | No cambia firma; >0 activa candado monotónico |
| Precio | Comercial | Sí | Sí | Sí | No forma firma |
| Precio especial | Comercial por talla | Sí | Sí | Sí | Se materializa por referencia V2 |
| Fotografía | Visual | Sí | Sí | Sí | No forma firma |
| Variantes físicas | Identidad física | N/A como entidad separada | Sí por referencia | Sólo valores que no cambien firma | Cada variante es una referencia exacta |
| POP | Comercial | Sí | Sí | Sí | No forma firma |
| Costo | Comercial | Sí | Sí | Sí | No forma firma |
| SKU visible | Derivado/comercial | No se captura directamente | Derivado | Derivado | No es identidad V2; duplicado sólo advierte |
| Barcode | Identidad logística | Legacy acoplado al SKU | Generado/inmutable | Inmutable | Resuelve exactamente `products.id` |

Conclusión de campo: hoy **sí necesitan una referencia distinta/reclasificación** categoría, modelo físico, manga, material, color tela, cuello, ornamento, color de ornamento, talla/familia efectiva y los custom marcados `inReference` (Corte y Características). Nombre comercial, foto, costo, POP y precios deberían —y ya pueden— editarse sin reclasificar.

## 4. Corte y Características: reproducción y causa

| Caso | Bundle publicado antes de H-115 | Resultado tras H-115 |
|---|---|---|
| A. alta V2, stock 0 | ambos persisten | ambos persisten |
| B. editar familia unlocked | ambos se descartan antes de DATA; éxito falso | candidate y `products.attrs` contienen ambos |
| C. editar con stock/candado | ambos se descartan; la guarda no ve cambio; éxito falso | DATA ve el cambio, bloquea y revierte el lote |
| D. excepción física específica | `row.attrs` persiste | persiste; familia mixta no borra fuente |
| E. guardar/reload/pull/reeditar | rehidrata sólo lo realmente persistido | conserva valores reales y proyección mixta |
| F. inspección de cada `products.attrs` | muestra la pérdida | todos conservan Corte/Características |
| G. Supabase | aislado; sin escrituras reales | aislado; sin escrituras reales |

Primera función incorrecta: `ProductForm.submit()` en `balam/inventory.jsx`. En edición construía `candidateAttrs` desde `source.attrs` y `row.attrs`; sólo reaplicaba `familyCaptureKinds`. Los nuevos valores generales de `d.attrs` para `referenceCaptureKinds` nunca llegaban a `DATA.updateReference()`.

La corrección materializa por cada fila el valor efectivo: excepción no vacía → valor general común → valor fuente si la familia es mixta. No altera qué campos son identidad.

Datos reales read-only: 150 referencias V2 activas en 33 familias, stock total 330, 134 con candado, 150 con Corte y 107 con Características. No existen hoy grupos que colisionen al retirar sólo Corte ni sólo Características, y no hay documentos asociados a esas hipotéticas colisiones. **Esto no autoriza cambiar `inReference`:** retirarlos cambiaría las firmas de las 150 referencias y el contrato histórico.

## 5. Cliente versus PostgreSQL

| Cambio/evidencia | Cliente | Servidor | Resultado | Divergencia |
|---|---|---|---|---|
| Campo en firma CONFIG | compara `physicalSignature` | compara firma y columnas/attrs | bloquea con evidencia | alineado en caso normal |
| `attrs` custom fuera de firma | permite si firma no cambia | compara `new.attrs is distinct from old.attrs` | remoto puede rechazar | **Sí, servidor más amplio (G4/G2)** |
| Préstamo por `productId` | consulta `loans` directamente | no consulta tabla de préstamos | cliente puede bloquear solo | **Sí**; normalmente el candado por stock también protege |
| Venta | `sales` local | `sale_items` | bloquea | alineado |
| Devolución | `returns` local | `return_items` | bloquea | alineado |
| Cambio | `exchanges` local | `exchange_items` | bloquea | alineado |
| Movimiento | `movements` local | `movements` | bloquea | alineado |
| Reclasificación | movimientos | movimientos + `reference_reclassifications` | bloquea | servidor tiene evidencia adicional |
| Sólo precio/foto/nombre/costo/POP | firma no cambia | trigger no escucha esos campos salvo attrs | permite | alineado |

No se modificó PostgreSQL: alinear el trigger exige decidir qué claves de `attrs` son contractualmente físicas y cómo representar préstamos históricos.

## 6. Candado permanente

| Caso | Resultado actual | Clasificación |
|---|---|---|
| stock > 0 sin documentos | bloquea cambio físico | G0 · necesario para piezas actuales |
| stock vuelve a 0, nunca hubo documentos | sigue bloqueado por `physicalIdentityLocked` | G2 · conservador; evita reutilizar identidad, pero falta evidencia de negocio para exigirlo siempre |
| venta histórica/cerrada | bloquea | G0 · protege historial |
| movimiento histórico | bloquea | G0 si el kardex representa pieza; amplio pero trazable |
| etiqueta impresa | no bloquea | G0 · no es autoridad de pieza |
| préstamo cerrado | cliente bloquea sin mirar estado | G0/G1 · protege documento; divergencia servidor |
| reclasificación revertida | sigue bloqueado | G0 · conserva ambas huellas del ledger |

No se retiró `physicalIdentityLocked`. El concepto no es simplemente `hasAnyOperations → bloquear formulario`: requiere cambio real de firma. Lo excesivo potencial está en la permanencia del candado sin documento y en que PostgreSQL trata todo `attrs` como físico.

## 7. Reclasificar piezas: comportamiento real

`DATA.reclassifyReference()` y el RPC/ledger existen, pero no tienen llamadores productivos en la UI.

| Pregunta | Comportamiento actual |
|---|---|
| ¿Qué cambia? | Resta cantidad a la referencia origen y suma a una referencia destino; crea dos movimientos y ledger remoto |
| ¿Qué conserva? | Ambas referencias y todos sus atributos, documentos e historia previa |
| ¿Crea nuevo `products.id`? | No; el destino debe existir antes |
| Barcode | No cambia |
| SKU | No cambia |
| Historial | Permanece ligado a los IDs originales; la reclasificación añade movimientos trazables |
| Stock | Se transfiere una cantidad entera disponible |
| Familia | No se cambia; origen/destino pueden pertenecer a familias distintas |
| Reversión | Es idempotente mediante `operationId/reversalOf`; crea evidencia inversa |

Impacto operativo:

- con stock > 0 se necesita primero una referencia destino válida y después transferir piezas;
- con stock 0 e historial no hay cantidad que reclasificar: el flujo correcto sería conservar la referencia histórica y crear la referencia correcta para futuro;
- la UI actual no puede crear con claridad una “hermana” que cambie un atributo común ni ejecutar el traslado;
- por ello el mensaje antiguo prescribía una acción no disponible.

Diseño pendiente, no implementado: asistente “Crear destino → previsualizar diferencias físicas → mover cantidad → confirmar ledger”, sin mutar IDs; para stock 0, “archivar/conservar origen y crear nueva referencia”, no una reclasificación de cantidad cero.

## 8. Baja/eliminación

| Superficie | Resultado actual |
|---|---|
| V1 detalle | muestra Eliminar; no pide confirmación; `removeProduct(id)` hace baja local y encola baja remota |
| V2 referencia exacta | la autoridad por ID existe, pero no hay acceso productivo desde la proyección normal |
| V2 proyección familiar | siempre `isFamilyProjection`; el botón se oculta por `!p.isFamilyProjection`, incluso con una sola referencia |
| Historia/stock | la autoridad de baja no impone una guarda general equivalente a identidad |
| Liquidación pendiente | sí bloquea la baja |
| Devolución/cambio posterior | puede no localizar/restockear una referencia eliminada localmente o reactivar semántica no definida |

V1 y V2 no tienen la misma eliminación. La semántica final sigue siendo HARD STOP (H-114): hay que decidir baja de referencia, familia, stock e historia antes de exponer una acción V2.

## 9. Inventario de mensajes y guardas de Nuevo/Editar

Los mensajes dinámicos conservan sus interpolaciones entre llaves.

| ID | Pantalla | Mensaje exacto/patrón | Cuándo aparece | Efecto | Modelo | Clase |
|---|---|---|---|---|---|---|
| INV-001 | Nuevo/Editar | `Selecciona o escribe el nombre / modelo.` | nombre vacío | Bloquea | V1/V2 | G0 |
| INV-002 | Nuevo/Editar | `Escribe el número de modelo.` | no hay catálogo Modelo y modelo vacío | Bloquea | V1/V2 | G0 |
| INV-003 | Nuevo/Editar | `Selecciona la familia de tallas.` | familia ausente | Bloquea | V1/V2 | G0 |
| INV-004 | Nuevo/Editar | `Selecciona al menos una referencia para crear o conservar.` | familia V2 sin filas seleccionadas | Bloquea | V2 | G0 |
| INV-005 | Nuevo/Editar | `Selecciona {catálogo} para talla {talla}.` | custom reference requerido sin valor efectivo | Bloquea | V2 | G0 |
| INV-006 | Nuevo/Editar | `Selecciona {catálogo}.` | catálogo requerido sin valor | Bloquea | V1/V2, compatibilidad V1 | G0 |
| INV-007 | Nuevo/Editar | `Selecciona color de ornamento para talla {talla}.` | ornamento exige color y falta | Bloquea | V2 | G0 |
| INV-008 | Nuevo/Editar | `Escribe el precio del grupo {n}.` | grupo con tallas sin precio | Bloquea | V1/V2 | G0 |
| INV-009 | Nuevo/Editar | `La talla {talla} está en dos precios especiales (grupos {a} y {b}).` | solape | Bloquea | V1/V2 | G0 |
| INV-010 | Nuevo/Editar | `Selecciona al menos un color en el grupo {n}.` | grupo sin colores | Bloquea | V1/V2 | G0 |
| INV-011 | Nuevo/Editar | `La talla {talla} tiene colores incompatibles en los grupos {a} y {b}.` | solape incompatible | Bloquea | V1/V2 | G0 |
| INV-012 | Editar | `Hay cambios sin guardar. ¿Deseas cerrar el formulario y descartarlos?` | cerrar draft dirty | Confirma | V1/V2 | G0 |
| INV-013 | Editar V1 | `Cambiar la familia de tallas eliminará {partes}. ¿Deseas continuar?` | perdería stock/excepciones | Confirma | V1 | G1 |
| INV-014 | Nuevo/Editar | `Selecciona una imagen` | archivo no es imagen | Bloquea foto | V1/V2 | G0 |
| INV-015 | Nuevo/Editar | `No se pudo leer la imagen` | resize/lectura falla | Advierte | V1/V2 | G1 |
| INV-016 | Nuevo/Editar | `Imagen lista` | preview local listo | Informa | V1/V2 | G0 |
| INV-017 | Nuevo/Editar | `Foto guardada en la nube` | upload termina | Informa | V1/V2 | G0 |
| INV-018 | Guardar familia | `{n} referencias guardadas` | lote completo correcto | Informa | V2 | G0 tras H-115 |
| INV-019 | Guardar familia | `No se pudo guardar la familia; no se aplicaron cambios` o error de dominio | falla cualquier referencia; rollback local | Bloquea | V2 | G0 |
| INV-020 | Guardar producto | `Producto actualizado` / `Producto agregado al inventario` | éxito individual | Informa | V1/V2 individual | G0 |
| INV-021 | Guardar | `Advertencia: referencias físicas distintas comparten el mismo SKU visible.` | SKU V2 duplicado | Advierte | V2 | G0 |
| INV-022 | Dominio | `La referencia ya no existe` | ID no localizable | Bloquea | V2 | G0 |
| INV-023 | Dominio | `Una fila V1 no se convierte automáticamente; crea referencias V2 nuevas` | intento V1→V2 | Bloquea | V1/V2 | G0 |
| INV-024 | Dominio | `El modelo de una referencia V2 es inmutable` | intento V2→otro modelo | Bloquea | V2 | G0 |
| INV-025 | Dominio | `El código logístico de la referencia es inmutable` | cambia barcode | Bloquea | V2 | G0 |
| INV-026 | Dominio | `Selecciona al menos un color de ornamento` | color requerido ausente | Bloquea | V2 | G0 |
| INV-027 | Dominio | `La talla no pertenece a la familia seleccionada` | talla inválida | Bloquea | V2 | G0 |
| INV-028 | Dominio | mensaje de identidad corregido | cambia firma con stock/candado/operación | Bloquea | V2 | G0 regla / G1 flujo |
| INV-029 | Dominio | `La edición colisiona con otra referencia` | ID/barcode/firma duplicada | Bloquea | V2 | G0 |
| INV-030 | UI | selector Talla deshabilitado | referencia adicional ya tiene ID | Bloquea control | V2 | G0 |
| INV-031 | UI | No. Modelo `readOnly` | el catálogo Modelo gobierna el código | Bloquea control | V1/V2 configurado | G0 |
| INV-032 | UI | `⚠ {valor} — ya no existe, elige otro` | valor histórico huérfano | Advierte/exige reemplazo si requerido | V1/V2 | G1 |
| INV-033 | Borrar | `El producto tiene una liquidación pendiente; espera su confirmación` | conflicto de liquidación | Bloquea | V1 | G0 |
| INV-034 | Borrar | `Producto eliminado` | baja local aceptada | Informa | V1 accesible | G4 por ausencia de confirmación/semántica histórica |
| INV-035 | Etiquetas | `No hay productos para etiquetar` | filtro vacío | Bloquea acción | V1/V2 | G0 |
| INV-036 | Importar | `El archivo no contiene productos para importar` | resultado sin filas | Bloquea | V1/V2 | G0 |
| INV-037 | Importar | `No se pudo leer el archivo Excel` | error no BALAM | Bloquea | V1/V2 | G1 |
| INV-038 | Importar | `Importación bloqueada: {n} conflicto(s). No se modificó el inventario.` | plan con conflictos | Bloquea | V1/V2 | G0 |
| INV-039 | Importar | `{n} nuevos · {n} actualizados` | aplicación correcta | Informa | V1/V2 | G0 |
| INV-040 | Importar | `No se pudo aplicar la importación; no se modificó el inventario` | commit falla | Bloquea | V1/V2 | G0 |
| INV-041 | Importar | `El ID {id} es V1/V2 ... Excel no convierte modelos de referencia.` | mismatch de recordModel | Bloquea | V1/V2 | G0 |
| INV-042 | Importar | `La fila intenta cambiar la identidad física de una referencia que tiene o tuvo existencias u operaciones. Los datos comerciales sí pueden actualizarse; los atributos físicos requieren un flujo de reclasificación.` | preview detecta firma distinta + evidencia | Bloquea | V2 | G0 regla / G1 flujo sin UI |
| INV-043 | Importar | `El código logístico {code} ...` duplicado/ambiguo | barcode repetido | Bloquea | V2 | G0 |
| INV-044 | Importar | `SKU_DUPLICATE_WARNING: ... se conservarán separadas por ID y barcode.` | SKU compartido | Advierte | V2 | G0 |
| INV-045 | Importar | `La importación tiene conflictos; no se modificó el inventario.` | se intenta aplicar plan inválido | Bloquea | V1/V2 | G0 |
| INV-046 | Importar | `El inventario cambió mientras revisabas la importación. Vuelve a abrir el archivo.` | fingerprint cambió | Bloquea | V1/V2 | G0 |
| INV-047 | Escritura local | error de lease/escritor local | dispositivo no tiene autoridad de escritura | Bloquea | V1/V2 | G0 |
| INV-048 | Permisos | sin mensaje de campo | el permiso opera a nivel de pantalla/ruta; no hay gates distintos por atributo | Bloquea pantalla | V1/V2 | G0/G1 |

Además, el lector Excel bloquea archivo inválido/vacío, >10 MB, exceso de hojas/filas/columnas/celdas, esquema/versión incompatible, hojas o columnas técnicas ausentes, talla interna desconocida/duplicada y mapa técnico incoherente. Son G0 y ocurren antes de abrir/aplicar el preview.

## 10. Clasificación consolidada de guardas

| Guarda | Clase | Veredicto |
|---|---|---|
| required fields, tallas válidas, colores requeridos, solapes | G0 | integridad necesaria |
| ID/barcode/modelo V2 inmutables | G0 | identidad logística/histórica |
| firma duplicada | G0 | evita dos IDs para la misma referencia |
| firma física + stock/documento | G0 | protege piezas e historia |
| mensajes anteriores “ya tiene operaciones” (formulario/Excel) | G1 | regla correcta, causa falsa; corregidos |
| recomendar Reclasificar sin UI | G1 | flujo incompleto; diseño pendiente |
| candado después de volver stock a 0 sin documentos | G2 | conservador, decisión de negocio |
| trigger bloquea cualquier diferencia de `attrs` | G2/G4 | más amplio que firma CONFIG |
| V1 permite mutar identidad histórica y V2 no | G3 aparente, pero justificada arquitectónicamente | V1 es compatibilidad legacy, no patrón deseado |
| préstamos: cliente sí, trigger no directo | G4 potencial | autoridades divergentes |
| Editar V2 descartaba Corte/Características | G4/P1 | bug confirmado y corregido H-115 |
| familia mixta + “Usar valor general” sin autoridad común | G1/G2 | ahora no borra; semántica final pendiente |
| eliminar V1 sin confirmación y V2 sin acción exacta | G4/H-114 | HARD STOP de negocio |

## 11. Casos de prueba funcionales

| Escenario | Física | Comercial/visual | Stock/precio | Observación |
|---|---|---|---|---|
| V2 virgen stock 0 | permite si no colisiona | permite | permite | ahora Corte/Características llegan a DATA |
| V2 con venta histórica | bloquea | permite | permite | venta cerrada también cuenta |
| V2 con movimiento | bloquea | permite | permite | cualquier movimiento por ID |
| V2 con cambio/devolución | bloquea | permite | permite | sin filtro de estado |
| V2 con préstamo/apartado activo | bloquea | permite | permite | préstamo cliente; apartado vía sales |
| V2 stock 0 pero candado true | bloquea | permite | permite | candado monotónico |
| V2 stock > 0 | bloquea | permite | permite | no necesita documento |

## 12. Comparación operativa V1 ↔ V2

| Acción | V1 | V2 | Diferencia | ¿Justificada? | Impacto operativo |
|---|---|---|---|---|---|
| Cambiar atributos físicos históricos | permite | bloquea con evidencia | V2 congela identidad | Sí | V1 puede reinterpretar historia |
| Editar nombre/foto/precio/costo/POP | permite | permite | ninguna relevante | Sí | flujo normal |
| Cambiar talla/familia | editor legacy con confirmación | crear referencia nueva; talla existente fija | entidad diferente | Sí | más pasos, identidad exacta |
| SKU duplicado | puede ser ambiguo | advierte; ID/barcode separan | V2 desacopla logística | Sí | reduce ambigüedad |
| Barcode | acoplado/legacy | único e inmutable | autoridad exacta | Sí | posventa segura |
| Alta | una fila con stock por tallas | una referencia por combinación/talla agrupada en familia | mayor granularidad | Sí | mejor trazabilidad |
| Reclasificar | no existe como ledger de identidad | autoridad existe sin UI | V2 incompleto | Parcial | operación necesaria no accesible |
| Eliminar | visible e inmediato | oculto en proyección | semántica no resuelta | No demostrado | H-114 |

## 13. Matriz Codex ↔ Opus

| Hallazgo | Codex | Opus | Reproducción | Veredicto | Severidad | Corrección segura | Decisión negocio |
|---|---|---|---|---|---|---|---|
| Corte/Características se pierden | no detectado inicialmente | afirmado | 13/13 pre-fix publicados; E2E rojo formal | CONFIRMADO | P1/G4 | sí, H-115 | no |
| mensaje “operaciones” exacto | detectó causa amplia | señaló flujo | stock sin docs reproduce | CONFIRMADO | G1 | sí, texto | no |
| sacar Corte/Características de identidad | no recomendado | posible lectura | datos reales: 0 colisiones actuales, 150 firmas afectadas | NO DEMOSTRADO | Alto | no | **sí, HARD STOP** |
| cliente vs trigger | detectó divergencia | no central | inspección ejecutable/SQL | CONFIRMADO | G2/G4 | no sin contrato | sí |
| candado permanente es bug | lo clasificó conservador | cuestionado | stock→0 sigue lock | PARCIAL | G2 | no | sí |
| Reclasificar está disponible | detectó autoridad | detectó cero callers | búsqueda + prueba de función | RECHAZADO como flujo UI; CONFIRMADO como API | G1 | diseño solamente | sí |
| V1/V2 eliminan igual | cuestionado | no equivalencia | `isFamilyProjection` oculta botón | RECHAZADO | G4/H-114 | no | **sí, HARD STOP** |
| V2 debe abandonarse | no | no | arquitectura e integridad verificadas | RECHAZADO | — | mantener V2 | no |

## 14. Decisión recomendada

Elegir **B: mantener V2 y corregir sus guardas/flujo de manera dirigida**.

- H-115 y el mensaje falso son correcciones seguras.
- No volver las altas a V1: V1 oculta el problema permitiendo reescribir identidad histórica.
- Próximas decisiones separadas: (1) semántica de Corte/Características; (2) paridad CONFIG/trigger/préstamos; (3) UI de reclasificación; (4) baja H-114.
- Hasta resolverlas, los campos comerciales/visuales continúan editables y los físicos requieren conservar el ID histórico y crear/mover hacia una referencia correcta.
