# Convergencia de inventario y conservación de la cola

**Riesgo:** H-142
**Estado:** RECUPERACIÓN EN NUBE APLICADA — cliente y equipos pendientes de verificación
**Fecha:** 05/09/2026
**Commit de implementación:** `0fa6810`
**Commit S11:** `9ea9142`.
**Commit S12/S13:** `a26701d`.

## Problema y reproducción

Auditoría del artefacto `c2b042e`: sucursal 253 familias/977 referencias/3502
unidades; laptop y fotografía remota 250/969/3556. Ocho referencias ausentes en
nube incluso entre eliminados; 77 referencias comunes difieren en stock y 74
de ellas tienen igual versión. La sucursal es la autoridad de negocio indicada.
Evidencia original preservada fuera del repositorio en
`../BALAM-sync-evidence-20260905/INFORME.md` (relativa a Downloads).

## Causa raíz

S13: el mismo navegador con la cola real de sucursal (62 operaciones, 2.06M
caracteres) falla con `QUARANTINE_STORAGE_UNAVAILABLE`: duplicar cola y archivo
en localStorage excede la cuota junto al inventario. Conserva los pendientes,
pero impide completar recuperación. Debe reutilizar el IndexedDB de respaldo
existente para archivos grandes y adaptar lectura/reporte/resolución de archivo;
no quitar pendientes antes de confirmar almacenamiento durable.

Corrección S13: archivos conservan formato; respaldo en el mismo objectStore
IndexedDB bajo su clave de cuarentena si localStorage no alcanza. Lectores unen
ambos almacenes, priorizan IDB y esperan todas las operaciones asíncronas.
Reporte, restauración y resolución siguen funcionando tras recarga. La cola
activa sólo se retira tras confirmar el archivo; abortos también fallan cerrado.

S12 (recuperación real, 05/09): navegador aislado con respuesta remota capturada
de ocho ventas y la purga histórica del 10/08 termina con cero ventas y
`synchronized=true`. `DOMAIN_ORDER` aplica `purges` después de descargar ventas,
pagos y comisiones; `applyRemotePurge` borra esa proyección recién confirmada
cuando la marca local aún no existe. Debe aplicar la invalidación destructiva
antes de reconstruir dominios comerciales. Evidencia: arnés externo
`verify-recovered-browser.cjs`, rama c79a14b, sin escrituras reales.

Corrección S12: purga antes de dominios comerciales; elimina cursores de las
proyecciones que modifica y las invalida incluso si su versión no cambió. Ventas
sin cursor se reconstruyen con snapshot completo, preservando históricos fuera
de la ventana normal. Si falla una descarga, el cursor ausente queda persistido
y el estado no declara sincronización completa.

S01: cola leída antes de esperar telemetría y guardada después pierde capturas.
S02/S03: temporizador omite reconciliar con canal suscrito y no reintenta envíos.
S04: protección del pull limitada a una cuenta sobre una caché compartida.
S05/S06: incompatibilidad detiene latidos y flota omite comparar versiones.
S07: versión base+1 no acredita que el contenido enviado haya sido aceptado.
S08: recuperación confirma versiones leídas después de descargar datos viejos.
S09: Inventario no escucha eventos de cambio de productos.
S10: heartbeat durante reconciliación envía nulo y SQL borra confirmación anterior.
La participación de cada defecto en cada edición real no está demostrada.

S11 (respaldo recibido el 05/09): la simulación transaccional de recuperación
falla en `commit_exchange_checked` con `V2_LINE_IDENTITY_REQUIRED`. El artículo
devuelto apunta al ID y línea originales; su barcode de 16 caracteres coincide
con el documento fuente y un alias del producto V2 actual. La traducción H133
sólo contemplaba V1 y dejaba sin traducir este alias histórico V2. S11 añade una
sobrecarga interna con folio de origen: exige una única línea fuente del mismo
folio, producto, talla y alias. Conserva estrictas las entregas nuevas y el
documento fuente. Reintentos ya confirmados conservan su hash histórico mediante
los delegados existentes, antes de intentar la traducción actual.

## Diseño

Conservar el protocolo vigente y autoridades STORE/DATA/SQL. Cola primero;
retiro exacto sobre el estado actual. Un pendiente de cualquier sesión protege
la caché compartida, pero sólo su autor puede enviarlo. Confirmar contenido y
versión de la escritura; conservar la primera escritura y el manejo existente
de conflictos. Reconciliar periódicamente, con compuertas y frescura explícita.
Recuperación confirma únicamente versiones cuyos datos aplicó. La UI escucha
el evento existente. La fecha SQL conserva su último valor no nulo.

Matriz de ciclo: guardar → persistir → enviar → confirmar/rechazar → retirar
entrada exacta → recibir → proyectar → recargar → eliminar bajo las guardas
existentes. V1 y V2 comparten este circuito; identidad, etiquetas, Excel,
comisiones y RPC de venta/posventa no cambian de autoridad.

## Solución

STORE retira una confirmación sobre la cola actual después de la telemetría.
El primer payload enviado de productos queda durable en `submittedRows`; una
edición posterior no lo reemplaza y un reintento conserva operación y contenido.
DATA comprueba versión y contenido normalizado de la respuesta antes de aceptar;
el marcador transitorio no se persiste. Los conflictos conservan las ediciones
posteriores afectadas como bloqueadas, sin reconstruirlas desde la fila rechazada.

El ciclo de 60 segundos reintenta y reconcilia incluso con Realtime suscrito.
Respeta sesión escritora, visibilidad, conectividad y recuperación. Los pendientes
de todas las sesiones protegen la caché, pero cada cuenta sólo envía los propios.
Compatibilidad se revisa antes de escribir y al reconciliar; un cliente fuera de
protocolo mantiene diagnóstico sin descargar la nube sobre su copia local.

Sincronizado exige lectura de versiones reciente, cursores vigentes, compatibilidad,
ausencia de pendientes de todo el equipo y finalización de la reconciliación.
La flota cruza contacto, protocolo, época, cursores y última confirmación, y la
interfaz no convierte por sí sola `0 pendientes` en `Sincronizado`.

Recuperación obtiene exclusión antes de esperar escrituras/reconciliaciones,
conserva capturas durante esperas y sólo confirma las versiones anteriores a
los snapshots aplicados; vuelve a reconciliar cambios recibidos durante descarga.
Inventario escucha `datachange` y `configchange`, conservando borradores abiertos.
El heartbeat final ocurre después de liberar la promesa de reconciliación.
`report_sync_device` conserva la última fecha no nula sin modificar ACL o retiro.

No cambia identidad V1/V2, catálogo, precios, existencias, documentos, reglas de
venta/posventa ni protecciones de baja. Los HTML y service worker se regeneraron
exclusivamente con `node build-offline.mjs`.

## Pruebas

Sobre `c2b042e`, la regresión de fuente falla 8/8 y navegador falla 3/4 (recarga
era control verde). La verificación SQL anterior falla por pérdida de fecha.
QA independiente inicial falla 4/4 antes de las correcciones.

| Verificación ejecutada | Resultado final |
|---|---|
| H142 fuente: cola, polling, sesiones, protocolo, flota, recuperación, fecha | 8/8 |
| H142 navegador con DATA/STORE reales | 4/4 |
| H142 carreras: protocolo, recuperación, captura, conflicto, confirmación perdida | 5/5 |
| BALAM QA navegador V1/V2, 320/1280, borrador, cancelación, recarga, overflow | 22/22 |
| Cola / concurrencia / contratos de módulos | 186/186; 15/15; 42/42 |
| H95 escritura / H77 sync / H80 convergencia / H125 atención | 16/16; 20/20; 7/7; 10/10 |
| Apartados H65 / cambios commit / modelo cambios | 35/35; 36/36; 28/28 |
| Comisiones H69 / familia H101 / tallas mixtas H101 | 95/95; 26/26; 10/10 |
| Baja H114 / préstamos / coherencia de venta / devoluciones | 13/13; 69/69; 20/20; 21/21 |
| Roles / migraciones / smoke bundle / navegación / build reproducible | 15/15; 31/31; 17/17; 15/15; 8/8 |
| SQL H142 PGlite y verificación transaccional remota | Aprobadas |
| S11 SQL: alias, folio, talla, identidad, V1, documento fuente y acceso | 16/16 |
| S11 QA independiente: idempotencia histórica y canónica return/exchange | 22/22 |
| Recuperación completa, dos replays por operación, rollback y hashes | Aprobada |
| S12 purga/recuperación: rojo anterior 7/15; verde | 15/15 |
| S13 archivo: cuota, recarga, resolución, fallo/aborto IndexedDB | 9/9 |
| Navegador con captura remota recuperada: laptop/sucursal/almacenamiento fallido | 3/3 |
| Regresión S12/S13 cola, H77, H80, H68, H113 y build | 186/186; 20/20; 7/7; 53/53; 35/35; 8/8 |

Fixtures de cola se actualizan al contrato de caché compartida; concurrencia
usa protocolo vigente. Contratos de módulos corrige una aserción literal obsoleta
de desestructuración de UI. No se retiran pruebas para ocultar fallos.

QA usó perfiles sintéticos y red interceptada: no certifica todavía equipos
físicos ni la recuperación de transacciones reales. Revisión independiente
también verificó un lote mixto aceptado/conflictivo y edición posterior del ID
aceptado, sin bloqueo indebido.

Repetición: `node test-h142-sync-convergence.mjs`,
`node test-h142-sync-browser.mjs`, `node test-h142-qa-races.mjs` y
`node test-h142-qa-browser.mjs`. SQL requiere `@electric-sql/pglite` instalado
o `BALAM_PGLITE_MODULE` apuntando a su módulo, luego
`node test-h142-sync-sql.mjs`. Los arneses no requieren conexión productiva.
S11: `node test-h142-historical-replay-sql.mjs` y
`node test-h142-historical-idempotency.mjs`, con la misma dependencia PGlite.
S12/S13: `node test-h142-purge-recovery.mjs` y
`node test-h142-quarantine-storage-browser.mjs`. El último usa Chrome/IndexedDB
reales y DATA/RPC sintéticas explícitas; el ensayo externo usa bundle completo y
filas remotas capturadas, sin acceso a perfiles ni sesiones de terminales reales.
Una corrida paralela de cola falló en el timeout fijo de 30 ms del caso PGRST301;
repetida sola, sin modificar código ni prueba, pasó 186/186. Riesgo del arnés bajo carga.
`BALAM_QA_SOURCE_REF=c2b042e` selecciona la fuente anterior en QA de carreras;
usar la referencia explícita, pues HEAD contiene la corrección.

## Despliegue y evidencia

Aplicadas en Supabase las migraciones `20260905017800` y `20260905017900`.
La segunda ejecuta el contrato real con fixture transaccional revertido. Se
comprobaron fecha nula/nueva, retiro, conteos inválidos y denegación anónima.
Postflight: cero fixtures, ACL/owner/search_path conservados, y hash completo
de productos idéntico antes/después: `6fbe2d5b9223f2970b68162e4618529b`.
Rollback de código SQL: restaurar la expresión anterior de asignación de fecha;
no necesita transformar datos comerciales.

También aplicadas `20260905018000` y `20260905018100`: compatibilidad de alias
históricos atestados y verificación. La sobrecarga interna no tiene permiso de
ejecución para anon/authenticated; los wrappers conservan sus permisos y sus
comprobaciones de capacidad. SQL probado antes con rollback real, después con
la verificación de despliegue. Rollback funcional: restaurar los dos wrappers
previos; la sobrecarga interna puede permanecer sin consumidores. Ninguna fila
comercial fue modificada por estas migraciones.

El frontend NO se publica sobre main/Pages mientras la nube esté incompleta.
Bundle final verificado SHA256:
`5d6494af80bb3965cee95c3a653f60bbbb261988d4050fcffb13d09745e1c40d`.
Cambios aislados en `fix/h142-sync-convergence`; árbol original ajeno preservado.
Evidencia en `../BALAM-sync-fix-evidence-20260905`: logs, capturas, SQL pre/post,
`recovery-preview.json` y `Recuperacion propuesta H142.xlsx`.
La propuesta incluye 8 filas exportadas completas, 77 ajustes de stock con
precondiciones de versión y las diferencias de las 89 filas comunes afectadas.
La ejecución se dividió: primero la retirada autorizada de las dos ventas y,
tras la instrucción posterior de continuar, la conciliación contra el nuevo estado.
No se eliminó producto alguno.

Snapshot remoto de campos de inventario, catálogo y configuración capturado
a las 20:24:26 UTC del 05/09/2026. Excluye medios y NO respalda todos los
documentos comerciales/colas de sucursal. El intento previo de respaldo amplio
falló por timeout HTTP 524; su archivo vacío no constituye respaldo.

## Riesgo residual y pendientes

Recibido `balam-recuperacion-1788640958193.json` (20:42:38 UTC), hash SHA256
`094fa006b489329b0bd1823f059dafa7404eb8e4cef0e9a60db54f255c2621e5`.
Confirma 253/977/3502 y 62 pendientes: 54 lotes de productos, tres ventas,
una devolución, un cambio, clientes, promociones y configuración. Las ocho
referencias faltantes sí están protegidas en esa cola. Los snapshots de los
lotes son de fechas distintas; no se deben reenviar como existencias finales.

El usuario autorizó reactivar este equipo; se aplicó la RPC administrativa
existente y quedó `must_rebootstrap`. También confirmó que las dos ventas
remotas adicionales por 3550 y 1250 son pruebas. En una autorización posterior
limitó expresamente la ejecución a eliminar esas dos ventas; ya se ejecutó esa
retirada y la reversa de sus efectos, sin la conciliación general.

Preparada conciliación exacta: respaldo de esas dos ventas y sus hijos; reversa
de cuatro piezas, dos ventas/4800/240 de comisión y un acumulado de cliente;
lápidas por operation_id, conservando el perfil y las cinco ventas reales.
No usa H113/H68 global ni altera consecutivos. Incorpora dos clientes nuevos,
dos promociones y dos entradas de catálogo; el resto de configuración coincide
semánticamente. Prepara 3508 unidades antes de las cinco operaciones comerciales,
que producen -6 unidades. Resultado verificado: 253 familias, 977 referencias,
3502 unidades, ocho ventas, nueve pagos, una devolución, un cambio, 15 movimientos.
El vendedor afectado termina en 5725, tres ventas y 325.75 de comisión.

La simulación completa ejerció las RPC reales y cada replay dos veces. Conservó
las cinco ventas anteriores por hash y no duplicó stock, pagos ni comisiones.
Después del rollback, hashes de productos, ventas, líneas, pagos, movimientos,
vendedores y clientes son idénticos. El SQL de aplicación preparado usa una
única transacción y aborta entera ante cualquier error o precondición distinta;
no contiene el manejo de errores que permite continuar una simulación.

El 05/09/2026 a las 21:18 UTC se aplicó exclusivamente la retirada autorizada:
dos ventas, cuatro líneas, dos pagos, cuatro movimientos, dos commits y dos
reservas. Se restituyeron cuatro piezas en tres referencias y se revirtieron
4800/2/240 del vendedor y 1250/1 del cliente, preservando ambos perfiles.
Cinco ventas reales conservadas por hash; productos ajenos a esas tres referencias,
líneas/pagos/movimientos ajenos y demás clientes idénticos por hash.
Dos marcas por operación impiden reintentar esas ventas como altas nuevas.
Postflight remoto separado: cinco ventas, cinco pagos y cinco movimientos;
inventario 250 familias/969 referencias/3560 piezas. No equivale al inventario
final de sucursal. Scripts `authorized-test-cleanup-*` y recibos privados en
la carpeta de evidencia. La prueba previa usó exactamente el mismo SQL con
ROLLBACK; aplicación con COMMIT, precondiciones completas y bloqueos breves.

Tras la instrucción «continua», se preparó y aplicó la conciliación general contra
una nueva captura, sin repetir la retirada. `authorized-recovery-simulation.sql`
ejerció cada operación dos veces; `authorized-recovery-dry-run.sql` probó el
candidato exacto con ROLLBACK. `authorized-recovery-apply.sql` se aplicó con COMMIT
y precondiciones de inventario, ventas, líneas, pagos, movimientos, clientes y
vendedores. La transacción protege también todos los atributos existentes de
productos salvo existencias y metadatos de sincronización: no cambia identidad,
SKU, barcode, fotos, precio, costo ni variantes históricas.

Postflight independiente: las 977 existencias por ID coinciden exactamente con
el JSON autorizado; 253 familias, 3502 piezas, ocho ventas, nueve pagos, una
devolución, un cambio y 15 movimientos. Las cinco operaciones pendientes tienen
sus commits originales. Datos en `recovery-postflight-inventory.json` y
`recovery-postflight-commercial.json`.

La misma transacción avanzó la época 6→7 mediante el manifiesto existente y
marcó los equipos no retirados para rebootstrap. La guardia SQL rechaza época 6
y acepta 7, verificado antes del COMMIT. Así los 54 snapshots históricos no
pueden reemplazar existencias conciliadas. No borra colas de terminales; el
rebootstrap existente exige exportarlas y las archiva para revisión. Los equipos
retirados conservan su estado. La propuesta combinada anterior quedó SUPERADA.
Archivos de la propuesta histórica, conservados para auditoría:
`targeted-test-cleanup-plan.json`, `recovery-stock-plan.json`,
`recovery-apply-AWAITING-APPROVAL.sql` y `recovery-final-dry-run.json`.
Informe revisable: `RECUPERACION-VALIDADA.md`; huellas en
`recovery-plan-manifest.json`. El archivo final también se ejerció cambiando
únicamente COMMIT por ROLLBACK; hashes completos posteriores idénticos.
Pendiente: publicar cliente y reconstruir equipos preservando
y archivando sus colas, comprobar datos y cursores reales. Otros equipos pueden
conservar operaciones únicas; no descartar ninguna cola sin revisarla.
Ensayo de recuperación en Chrome: laptop y sucursal coinciden en 253/977/3502,
ocho ventas y cero pendientes activos; sucursal conserva las 62 operaciones en
archivo IndexedDB. Ambos mantienen inventario tras recarga. Fallo simultáneo de
ambos almacenes mantiene las 62 operaciones activas. No demuestra que equipos
físicos ya hayan descargado el nuevo cliente o actualizado sus copias.
Falta identificar inequívocamente los dos productos agotados mencionados antes
de ejercer sus bajas reales. No se declara H142 resuelto ni ausencia de errores.

## Referencias

- `docs/03-known-risks.md#h-142`
- `docs/architect/playbooks/synchronization.md`
- `docs/architect/decisions/ADR-014-autoridad-confirmada-cola-y-cache.md`
