# Eliminación selectiva: recuperación del botón y alcance

**Riesgo:** H-157
**Estado:** PARCIALMENTE RESUELTO — integración local validada; push y publicación pendientes, sin certificación real A/B/C.
**Fecha:** 11/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario selecciona categorías en Administración / Datos y no puede continuar.
Solicita diagnóstico y solución; además pide eliminar la denominación «datos de
prueba» porque el sistema no clasifica cada documento como prueba o real.
Alcance inicial: auditar este flujo, sin borrar datos ni publicar. Después el
usuario autorizó corregirlo de forma quirúrgica y limitó la validación a una
prueba por cada uno de los cuatro grupos propuestos. La auditoría inicial se
conserva debajo; la implementación y las cuatro pruebas figuran al final.

Se recorrió el HTML distribuido local con Chrome/Playwright, perfil independiente
y todo tráfico externo bloqueado. Se ejecutó la función original
`STORE.previewTestDataCleanup`, extraída sin cambios de `balam/store.jsx`, con
dependencias de transporte, sesión y estado controladas. No equivale a ejecutar
el coordinador completo ni a consultar Supabase real.

| Caso | Resultado observado |
|---|---|
| Ocho casillas marcadas, preview listo | Botón habilitado: los checkboxes sí funcionan |
| Ocho casillas marcadas durante sincronización; después estado listo | Sigue deshabilitado, conserva «Espera a que termine» y no vuelve a consultar: 2 llamadas antes y 2 después |
| Bloqueo remoto que desaparece | Conserva el motivo antiguo: 1 llamada antes y 1 después |
| Consulta falla; transporte vuelve a responder | Conserva error y botón deshabilitado: 1 llamada antes y 1 después |
| Desmarcar y volver a marcar después de recuperarse | Consulta otra vez y habilita el botón |
| Pulsar Actualizar diagnóstico en Punto Cero | También lo recupera, indirectamente y conservando selección |
| Preview con dos motivos bloqueantes | Sólo muestra el primero; omite el segundo |

Los eventos de recuperación emitidos fueron `syncstatuschange`,
`syncactivitychange`, `syncfleetchange`, `online`, `focus` y `datachange`.
Se esperó más que los 180 ms del debounce. Las solicitudes y el estado DOM
antes/después están conservados en la evidencia. Las recuperaciones sólo
revisaron la selección: cero respaldos y cero ejecuciones de limpieza.

La captura del usuario no muestra el botón, su aviso ni la respuesta de preview.
Por tanto, se confirmó un defecto reproducible capaz de producir el síntoma;
no se atribuye sin evidencia la condición específica de su terminal a esta causa.

## Causa raíz

### H-157-A — Diagnóstico obsoleto bloquea el flujo (ALTO)

`SelectiveCleanupCard`, `balam/settings.jsx:2035`, guarda el preview en estado.
Su efecto (`:2059`) depende únicamente de `enabled` y la selección serializada.
No escucha la recuperación de sincronización, conectividad ni riesgo de flota.
El botón (`:2299`) depende del `preview.ready` almacenado.

`balam/store.jsx:3786` obtiene el plan SQL y calcula la preparación local una sola
vez por llamada: `executable && synchronized && pending===0 && blocked===0 &&
!activity.active`. El resultado no se actualiza solo cuando cambia STORE.
Los eventos sí existen (`store.jsx:60`, `core.jsx:74`); la tarjeta no los consume.

Esto explica causalmente que el plan sea ahora ejecutable y el botón permanezca
bloqueado hasta otra consulta. El texto «Espera a que termine» no corresponde a
una recuperación implementada en esta tarjeta.

### H-157-B — Error sin reintento directo (MEDIO)

La consulta fallida elimina el preview (`settings.jsx:2056`). El aviso solicita
actualizar la revisión (`:2203`), pero la única acción de la tarjeta es Continuar,
que exige un preview listo (`:2298`). No existe ahí una acción independiente
para volver a consultar con las mismas casillas.

Sí existe un camino indirecto: `AdminDataPanel.refresh` (`:1805`) pone a null
el diagnóstico de Punto Cero y después lo repone. Esto cambia `enabled`
false→true y dispara el efecto del componente hijo. La hipótesis inicial de
que ese botón no ayudaba fue refutada por la prueba; se conserva como
alternativa temporal, no se presenta como un defecto adicional.

### H-157-C — Motivos incompletos (MEDIO)

`settings.jsx:2175` traduce todos los `blocked_reasons`, pero `:2186` usa sólo
`blockingMessages[0]`, salvo dos códigos prioritarios. No renderiza la lista.
Con existencias negativas y un cliente antiguo simultáneos, la UI sólo informó
las existencias negativas. Además, cualquier `client_ready=false` se presenta
como «todavía está sincronizando», aunque `STORE.syncStatus` también puede
representar incompatibilidad, conflicto o fallo de persistencia (`store.jsx:3335`).
Esta última clasificación se comprueba por camino de código, no por una
reproducción de cada fallo real de almacenamiento.

### H-157-D — Nombre y contrato comunicado no coinciden (MEDIO)

El plan SQL vigente, migración
`20260909019600_pos_h152_exchange_payment_cleanup.sql:94`, selecciona todos los
documentos por los booleanos de categoría. No exige una marca «de prueba».
Clientes (`:102`) selecciona no genéricos activos sin ventas conservadas;
no identifica clientes de prueba. El mensaje «BALAM está utilizando datos de
prueba» (`settings.jsx:1829`) sólo se deduce del modo global preproduction.
Ese modo no acredita la procedencia de cada registro.

El motor sí conserva un bloqueo independiente en modo production (`SQL :217`
y `:378`), y la UI depende del diagnóstico de Punto Cero para conocer el modo
(`settings.jsx:1831`). Renombrar la pantalla no elimina estas dos condiciones.

## Diseño de la solución

1. **Contrato visible:** sección «Eliminar datos por categoría»; grupo «Clientes»;
   texto «Se eliminarán todos los registros de las categorías seleccionadas y
   sus dependencias indicadas en el resumen». Eliminar la afirmación de que
   preproducción identifica datos de prueba. No crear filtros por nombres,
   fechas ni una clasificación ficticia de prueba/real.
2. **Revisión recuperable:** consumir las transiciones relevantes de estado y
   conectividad, invalidar el diagnóstico obsoleto y solicitar uno nuevo para
   la selección vigente. Añadir «Revisar de nuevo» dentro de esta tarjeta,
   disponible también después de error, sin depender de Punto Cero.
3. **Evitar bucles:** no consultar en cada evento indiscriminadamente; el
   propio preview reconcilia y emite eventos. Comparar estado relevante,
   agrupar solicitudes y cancelar/ignorar respuestas de selecciones antiguas.
   No modificar automáticamente un resumen ya confirmado en el asistente.
4. **Explicación completa:** mostrar cada bloqueo accionable, datos/documentos
   afectados y siguiente acción. Distinguir «calculando», «sin conexión»,
   «sin registros», «pendiente de sincronización», «requiere intervención» y
   «listo». Reservar el aviso de espera para condiciones recuperables así.
5. **Alcance exacto:** conservar productos y configuración en la herramienta
   selectiva; revertir los efectos de las operaciones en existencias y
   recalcular saldos. Ventas incluye sus pagos, devoluciones/cambios dependientes
   según el plan. Clientes con referencias conservadas requieren explicar su
   dependencia; no prometer borrarlos ignorando documentos retenidos.
6. **Modo de operación:** si el contrato solicitado es una herramienta
   administrativa permanente también en producción, separar su disponibilidad
   de Punto Cero y actualizar explícitamente las guardas de cliente y SQL
   mediante migración nueva. Es una modificación del contrato de disponibilidad,
   no un cambio de nombre. Conservar administración activa, capacidades y RLS.
7. **Defensas:** mantener respaldo ligado al hash, nueva validación al confirmar,
   transacción, idempotencia, control de época y prevención de resurrección
   desde colas. Recuperar una revisión nunca ejecuta borrado ni crea respaldo.

La corrección mínima del bloqueo vive en `balam/settings.jsx`, con una
proyección precisa del estado de `balam/store.jsx`. El alcance SQL ya es por
categorías: no requiere agregar un motor de borrado distinto. Sólo la extensión
a modo producción exigiría cambiar ese contrato servidor.

## Solución integrada

La corrección previa sobre H152 se integró sobre H155 modificando únicamente
`balam/settings.jsx` como fuente funcional de esta corrección:

- La tarjeta se titula **Eliminar datos por categoría**, muestra **Clientes**
  y comunica todos los registros seleccionados y sus dependencias. El aviso
  del modo ya no afirma que cada documento sea de prueba.
- Añade **Revisar de nuevo**, disponible tras errores y con las mismas casillas.
- Escucha cambios de estado, actividad, flota, datos, conexión, foco y visibilidad.
  Agrupa revisiones a 180 ms y compara preparación, época y cursores sin fechas
  de heartbeat. Los eventos de reconciliación propios no disparan un bucle.
- Invalida la petición al cambiar selección. Una petición vieja pendiente no
  impide procesar los eventos de la selección vigente.
- Una invalidación de flota/datos durante la petición solicita como máximo una
  revisión posterior. El límite evita consultas encadenadas indefinidamente.
- La confirmación conserva su snapshot; la revisión automática se suspende
  durante el asistente. La recuperación H124 conserva el resumen nuevo y su
  aviso al cerrar. Una revisión que deja de ser ejecutable no abre el asistente.
- Muestra todos los motivos bloqueantes y distingue desconexión,
  incompatibilidad, errores, pendientes bloqueados y captura activa.
- El siguiente paso de confirmación añade un `data-testid` estable para el arnés.

SQL, `STORE`, `DATA`, permisos, modo producción y el alcance de borrado no cambian.
El servidor ya seleccionaba por categoría sin bandera prueba/real. No se amplía
la disponibilidad a producción ni se ejecuta una eliminación de negocio.

`node build-offline.mjs` regeneró `index.html`, `POS Balam (offline).html`
y el service worker. Se reutilizaron recursos vendored y dependencias ya
instaladas; no hubo instalación ni descarga de dependencias. El junction roto
`node_modules` se reenlazó al paquete local `h155-sync/node_modules`; su enlace
anterior se conserva en `.work/h153-before/node_modules-original`.

El test de integración es `test-h157-cleanup-readiness.mjs`, con exactamente
los mismos cuatro escenarios del test local inicial `test-h153-cleanup-readiness.mjs`.
La revisión de código fue independiente y no ejecutó otros tests.

## Pruebas de la auditoría previa

| Comando | Resultado de esta auditoría |
|---|---|
| `node .work/audit-cleanup-state.mjs` | 21/21 observaciones confirmadas; incluye reproducción del fallo, recuperación manual, ocho anchos y cero errores de página |
| `node .work/test-h116-cleanup-fleet-risk-e2e.mjs` | 29/29 |
| `node .work/test-h124-cleanup-preview-stability-e2e.mjs` | 11/11 |
| `node test-h113-selective-cleanup.mjs` | 35/35 |
| `node test-h116-cleanup-fleet-risk.mjs` | 20/20 |
| `node test-h124-cleanup-preview-stability.mjs` | 11/11 |
| `node test-h151-cleanup-propagation.mjs` | 12/12 |

Los E2E existentes se copiaron a `.work` cambiando únicamente el import de
Playwright: el junction `node_modules` raíz apunta a una ruta ausente. Se reutilizó
Playwright 1.60.0 ya instalado en `h155-sync/node_modules`; no se instalaron
dependencias. El primer intento de H124 desde raíz falló con
`ERR_MODULE_NOT_FOUND`, antes de ejecutar casos.

Anchos de la reproducción: 320, 360, 390, 430, 768, 1024, 1280 y 1440 px,
sin overflow horizontal en el estado probado. No se ejecutaron Firefox,
WebKit, axe ni pruebas de persistencia por borrado real.

**Por qué las pruebas previas no lo detectaban:** H116 E2E `:97–102` termina
tras afirmar el bloqueo local; no prueba su liberación manteniendo casillas.
H113/H117/H122/H123/H124/H150 sustituyen preview por respuestas listas.
H150 SQL-UI `:45,56` fuerza `client_ready:true, ready:true`. H119 `:204`
espera sincronización completa antes de entrar a la sección. Ninguna acredita
el recorrido que falló aquí.

**Regresión de la corrección:** seleccionar una vez mientras sincroniza,
completar sincronización real y exigir preview nuevo/botón listo sin tocar
casillas; red fallida→reintento; dos motivos simultáneos; bloqueo persistente;
cero registros; selección rápida/respuestas fuera de orden; modo y roles;
mantener respaldo/frase/reconfirmación y cero ejecución automática. La
eliminación distribuida completa exige A/B/C real sobre el artefacto final.

**Artefacto auditado:** 9,051,998 bytes; SHA-256
`38978740c0ba3295e4dab4e37dd03fdb90e686467af4b5f606059b1332f4f586`.
`index.html` y `POS Balam (offline).html` coinciden. Los assets de settings,
store, data y shared coinciden con sus fuentes transpiladas en memoria usando
Babel vendored. No hay evidencia de desalineación local fuente/bundle.

## Pruebas de la corrección anterior — base H152

Comando ejecutado antes de integrar: `node test-h153-cleanup-readiness.mjs`.
Resultado: **4/4**. Esta evidencia no acredita el artefacto integrado sobre H155.

| Grupo | Único escenario ejecutado | Resultado |
|---|---|---|
| Botón | Seleccionar durante sincronización, liberar el estado, revisar de nuevo ante un error transitorio | Habilitación automática sin desmarcar; reintento recuperado; 2 consultas hasta recuperación y sin bucle posterior |
| Borrado | Préstamo seleccionado, con venta/pago/producto ajenos conservados | Aplicación local real de DATA: préstamo eliminado y persistido, venta y pago conservados, 1 producto/4 piezas intactos; un respaldo y una ejecución simulados |
| Protección | El plan pasa de listo a bloqueado justo al continuar | Muestra ambos motivos; no abre confirmación ni solicita respaldo/ejecución |
| Terminales | Un evento confirmado alcanza A/B/C en tres entornos locales independientes | STORE adopta época 2, stock 12 y cola 0 en los tres |

Los tres casos de navegador usaron el HTML local anterior a integración a 390 px, red externa bloqueada
y la función STORE de preview original con transporte/estado controlados.
El cuarto reutiliza la preparación del arnés H151 sin ejecutar su suite; es
simulación local y no certificación de Supabase. No se ejecutaron los otros
26 escenarios propuestos ni suites de regresión adicionales, respetando la
instrucción del usuario.

La primera ejecución no llegó a probar el producto: el fixture omitía campos
de `syncStatus` que necesita Configuración y la extracción del arnés H151 se
cortaba dentro de una cadena. Se corrigió el montaje, conservando el estado
completo y usando el límite de línea correcto. El fallo inicial no se atribuye
a BALAM ni se presenta como reproducción roja. La reproducción previa válida
es la auditoría conservada en `h157-cleanup-audit.json`.

El build anterior a integración terminó con código 0, usando recursos locales. El primer
registro mediante redirección PowerShell marcó como error el aviso de Browserslist
aunque el build terminó; se repitió con captura directa del código de Node.

**Artefacto previo a integración probado:** SHA-256
`70f3649d0a2c07793f209e0f6cdd892cb6486720fba8eb95be0db6e6ad09c5ac`.
La evidencia de los cuatro escenarios está en
[h157-correction-preintegration.json](evidence/h157-correction-preintegration.json).

## Integración sobre main y publicación

El usuario autorizó commit, push e incorporación a main el 11/09/2026.
El checkout original conservaba un enlace Git a una ruta inexistente. Se
recuperó el acceso al repositorio mediante un checkout aislado desde
`origin/main`, commit `0e1aa7d`, sin incorporar cambios ajenos del directorio
`h155-sync`.

La base publicada ya contiene impresión H153 y sincronización H155. H153,
identificador usado inicialmente para esta auditoría local, pertenece en main
al trabajo de impresión; H154 está reservado y H156 registra otro residual.
Esta corrección se registra como **H157** antes de integrarla. Sus evidencias
históricas se conservan con prefijo h157 y el resultado previo se denomina
`h157-correction-preintegration.json`; no se altera su hash ni se atribuye a
la base nueva.

Se integró exclusivamente el cambio de eliminación por categorías sobre H155,
preservando las correcciones de impresión y sincronización. Los artefactos
HTML/offline/SW se regeneraron desde la fuente integrada; el build terminó con
código 0. Se repitieron únicamente los mismos cuatro escenarios solicitados,
mediante `node test-h157-cleanup-readiness.mjs`, sin ampliar la matriz.

**Resultado de integración:** **4/4**, código de salida 0, el 11/09/2026 a las
18:36 UTC: recuperación/reintento del botón, préstamo local con conservación,
bloqueo antes de confirmar y propagación en tres entornos STORE locales.
**Artefacto integrado y SHA-256:** HTML y offline
`80de96831e1f37a26bfeab36ddedca768ff2d1ee1281b0a4ee0449cf075dbe71`.
**Evidencia final:** [h157-correction.json](evidence/h157-correction.json).
**Commit y publicación:** pendientes; no se atribuye despliegue a la evidencia local.

El workflow `h148-sync-authority.yml` exige un certificado real del mismo
artefacto antes de desplegar Pages. `test-h148-sync-certification.mjs` compara
el SHA-256 certificado con el HTML que se entrega. El certificado de H155
no cubre este HTML modificado; por tanto, la publicación automática queda
pendiente de una certificación nueva. No se modifica el filtro ni se reutiliza
el certificado atribuyéndolo a H157. La petición del usuario limita la prueba
a los cuatro escenarios y no se ejecutó la matriz real adicional. Esta
condición contractual de CI no invalida los cuatro escenarios locales aprobados.

## Riesgo residual, despliegue y commits

- Integración local validada; commit/push pendientes desde el checkout aislado.
  Pages requiere el certificado real del artefacto final; no se afirma despliegue.
- **NO CERTIFICADO** contra Supabase real/A/B/C: la cobertura de esta corrección
  permanece acotada por el usuario. No ejecuta borrados ni escrituras
  comerciales remotas.
- Una invalidación nueva durante la única revisión posterior puede requerir
  «Revisar de nuevo» o el siguiente evento. Abrir/respaldar/ejecutar sigue
  revalidando el plan; nunca se ejecuta automáticamente.
- La preservación H124 y la exclusión de peticiones obsoletas se revisaron en
  código; no se añaden escenarios separados fuera de los cuatro autorizados.
- No se amplía la operación al modo producción; permanece su restricción
  contractual. No se reconstruye ni altera la sesión del usuario.
- **Pendiente de commit**. El enlace Git roto del directorio original ya no
  impide la integración: se trabaja en el checkout aislado de main.

## Referencias

- `docs/03-known-risks.md`, H-157; antecedentes H-113, H-116, H-117, H-119,
  H-124, H-150 y H-152.
- [Evidencia JSON](evidence/h157-cleanup-audit.json).
- [Botón bloqueado tras recuperación](evidence/h157-sync-stuck.png).
- [Error de revisión sin acción directa](evidence/h157-error-stuck.png).
- Reproducción inicial: `.work/audit-cleanup-state.mjs`, arnés local no distribuido; sus resultados y capturas se conservan en la evidencia enlazada.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16 y R-SYNC-17.
