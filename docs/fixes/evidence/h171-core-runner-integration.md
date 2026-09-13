# H171 — integración de la jornada UI en el certificador preparado

Estado: implementación y pruebas locales; **live cerrado, certified=false**. No se ejecutó el runner contra Supabase ni se generó HTML desde esta subtarea. Commit: Pendiente de commit.

`test-h164-live-online.mjs` conserva los 22 escenarios históricos y añade un caso UI inmediatamente antes del retiro de equipos. El flujo previsto cierra la sesión de C desde la interfaz, vuelve a entrar, busca familia/talla/color, agrega una variante al carrito, verifica el efectivo, elige al vendedor QA de C, confirma, inspecciona e imprime el ticket hacia un iframe instrumentado, consulta existencias y venta, recarga y vuelve a consultar. Después B/A/C reconstruyen y comparan sus proyecciones con la autoridad remota mediante las lecturas existentes. El caso exige una partida, un pago de116, stock2+2 y conservación de las filas comerciales del baseline. La venta genérica debe guardar `cliente_id=null`; no asigna ni cambia un cliente real.

Los primeros siete productos mantienen sus posiciones y comportamiento histórico. Dos UUID adicionales quedan en `fixtures.products[7:9]` y en `fixtures.coreJourney` antes del primer `save` y del aprovisionamiento. Su familia es el primer UUID, las cantidades son3+2 y el precio116. Se obtiene una talla activa y dos colores distintos del catálogo vigente; la preparación reutiliza `DATA.createReference` y realiza un único `DATA.saveProductRows` por el gateway. No modifica configuraciones ni usa productos existentes. Ausencia de catálogo válido, dos colores o colisión con una identidad presente bloquea la preparación.

El libro durable recibe antes del aprovisionamiento una entrada `kind: 'fixture-plan'`, mediante `journal.prepare`, **sin solicitud HTTP**. Tiene `requestId=run`, los nueve UUID, el subconjunto UI y el plan inmutable de familia/cantidades/precio. Se excluyen observaciones y ticket posteriores para conservar la misma huella al reanudar. El reconciliador debe tratarla como metadatos y comprobar su identidad, no como una mutación. La creación de productos y la venta siguen cubiertas por `execute_online_command` y por `guardedBrowserRoute`; no se añadieron interceptores HTTP que evadan el libro.

Un checkpoint UI incompleto con recibo confirmado detiene la reanudación y pide conciliación exacta. No vuelve a vender. Un checkpoint completado devuelve su evidencia sin accionar la interfaz otra vez. Una respuesta incierta tampoco se convierte en PASS por consultar directamente DATA. La integración nueva no crea cuentas Auth; reutiliza las terminales y credenciales ya previstas por el runner. Estas últimas sólo se pasan en memoria al helper y no se guardan en sus resultados. Los errores del bloque de login se convierten en `CORE_UI_LOGIN_FAILED` para evitar que los call logs de Playwright impriman un valor introducido.

## Contrato de cierre de sesión

Se añadió únicamente `data-testid='auth-logout'` al botón existente de `balam/app.jsx`. Navigator → client/delivery y R-DEL-10 exigen un contrato estable; antes sólo había un título visible y el handler. Es un atributo inerte: no cambia el handler, permisos, aspecto ni semántica de Auth. El coordinador autorizó ese cambio dentro de H171 y conserva la responsabilidad del build único final.

`runCoreJourney(page, expected, {relogin:true, onStep})` añade la etapa de logout mediante ese atributo. El menú móvil se abre por `aria-controls`/`aria-expanded`. El resto sigue usando los contratos previos del artefacto. El observador de impresión espera realmente la entrega al iframe, guarda el ticket y sus huellas y declara `hardware: NOT_TESTED`; no acredita papel ni periféricos.

## Pruebas

- Gate existente:5/5 PASS. El runner real sigue rechazando altas/resume y falsas excepciones antes de leer fuentes, consultar credenciales, crear archivos o enviar solicitudes.
- Recuperación histórica:10/10 PASS. Se conservan las defensas del intento confirmado y del reintento acotado ya revisado.
- Integración del libro existente:10/10 PASS. Incluye rutas tardías, fallas de escritura, separación de claves y cierre durable.
- `test-h171-core-runner-integration.mjs`:10/10 PASS. Ejecuta los cuerpos reales de planner/seed/checkpoint mediante VM y libro real con DATA/transporte falsos. Prueba IDs/posiciones, plan estable, seeding acotado, bloqueos, no repetición de UI y omisión de credenciales en errores. Las aserciones de presencia del atributo y posición del caso son sólo presencia, no ejecución UI.
- Helper aislado actualizado:8/8 etapas PASS sobre `cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437`, sin logout. Una venta y pago simulados, dos recibos, cero red externa permitida y reconstrucción tras reload. Evidencia: `h171/core-journey-runner-integration-cf32/journey.json`, screenshots y ticket HTML.
- Sintaxis Node y `git diff --check`: PASS.

La primera ejecución de los tests nuevos detectó que los objetos construidos en otro realm de VM no tenían el prototipo de los objetos Node que acepta el libro. El harness usa ahora el mismo contexto para los helpers Node; el aislamiento de DATA del navegador permanece separado. No se cambió el validador del libro para admitir esos objetos.

La rama de nueve etapas con logout **no queda acreditada sobre cf32**, que todavía no contiene el nuevo atributo. Después del build del coordinador debe ejecutarse contra el SHA256 verificado del nuevo HTML, en una carpeta de evidencia distinta:

```powershell
$env:BALAM_CORE_JOURNEY_EXPECTED_SHA256 = '<SHA256 verificado del nuevo HTML>'
$env:BALAM_CORE_JOURNEY_RELOGIN = '1'
$env:BALAM_CORE_JOURNEY_OUTPUT = 'docs/fixes/evidence/h171/core-journey-candidate-final'
node qa-h171-core-journey.mjs
```

El modo aislado realiza primero un login UI de preparación; la jornada hace logout local y segundo login UI, con nueve etapas. Su fixture intercepta y comprueba `logout?scope=local`. La variable SHA exige un hash hexadecimal explícito y lo compara con los bytes leídos; no deduce el valor esperado del mismo archivo. Sin variable conserva el guard histórico de cf32. Estas variables no abren el runner live ni alteran sus banderas de certificación.

La limpieza exacta, el baseline canónico, la conciliación, el candidato final y la certificación remota siguen bajo el corte principal H171. Ninguna de estas pruebas locales acredita por sí sola Supabase, A/B/C reales, hardware o aptitud final de entrega.
