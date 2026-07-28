---
capa: reglas+aprendizaje
applies_to: [database, migrations]
related_histories: [H-01, H-04, H-07, H-10, H-33, H-34, H-35]
severity_max: blocking
no_alcance: "No describe el esquema. Eso vive en docs/02-architecture.md y en las migraciones."
---

# Playbook · Base de datos y migraciones

## Reglas

**R-DB-01 · BLOCKING · Una migración ya aplicada en remoto no se reescribe.**
Se corrige con una migración nueva. Renumerar sólo es válido si la versión
**nunca llegó a registrarse** en remoto, y eso debe comprobarse antes.
Origen: H-07 (la 014 se dejó intacta), H-35 (`004800` se renumeró porque nunca
se registró)

**R-DB-02 · BLOCKING · La migración de verificación es la última por orden de
versión.**
Las migraciones se aplican por orden de versión; una verificación numerada
antes de la corrección que debe comprobar no verifica nada.
Origen: H-35

**R-DB-03 · BLOCKING · Redefinir una función SQL viva se hace generando el
texto desde la definición vigente, nunca retipeándola.**
El diff debe revisarse bloque por bloque y contener sólo los cambios previstos.
Origen: H-34 · Antipatrón: `AP-05`

**R-DB-04 · BLOCKING · Los cambios de esquema son aditivos.**
Un registro histórico sin los campos nuevos sigue siendo legible, y un reintento
que no envía el campo no borra el valor ya guardado (`coalesce(excluded.…,
tabla.…)`).
Origen: H-34, `docs/02-architecture.md` § Contratos que no deben romperse

**R-DB-05 · REQUIRED · Toda migración funcional relevante lleva verificación
autocontenida** que aborta ante el fallo y elimina sus propias semillas.
Origen: H-10, H-33, H-34, H-35 · Decisión: `ADR-004` · Antipatrón: `AP-09`

**R-DB-06 · REQUIRED · Toda operación que consume un recurso compartido
serializa y es idempotente.**
Candado explícito antes de validar (`pg_advisory_xact_lock`, `for update` en
orden estable) e idempotencia por clave + hash del payload.
Origen: H-01, H-04, H-35

**R-DB-08 · REQUIRED · Una migración aditiva, verificada y no destructiva forma
parte de la autorización de la historia.**
No requiere una autorización aparte: se anuncia brevemente antes de ejecutarla
—qué hace, sobre qué objetos y cómo se revierte— y se aplica. **Sólo se detiene
si aparece un riesgo nuevo durante el despliegue.** Si es destructiva, cambia
permisos, o puede provocar pérdida de datos o indisponibilidad, se detiene antes
de ejecutar (`WORKFLOW.md` § Detención obligatoria, 2 y 3).
Origen: H-36 · Gobierno: `R-GOV-01`

**R-DB-07 · REQUIRED · `node test-migrations.mjs` debe pasar.**
Si el cambio introduce una regla nueva sobre la cadena, se añade ahí: ese arnés
es la autoridad ejecutable del orden, la unicidad y la ausencia de deriva.

---

## Antipatrones

### AP-05 · Función SQL viva retipeada a mano en vez de generada
**Origen:** H-34 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una migración necesita añadir algo a una función grande que ya
está desplegada.
**Síntoma:** el cuerpo nuevo «parece igual» pero introduce diferencias
semánticas que ninguna prueba local distingue.
**Causa raíz:** transcribir un texto largo a mano no es una operación
verificable.
**Riesgo:** en H-34 el primer intento manual introdujo **nueve** desviaciones,
entre ellas la pérdida de `is distinct from`, un `greatest(0, …)` de más en el
total del cliente y la pérdida de `v_products` de la reserva. Cualquiera de las
tres habría alterado dinero o inventario en producción.
**Regla permanente:** `R-DB-03`.
**Cómo detectarlo:** extraer la función de la migración anterior y de la nueva y
compararlas; el diff debe contener exactamente los bloques previstos y nada más.
**Cómo prevenirlo:** generar el texto nuevo a partir del vigente aplicando sólo
las ediciones acordadas.
**Pruebas obligatorias:** diff explícito contra la definición anterior;
comprobación posterior contra la base de que la función desplegada conserva las
expresiones que no debían cambiar.
**Excepciones justificables:** funciones pequeñas creadas en la misma historia.
**Referencias:** `docs/fixes/plazo-posventa.md`
**Camino de retiro:** un arnés que extraiga la función de dos migraciones
consecutivas y falle si el diff excede los bloques declarados.

### AP-09 · Verificación que comprueba el síntoma, no la defensa
**Origen:** H-35 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** se escribe una migración de verificación para dar por buena una
corrección.
**Síntoma:** la verificación pasa y el defecto sigue presente, porque comprobó
el resultado visible en vez del mecanismo que lo protege.
**Causa raíz:** confundir «hoy se comporta bien» con «no puede comportarse mal».
**Riesgo:** una defensa que decae en silencio. En H-35, comprobar sólo que la
vista devolvía el saldo correcto habría dejado pasar que era legible por
`authenticated`.
**Regla permanente:** `R-DB-05` y `R-SEC-01`.
**Cómo detectarlo:** preguntar FF-10. Si la verificación seguiría pasando
después de retirar la defensa, verifica el síntoma.
**Cómo prevenirlo:** verificar el mecanismo —privilegios efectivos, opciones del
objeto, restricciones— y exigir **todas** las medidas, no una.
**Pruebas obligatorias:** la verificación debe fallar si se retira cualquiera de
las defensas por separado.
**Excepciones justificables:** ninguna para cambios de seguridad.
**Referencias:** `docs/fixes/saldo-por-renglon.md` ·
`supabase/migrations/20260728004900_pos_h35_line_balance_grants.sql` ·
`ADR-004`
**Camino de retiro:** no aplica; es un criterio de diseño de la verificación.
