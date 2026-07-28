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

## Autonomía

Autorizar una historia autoriza **su ciclo completo**: análisis, registro del
riesgo, diseño, línea base, implementación, migraciones, regresión,
documentación y los commits técnicos y documentales que haga falta. No se pide
permiso paso a paso.

**R-GOV-01 · BLOCKING · No se detiene una historia para pedir autorización
sobre una decisión cuya respuesta ya puede deducirse de las reglas aprobadas de
este sistema.** Detenerse de más cuesta visibilidad, no la aumenta: consume la
atención del dueño en decisiones que el sistema ya resolvió. Ante la duda, se
decide, se ejecuta y se explica en el informe final.

## Detención obligatoria

Sólo estas seis. Fuera de ellas, se avanza.

1. Existe una **decisión de negocio** que no puede deducirse de los requisitos
   ni del producto actual.
2. La acción es **irreversible o destructiva**.
3. El cambio llega a **producción** y puede provocar pérdida de datos,
   indisponibilidad o alteración de permisos.
4. El **alcance, coste o comportamiento** solicitado cambia de manera
   importante.
5. Las **pruebas revelan que la solución aprobada ya no es viable**.
6. Se va a **iniciar otra historia**: la autorización es por historia.

`R-SEC-04` sobrevive intacta como excepción nombrada: si una verificación de
seguridad falla en remoto, es parada obligatoria. Eso es exposición, no proceso.

Una contradicción entre la evidencia y la documentación ya **no detiene**: se
resuelve y se reporta en el informe final.

## Informe ejecutivo

Es el **único** entregable del cierre. Seis puntos, sin razonamiento paso a
paso:

1. **Qué se hizo.**
2. **Qué cambió para el usuario.**
3. **Pruebas realizadas.**
4. **Despliegue.**
5. **Riesgos residuales.**
6. **Commits.**

Las once preguntas de `THINKING.md` siguen siendo la disciplina de trabajo —son
lo que evita los defectos— pero **dejan de escribirse para el dueño**. Los
conteos, hashes y fechas viven en `docs/fixes/<corrección>.md` y en
`docs/03-known-risks.md`, nunca en este directorio.
