---
capa: reglas+aprendizaje
applies_to: [client, build, sync]
related_histories: [H-09, H-13, H-14, H-16, H-17, H-18, H-19, H-20, H-21, H-22, H-23, H-24, H-27, H-28]
severity_max: blocking
no_alcance: "No describe los módulos ni la sincronización. Eso vive en docs/02-architecture.md."
---

# Playbook · Cliente, sincronización y build

## Reglas

**R-CLI-01 · BLOCKING · `index.html` y `POS Balam (offline).html` no se editan
como fuente.**
Son artefactos. Se modifica `balam/` y se regeneran con `node build-offline.mjs`.
Origen: `AGENTS.md` · Decisión: `ADR-008`

**R-CLI-02 · BLOCKING · Cero red en runtime y en el build normal.**
Ni CDN, ni descargas dinámicas, ni dependencias sin fijar. La actualización
deliberada del almacén de recursos requiere `BALAM_REFRESH_BUILD_RESOURCES=1` y
revisión del diff.
Origen: H-20, H-27, H-28 · Decisión: `ADR-007`

**R-CLI-03 · BLOCKING · La acción local funciona sin conexión y deja una
operación recuperable e idempotente.**
Toda operación se encola **antes** de intentar enviarse; sale de la cola sólo
tras éxito remoto.
Origen: `docs/02-architecture.md` § Contratos que no deben romperse ·
Decisión: `ADR-006`

**R-CLI-04 · REQUIRED · Un pull no pisa cambios locales pendientes, y una
página llena nunca es fin de conjunto.**
Toda lectura que reconstruye un conjunto completo pagina explícitamente y
mantiene orden estable; un error intermedio impide aplicar un resultado parcial.
Origen: H-13, H-16

**R-CLI-05 · REQUIRED · `DATA`, `CONFIG` y `AUTH` no referencian `window.STORE`.**
Sólo el gateway de `CORE`. `STORE → DATA/CONFIG/AUTH` queda como dependencia
unidireccional intencional.
Origen: H-21, H-22, H-23, H-24

**R-CLI-06 · REQUIRED · Un cambio en `balam/` exige regenerar los artefactos y
probar el bundle.**
`node build-offline.mjs`, más `test-smoke.mjs bundle` y `test-ui-navigation.mjs`,
que ejecutan `index.html` —el artefacto realmente distribuido—.
Origen: H-15, H-17, H-27

**R-CLI-07 · RECOMMENDED · Un símbolo sin consumidores internos no es
necesariamente eliminable.**
`tweaks-panel.jsx` publica un contrato `postMessage` para un editor externo que
no se puede inventariar desde el repositorio.
Origen: H-17

**R-CLI-08 · BLOCKING · Antes de proponer cambios de captura o interacción,
recorrer el flujo existente de extremo a extremo.**
Enumerar pantallas, componentes, estados y transiciones reales —alta, edición,
validación y guardado— y describirlos antes de proponer nada. El diseño parte
del comportamiento comprobado, no del modelo de datos ni de búsquedas textuales:
`grep` localiza consumidores de un campo, no flujos. El formulario de producto
captura existencias por talla sin mencionar nunca `precio`. Si ya existe un
idioma de interacción para el problema —la grilla por talla de Existencias, los
chips con «Todas» del Alcance de Descuentos—, se reutiliza o se justifica por
escrito por qué no.
Origen: H-36 (en análisis) · Pregunta: `FF-11` · Antipatrón: `AP-10`

---

## Antipatrones

### AP-10 · Interacción diseñada sin recorrer el flujo existente
**Origen:** H-36 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** un cambio necesita capturar, mostrar o editar algo que el usuario
ya administra por alguna pantalla del producto.
**Síntoma:** la interfaz propuesta es coherente con el esquema y ajena a cómo el
negocio trabaja hoy. Suele descubrirse cuando el dueño del producto dice «ya
existe un flujo para eso», y no antes.
**Causa raíz:** el flujo se infirió del modelo de datos y de búsquedas
textuales. El modelo dice qué se puede guardar, nunca cómo se captura; y una
pantalla no menciona necesariamente el campo que se está cambiando, de modo que
ninguna búsqueda de ese campo la encuentra.
**Riesgo:** rediseño completo después de proponerlo y, peor, una interfaz que
exige al usuario datos o pasos que su flujo actual no le pide, o que duplica un
idioma de interacción ya establecido y deja dos formas distintas de hacer lo
mismo dentro del producto.
**Regla permanente:** `R-CLI-08` · **Pregunta:** `FF-11`.
**Cómo detectarlo:** si la propuesta de interfaz no cita ningún `archivo:línea`
de una pantalla real, el flujo no se recorrió. Si el producto ya resuelve un
problema de la misma forma y la propuesta no lo menciona, tampoco.
**Cómo prevenirlo:** abrir los componentes de alta, edición y validación del
flujo afectado; documentar su orden de bloques, sus estados y sus reglas de
guardado; e inventariar los idiomas de interacción que el producto ya usa para
problemas de forma parecida, antes de proponer nada.
**Pruebas obligatorias:** el arnés de la historia cubre el flujo de captura y
sus validaciones, no sólo la autoridad de dominio.
**Excepciones justificables:** cambios que no tocan captura ni interacción
—refactores internos, rendimiento, sincronización—.
**Caso de origen, como ejemplo:** en H-36 se propuso capturar el precio por
talla listando las ~20 tallas con un campo en cada una. El producto ya tenía dos
idiomas para esto: la grilla por talla de «Existencias por talla» en el
formulario de producto, y los chips multi-selección con interruptor «Todas» del
Alcance de Descuentos, que es como el negocio ya expresa «este valor afecta a
estas tallas». El formulario nunca menciona `precio`, así que ninguna búsqueda
de ese campo lo encontraba.
**Referencias:** `balam/inventory.jsx` § `ProductForm` ·
`balam/discounts.jsx` § Alcance
**Camino de retiro:** no aplica; es un criterio de método, no un descuido
mecanizable.

---

Otros defectos de esta capa no se registraron —el overlay del bundle en H-15,
los CSS huérfanos de H-17, el UUID aleatorio del manifiesto en H-19— porque
fueron irrepetibles o ya están cubiertos por arneses permanentes
(`test-smoke.mjs`, `test-ui-navigation.mjs`, `test-build-reproducibility.mjs`,
`test-module-contracts.mjs`). Convertirlos en antipatrones habría diluido el
catálogo sin añadir prevención.
