# Memoria técnica de POS BALAM

Este directorio es la memoria permanente del proyecto:

- `01-engineering-methodology.md`: proceso obligatorio de trabajo.
- `02-architecture.md`: mapa técnico y contratos del sistema.
- `03-known-risks.md`: estado auditable de problemas conocidos.
- `04-contrato-del-cambio.md`: autoridad funcional del módulo de Cambios.
- `fixes/`: causa raíz, solución y evidencia de cada corrección.
- `architect/`: sistema operativo de ingeniería. Se lee primero: enruta qué
  módulos aplican al cambio en curso, con sus reglas, antipatrones y decisiones.

`AGENTS.md`, en la raíz, hace estas reglas automáticas para herramientas que
reconocen ese estándar. Para cualquier otra IA, iniciar la sesión con:

```text
Vamos a trabajar sobre el proyecto POS BALAM.

Antes de hacer cualquier cambio:

1. Lee AGENTS.md.
2. Lee docs/architect/README.md y los módulos que ese archivo enrute.
3. Lee docs/01-engineering-methodology.md.
4. Lee docs/02-architecture.md.
5. Lee docs/03-known-risks.md.
6. Lee docs/fixes/README.md y las correcciones relacionadas con este módulo.

Trabajaremos siguiendo esa metodología. No la rompas durante toda la sesión.
Atiende un solo problema y no empieces el siguiente.

El problema que resolveremos hoy es:

"H-XX — [nombre del problema]".
```

Al terminar, la IA debe actualizar el riesgo y crear o actualizar su documento
en `docs/fixes/` antes de cerrar.
