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
Origen: H-36 (en análisis) · Pregunta: `FF-11`

---

## Antipatrones

Sin antipatrones registrados. Los defectos de esta capa —el overlay del bundle
en H-15, los CSS huérfanos de H-17, el UUID aleatorio del manifiesto en H-19—
fueron irrepetibles o ya están cubiertos por arneses permanentes
(`test-smoke.mjs`, `test-ui-navigation.mjs`, `test-build-reproducibility.mjs`,
`test-module-contracts.mjs`). Convertirlos en antipatrones habría diluido el
catálogo sin añadir prevención.
