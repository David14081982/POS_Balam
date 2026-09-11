# Refresco de permisos sin interrumpir la pantalla

**Riesgo:** H-158
**Estado:** CORREGIDO, CERTIFICADO Y PUBLICADO — adopción física pendiente.
**Fecha:** 11/09/2026
**Commit:** `06ffb89de43c54a5c64aa1d0e9fe2e75c09fac30`

## Problema y reproducción

El usuario reporta oscurecimiento periódico y apariencia de refresh en cualquier
pantalla de https://david14081982.github.io/POS_Balam/.
Se descargó esa publicación, SHA-256
`80de96831e1f37a26bfeab36ddedca768ff2d1ee1281b0a4ee0449cf075dbe71`.

`test-h158-auth-refresh-browser.mjs` carga sus bytes en Chrome, en un origen HTTPS
con el gate de autenticación habilitado, perfil sintético y tráfico interceptado.
Se aísla el arranque de STORE y se presenta recuperación lista para comprobar
AUTH y App sin una recuperación de dispositivo ajena al caso.
El recorrido es login resuelto → POS → escribir en el buscador → retener la RPC
de permisos → refrescar → responder → revocar permisos. Se comprueban nodo DOM,
foco, contenido, `isReady`, gate y `performance.timeOrigin`.

Antes: **4/8**, con cuatro fallos en 1280 y 390 px: aparece «Cargando…», el input
se desmonta, pierde foco y vuelve vacío. No cambia `performance.timeOrigin`:
en este caso es un desmontaje React, no una navegación completa. No se observó
la sesión física del usuario ni se midió su frecuencia efectiva.

La reproducción unitaria previa terminó **25/28**, tres fallos: carga durante
refresco, respuesta tardía tras logout y confirmación de una consulta de la
identidad anterior después de cambiar de cuenta.

## Causa raíz

H-78 preservaba la sesión durante `onAuthStateChange`, pero
`AUTH.refreshPermissions()` todavía publicaba `ready=false` antes de la RPC.
`App` respondía con su gate oscuro, sustituyendo el árbol de la pantalla activa.
STORE llama a esta función al reconciliar `permissions`; las invalidaciones,
reintentos y revisiones completas pueden repetir la interrupción. El sondeo
vigente es de un minuto y la revisión completa de cinco minutos; no se modifican.

La misma ruta tampoco descartaba respuestas tras logout/cambio de identidad.
El contador de `resolveProfile` se comprobaba después de modificar perfil/caché.

## Diseño

Conservar la última identidad y permisos verificados mientras se consulta su
actualización. Aplicar la respuesta vigente completa y retirar acceso ante
revocación/inactividad. Conservar el gate de arranque y cambio de identidad.
Compartir la secuencia de resoluciones y comprobarla antes de aplicar respuestas,
incluida la espera de obtención del cliente. Una consulta obsoleta devuelve falso
al coordinador para que no confirme un checkpoint por ese resultado.

## Solución

- `balam/auth.jsx`: elimina la transición de arranque del refresco de permisos
  y descarta respuestas obsoletas antes de mutar estado.
- `test-auth-permissions.mjs`: espera controlada, red fallida, logout,
  cambio de identidad e inactividad, además de revocación/caché ya existentes.
- `test-h158-auth-refresh-browser.mjs`: regresión en Chrome sobre el artefacto,
  con captura conservada y revocación comprobada en escritorio y móvil.
- `index.html`, `POS Balam (offline).html` y `sw.js`: regenerados desde fuente.

## Pruebas

| Comando | Resultado |
|---|---|
| `node test-auth-permissions.mjs` | 28/28; antes 25/28 |
| `node test-h158-auth-refresh-browser.mjs <publicado>` | 4/8 antes |
| `node test-h158-auth-refresh-browser.mjs` | 8/8 después |
| `node test-role-access.mjs` | 15/15 |
| `node test-auth-signout-scope.mjs` | 14/14 |
| `node test-module-contracts.mjs` | 42/42 |
| `node test-store-queue.mjs` | 186/186 |
| `node test-ui-navigation.mjs` | 15/15, once pantallas sin excepciones |
| `node test-smoke.mjs bundle` | 17/17 |
| `node test-h148-reconciliation.mjs` | 15/15 |
| `node test-h155-publication.mjs` | 5/5, conserva el bloqueo de publicación sin certificado |
| `BALAM_SYNC_LIVE=1 node test-h148-live-convergence.mjs` | 29/29 A/B/C reales; limpieza correcta y 17/17 tablas conservadas |
| `node test-h148-sync-certification.mjs .evidence-h158-live/matrix.json` | CERTIFIED, 16/16 dominios, cero pérdidas/divergencias |
| `node build-offline.mjs` | Código 0, 73 assets; ambos HTML idénticos |

La tabla corresponde a la integración sobre `main` en `a1cd53f`, que conserva
impresión H153, sincronización H155 y Configuración H157. Se añadió el arnés
H158 y AUTH a la regresión de CI previa a Pages. El nombre provisional H156
pertenecía a la carpeta sin conexión Git; en remoto ese ID ya designaba otro
riesgo. Se usa H158 sin modificar el H156 de UPSERT ni incorporar sus cambios.

Evidencia: `evidence/h158-before.json`, `evidence/h158-after.json` y capturas
`evidence/h158-before-1280.png`, `evidence/h158-after-1280.png`.
SHA-256 del arnés navegador:
`c453ea3b1ecd49df28ff64c40ed70d1b79f2f5b9e6cbbf5403f672f6d8eb6593`.
SHA-256 del artefacto final:
`1e477db25a4732507efcfc9fd481f068155a32b2241e424eda9ea00b09c56f03`.

El primer intento de CI `34647824445` aprobó AUTH, H158 y el certificado, pero
falló en 24a/24b de `test-store-queue.mjs` (184/186). Esas aserciones leen la cola
tras una espera fija de 40 ms; las siguientes 24c/24d sí observaron el bloqueo
y un único intento persistido. La repetición local dio 186/186. Se reejecutó
el job completo sin modificar el producto, las aserciones ni las guardas.
El segundo intento aprobó todas las regresiones y publicó Pages. Queda como
riesgo del arnés la dependencia de esa espera fija; no se cambió en esta historia.

## Publicación

Commit técnico `06ffb89de43c54a5c64aa1d0e9fe2e75c09fac30`, push a `main`
completado. Workflow H148 `34647824445`, intento 2: regresión y despliegue
correctos; workflow H132 `34647824452` correcto. El certificado real se ejecutó
localmente antes del commit y CI verificó su correspondencia estricta con el
artefacto; el job manual de certificación remota no se solicitó en Actions.

El 11/09/2026 a las 21:15:55 UTC, la raíz pública sin parámetros y los nueve
archivos de entrega respondieron HTTP 200 y coincidieron byte a byte con el
commit: **10/10**. HTML/offline: `1e477db2…`; SW: `4db44295…`.
Evidencia completa: `evidence/h158-pages.json`.

## Riesgo residual y pendientes

La corrección está en el sitio público. La referencia Git rota de la carpeta
original se salvó preparando un checkout limpio `.h156-release`, conectado a
`origin/main` de `David14081982/POS_Balam`. Se conserva intacta la carpeta
original y el trabajo separado de `h155-sync/`.

El arnés específico de interfaz usa transporte controlado. La certificación
adicional completa sí ejecutó A/B/C contra Supabase real sobre este HTML:
**29/29**, **16/16 dominios**, cero pérdidas/divergencias, limpieza sin errores y
comparación de **17/17 tablas** sin cambios en sus datos previos. Terminó el
11/09/2026 a las 21:05:22 UTC y pasó el filtro estricto de entrega. Evidencia:
`docs/fixes/evidence/h148-live-matrix.json`. No se hicieron migraciones ni cambios
de RLS/RPC; sólo se crearon y retiraron las semillas autorizadas.
Commit, push, publicación y comprobación del artefacto servido están completos.
Falta observar la adopción de la actualización en la terminal física del usuario;
una pestaña abierta puede conservar la versión anterior hasta actualizarse.
No se recomienda borrar almacenamiento para resolver este fallo.

La revisión automática rechazó el 11/09/2026 la ejecución de
`BALAM_SYNC_LIVE=1 node test-h148-live-convergence.mjs`: el arnés crea y elimina
fixtures reales con `service_role`, y el revisor no consideró la autorización
de despliegue suficiente para ese alcance. La ejecución no comenzó. Se pidió
autorización explícita para cuenta/filas aisladas y eliminación con verificación
de conservación. El workflow general, su certificado y las guardas permanecen
vigentes; la excepción de H157 no se amplía a este artefacto.

El usuario autorizó después expresamente crear y eliminar únicamente registros
temporales de prueba. La certificación completa terminó con esa autorización
en preproducción, con journal de IDs exactos y verificación de conservación.

## Decisiones verificables

FF-01/02: defecto del ciclo de presentación, reproducido sobre publicación;
el trabajo de captura debe sobrevivir una consulta de fondo. FF-03/05:
`current_permission_snapshot` sigue decidiendo permisos, AUTH los proyecta y
App/STORE consumen sus APIs vigentes. FF-04/08: no se modifica documento
histórico ni formato de caché; se regeneran los artefactos.
FF-06/07: los consumidores de `refreshPermissions` comparten el mismo contrato;
no se cambia el coordinador ni se inventa otra caché. FF-09/10: revocación,
inactividad, sin perfil, vendedor/admin y cambios de identidad se comprueban
localmente; la matriz A/B/C adicional comprueba propagación real de permisos,
operaciones, cola y conservación contra Supabase, sin aprobar globalmente
riesgos ajenos a esta historia (por ejemplo el H156 de UPSERT).
FF-11: recorrido del POS con input real, espera y revocación, en dos viewports;
regresión de navegación sobre las once pantallas. Aprendizaje: H-78 sólo probó
el evento de renovación de token; faltaba ejercitar el refresco público de
permisos con una respuesta retenida. Las nuevas pruebas cubren esa omisión.

## Referencias

- `docs/03-known-risks.md`, H-158.
- `docs/fixes/renovacion-sesion-sin-bloqueo.md`, H-78.
- `docs/02-architecture.md`, AUTH y Sincronización.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16/17.
