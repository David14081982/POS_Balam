---
capa: reglas+aprendizaje
applies_to: [testing, documentation, deployment]
related_histories: [H-10, H-31, H-32, H-33, H-34, H-35]
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

**R-DEL-04 · BLOCKING · El commit publica.**
El hook `post-commit` sube cada commit a GitHub automáticamente. Un commit sin
evidencia completa es una publicación sin evidencia.

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

**R-DEL-09 · RECOMMENDED · Regresión proporcional al riesgo, con los arneses
nombrados y su resultado.**

---

## Antipatrones

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
