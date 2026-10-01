# THERMER: cliente y tienda con un toque

**Riesgo:** H-181
**Estado:** EN CURSO — URI corregida; aceptación física pendiente
**Fecha:** 01/10/2026
**Commit:** `12a7a8c` (implementación); `8eadc90` (registro inicial, cliente publicado)
**Corrección de URI y diagnóstico:** `b2db3ed`.

## Problema y reproducción

El usuario acepta un toque después del cobro, THERMER 6.4.8.42 y END-80TEUX USB.
H-180 entrega cada copia a `window.print()`. No existe respuesta JSON descargable
por THERMER. Línea base del arnés contra `b28ea2b:index.html`: 0/2, falla la
preparación en Android y Linux táctil. Adaptador único en `PrintManager.send`.
El alcance es salida de comprobantes, no cobro ni detección USB desde JavaScript.

## Causa raíz

Contrato de transporte ausente. Una página GitHub Pages no ejecuta el ejemplo
PHP del proveedor. El enlace externo exige gesto y no certifica recepción.

La aceptación fallida posterior permitió reproducir un defecto adicional:
Chromium normaliza `my.bluetoothprint.scheme://https://...` como
`my.bluetoothprint.scheme://https//...`, eliminando los dos puntos del HTTPS
anidado. Ocurre tanto al leer `anchor.href` como en la navegación real observada
por CDP `Page.frameRequestedNavigation`. El atributo original sí los conserva;
comprobar sólo que se creó/clicó el enlace no detectaba la corrupción. Es un
defecto de transporte confirmado, sin atribuirle aún toda la falla física.

La reproducción añadida al artefacto publicado `8a52ec9` dio 14/16: fallaron
las dos comprobaciones de URL completa (Android y modo escritorio táctil).
La prueba independiente de navegación demuestra la diferencia antes/después.
Evidencia: `evidence/h181-browser-uri.json` y `evidence/h181-uri-baseline.json`.

## Diseño

Configuración optativa `print.thermer` para Android (incluido modo escritorio
Linux táctil). En ese modo los comprobantes preparan siempre dos copias marcadas,
sin depender de los ajustes del sistema. Un trabajo agrupa ambas y conserva sus
snapshots antes de esperas. PNG existente 576 puntos sin modificar plantillas.
`ReceiptPrintHelp` prepara al montar; el operador activa cuando el paquete está
listo. Una apertura envía el JSON completo con dos imágenes, sin `window.print`.

Servicio `thermer-print`: POST exige usuario y perfil activo mediante RPC vigente;
bucket privado exclusivo sin políticas de acceso cliente. El gateway conserva
verificación JWT. Storage firma URLs de diez minutos para un paquete inmutable
y sus imágenes. No incluye el JWT de sesión, folio ni nombres en URL. Las firmas
de Storage son capacidades limitadas al recurso. GET de Storage no requiere
sesión del navegador porque THERMER descarga en otro proceso. POST no-store y
objetos con cacheControl 0. Limpieza acotada de paquetes
caducados al preparar trabajos; un paquete final puede permanecer privado hasta
la siguiente preparación. No escribe tablas de negocio ni modifica permisos
existentes. La cola de impresión es efímera y no reproduce ventas.

Cierre por regreso del operador, nunca confirmación física. Reintento de
preparación explícito; enlace vencido se renueva antes de permitir otro toque.
Reportes y PC mantienen H-180. El ajuste THERMER está apagado por omisión.

El enlace se envuelve ahora como
`intent:my.bluetoothprint.scheme://<URL>#Intent;package=mate.bluetoothprint;end`.
No lleva `scheme=`: según `Intent.parseUriInternal` de AOSP, Android elimina
sólo el prefijo `intent:` y conserva la URI que documenta THERMER. La forma
opaca impide que Chrome normalice el HTTPS anidado. No se altera JSON, PNG,
firmas, tamaño, plantilla, número de copias ni servicio. La ejecución de ese
parser en Android y su recepción física por THERMER siguen NOT_TESTED localmente.

## Solución

- `balam/config.jsx`, `settings.jsx`: ajuste optativo `print.thermer`.
- `shared.jsx`, `print-manager.jsx`: preparación de dos originales, hashes por
  copia, enlace bajo gesto, exclusión de doble toque, reintento inmutable,
  renovación y cancelación sin resucitar trabajos. Historial distingue THERMER.
- `store.jsx`: preparación autenticada mediante CORE, timeout y comprobación de
  sesión al regreso; valida origen/ruta de la URL de respuesta.
- `supabase/functions/thermer-print/index.ts`: cuerpo acotado, dos PNG con firma
  y dimensiones válidas (no decodifica ni certifica todo el PNG en servidor),
  permisos de usuario/perfil/dispositivo, paquete privado firmado y limpieza.
- Fuentes reconstruidas en ambos HTML y `sw.js`; guardián H-181 añadido al
  workflow de publicación. Ninguna migración SQL ni cambio de datos comerciales.

Activación: actualizar BALAM, Configuración → Impresión → «Usar THERMER en
tablets Android». En THERMER, Browser Print activado y END-80TEUX seleccionada
por USB. Abrir el comprobante y tocar Imprimir cuando esté listo. El trabajo
incluye cliente y tienda aun si `print.twoCopies` está apagado. No cambia tamaño.
Reversión: apagar `print.thermer` recupera la ruta del sistema. No se modifica
automáticamente la configuración comercial remota del establecimiento.

## Pruebas

- Corrección de URI del 01/10: `node test-h181-browser-uri.mjs` 2/2; CDP
  reproduce enlace directo corrupto y navegación opaca exacta.
- `node test-h181-thermer.mjs` 16/16 después de corregir la URI: comparación
  completa del enlace firmado, dos trabajos consecutivos entregados, originales
  intactos y cierre/cancelación/reintento conservados en ambos perfiles Android.
  Evidencia final: `evidence/h181-uri-final.json`.
- Diagnóstico: `node test-h181-diagnostic-payload.mjs` 5/5;
  `node test-h181-diagnostic-page.mjs` 7/7 (incluye descarga retenida abortada).
- Regresión ejecutada sobre artefacto reconstruido: H-180 18/18, UI H-164 6/6,
  PWA H-164 2/2. Los cinco procesos locales completaron sus aserciones pero
  quedaron esperando `browser.close()` en el entorno Windows; se cerraron sólo
  sus Chrome headless identificados por PID/padre y todos terminaron con código 0.
  El workflow verificó después el ciclo completo sin ese cierre manual: SUCCESS.

Pruebas de la implementación inicial (anteriores a esta corrección):

- `node test-h181-thermer.mjs --baseline`: 0/2 sobre b28ea2b.
- `node test-h181-thermer.mjs`: 16/16 sobre artefacto final. Dos agentes Android;
  originales PNG completos idénticos al generador existente, hashes, ancho576,
  ambos HTTP de imágenes, orden JSON, dos documentos sucesivos (3 y 24 partidas),
  un toque/una apertura/cero print(), regreso, errores/reintento, URL caducada,
  cancelación durante upload, recursos y ruta Windows con ajuste activo.
  El guardián fija coste máximo 1 toque para entregar 2 copias, integridad por
  bytes y completitud; no mide ni afirma impresión física.
- `node test-h181-thermer-service.mjs`: PASS. Handler real con dependencias
  aisladas: vendedor/admin, anónimo/perfil inactivo/sin perfil/dispositivo no
  admitido, tamaños y tipo, orden, aislamiento, expiración y limpieza. La firma
  local es simulada; la verificación real de Storage se ejecutó aparte.
- `node test-h181-live-service.mjs <PNG ficticio>`: 7/7 + limpieza exacta en
  Supabase real: bucket privado, descarga pública rechazada, POST anónimo/anon
  key/service key rechazados, URL adulterada rechazada, JSON y dos PNG idénticos.
  No usa datos de venta, no guarda claves ni URLs firmadas en evidencia.
- `node test-h180-system-print.mjs`: 18/18; `node test-h179-receipt-copies.mjs`: 13/13.
- `node test-h164-online-ui.mjs`: 6/6; `node test-h164-online-pwa.mjs`: 2/2.
- `node test-h164-online-architecture.mjs`: PASS; configuración 3/3 y settings
  3/3. Build PASS. El workflow vuelve a ejecutar la regresión sobre el commit.
- Evidencia: `evidence/h181-local.json`, `evidence/h181-live-service.json`.

## Despliegue

### Corrección de URI publicada

Commit `b2db3ed`, Actions
[36920521984](https://github.com/David14081982/POS_Balam/actions/runs/36920521984):
regresión y despliegue SUCCESS; certificación A/B/C omitida, no solicitada.
Comprobación a las 20:26:18 UTC del 01/10/2026: `index.html`, HTML offline,
`sw.js`, página de diagnóstico y control JSON públicos idénticos byte por byte
al commit probado. Evidencia completa: `evidence/h181-uri-deploy.json`.
HTML 9,369,511 bytes, SHA-256
`02934821e81814536127175cc4b2f7c70470a9a6795d52139cd98e22eb6ec2a6`.
No se volvió a desplegar servicio ni se modificaron datos o permisos de Supabase.
No se emitió un paquete sintético remoto: tras reproducir el defecto del enlace,
la siguiente aceptación es reimprimir un comprobante con el cliente actualizado.
El diagnóstico adicional permanece disponible si la falla física persiste.

### Publicación inicial

Servicio desplegado con JWT habilitado y bucket privado provisionado antes del
cliente. La revisión automática rechazó el primer intento de despliegue que
deshabilitaba JWT; se reemplazó por POST autenticado y firmas nativas de Storage,
sin el flag rechazado. El diseño final fue aprobado y desplegado.
El usuario autorizó explícitamente el push y la publicación el 01/10/2026
(«si hazlo»), después del rechazo automático inicial. Se enviaron ambos commits
a `main` y se ejecutó el workflow manual con `live=false` porque el commit
documental contiene `[skip ci]`.

Actions [36910485462](https://github.com/David14081982/POS_Balam/actions/runs/36910485462):
regresión y despliegue SUCCESS. Incluye servicio H-181 y cliente 16/16; A/B/C
no solicitado, omitido. GitHub Pages sirve el HTML y el SW idénticos byte por
byte a `8eadc90a6a99ea93a51cc56d3b000251806c5626`, comprobado a las
19:04:04 UTC del 01/10/2026. Evidencia: `evidence/h181-deploy.json`.

HTML público: 9,369,339 bytes. SHA-256:
`52f0959eba96030d6c0b7f5020fe604d7ed99ba348c6bd3f9fa1fd76820dbab0`.
SW público: 4,477 bytes. SHA-256:
`2bcf1918d534fd478ec4aa822b4a66c3ee743adf4a0bfb1bc1fb0ac41ac20068`.

## Riesgo residual y pendientes

### Evidencia del usuario posterior a la publicación (01/10/2026)

Al abrir THERMER desde BALAM aparece publicidad, no sale papel y parpadea un
indicador azul. El usuario luego confirma que un texto de prueba creado e
impreso directamente desde THERMER sí sale por USB. Esto prueba impresión
básica por esa conexión, pero no recepción/impresión de las imágenes de BALAM.
En ese momento aún no se había reproducido el defecto de la URI descrito arriba.

Los dos PNG ficticios del arnés H-181 se volvieron a inspeccionar sin enviarlos:
576×2295, gris de 8 bits, CRC de todos los chunks válidos, datos zlib/filtros y
longitud válidos, 59,353/59,265 píxeles negros respectivamente. Esta comprobación
descarta un PNG vacío o corrupto en esos fixtures, no certifica el ticket real
del usuario ni el decodificador de THERMER.

La revisión automática bloqueó inicialmente leer los tres últimos paquetes
privados mediante acceso administrativo. El usuario autorizó explícitamente esa
lectura («si hazlo»). Se inspeccionaron, sin modificar archivos remotos, los
paquetes de las 19:19:40, 19:23:35 y 19:29:48 UTC. Los tres contienen entradas
`[imagen, línea vacía, imagen]`; sus seis PNG son 576×2438, gris de 8 bits,
CRC/zlib/filtros correctos y contenido no vacío (57,511–57,825 píxeles negros).
Las imágenes pesan entre 25,616 y 25,686 bytes. No se publicó contenido, URLs
firmadas, credenciales ni datos identificativos del comprobante.

Las firmas de imagen vencían aproximadamente diez minutos después de crear
cada paquete: 19:29:39–40, 19:33:35 y 19:39:47–48 UTC. A las 19:49:19 UTC estaban
vencidas; no se conoce el instante de descarga de THERMER y no se atribuye el
fallo a caducidad sin esa evidencia. La lectura administrativa confirma los
archivos almacenados, no que THERMER recibiera/procesara las imágenes.

El usuario confirmó después que una imagen de su galería también imprime en
THERMER por USB. PC imprime los tickets correctamente. Queda aislado para
diagnóstico el recorrido Browser Print/descarga externa/procesamiento del
paquete. La reproducción posterior identificó la corrupción de URI en Chrome;
su efecto final sobre el papel aún requiere la prueba de la tablet.

Se incorpora una página diagnóstica separada en `pwa/thermer-check.html`, sin
sesión comercial. Un botón abre la misma clase de URL
firmada en THERMER. Paquete sintético: texto INICIO, PNG gris8 576×96, texto
IMAGEN LARGA, PNG gris8 576×2438 y texto FIN. Permite distinguir manifiesto,
descarga de imagen y longitud sin usar datos reales. La URL temporal se recibe
en el fragmento, se limita al origen/ruta de Storage de BALAM y no se registra.
El paquete se emite bajo demanda con `node h181-thermer-diagnostic.mjs --prepare`
para conservar sus diez minutos; se limpia únicamente con el registro devuelto
mediante `--cleanup <record.json>`. No se crean objetos remotos al ejecutar
pruebas locales. La página aborta descargas tras 30 segundos y ofrece un control
público de texto independiente. Ésta es instrumentación, no aceptación física.

Pendiente confirmar las dos copias en la tablet tras publicar la URI corregida.
No se cambiaron tamaños ni imágenes comerciales a partir de esta observación.
Las pruebas anteriores siguen siendo de transporte y no equivalen a aceptación
física exitosa.

HARDWARE_LOCAL NOT_TESTED; USER_ACCEPTANCE FAILED para tickets de BALAM y PASS
para texto e imagen de galería directos de THERMER. Abrir el enlace no prueba impresión física ni corte entre
copias; el protocolo del proveedor no documenta confirmación ni comando de corte.
El navegador/Android puede mostrar confirmación para abrir la aplicación.
No se promete operación invisible ni selección USB desde BALAM. Requiere Internet.
POST con usuario activo contra remoto NOT_TESTED (matriz ejecutada aislada);
expiración real de Storage NOT_TESTED, cubierta por contrato simulado. Últimos
artefactos pueden permanecer privados hasta la siguiente preparación. Un usuario
que reciba una URL firmada puede leer ese paquete durante su vigencia. No hay
reintento de impresión física automático para evitar duplicar papel.
No certificación A/B/C. FF-09 aplica a creación del paquete; la descarga usa una
capacidad temporal. No cambian cálculos, roles comerciales ni persistencia de
ventas. FF-01/03/05/07: nueva salida, autoridad PrintManager. FF-04/06/08:
snapshots separados e inmutables por trabajo. FF-10/11: validar cuerpo e imágenes,
no sólo número de llamadas. El flujo de cobro sigue esperando `recordSale` antes
de montar el éxito y el ticket. Configuración usa el CfgToggle existente.

## Referencias

- Manual Browser Print entregado por el usuario el 01/10/2026.
- H-153, H-179, H-180; `docs/02-architecture.md`.
- https://developer.chrome.com/docs/android/intents
- https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/content/Intent.java
- https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/net/Uri.java
