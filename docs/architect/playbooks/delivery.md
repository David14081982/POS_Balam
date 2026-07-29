---
capa: reglas+aprendizaje
applies_to: [testing, documentation, deployment]
related_histories: [H-10, H-31, H-32, H-33, H-34, H-35, H-42, H-43, H-44]
severity_max: blocking
no_alcance: "No sustituye docs/01-engineering-methodology.md ni docs/fixes/_template.md."
---

# Playbook · Prueba, cierre, commit y despliegue

## Reglas

**R-DEL-01 · BLOCKING · No se declara una causa raíz sin reproducción o
evidencia equivalente.**
Origen: `docs/01-engineering-methodology.md` § 3 · `AGENTS.md`

**R-DEL-02 · BLOCKING · Una prueba no ejecutada no se declara aprobada.**
Si no puede ejecutarse, se documenta el motivo y el riesgo.
Origen: `docs/01-engineering-methodology.md` § 6

**R-DEL-03 · BLOCKING · Las migraciones se aplican antes de publicar el cliente,
y se verifican contra la base real.**
Nunca al revés. `db push --dry-run` antes, comprobación directa después.
Origen: H-32, H-34, H-35 · Antipatrón: `AP-08`

**R-DEL-04 · REQUIRED · El commit publica.**
El hook `post-commit` sube cada commit a GitHub automáticamente, así que un
commit sin evidencia completa es una publicación sin evidencia. Es un listón de
calidad, **no una puerta de autorización**: los commits técnicos y documentales
son parte del ciclo de la historia y no se consultan uno por uno.

**R-DEL-05 · REQUIRED · La reproducción previa falla, y su conteo se registra.**
«7 pasaron, 31 fallaron» es evidencia; «se verificó» no lo es.
Origen: H-34, H-35

**R-DEL-06 · REQUIRED · El cierre son dos escrituras.**
`docs/fixes/<corrección>.md` desde `docs/fixes/_template.md`, y la entrada de
`docs/03-known-risks.md` con estado, fecha, commit, pruebas, pendiente y riesgo
residual. Si el commit no existe todavía, `Pendiente de commit` y se reemplaza
después.
Origen: `AGENTS.md` · `docs/03-known-risks.md` § Regla de actualización

**R-DEL-07 · REQUIRED · El artefacto publicado se verifica byte a byte.**
El archivo servido por GitHub Pages debe coincidir con el `index.html` del
commit; se registra su SHA-256 en el documento de corrección.
Origen: H-33, H-34 · Decisión: `ADR-008`

**R-DEL-08 · REQUIRED · Convención de commits.**
`tipo(ámbito): resumen H-XX` para el cambio; el registro documental del hash va
en un commit aparte. No se mezcla el cierre documental de una historia con la
creación de un subsistema.

**R-DEL-10 · BLOCKING · Una prueba automatizada localiza los controles por
CONTRATO ESTABLE, nunca por texto visible, icono, orden o copy.**
Las pruebas validan comportamientos del negocio mediante contratos estables de
interaccion; jamas deben depender de elementos cosmeticos de la interfaz. Los
`data-testid` son **arquitectura de pruebas, no deuda tecnica**: son atributos
inertes en produccion y el unico punto estable cuando no hay rol ni estructura
que sirva.
Origen: H-42 · Antipatron: `AP-11`

**R-DEL-11 · REQUIRED · Toda regla de bloqueo importante se prueba
explicitamente.**
Si el negocio impide algo —cobrar sin capturar el efectivo, cambiar fuera de
plazo, consumir mas saldo del disponible— el arnes lo afirma **en los dos
sentidos**: bloqueado sin la condicion, libre con ella. Asi una validacion de
negocio se convierte en garantia permanente en vez de en un camino feliz.
Origen: H-42 (caso 14b del E2E del cambio)

**R-DEL-12 · REQUIRED · Las semillas de prueba representan un estado VALIDO del
negocio, no el minimo que compila.**
Un perfil de vendedor debe cumplir la elegibilidad real, una venta debe tener
sus importes coherentes, un producto sus existencias. Una semilla minima produce
falsos fallos que se confunden con defectos del producto y cuesta mas
depurarlos que escribirla bien.
Origen: H-42 (el modal de vendedor sin candidatos)

**R-DEL-13 · REQUIRED · Una mejora de UX se justifica con metricas
reproducibles del recorrido, nunca con estimaciones ni enumeraciones manuales.**
Toda reduccion de clics, de escritura o de tiempo se demuestra **instrumentando**
el recorrido antes y despues del cambio, con el mismo instrumento y el mismo
escenario. Contar los pasos leyendo el codigo es una estimacion, no una medida:
el propio autor del cambio es quien peor puede juzgar cuantas interacciones
cuesta su pantalla.
Origen: H-43

**R-DEL-14 · BLOCKING · Una optimizacion de UX conserva o AUMENTA las
validaciones de negocio que el recorrido ejerce.**
Reducir interacciones nunca puede lograrse retirando un control funcional. Si el
recorrido instrumentado ejercia N validaciones antes del cambio, despues debe
ejercer N o mas: menos interacciones **y** menos validaciones no es una mejora,
es una perdida de defensa disfrazada de agilidad.
`test-ux-metrics.mjs` lo hace comprobable — registra cada validacion atravesada
con su estado bloqueado y liberado — asi que la comparacion antes/despues de
`R-DEL-13` debe leerse **siempre en dos columnas**: interacciones y
validaciones. La primera puede bajar; la segunda, jamas.

La regla **no depende de que alguien lea el informe**. El instrumento compara
solo contra `ux-baseline.json` y **sale con codigo 1** si disminuyen las
validaciones, si aumentan las interacciones o si el recorrido deja de
completarse. Se ejecuta como las verificaciones de contratos y migraciones, y
una historia que lo rompa no puede darse por terminada.

    node test-ux-metrics.mjs                    mide y compara (falla si rompe)
    node test-ux-metrics.mjs --justifica "..."  admite MAS interacciones
    node test-ux-metrics.mjs --fijar "<motivo>" reescribe la linea base

`--justifica` libera **solo** la columna de interacciones: a veces un paso mas
es correcto —una confirmacion, un dato que faltaba— y entonces se declara el
motivo. Las validaciones no tienen valvula de escape: no existe motivo por el
que una optimizacion pueda ejercer menos defensas. `--fijar` es un acto
deliberado con motivo y fecha, no un atajo para poner el guardian en verde.
Origen: H-43

**R-DEL-15 · BLOCKING · Toda historia que prometa «mas rapido», «menos pasos» o
«menos costoso» trae su propio guardian con linea base.**
El mecanismo de `R-DEL-14` no es exclusivo de la interfaz: se aplica igual a
rendimiento, a procesos del punto de venta, a consultas y a cualquier
optimizacion. La forma es siempre la misma y se construye **antes** de tocar lo
que se va a optimizar:

| pieza | que es |
|---|---|
| coste | lo que la historia promete reducir: interacciones, milisegundos, lecturas, filas recorridas |
| garantia | lo que jamas puede bajar: validaciones ejercidas, filas correctas, invariantes comprobadas |
| completitud | que el recorrido u operacion siga terminando |
| linea base | el fichero versionado con las tres cifras, su motivo y su fecha |

El guardian mide las tres, compara y **sale con codigo distinto de cero** cuando
la garantia baja o la completitud se pierde. El coste es la unica columna
negociable, y su aumento se declara.
Sin esas cuatro piezas la historia no puede cerrarse, porque «quedo mas rapido»
sin cifra reproducible no es un resultado: es una impresion.
Origen: H-43 · Filosofia: principio 9

**R-DEL-16 · BLOCKING · Una historia que mejora una metrica REFIJA la linea base
antes de cerrarse.**
El guardian protege el suelo que tiene registrado, no el que se alcanzo. Si una
optimizacion baja el coste y no refija la base, la mejora queda **gastable**: la
siguiente historia puede devolver la mitad del terreno y seguir en verde, porque
sigue comparando contra el suelo viejo. El trinquete solo trinca si alguien lo
aprieta.
Se descubrio al cerrar H-44: el recorrido bajo de 14 interacciones a 11 y la
linea base seguia diciendo 14, asi que un retroceso a 13 habria pasado la
comprobacion en las dos columnas.
Refijar es parte del cierre, con motivo y fecha —`--fijar "<motivo>"`—, y ocurre
**despues** de que el guardian y la regresion esten en verde, nunca antes: una
linea base refijada sobre codigo sin probar convierte el guardian en un sello.
Origen: H-44 · Regla hermana: `R-DEL-14`

**R-DEL-09 · RECOMMENDED · Regresión proporcional al riesgo, con los arneses
nombrados y su resultado.**

---

## Antipatrones

### AP-11 · Prueba acoplada a lo cosmetico de la interfaz
**Origen:** H-42 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** un arnes de navegador necesita pulsar un control.
**Sintoma:** la prueba falla —o peor, pasa por casualidad— sin que el producto
haya cambiado de comportamiento. Se depura buscando un defecto que no existe.
**Causa raiz:** el localizador depende de algo cosmetico. En H-42 ocurrio tres
veces: `innerText` incluye la **ligadura del icono**, de modo que
`"shopping_cart_checkout COBRAR $100.00"` no casa con `/^cobrar/`; y `Segment`
pinta sus opciones con `text-transform: uppercase`, asi que `innerText` devuelve
`CAMBIO` y no `Cambio`.
**Riesgo:** dos clases de dano. Un falso negativo consume horas persiguiendo un
defecto inexistente; un falso positivo —el caso del selector de talla en H-36,
que pasaba porque la tarjeta ya mostraba las dos cifras— deja sin cubrir lo que
decia cubrir.
**Regla permanente:** `R-DEL-10`.
**Como detectarlo:** si el localizador usa `innerText`, un indice de posicion o
una clase de estilo, esta acoplado a lo cosmetico.
**Como prevenirlo:** `data-testid` en el punto de interaccion, o un atributo
funcional ya existente. Comprobar ademas el ESTADO del control —`disabled`— y no
solo su presencia.
**Pruebas obligatorias:** el E2E de la historia no contiene ningun localizador
por texto visible en los controles que acciona.
**Excepciones justificables:** afirmar contenido que el usuario debe LEER —un
importe, un aviso— es legitimo: ahi el texto es el comportamiento.
**Referencias:** `test-cambio-e2e.mjs` · `docs/fixes/pantalla-del-cambio.md`
**Camino de retiro:** un arnes que recorra los `test-*.mjs` de navegador y falle
si accionan un control localizado por `innerText`.

### AP-08 · Migración dada por desplegada sin evidencia en la base
**Origen:** H-31 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una historia se cierra declarando su migración aplicada.
**Síntoma:** ninguno, hasta que otra historia ejecuta `db push` y arrastra la
migración pendiente meses después.
**Causa raíz:** se dio por desplegada en una sesión anterior sin comprobarlo
contra la base. La documentación registró el despliegue; la base no.
**Riesgo:** el repositorio y producción divergen en silencio. En H-31 se
descubrió porque el `db push` de H-32 detectó **dos** migraciones sin aplicar y
PostgreSQL emitió el `NOTICE ... does not exist, skipping` que probaba que era
la primera ejecución.
**Regla permanente:** `R-DEL-03`.
**Cómo detectarlo:** `db push --dry-run` antes de cerrar, y comprobación directa
de que los objetos declarados existen en la base.
**Cómo prevenirlo:** la evidencia del despliegue es la base, no la sesión. Se
registra qué objetos se comprobaron, no que «se aplicó».
**Pruebas obligatorias:** listar los objetos nuevos contra la base y comprobar
que los datos existentes no cambiaron.
**Excepciones justificables:** ninguna.
**Referencias:** `docs/fixes/trazabilidad-descuento-ticket.md` § La misma
operación aplicó también la migración pendiente de H-31
**Camino de retiro:** un arnés que compare el historial local de
`supabase/migrations/` contra `supabase_migrations.schema_migrations` remoto.
