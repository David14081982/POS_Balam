# Reglas permanentes de trabajo — POS BALAM

Estas instrucciones aplican a todo el repositorio y a cualquier agente de IA.

## Antes de modificar

1. Leer completos:
   - `docs/architect/README.md` y los módulos que ese archivo enrute
   - `docs/01-engineering-methodology.md`
   - `docs/02-architecture.md`
   - `docs/03-known-risks.md`
2. Leer `docs/fixes/README.md` y las correcciones relacionadas con el módulo.
3. Revisar el código y las pruebas vigentes; la documentación orienta, pero el
   código ejecutable es la evidencia final.
4. Identificar el riesgo que se atenderá. Si no existe, registrarlo antes de
   implementar con el siguiente identificador disponible.
5. Trabajar un solo problema hasta cerrarlo. No comenzar el siguiente.

## Durante el trabajo

- Seguir, sin omitir ni reordenar, las ocho etapas de
  `docs/01-engineering-methodology.md`.
- Aplicar las reglas de `docs/architect/playbooks/` que el enrutamiento indique,
  respetando su severidad.
- No declarar una causa raíz sin una reproducción o evidencia equivalente.
- Preservar el modelo local-first, la compatibilidad con datos históricos y la
  cola offline salvo que el cambio aprobado modifique expresamente ese diseño.
- No editar los artefactos generados `index.html` o
  `POS Balam (offline).html` como fuente. Modificar `balam/` y regenerarlos con
  `node build-offline.mjs` cuando corresponda.
- No marcar un riesgo como resuelto sin pruebas verificables.

## Antes de cerrar

1. Crear o actualizar `docs/fixes/<correccion>.md` usando
   `docs/fixes/_template.md`.
2. Actualizar la entrada correspondiente en `docs/03-known-risks.md`.
3. Registrar estado, fecha, pruebas, riesgo residual y commit. Si el commit aún
   no existe, usar `Pendiente de commit` y reemplazarlo después.
4. Verificar que la documentación describe el código final.
5. Entregar la declaración de cierre de `docs/architect/WORKFLOW.md`.
6. Detenerse. No iniciar otro problema sin una nueva instrucción.

## Sistema arquitectónico

`docs/architect/` es el sistema operativo de ingeniería del proyecto. Deriva de
`docs/` y de las migraciones; no las sustituye ni repite sus reglas.

- Leer siempre `README.md`, `PHILOSOPHY.md`, `THINKING.md` y `WORKFLOW.md`.
- Cargar de `playbooks/`, `authorities/` y `decisions/` únicamente lo que la
  tabla de enrutamiento del `README.md` indique. No leer el sistema completo.
- Antes de cerrar, commitear o desplegar, aplicar `WORKFLOW.md`.
