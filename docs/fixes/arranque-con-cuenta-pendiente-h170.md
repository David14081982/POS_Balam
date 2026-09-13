# Arranque con una gestión de usuarios pendiente

**Riesgo:** H-170
**Estado:** RESUELTO, certificado A/B/C y publicado
**Fecha:** 12/09/2026
**Commit:** `6bbce30eb08348cef40b073a3cfc3aac4c489bd0`

## Problema y reproducción

Al iniciar, una cuenta con referencia técnica pendiente quedaba en la pantalla
«Confirmación pendiente» aun después de obtener permisos y datos remotos válidos.
H-169 conservaba la captura después de montar la aplicación, pero no permitía
su primera montura en este estado. La matriz anterior no cubría ese arranque.

Consulta remota de sólo lectura: solicitud `70549527-4867-4342-94d2-38e770b0f2a9`,
acción `delete`, estado `profile_confirmed`, creada el 12/09/2026 22:15:27 UTC.
Destino: `qa-h164-69237da3-b20c-4a37-93fb-831fd846d867 Account`, perfil inactivo y
Auth aún existente. Ninguna operación comercial en estado `executing`.
La captura no contiene el request ID local: se identifica la única eliminación
pendiente del servidor, sin afirmar haber inspeccionado el navegador del usuario.

Reproducción: `BALAM_STARTUP_CASE="Confirmed snapshot"
BALAM_STARTUP_EVIDENCE=docs/fixes/evidence/h170-before.json
node test-h164-startup-app.mjs`: **0 PASS / 1 FAIL** antes del cambio.

## Causa raíz

`STORE.resolveOutstanding` conserva correctamente una respuesta incierta de
cuenta y puede completar la carga remota: `ready=true` no afirma que esa cuenta
haya terminado. App, en cambio, exige `lastShell.current` para evitar el gate
aunque `online.ready` ya sea verdadero. En el primer render no existe shell.
Así, una gestión de usuarios se convierte en impedimento para entrar al POS.

No se atribuye una causa al fallo de eliminación Auth sin su diagnóstico.
El estado comprobado sólo acredita que el perfil está desactivado y la cuenta
Auth no ha terminado de eliminarse.

## Diseño

La autorización y un snapshot confirmado permiten montar la aplicación por
primera vez. La referencia pendiente sigue visible como aviso dentro del shell.
Sin snapshot o sin autorización se conserva la protección existente. No se
inventan datos, no se convierte incertidumbre en éxito y no se repite el comando.
El servidor y STORE conservan todas sus barreras comerciales y de cuentas.

`syncStatus.pendingRequests` sólo expone identidad y tipo de referencias del
actor actual para identificar la clase de aviso. No agrega almacenamiento,
payload, contraseña, permiso ni consulta remota; el resumen es de sólo lectura.
Una referencia ilegible no desactiva la bandera de incertidumbre existente.

## Solución

- `balam/app.jsx`: montar el shell si ya hay snapshot confirmado, incluso con
  referencia pendiente; indicar «Gestión de usuarios pendiente de confirmación»
  cuando todas las referencias corresponden a cuentas.
- `balam/store.jsx`: resumen mínimo de referencias del actor actual.
- Arneses vigentes: nuevo caso de arranque, conservación/resolución de referencia
  de cuenta y aislamiento de otro actor. El caso UI inicia directamente pendiente.
- Certificador real: nuevo escenario A/B/C con una preparación QA real abandonada
  antes de cualquier escritura Auth. Cada sesión guarda sólo la referencia,
  recarga, verifica acceso, aviso y navegación sin borrar esa referencia. El
  retiro marca exclusivamente esa preparación QA como rechazada, conserva el
  recibo y comprueba que la resolución remota retire las referencias locales.

El retiro del fixture no afecta la solicitud real del usuario. No se cambian
migraciones, Edge Functions ni reglas de Auth. La eliminación antigua sigue
pendiente hasta su resolución propia.

## Pruebas

| Comando | Resultado |
|---|---|
| `node test-h164-startup-app.mjs` | 8/8; previo específico 0/1 |
| `node test-h164-online-adoption.mjs` | 11/11, incluye cuenta incierta y referencia ajena |
| `node test-h164-online-transport.mjs` | 13/13 |
| `node test-h164-online-account.mjs` | 1/1 |
| `node test-h164-online-architecture.mjs` | exit 0, 28 módulos |
| `node build-offline.mjs` | exit 0, HTML idénticos |
| `node test-h164-online-ui.mjs` | 6/6 sobre artefacto final |
| `node test-h164-online-pwa.mjs` | 2/2 sobre artefacto final |
| `BALAM_LIVE_PREFLIGHT_ONLY=1 node test-h164-live-online.mjs` | exit 0, proyecto y artefacto verificados |
| `node test-h170-certifier-recovery.mjs` | 10/10; conciliación exacta y nueve rechazos antes de modificar checkpoints |

El primer pase de UI dio 4 PASS / 1 FAIL en la reimpresión histórica: su semilla
tomaba el día UTC, ya 13/09, y Reportes filtraba el día local 12/09. Se corrigió
únicamente la fecha de la semilla para usar el mismo calendario local, sin
cambiar Reportes ni reducir sus aserciones. Pase final: 6/6.

Evidencia: `evidence/h170-before.json`, `h170-startup.json`,
`h170-ui-final/online-ui.json` y pruebas PWA del artefacto.
SHA-256 del HTML:
`ae53f13541729ecb3fff768d4a974a44fd5fe790f7d7961d6fde1dd28801665d`.

## Certificación real

Ejecución `8a89fd93-552a-489d-ae6b-e0afabf899e7`, del 13/09/2026 00:13:26 al
00:40:38 UTC (12/09 en Hermosillo), sobre ese único HTML. Resultado final:
**22 escenarios distintos aprobados, certified=true, exit 0**. La matriz conserva
26 entradas: 22 aprobadas y **4 intentos interrumpidos**, no 26 aprobados.

Se ejecutó localmente con `BALAM_ONLINE_LIVE=1`, salida `.evidence-h170-live`,
artefacto `index.html`; las reanudaciones usaron `BALAM_LIVE_RESUME_DIR` apuntando
al mismo directorio. No se reutiliza el certificado del HTML H-169.

Las interrupciones fueron tres timeouts de lectura SQL (cliente, venta y
apartado) y un guardado de configuración detenido antes de enviarse por falta
de readiness. Sus checkpoints, recibos y resultados permanecen registrados en
cinco sesiones del mismo run. Cliente y apartado se continuaron desde sus
operaciones confirmadas; el intento de configuración tenía cero request IDs.

La venta del intento interrumpido se concilió con sus recibos de folio/venta,
actor, cliente QA, línea de tres piezas y un único pago. Se conservó y **no se
reenvió**. Se permitió como máximo una prueba QA nueva con IDs distintos; su
lectura de recuperación usa los reintentos acotados de `converge`. Los arneses
rechazan actor ajeno, recibo pendiente/ausente, tipo incorrecto, venta no seguida,
cliente/cantidad/pago inconsistentes y una segunda repetición nueva (10/10).
Los reingresos restauran Realtime desactivado cuando su escenario específico
ya había pasado, manteniendo la condición de consulta autoritativa de la matriz.

En A/B/C real pasó el caso nuevo: tres recargas con preparación de cuenta aún
`prepared`, snapshot confirmado, franja de usuarios visible, navegación operable
y referencia intacta. Sólo desaparece la referencia después de rechazar
remotamente esa preparación QA que no había escrito en Auth. También pasaron
los 21 escenarios previos de operaciones, stock, permisos, respuesta perdida,
concurrencia, corte/reconexión, recarga/reapertura y conservación histórica.

Resultado de conservación: **1,664 filas preexistentes en 18 tablas sin pérdidas**,
con exclusión de `updated_at`, `sync_version`, `sync_base_version` y
`sync_device_id` en la huella histórica, como define el certificador. Las
proyecciones A/B/C coinciden con Supabase. Retiro final confirmado: 5 perfiles
QA inactivos, 2 cuentas Auth bloqueadas, 3 instalaciones retiradas; historial
QA conservado. La solicitud original del usuario no se modificó.

Evidencia: `evidence/h170-live-matrix.json` (matriz completa),
`evidence/h170-sale-reconciliation.json` (identidades del intento conciliado)
y `.evidence-h170-live/` (fixtures, baseline y copias previas a cada reanudación).
SHA-256 de la matriz:
`1ed134915cb7a309b8596548a4488ac94e9e0b100e533ecfbacee326ebfe3e52`.
Certificador final:
`02ce46d25101ae2f8ad9a800f7fa4d24c065b10322dd32c6dabd55452177c9cd`.
La matriz conserva el hash inicial y los hashes por sesión; se verificó el
hash final y que todas las sesiones ejecutaron el mismo artefacto.

## Riesgo residual y pendientes

Publicado en GitHub Pages desde `6bbce30eb08348cef40b073a3cfc3aac4c489bd0`.
Actions `34728754511`: regresión y deploy aprobados; el job live no se ejecutó
en GitHub. La certificación real descrita arriba se ejecutó localmente.
Verificación pública HTTP 200 y bytes idénticos en los tres archivos:
`index.html`, `POS Balam (offline).html` y `sw.js`.
Evidencia: `evidence/h170-workflow.json` y `evidence/h170-publication.json`.
Para adoptar la corrección, recargar el navegador (Ctrl+F5); «Actualizar ahora»
consulta el resultado pendiente, pero no reemplaza por sí solo el código cargado.

Hardware e impresora no probados. Los timeouts
SQL observados no se presentan como resueltos por esta corrección de interfaz.
La eliminación real de la cuenta QA antigua sigue
pendiente; esta corrección evita que impida entrar cuando los datos están listos.

## Referencias

- `docs/03-known-risks.md`, H-170.
- `docs/fixes/confirmacion-sin-bloqueo-h169.md`.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16/17.
