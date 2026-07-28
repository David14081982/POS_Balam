---
capa: proceso
applies_to: [todo]
severity_max: blocking
no_alcance: "No contiene reglas de ingeniería ni las preguntas de revisión. Viven en playbooks/ y THINKING.md."
---

# Flujo, puertas y detención

`docs/01-engineering-methodology.md` es la autoridad de las etapas 1–8. Este
archivo no las reordena ni las repite: las mapea y añade lo que esa metodología
no cubre —migraciones, commit y despliegue—.

## El flujo

| Paso | Etapa de `01-engineering-methodology.md` |
|---|---|
| 1. Problema | 1. Comprender |
| 2. Causa raíz | 2. Reproducir + 3. Causa raíz |
| 3. Alcance y no alcance | 1. Comprender (salida) |
| 4. Diseño | 4. Diseño |
| 5. Contratos | 4. Diseño (invariantes) |
| 6. Implementación | 5. Corrección |
| 7. Migraciones | *(no cubierto)* → `playbooks/database.md` |
| 8. Verificación | 6. Pruebas |
| 9. Regresiones | 6. Pruebas |
| 10. Documentación | 7. Documentación |
| 11. Commit | *(no cubierto)* → `playbooks/delivery.md` |
| 12. Despliegue | *(no cubierto)* → `playbooks/delivery.md` |

El cierre de la etapa 8 sigue siendo el de `01`: estado auditable y punto de
continuación explícito.

## Las tres puertas

Sólo hay tres. Ninguna se cruza sin lo que exige.

**Puerta de causa raíz** — entre los pasos 2 y 4.
No hay diseño sin reproducción o evidencia equivalente. Una prueba que falla
antes del cambio, con su conteo, es la forma preferida.

**Puerta de verificación** — entre los pasos 9 y 11.
No hay commit sin regresión ejecutada, y sin verificación contra la base real
cuando el cambio toca Supabase. Verde en local no cruza esta puerta para un
cambio de seguridad.

**Puerta de publicación** — entre los pasos 11 y 12.
No hay despliegue sin migraciones aplicadas **antes** que el cliente y sin el
artefacto publicado verificado contra el `index.html` del commit.

## Detención obligatoria

El agente se detiene y pide autorización ante cualquiera de estas nueve:

1. Cambiar un contrato existente o cualquiera de los «Contratos que no deben
   romperse» de `docs/02-architecture.md`.
2. Ampliar el alcance acordado.
3. Cambiar permisos, roles, policies RLS o grants.
4. Aplicar migraciones o desplegar.
5. Commitear.
6. Iniciar una historia nueva.
7. Ejecutar cualquier operación destructiva sobre la base con datos reales,
   incluidos los scripts operativos heredados de `supabase/`.
8. Una verificación remota falla, o una prueba no puede ejecutarse.
9. La evidencia disponible contradice la documentación.

## Declaración de cierre

Prosa, no casillas. Cuatro bloques:

1. **Las preguntas de `THINKING.md`** que aplican, respondidas con su cita. Las
   que no aplican, descartadas en una línea con motivo.
2. **Qué no se modificó**, dicho expresamente: contratos preservados, alcance
   dejado fuera, decisiones que se respetaron.
3. **Evidencia que autoriza commit y despliegue**: arneses ejecutados con su
   resultado, verificación remota, estado de las migraciones.
4. **La pregunta de aprendizaje** de `THINKING.md`, respondida.

Los conteos, hashes y fechas de esa declaración se escriben en
`docs/fixes/<corrección>.md` y en `docs/03-known-risks.md`, nunca en este
directorio.
