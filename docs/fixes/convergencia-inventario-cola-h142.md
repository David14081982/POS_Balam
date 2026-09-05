# Convergencia de inventario y conservación de la cola

**Riesgo:** H-142
**Estado:** PARCIALMENTE RESUELTO — código verificado; recuperación y publicación del cliente pendientes
**Fecha:** 05/09/2026
**Commit de implementación:** `0fa6810`

## Problema y reproducción

Auditoría del artefacto `c2b042e`: sucursal 253 familias/977 referencias/3502
unidades; laptop y fotografía remota 250/969/3556. Ocho referencias ausentes en
nube incluso entre eliminados; 77 referencias comunes difieren en stock y 74
de ellas tienen igual versión. La sucursal es la autoridad de negocio indicada.
Evidencia original preservada fuera del repositorio en
`../BALAM-sync-evidence-20260905/INFORME.md` (relativa a Downloads).

## Causa raíz

S01: cola leída antes de esperar telemetría y guardada después pierde capturas.
S02/S03: temporizador omite reconciliar con canal suscrito y no reintenta envíos.
S04: protección del pull limitada a una cuenta sobre una caché compartida.
S05/S06: incompatibilidad detiene latidos y flota omite comparar versiones.
S07: versión base+1 no acredita que el contenido enviado haya sido aceptado.
S08: recuperación confirma versiones leídas después de descargar datos viejos.
S09: Inventario no escucha eventos de cambio de productos.
S10: heartbeat durante reconciliación envía nulo y SQL borra confirmación anterior.
La participación de cada defecto en cada edición real no está demostrada.

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

El frontend NO se publica sobre main/Pages mientras la nube esté incompleta.
Bundle final verificado SHA256:
`b0460c9e1c5cb909936193c7da366d2a35d6ed45275f59baeb0ee5a3a59b2173`.
Cambios aislados en `fix/h142-sync-convergence`; árbol original ajeno preservado.
Evidencia en `../BALAM-sync-fix-evidence-20260905`: logs, capturas, SQL pre/post,
`recovery-preview.json` y `Recuperacion propuesta H142.xlsx`.
La propuesta incluye 8 filas exportadas completas, 77 ajustes de stock con
precondiciones de versión y las diferencias de las 89 filas comunes afectadas.
No se aplicó ningún ajuste de negocio ni se eliminó producto alguno.

Snapshot remoto de campos de inventario, catálogo y configuración capturado
a las 20:24:26 UTC del 05/09/2026. Excluye medios y NO respalda todos los
documentos comerciales/colas de sucursal. El intento previo de respaldo amplio
falló por timeout HTTP 524; su archivo vacío no constituye respaldo.

## Riesgo residual y pendientes

Falta el JSON de recuperación actual de los equipos de sucursal que conservan
información única. Excel no contiene cola, ventas ni claves de idempotencia.
Aplicar sus existencias y luego repetir ventas podría descontar dos veces.
Un snapshot completo de nube también retira referencias locales sin operación
durable; la corrección previene nuevas pérdidas, no reconstruye colas ya perdidas.
Por ello se detiene despliegue del cliente conforme a WORKFLOW, condición 3:
producción puede provocar pérdida de datos. No se solicita permiso para ignorarla.

Continuación: preservar esos JSON; cruzar operaciones con commits reales y sus
hashes; resolver aplicadas/pendientes/conflictivas antes de ajustar existencias;
releer versiones y abortar ante cambios; recuperar por IDs exactos respetando
identidad, catálogo e históricos; publicar cliente y comprobar cada equipo.
253/977/3502 corresponde al Excel fechado, no es objetivo fijo si hubo nuevas
ventas. Falta confirmar identidad de los dos productos agotados mencionados y
ejercer su baja una vez recuperados, manteniendo las guardas de negocio.
No se declara H142 resuelto ni ausencia absoluta de errores.

## Referencias

- `docs/03-known-risks.md#h-142`
- `docs/architect/playbooks/synchronization.md`
- `docs/architect/decisions/ADR-014-autoridad-confirmada-cola-y-cache.md`
