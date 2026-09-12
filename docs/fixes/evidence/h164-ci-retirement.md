# H164 — retiro de rutas CI local-first

El workflow vigente es `.github/workflows/h164-online-authority.yml`.
Este registro describe configuración y retiro de CI. La ejecución aprobada
se identifica al final; no certifica las instalaciones reales. Los resultados
verificables se registran en la corrección H164 y los artifacts de cada ejecución.

| Ruta retirada | Motivo | Conservación |
|---|---|---|
| `h148-sync-authority.yml` | Ejecutaba contratos de cola, replay, cursor, checkpoint y recovery retirados; publicaba otro gate de arquitectura. | YAML anterior en Git; arneses e informes históricos permanecen. |
| `h132-inventory-identity.yml` | Duplicaba build y mantenía un certificado ligado al cliente anterior. | Pruebas originales permanecen; H164 verifica V2, barcode V3 y etiquetas en su artefacto actual. |
| `h157-cleanup-publication.yml` | Excepción limitada a bytes aprobados de H157, incompatible con el cliente H164. | Commit y evidencia exacta de aquella publicación permanecen. |

La ruta nueva ejecuta una vez cada arnés de contrato actual: guardia arquitectónica,
cadena de migraciones, SQL local, transporte, DATA, CONFIG/AUTH/PWA, recibo de
cuentas, mensajes, identidad estable, feedback de teclado, callbacks de cliente,
UI del bundle y caché PWA real.
`package.json` expone comandos individuales;
los escenarios de cada arnés no se multiplican en workflows paralelos.

La guardia arquitectónica usa el Babel fijado en el almacén local: descubre los
exports DATA/STORE y sus consumidores, incluidas llamadas a `CORE.invokeSync`,
rechaza APIs comerciales retiradas, RPC no registrados, escrituras directas de
tablas Supabase y persistencia comercial. Reconoce la cola técnica de impresión
y los archivos legacy como responsabilidades distintas, sin concederles replay.
Su fixture de sensibilidad comprueba que las infracciones realmente la hacen fallar.

PGlite `0.5.8` procede del lockfile compartido. No se añaden versiones ni descargas
ad hoc de dependencias durante la prueba SQL. El cliente se construye una vez;
Pages y la matriz live consumen los mismos archivos producidos por ese job.

Después del build, `git diff --quiet` exige que HTML, Service Worker, manifest
e iconos coincidan con el commit antes de probar/publicar. `.gitattributes`
conserva bytes de los HTML generados y `sw.js`, y fija LF para las fuentes.
La revisión H164 comprobó que normalizar a LF las entradas JSX no cambia su
salida Babel y que los 46 recursos vendorizados coinciden con sus hashes.
El staging `_site` sólo copia los dos HTML, `sw.js`, manifest e iconos `pwa`;
no incluye inventarios, catálogo SQL, scripts, capturas remotas ni secretos.

La ejecución live requiere dispatch explícito, `main` y secretos servidor. No se
ejecuta con secretos en PRs. Conserva evidencia aun ante fallos y no realiza Punto
Cero ni limpieza por prefijos. Esa matriz acredita sólo los casos y contextos
que ejecuta: no demuestra adopción ni reconciliación de equipos reales ausentes.

## Entrega comprobada

[CI 34683481979](https://github.com/David14081982/POS_Balam/actions/runs/34683481979)
del commit `df4965b1269239665594eca722c38c9adb86cb68` terminó con regresiones y
despliegue SUCCESS. El artifact `online-ui.json` registra seis escenarios PASS;
`online-pwa.json`, dos escenarios PASS con `activationUsesSource:false`.
Ambos corresponden al HTML
`25bc985dce9bbe92e83f8dc9c61c6f1cf90fd0b1904dfe09d7bdfd594201d96f` y PWA usa
el SW `5b43e72ad8fe5ca2a398f75530057010420ddfbdb4ccf730fcc4f535424d06b1`.
La copia descargada está en `.evidence-h164/ci-34683481979/`.
CI 34681857847 y el commit anterior `0f05350` permanecen como historia de la
primera entrega aprobada; el HTML y Service Worker no cambiaron de bytes.

La [verificación de Pages](h164-online-pages.json) contrastó ambos archivos
contra el commit a las 08:34:42.109 UTC del 12/09/2026: MATCH. El job live se
omitió intencionalmente: la [matriz comercial A/B/C, resumen público](h164-live-online.json)
ya terminó 20/20 PASS, certified=true y retiro QA completado; no se repitió.
Adopción e inventario de equipos físicos siguen pendientes. La entrega
documental posterior se refiere a este commit técnico y no ejecuta otra vez
las pruebas por cambios únicamente de prosa o evidencia.
