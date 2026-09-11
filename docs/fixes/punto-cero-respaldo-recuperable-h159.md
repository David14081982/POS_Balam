# Punto Cero: respaldo recuperable y diagnóstico operativo

**Riesgo:** H-159
**Estado:** CORREGIDO Y PUBLICADO; convergencia certificada. Punto Cero global pendiente.
**Fecha:** 11/09/2026
**Commit técnico:** `5f9eb63639182494a953b5e7f6e85aa636b94550`

## Problema y reproducción

El respaldo de Punto Cero aparece deshabilitado con cero cambios pendientes y
cero bloqueos. El usuario requiere vaciar inventario y operaciones, conservando
configuración, catálogos, usuarios, roles/permisos, constructor SKU, métodos de
pago, logotipo y tienda. El alcance de borrado y las confirmaciones se conservan.

La lectura real del preview reproduce los conteos de la captura: 2,386 productos,
3,502 piezas, 13 clientes no genéricos, tres commits de venta, uno de cambio, uno
de liquidación de apartado, un canje y 30 contadores; documentos operativos cero.
Las consultas fueron de lectura, sin respaldo ni ejecución. Los 13 clientes ya
tenían `deleted_at`. Los 14 equipos declaraban cola/bloqueos 0/0; seis estaban
retirados, seis requerían reconstrucción y dos tenían estado online sin señal
reciente al consultar. El preview devolvía 14 equipos sin sincronizar.

En Chrome sobre el HTML publicado H158, abrir durante sincronización y emitir
su recuperación deja el diálogo bloqueado: las consultas permanecen 2→2.
H157 había reparado la tarjeta selectiva, pero su prueba sustituía el preview de
Punto Cero por uno siempre listo. La reproducción inicial H159 dio 1/6: tres
fallos funcionales y dos casos que aún necesitaban selectores estables; estos
últimos no se presentan como defectos del producto.

El arnés SQL aislado ejecuta las definiciones reales de preview, respaldo,
ejecución, purga y huellas con tablas sintéticas. Baseline 10/15: los retirados
bloqueaban, su cola histórica se sumaba, las lápidas contaban como clientes y
la ejecución con clientes eliminados terminaba en `point_zero_postcondition_failed`.
El escenario de residuos huérfanos se detenía antes del respaldo con
`point_zero_not_synchronized`. La transacción fallida revertía correctamente,
pero no alcanzaba el resultado esperado.

## Causa raíz

`PointZeroWizard` conserva una copia de `preview.ready` al abrir. No se suscribía
a la recuperación ni ofrecía una revisión dentro del modal. Un rechazo por
preview cambiado también dejaba el mismo token obsoleto disponible para reintentar.

La última definición de `point_zero_preview` (migración 14100) seguía incluyendo
`status='revoked'` en las sumas y en el requisito de equipos online, aunque el
retiro es durable y las escrituras están cercadas por H154. Además contaba
clientes no genéricos eliminados lógicamente. H68 preserva sus lápidas, mientras
H98 exige cero operativo después de la purga: ese conteo hacía fallar el cierre.

## Diseño

Conservar la autoridad de PostgreSQL y el flujo diagnóstico → respaldo sellado y
descarga → frase exacta → confirmación final → ejecución → comprobante.
Revisar automáticamente sólo durante el diagnóstico; congelar la evidencia que
acompaña el respaldo y revalidarla en las RPC existentes. Un rechazo por cambio
obliga a revisar y generar otro respaldo. Ningún evento crea respaldo ni borra.

Excluir únicamente instalaciones retiradas de la flota operativa. Los equipos
activos siguen necesitando época vigente, señal reciente y cola/bloqueos cero.
No se atribuye sincronía a equipos ausentes. La revisión enumera los impedimentos
por equipo para que el administrador pueda resolverlos por el flujo existente.
Contar clientes activos preserva las lápidas y evita ampliar la eliminación.

## Solución

- `balam/settings.jsx`: revisión recuperable en `PointZeroWizard`, petición
  secuenciada, agrupación de eventos, descarte tras cierre y pausa durante
  respaldo/confirmación. Motivos locales y remotos explícitos. Los errores SQL
  y cliente por cambio de preview invalidan respaldo y frase.
- Migración `20260911020400`: generada desde `pg_get_functiondef` real; compara
  MD5 anterior antes de cambiar cuatro bloques de `point_zero_preview`.
  Filtra retirados, cuenta clientes activos y entrega `blocked_devices` y el
  conteo retirado. No modifica purga, ejecución, payload ni huella conservada.
- Migración `20260911020500`: verificación de autoridad y acceso negativo en
  transacción de sólo lectura con rollback. Conserva los grants y search_path.
- Nuevos arneses H159 en CI. H98 E2E abre el detalle técnico antes de afirmar su
  identificador; la presentación del producto ya lo mantenía plegado.
- HTML/offline/SW regenerados desde fuente. STORE, DATA, CONFIG, AUTH, impresión
  y el flujo selectivo no cambian por esta historia.

## Pruebas

| Verificación | Resultado |
|---|---|
| H159 navegador, 390 px | 11/11 |
| H159 navegador, 1280 px | 11/11 |
| H159 SQL aislado con funciones reales | 15/15; baseline 10/15 |
| H98 contrato y wizard | 24/24 y 18/18 |
| H157 eliminación selectiva | 4/4 |
| AUTH y regresión H158 | 28/28 y 8/8 |
| Contratos de módulos | 42/42 |
| Cola durable | 186/186 |
| Navegación y smoke bundle | 15/15 y 17/17 |
| Cadena de migraciones | 31/31 |
| Guarda de publicación H155 | 5/5 |
| Migración 205 real | autoridad, acceso y conservación correctos; cero escrituras comerciales |
| Certificación real A/B/C | 29/29; 16 dominios; cero pérdidas y divergencias |

Los 11 escenarios cubren recuperación, bloqueo remoto legítimo, red/reintento,
cambio antes y después del respaldo, confirmaciones, errores SQL en minúsculas,
cierre durante preview/respaldo, respuestas fuera de orden al reabrir y motivos
por equipo. Las pruebas SQL cubren las 21 familias del respaldo, los ocho grupos
protegidos, guardas, residuos sin documentos, idempotencia y rollback inducido.
Las tablas y la autenticación del arnés SQL son sintéticas: no sustituye RLS ni
una ejecución distribuida contra Supabase.
La certificación A/B/C se limita a la convergencia del artefacto; no ejecuta un Punto
Cero global contra los datos comerciales. Ese recorrido real de limpieza queda
**NO CERTIFICADO**, pendiente de resolver la flota activa y realizar el respaldo
y la ejecución operativa. El éxito SQL aislado no se presenta como ese recorrido.

El primer intento A/B/C aprobó 25 casos y falló en la reapertura de C, antes
de cargar el manifiesto (`compatibility=legacy`, `dataEpoch=null` y sin última
lectura). El arnés esperaba `AUTH.hasSession()` y el escritor local; esa condición
puede cumplirse mientras AUTH aún resuelve el perfil y STORE inicia su sesión
administrada. Tres llamadas inmediatas al reconciliador no esperan ese inicio.
Se ajusta sólo la barrera del arnés: observar identidad resuelta, protocolo y
época correctos y sincronización automática antes de comparar otra vez contra
Supabase, con plazo máximo de 120 segundos. No fuerza el arranque ni altera las
aserciones de documentos. El artefacto del producto conserva su hash.
El intento fallido terminó con limpieza exacta y conservación de las 17 tablas
verificadas; evidencia completa `evidence/h159-live-first-attempt.json`.
El ensayo específico posterior aprobó 3/3 (arranque, referencias y reapertura),
con limpieza y conservación correctas: `evidence/h159-reopen-check.json`.
Esa matriz conserva `partial=true` y no habilita publicación por sí sola.
La segunda ejecución completa del 11/09/2026, 22:18:03–22:42:36 UTC, aprobó
29/29 escenarios y la puerta estricta `test-h148-sync-certification.mjs`.
Limpieza exacta y conservación de las 17 tablas: correctas; cero pendientes
perdidos y cero divergencias finales. Evidencia canónica:
`evidence/h148-live-matrix.json`. SHA-256 del certificador:
`82081ebea74289347429ee3a0d6ed6febdfa54451c62013d1deac8f1fdae1096`.

La regresión histórica H68 no se declara aprobada: su ruta absoluta apunta a
otro checkout. Una copia temporal que cambia sólo esa ruta ejecuta 15 aserciones
y falla al leer un producto tras recibir inventario remoto vacío del mock.
El mismo fallo, con 11 aserciones derivadas y aborto posterior, se reprodujo
contra el HTML de `HEAD 57de058` anterior a H159. No se modifica ese arnés ni el
contrato de snapshots para resolver un defecto ajeno. H159 sí ejecuta la purga
SQL real y sus postcondiciones en el escenario aislado completo.
Evidencia de la regresión histórica: `evidence/h159-h68-baseline.txt`.

Las migraciones 204/205 se aplicaron tras `db push --dry-run`, que listó sólo
esas dos. La lectura posterior mantiene 2,386 productos y 3,502 piezas; devuelve
cero clientes activos, seis retirados excluidos y ocho equipos activos pendientes.
No se creó un respaldo real ni se llamó `execute_point_zero` durante ese proceso.
La comparación de `pg_get_functiondef` confirma cinco funciones idénticas antes
y después: respaldo, ejecución, payload, huella conservada y purga. Sólo cambia
el preview (MD5 `facb9404…` → `ce5b00b4…`); evidencia:
`evidence/h159-sql-deployment.json`.
La lectura final del 11/09/2026 a las 22:46:39 UTC conserva esos productos y
piezas, cola y bloqueos cero y ningún Punto Cero activo. En ese momento la flota
mostraba ocho retirados y seis instalaciones activas pendientes. El agente no
ejecutó retiros; ese estado se registra sin atribuir la variación a esta
corrección. Evidencia de sólo lectura: `evidence/h159-final-preview.json`.

Evidencias: `evidence/h159-ui-before.json`, `h159-ui-after-390.json`,
`h159-ui-after-1280.json`, `h159-sql-before.json`, `h159-sql-after.json` y
`h159-selective-regression.json`.
Capturas sintéticas `h159-ready-390.png` y `h159-blocked-1280.png`: respaldo y
footer visibles, sin desbordamiento. Los conteos de esas capturas son fixtures,
no un diagnóstico posterior de la base comercial.
SHA-256 del HTML/offline probado:
`6678d9d1c2eac11f1b670017e8fec4c716e7f9b763c1f26e631e423aab22fd85`.

## Riesgo residual y pendientes

Entrega publicada desde `main`: H148 `34655403188` (regresión y Pages) y H132
`34655403158` concluyeron correctamente, sin repetir CI. Pages verificado el
11/09/2026 a las 22:50:54 UTC: 10/10 respuestas HTTP 200 idénticas al commit,
incluida la raíz sin parámetros. Evidencia: `evidence/h159-pages.json`.
El HTML, el offline y el certificador conservan los hashes registrados arriba.

La ejecución operativa requiere resolver las instalaciones activas pendientes;
se pidió identificar los equipos/navegadores vigentes antes de alterar su estado.
La revisión operativa está en Configuración → Negocio → Centro de equipos →
Equipos. Una instalación vigente debe conectarse y completar su actualización;
una instalación reconocida que ya no se usa puede retirarse mediante el flujo
administrativo existente. Después se vuelve a Administración / Datos → Abrir
Punto Cero → Revisar de nuevo. La herramienta «Establecer punto cero» del centro
de sincronización tiene otro propósito y no sustituye esta limpieza.
El agente no retiró instalaciones ni borró datos comerciales; sólo creó y
eliminó los registros temporales de sus pruebas autorizadas.
El respaldo es JSON sellado; H98 no proporciona una restauración automática.
Una pestaña abierta puede seguir ejecutando el cliente anterior hasta actualizarse.

## Decisiones verificables

El defecto es una revisión congelada y dos incompatibilidades con estados
históricos, reproducidos en navegador y SQL. La autoridad sigue siendo H98;
la UI proyecta su diagnóstico y no calcula un plan alternativo. No cambian
fórmulas financieras ni documentos históricos. Clientes con lápida, retiros y
colas permanecen conservados; una instalación retirada conserva su cerco de
escritura H154, verificado también por su matriz real histórica. La ampliación
del preview es aditiva para los clientes anteriores. Administrador/capacidad y
modo se verifican otra vez en servidor. La nueva prueba recorre las transiciones
que los mocks siempre listos de H98/H157 omitían, además del éxito SQL completo.

## Referencias

- `docs/03-known-risks.md`, H-159; antecedentes H98, H154 y H157.
- `docs/fixes/punto-cero-administrativo.md`.
- `docs/02-architecture.md`, Punto Cero y sincronización.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16/17.
