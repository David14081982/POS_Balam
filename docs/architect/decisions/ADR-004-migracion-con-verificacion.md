# ADR-004 — Toda migración funcional relevante lleva verificación autocontenida

**Estado:** vigente · **Historias:** H-10 (origen), H-33, H-34, H-35

## Contexto

Una versión del repositorio no determinaba por sí sola un esquema: las bases
001–012 se habían ejecutado a mano y nunca entraron al historial formal (H-10).
Después, cada contrato nuevo —folio diario, plazo de posventa, saldo por
renglón— necesitaba demostrar que la base real se comportaba como el diseño
decía, y no sólo que el cliente compilaba.

## Decisión

Cada migración funcional relevante se acompaña de una migración de verificación
que: comprueba el mecanismo contra la base, aborta con un mensaje explícito si
falla, crea y elimina sus propias semillas, y se numera **después** de todo lo
que debe comprobar. La verificación es parte del contrato, no un extra.

## Trade-off

**Beneficio obtenido:** el despliegue deja de ser un acto de fe. En H-35 la
verificación abortó por sí sola al detectar que la vista había quedado legible
por `authenticated`, y el defecto no llegó a producción. En H-31 la ausencia de
esa comprobación permitió que una migración se diera por desplegada durante
semanas sin estarlo.

**Costo aceptado:** aproximadamente el doble de migraciones, una cadena más
larga que aplicar en cada entorno limpio, y trabajo real de diseño en cada
verificación —las semillas deben ser reservadas, la limpieza total y el orden
de versión correcto—. Un error en la propia verificación bloquea un despliegue
correcto, y ya obligó una vez a renumerar (`004800` → `005000`).

**Alternativa descartada:** verificar sólo con arneses locales en Node. Se
descartó porque no ejercitan RLS, privilegios efectivos ni el comportamiento
real de PostgreSQL: los dos defectos de permisos de H-35 eran invisibles en
local y verdes en toda la suite.

## Cómo se revierte y qué se rompería

Dejar de escribir verificaciones no rompe nada de inmediato; devuelve el
proyecto al estado previo a H-10, donde el repositorio y producción podían
divergir sin señal. El costo aparece meses después y en producción.

## Referencias

`docs/fixes/migraciones-reproducibles.md` · `docs/fixes/saldo-por-renglon.md` ·
`test-migrations.mjs` · `AP-08`, `AP-09`
