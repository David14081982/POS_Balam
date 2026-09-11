# H-155 — Sincronización automática consistente entre equipos

**Riesgo:** H-155; H-154 reservado por el trabajo previo no publicado.
**Estado:** CORRECCIÓN VERIFICADA Y PUBLICADA — matriz A/B/C aceptada; adopción física pendiente.
**Fecha:** 11/09/2026.
**Commit técnico y desplegado:** `be333e16627b42a2dee6cfd280244fe2894cc31e`.

## Problema y reproducción

El usuario autoriza corregir quirúrgicamente la sincronización automática y
probar la conservación de las funcionalidades. Supabase, consultado el 11/09
a las 08:40 UTC, conserva la última señal de EIFBB1: siete upserts pendientes,
cero bloqueados y `P0001 / REFERENCE_RECLASSIFICATION_REQUIRED` clasificado
`unknown / auto_retry`. Productos permanece en 1016 mientras configuración
avanza de 354 a 365. La lectura actual no demuestra presencia actual del equipo.

CORE/STORE reales reprodujeron el reenvío idéntico y bloqueo de productos con
configuración avanzando. De 975 V2 no eliminadas consultadas, 64 cambian sólo
el orden de colores al hidratar; todas tienen identidad bloqueada. El censo
puede incluir pruebas y no identifica los siete payloads originales.

También se reprodujeron arranque sin servicio automático tras una petición
fallida, objetos anteriores en POS después del pull y configuración antigua
reenviada por un blur sin edición. Los dos últimos fallan en Chromium sobre el
HTML público `cf872aa8848ead631fc6984b253d5f4242b10f063b919f3d0365480999ed9ce8`.

## Causa raíz

La guarda SQL interpreta el orden de una multiselección como identidad; el
clasificador omite el rechazo permanente y la cola protege todo el dominio.
El arranque instala sus reintentos después de dependencias remotas falibles.
Consumidores de DATA y campos no controlados retienen representaciones viejas.

La regresión SQL local encontró otra causa de divergencia en ambas RPC: el
trigger H133 de BEFORE INSERT elimina `sync_base_version`; ON CONFLICT recibe
NULL y omite la comprobación de versión en UPDATE. Reproducción sin H155:
stock 5/v1, A confirma stock 4/v2, B reenvía precio con base 1; UPDATE directo
preserva 4/v2, pero ambas RPC restauran 5/v3. Prueba real PGlite 2/4; no se
ejecutó esta reproducción contra filas comerciales. La corrección de esa
barrera se integra en H155 antes de permitir convergencia de escrituras.

### Hallazgos y primera capa incorrecta

| Prioridad | Evidencia / primera capa | Impacto y alcance | Corrección |
|---|---|---|---|
| P0 | `guard_entity_version` H133 borra la base en BEFORE INSERT; ambos UPSERT reciben EXCLUDED sin base. Probe sin H155: 2/4; con 202: 4/4. | Una edición obsoleta puede revertir stock/precio confirmado del mismo producto en cualquier equipo. | 202 recupera la base original de `p_rows` por ID exacto en las dos RPC; conserva guardas y semántica legacy. |
| P1 | `STORE.classifyFailure`, `domainBlocked` y envío inmutable: siete rechazos permanentes siguen reteniendo todo products. | Una intención fallida impide recibir cambios válidos del catálogo; otros dominios avanzan. | Archivo selectivo con original durable y ACK remoto; incluye `product_version_conflict` para que 202 no produzca otro bloqueo. |
| P1 | `initializeStore` retorna antes de completar el servicio; recuperación/manifiesto fallibles. | Un fallo de arranque deja sin recepción automática o sin reanudar `auth_required`. | Coordinador instalado antes de dependencias y marca de inicialización completa; retoma etapas pendientes una sola vez. |
| P1 | `heartbeatDevice` interpreta un fallo de consulta de sesión como transporte legacy sin revisiones. | El equipo puede mostrar actualizado aunque un expediente siga pendiente; no implica pérdida de su original. | Sólo el transporte sin sesión administrada admite la excepción legacy; una identidad no confirmada conserva revisión desconocida e impide verde. |
| P1 | `DATA.canonicalReferenceOrnamentColors` ordena; guarda H94/H133 compara arrays ordenados como identidad. | Rechaza ediciones sin cambio físico de referencias multicolor bloqueadas; 64/975 susceptibles en el censo consultado. | 200 acepta sólo permutaciones exactas de strings, conserva multiplicidad, otros campos y NEW para el ACK. |
| P2 | `POSScreen` memoiza catálogo sin revisión DATA; modales/clicks conservan objetos anteriores. | Pantalla y nueva selección pueden usar precio/stock anterior tras recibir datos correctos. | Revisión DATA/config y resolución por ID al seleccionar; mantiene precio de renglones iniciados. |
| P2 | `CfgText` y `FolioPrefixField` conservan `defaultValue`; blur publica sin intención nueva. | Un equipo puede mostrar y reenviar valores anteriores de configuración/prefijo. | Controles reactivos con borrador explícito, comparación vigente y escritura sólo ante edición real. |

La relación entre la clasificación permanente y el bloqueo de EIFBB1 está
confirmada por telemetría y reproducción. El contenido íntegro de sus siete
intents no está disponible en Supabase; no se atribuye cada uno al orden de
colores ni se declara que esos siete ya hayan sido aceptados o revisados.

## Diseño

Una historia: recepción automática y representación coherente de datos
compartidos. Conservar IDs, barcodes, V1/V2, stock, documentos históricos,
permisos, transacciones, versiones, épocas, escritor único y cola por sesión.

Aceptar únicamente permutaciones exactas de colores en la guarda compartida,
sin deduplicar, convertir tipos o aceptar cambios en otros campos físicos.
Conservar NEW para que el ACK estricto coincida; sin backfill de productos.
Archivar rechazos permanentes mediante el mecanismo existente, con original
durable y ACK remoto antes de separar la intención de la proyección operativa.
Un archivo pendiente nunca equivale a éxito comercial.

Recuperar el arranque incompleto sin depender de un manifiesto previo; conservar
las barreras de sesión, recuperación, actividad y escritor. Actualizar los
consumidores sin reiniciar borradores ni cambiar tickets ya iniciados. Guardar
campos de configuración sólo ante una modificación real del usuario.

Fuera del alcance: limpieza global, descarte de los siete intents, decisiones
comerciales sobre las 57 cuarentenas antiguas, retiros y rediseño de impresión.
H-154 se reutiliza selectivamente después de revisión; no se importa completo.

## Solución

Implementación completa. Base aislada `ad3966ab21db2f27a44980d4885eb3df7865a7c4`, rama
`fix/h155-automatic-sync`; copias originales y trabajo H-154 preservados.

11/09/2026: CLI oficial `db push --linked --dry-run` confirmó únicamente
200–203; `db push --linked --yes` aplicó las cuatro migraciones y ejecutó sus
verificaciones sin error. Las guardas de deriva comprobaron los cuerpos vivos
H133/H138 antes de generar los cambios; propietario, ACL y search_path se
conservaron. Las migraciones históricas 198/199 ya estaban aplicadas y se
incorporan al repositorio sin reejecutarlas.

La autenticación manual de Windows fue rechazada por revisión automática y
no se repitió. La autenticación oficial existente de Supabase CLI funcionó.
Sus comandos de despliegue inicializan su rol temporal normal de conexión;
esto se distingue expresamente de las lecturas PostgREST sin escritura del
diagnóstico. No se aplicaron roles personalizados ni semillas comerciales.

La clasificación y el archivo selectivo cubren también
`product_version_conflict` en upserts de productos: corregir el servidor y
dejar el conflicto permanente en la cola volvería a congelar el catálogo.
No se cambia automáticamente la base enviada ni se da una revisión por éxito.

STORE instala el coordinador antes de las peticiones fallibles y reanuda las
etapas pendientes del arranque una sola vez. Conserva barreras de sesión,
escritor y actividad, incluso si una respuesta llega después de cerrar sesión.
POS vuelve a derivar el catálogo al cambiar DATA/config y resuelve nuevas
selecciones por ID; no altera el precio acordado en renglones ya iniciados.
Configuración y prefijo reaccionan al valor confirmado sin borrar borradores
activos ni escribir por un simple foco/blur.

La entrega añade regresiones para estas causas y condiciona Pages al éxito
del trabajo de regresión, las guardas existentes de inventario/etiquetas y un
certificado real del mismo HTML y certificador. Dos checkouts con
`core.autocrlf=false/true` producen el mismo artefacto; el job recibe sólo los archivos
necesarios para servir la aplicación.

## Pruebas

Resultados sobre las fuentes finales y el HTML
`8883393ca53d880e5af59ad34113e4c912e886308ec8f697df09a9e4b5ae32d0`:

| Prueba | Resultado y alcance |
|---|---|
| `test-h155-auto-sync.mjs` | 23/23; 12 fallos iniciales, carreras adicionales de logout y arranque incompleto reproducidas antes de corregir. Incluye sólo IndexedDB/openCursor, recarga, replay, cuota, ACK perdido y siete conflictos permanentes. Los dos negativos de sesión administrada dan 21/23 antes de la última guarda y 23/23 después; legacy explícito sigue operativo. |
| `test-h155-ornament-order-sql.mjs` | 41/41 en PostgreSQL PGlite; baseline orden 0/2, probe versión 2/4→4/4. RPC completas y ACK STORE real; auth/recuperación son dobles explícitos. |
| Migraciones 200–203 | Aplicadas en Supabase por CLI oficial; verificadores SQL temporales ejecutados sin error y metadatos conservados. |
| `test-h155-ui-sync.mjs` | 17/17 sobre bundle final sin superponer fuentes. Original 1/15; prefijo 15/17 antes de su corrección. |
| Smoke / navegación / PWA | 17/17, 15/15 y 19/19; Chromium real y red comercial bloqueada. PWA prueba SW, subruta y offline local. |
| H148 / H149 / cola | 15/15, 15/15 y 186/186, repetidos tras la última guarda de sesión. |
| Durabilidad / H151 / H152 | 32/32, 12/12, 9/9 finales. En el artefacto anterior H151 dio 10/12 bajo carga y pasó aislado sin cambiar prueba ni timeout; la ejecución final pasó al primer intento. Se conservan todas. |
| Concurrencia / carreras / foco / contratos | 15/15, 5/5, 20/20, 42/42. |
| Impresión H153 y ticket | 80/80 + 3/3 + 12/12 + 23/23; 26/26 verificaciones independientes de PNG/PDF y revisión visual de ticket largo/devolución. Sin hardware físico. |
| Cadena / gate / publicación | 31/31, 29 certificados falsos rechazados y 5/5 contratos de publicación. Son controles locales, no certificados reales. |
| Guardas CI de identidad y etiquetas | H132 7/7 + 2/2, H127 11/11, H99 23/23, H100 10/10; el mismo HTML final, cero red comercial. |
| EOL | Antes: 36 entradas divergentes entre checkouts con autocrlf=false/true; después: 38/38 idénticas y dos builds idénticos ejecutados en Windows. |

El adaptador local de Chromium cambia sólo el ejecutable de pruebas históricas;
para PWA también confina HTTP externo. No sustituye lógica del producto ni
respuestas de Supabase en la prueba A/B/C real. Evidencias locales detalladas en
`.evidence-h155-live/`, resúmenes versionados en `docs/fixes/evidence/`.

La revisión independiente posterior reprodujo una confirmación falsa si
`getSession` falla con una sesión administrada y un expediente pendiente.
Por ello la primera ejecución A/B/C del HTML `cb11eefc…` se conserva como
evidencia intermedia y no certifica el artefacto posterior a esta corrección.
Terminó 29/29 a las 15:23:08 UTC, con limpieza correcta y conservación de las
17 tablas comparadas. La aceptación requiere repetir íntegramente la matriz
sobre el nuevo HTML.

La segunda ejecución (`ff47eb77-d162-4f5d-9069-0e346c94ad74`) se rechaza:
3 casos aprobados, H149 boot 17 bloqueó una captura durante recuperación y el
cierre de Chromium excedió 15 segundos bajo carga compartida. Terminó a las
15:30:54 UTC; conservación de las 17 tablas correcta y todas las eliminaciones
exactas ejecutadas, pero `cleanup.ok=false` por el cierre del navegador.
No se cuenta esta matriz parcial como certificación ni se reduce la exigencia
de recuperación para aceptar una captura.

Reproducción determinista con CORE/STORE/AUTH reales y permisos retenidos:
`hasSession=true`, `AUTH.isReady=false`, perfil nulo y recuperación `ready`
satisfacían el predicado anterior del harness. Al resolver el perfil, el
`setSession` de App iniciaba la recuperación administrada y la captura directa
era rechazada correctamente. La espera del certificador ahora exige identidad
resuelta, escritor activo, STORE habilitado y sincronizado, recuperación lista
y ausencia de la pantalla de recuperación. La captura sigue ejecutándose una
vez, sin reintentar ni suprimir su guarda. Se repite la matriz completa con el
nuevo hash del certificador y el mismo HTML definitivo.

La tercera ejecución (`220eed6a-8e4c-41e6-92c3-9b34151b34a3`) terminó 29/29,
con limpieza y conservación correctas, a las 16:00:17 UTC, pero el filtro final
la rechazó: H151 había capturado `synchronized=false` para A/B después de la
espera que observó `true`. Su PASS no bastaba para aceptar esa evidencia.
El certificador ahora devuelve una instantánea del mismo predicado satisfecho,
con sesión resuelta, escritor activo y recuperación lista; la registra mediante
el JSHandle de esa observación y valida inmediatamente los campos. El filtro
conserva sus exigencias y añade una prueba negativa de este caso. Se requiere
una cuarta ejecución completa; la tercera permanece no certificada.

La cuarta ejecución (`d604289c-8a1c-4770-9d09-5de0c917c12e`) terminó el
11/09/2026 a las 16:30:12 UTC: 29/29 casos en 16 dominios, exit 0,
`cleanup.ok=true`, cero errores de limpieza y conservación semántica de las
17 tablas comparadas antes/después (la huella general excluye `updated_at`;
H149 también compara timestamps durante su recuperación). Cero pendientes
perdidos y cero divergencias finales en los escenarios ejercitados.
El filtro estricto aceptó tanto el original como la copia versionada en
`docs/fixes/evidence/h148-live-matrix.json`, con exit 0.

Artefacto HTML/offline: `8883393ca53d880e5af59ad34113e4c912e886308ec8f697df09a9e4b5ae32d0`.
Service worker: `aba921105c7f43946b922d2110f4c86e9da95734c9e51aa91a4570d28c32ce16`.
Certificador: `85c4c222c393239c8de546dcca2d46b77d38d5ea0f4afa1d75a04e7b27dcc865`.
STORE: `6acd2605836b3ac99a7209da1a85270e86399fc2696359344a9b3fd7379db23b`.

La aceptación exige A/B/C independientes contra Supabase real con fixtures
exactos, limpieza y conservación de datos ajenos, hashes finales del HTML y
certificador. No aceptar matrices sin finalización ni confundir certificación
del motor con adopción física de las instalaciones.

El caso remoto de configuración cambia una clave QA aislada y comprueba su
recepción automática en A/B/C; no reenvía una instantánea global ni certifica
el RPC de escritura `commit_config`, que no se modifica en esta historia.
Su evidencia declara `configCommitRpcExercised:false`. Los consumidores y sus
intenciones de edición se verifican por separado en las 17 pruebas de UI.

## Publicación verificada

El commit técnico está en `main`. El flujo
[H148, ejecución 34622914116](https://github.com/David14081982/POS_Balam/actions/runs/34622914116)
terminó correctamente: regresiones a las 16:38:53 UTC y despliegue a las
16:39:07 UTC del 11/09/2026. H132 también terminó correctamente en la
[ejecución 34622914156](https://github.com/David14081982/POS_Balam/actions/runs/34622914156).
La certificación real se ejecutó previamente desde este entorno y CI validó
su evidencia completa contra la entrega; el job manual `live-certification`
de ese push fue omitido y no se atribuye a GitHub una segunda ejecución A/B/C.

Pages utiliza ahora `build_type=workflow`: el despliegue depende del éxito de
las regresiones y del certificado del mismo artefacto. Se conservó la política
del entorno `github-pages`, que permite la rama `main`.

La lectura HTTP de las URL canónicas de
[BALAM publicado](https://david14081982.github.io/POS_Balam/) terminó a las
16:40:27 UTC: 10/10 respuestas 200 y SHA-256 idéntico al archivo local del
commit, incluidos raíz, ambos HTML, service worker, manifiesto y cinco iconos.
Evidencia: `docs/fixes/evidence/h155-pages.json`. No se reconstruyó ni cambió
el HTML certificado después de las pruebas.

La consulta PostgREST de sólo lectura de las 16:40:27 UTC sigue mostrando
EIFBB1 en `2026-09-09-h152`, con siete pendientes y última señal del
10/09 a las 21:31:32 UTC. La otra señal comercial más reciente también es
H152, del 11/09 a las 01:54:04 UTC. Son registros históricos, no una medición
de equipos conectados ahora ni evidencia de adopción de H155. Permanecen
57 expedientes `pending_review` y ocho `rejected`; no se descartaron pendientes
reales ni se modificó el mínimo global de versión.

## Riesgo residual y pendientes

Cliente publicado y verificado; adopción física pendiente. Implementación y
migraciones completas; regresiones y matriz A/B/C aceptadas sobre el artefacto
final publicado. A/B/C son tres perfiles independientes de Chromium contra Supabase
real, no una certificación de todos los equipos físicos instalados.
Los siete intents originales sólo pueden compararse desde su instalación.
No aceptar cambios físicos inválidos ni borrar pendientes para indicar verde.
La revisión de consumidores confirmó además H-156, P1 preexistente: los UPSERT
REST de clientes y promociones conservan el defecto de versión del guard
compartido. La matriz prueba su ciclo secuencial, no la concurrencia que falla
en PostgreSQL. Esta corrección y su certificado no equivalen a aprobación
global de BALAM; H-156 exige una corrección separada de esas autoridades de
escritura y nuevas pruebas reales de concurrencia.
No utilizar `supabase db query --linked` para el diagnóstico: su preflight crea
roles temporales. Las lecturas operativas usan PostgREST autenticado mediante
el flujo oficial existente de Supabase CLI, sin mostrar credenciales.

## Referencias

- `docs/03-known-risks.md`, H-155.
- `docs/02-architecture.md`, identidad, sincronización y cola offline.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16/17.
- `docs/fixes/convergencia-autoritativa-h148.md`.
- `docs/fixes/recuperacion-dirigida-h149.md`.
