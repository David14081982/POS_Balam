---
capa: reglas+aprendizaje
applies_to: [domain]
related_histories: [H-02, H-03, H-18, H-25, H-26, H-29, H-31, H-32, H-33, H-34, H-35]
severity_max: blocking
no_alcance: "No describe el modelo de dominio. Eso vive en docs/02-architecture.md."
---

# Playbook · Dominio

## Reglas

**R-DOM-01 · BLOCKING · Una pregunta de negocio tiene una sola autoridad.**
Antes de escribir una fórmula, buscarla en `AUTHORITIES.md`. Si ya existe, se
consume; no se reimplementa. Si no existe y va a ser consultada por más de un
lugar, se crea como autoridad y se da de alta.
Origen: H-35, H-29, H-18, H-25, H-26 · Antipatrón: `AP-01`

**R-DOM-02 · BLOCKING · Lo pactado en la venta se congela en el documento.**
Nunca leer configuración vigente para juzgar un documento anterior. Si el
negocio pactó algo al vender, ese valor viaja dentro de la venta.
Origen: H-03, H-32, H-34 · Decisión: `ADR-002` · Antipatrón: `AP-06`

**R-DOM-03 · BLOCKING · Un valor derivado de la fecha usa la misma fecha
guardada en el documento.**
Nunca una segunda lectura del reloj. Una venta cerca de la medianoche no puede
quedar partida entre dos días.
Origen: H-33, H-34

**R-DOM-04 · BLOCKING · Identidad técnica y referencia comercial son campos
separados.**
Ninguno se deriva del otro. Un solo campo no puede cumplir dos funciones
incompatibles.
Origen: H-02 → H-33 · Decisión: `ADR-001` · Antipatrón: `AP-07`

**R-DOM-05 · REQUIRED · El alcance se declara junto con su no-alcance.**
Lo que se descubre fuera del alcance se **registra**, no se corrige. Ampliar
exige autorización expresa.
Origen: H-29 (Reportes excluido), H-31 (cálculos financieros excluidos),
H-32 (cortesías excluidas), H-35 (`allReturned` conservado)

**R-DOM-06 · REQUIRED · Toda autoridad nueva se da de alta en `AUTHORITIES.md`**
con su pregunta de negocio, no con su nombre de función.

**R-DOM-07 · RECOMMENDED · Si se prevé un segundo consumidor, declarar la
costura de extensión** en vez de dejar que cada consumidor enumere los casos.
Origen: H-35 · Decisión: `ADR-003`

---

## Antipatrones

### AP-01 · Fórmula de negocio duplicada sin autoridad
**Origen:** H-35 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una regla de negocio consultada desde varios lugares.
**Síntoma:** la misma expresión aparece copiada en dos o más sitios y todos
coinciden, por lo que nada falla todavía.
**Causa raíz:** ausencia de una autoridad y de un punto de extensión, no una
consulta equivocada.
**Riesgo:** en cuanto aparece un caso nuevo, basta con que una copia lo omita
para producir un efecto doble sin que ninguna restricción lo impida. En H-35
habría sido doble reingreso de stock y doble efecto financiero.
**Regla permanente:** `R-DOM-01`.
**Cómo detectarlo:** buscar la fórmula literal en `balam/` y `supabase/`;
comprobar si `AUTHORITIES.md` ya tiene esa pregunta.
**Cómo prevenirlo:** crear la autoridad antes que el segundo consumidor.
**Pruebas obligatorias:** un caso que ejercite la costura con una fuente
adicional simulada, demostrando que el saldo cambia sin tocar consumidores.
**Excepciones justificables:** una expresión trivial usada una sola vez, o una
duplicación deliberada documentada con su motivo (H-35 conservó `returnedQty()`
con su significado literal y lo registró).
**Referencias:** `docs/fixes/saldo-por-renglon.md` · `ADR-003`
**Camino de retiro:** un arnés que compare las fuentes declaradas en
`consumptionSources()` contra las ramas de `pos.line_consumption`.

### AP-06 · Derivar un valor que debía ser evidencia persistida
**Origen:** H-32 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una presentación o una regla necesita un dato que ya no está.
**Síntoma:** se reconstruye el valor con la información vigente —dividiendo,
releyendo la configuración o el reloj— y el resultado es plausible pero falso.
**Causa raíz:** la evidencia existía en memoria y murió al persistir.
**Riesgo:** números que ningún administrador configuró (7.14 %, 4.8 %, 15 % en
H-32) y ventas antiguas que cambian de comportamiento cuando alguien edita un
ajuste (H-34).
**Regla permanente:** `R-DOM-02` y `R-DOM-03`.
**Cómo detectarlo:** preguntar FF-04. Si el valor puede cambiar por una edición
posterior, debía guardarse.
**Cómo prevenirlo:** persistir la evidencia como copia congelada, distinguiendo
«sin dato» de «anterior al cambio».
**Pruebas obligatorias:** editar y borrar la fuente después de emitir el
documento y comprobar que el documento no cambia; un registro histórico sin el
campo nuevo no debe inventar valor.
**Excepciones justificables:** valores puramente presentacionales que no forman
parte de lo pactado.
**Referencias:** `docs/fixes/trazabilidad-descuento-ticket.md` ·
`docs/fixes/plazo-posventa.md` · `ADR-002`
**Camino de retiro:** no aplica; es una regla de diseño, no un descuido
mecanizable.

### AP-07 · Identidad técnica expuesta dentro de un campo comercial
**Origen:** H-02 → H-33 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** se necesita unicidad y se toma prestada de un identificador
técnico ya disponible.
**Síntoma:** el campo que ve el cliente crece, se parte en la impresión y
estira columnas. En H-33 medía 29 caracteres.
**Causa raíz:** un solo campo cumpliendo dos funciones incompatibles.
**Riesgo:** el valor visible degrada la operación diaria y no se corrige con
recortes visuales, porque su forma proviene de un requisito técnico.
**Regla permanente:** `R-DOM-04`.
**Cómo detectarlo:** preguntar FF-02. Si el campo lo lee una persona, su forma
la decide el negocio.
**Cómo prevenirlo:** dos campos con responsabilidades separadas y una fuente de
unicidad propia para el comercial.
**Pruebas obligatorias:** la identidad técnica no aparece en el valor visible;
los valores históricos siguen siendo buscables y no se migran.
**Excepciones justificables:** identificadores internos que nunca se muestran.
**Referencias:** `docs/fixes/folio-comercial-diario.md` · `ADR-001`
**Camino de retiro:** no aplica.
