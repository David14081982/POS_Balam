---
capa: enrutamiento
applies_to: [todo]
severity_max: blocking
no_alcance: "No contiene reglas de ingeniería. Sólo dice qué leer y cómo se mantiene este sistema."
---

# Sistema Operativo de Ingeniería — POS BALAM

Este directorio no documenta la arquitectura: **cambia el comportamiento del
agente antes de que escriba código**. La arquitectura vive en
`docs/02-architecture.md`, el estado de los riesgos en `docs/03-known-risks.md`
y la evidencia en `docs/fixes/`. Aquí sólo hay cuatro cosas: cómo razonar, en
qué orden avanzar, qué está prohibido y qué se decidió una vez y no se
reabre por accidente.

## Qué leer

| Si el cambio toca… | Abrir |
|---|---|
| *(siempre, en este orden)* | `PHILOSOPHY.md` → `THINKING.md` → `WORKFLOW.md` |
| una fórmula, un cálculo, una autoridad de negocio | `playbooks/domain.md` |
| el módulo de Cambios | `../04-contrato-del-cambio.md` — autoridad funcional |
| esquema, migraciones, persistencia | `playbooks/database.md` |
| SQL, permisos, roles, RLS, vistas o funciones | `playbooks/security.md` |
| `balam/`, build o artefactos | `playbooks/client.md` |
| sincronización, cola, Realtime, offline o terminales | `playbooks/client.md` · `playbooks/synchronization.md` · `authorities/synchronization.md` · `ADR-006` · `ADR-012` |
| pruebas, cierre, commit o despliegue | `playbooks/delivery.md` |
| ubicar quién responde una pregunta de negocio | `authorities/` — `sales` · `inventory` · `security` · `synchronization` |
| *(sólo si una regla o un playbook lo cita)* | el `ADR-XXX` correspondiente |

No se lee el sistema completo. La carga típica son cuatro archivos base y uno
o dos playbooks.

## Severidad

| Nivel | Efecto operativo |
|---|---|
| **BLOCKING** | Detiene la implementación en el acto. No se continúa sin autorización o sin la evidencia que la regla exige. Violarla es, por sí sola, un defecto que debe registrarse. |
| **REQUIRED** | Puede quedar pendiente mientras se trabaja, pero **no se cierra, ni se commitea, ni se despliega** sin ella. |
| **RECOMMENDED** | Su omisión se declara en una línea, con motivo. No detiene nada. |

## Reglas de este sistema

1. **Regla de admisión.** Todo archivo debe responder al menos una de: ¿qué debe
   hacer?, ¿qué nunca debe hacer?, ¿cuándo debe detenerse?, ¿qué debe demostrar
   antes de continuar? Un párrafo que sólo explica un concepto no entra: se
   enlaza a donde ya está explicado.
2. **Regla del enlace único.** Si un hecho ya vive en `docs/02-architecture.md`,
   `docs/03-known-risks.md`, `docs/fixes/` o una migración, aquí se referencia
   por ruta; **no se transcribe**. Prohibido copiar definiciones, firmas SQL o
   tablas de contrato.
3. **Regla del índice derivado.** No se mantiene a mano ningún índice que el
   repositorio pueda responder. Se documenta la consulta, no la respuesta.
   Ejemplo: todo lo que produjo una historia se obtiene con
   `grep -rn "H-35" docs/`.
4. **Prohibición de datos perecederos.** Aquí no se registran conteos de
   pruebas, hashes, versiones desplegadas ni fechas. Eso vive en
   `docs/03-known-risks.md` y en `docs/fixes/`.
5. **Contradicción = detención.** Si una regla de este sistema choca con
   `docs/02-architecture.md` o con una migración aplicada, el agente **se
   detiene y lo reporta**. La autoridad final es el código ejecutable.

## Registro de autoridades

`authorities/` responde «¿quién decide esto?» y está indexado por **pregunta de
negocio**, no por función: las funciones de BALAM han cambiado varias veces; las
preguntas, casi nunca. Para localizar una sin saber su dominio:

```bash
grep -rn "<pregunta o función>" docs/architect/authorities/
```

Dos reglas de mantenimiento:

- Si cambia la función, se edita la entrada. **Si cambia la pregunta, es una
  autoridad nueva.**
- **Dos entradas con la misma pregunta son, por definición, `AP-01`.** El
  registro es también un detector de fórmulas duplicadas.

Los consumidores no se mantienen: cada entrada trae la consulta que los
descubre. Las historias que modificaron una autoridad se recuperan con
`grep -rn "<autoridad>" docs/03-known-risks.md`.

## Presupuestos y crecimiento

- Archivo ≤ 120 líneas. Playbooks ≤ 180. `WORKFLOW.md` ≤ 120 con cap duro: si
  crece, salen las condiciones de detención hacia este README, no se alarga.
- Sistema ≤ 1 600 líneas. Superarlo obliga a dividir por dominio, no a alargar.
- **Directorios acotados.** `authorities/`, `playbooks/` y `decisions/` son los
  vigentes. Crear otro, o dividir un archivo que superó su presupuesto, son
  decisiones internas: se toman y se informan en el informe final, no se
  consultan (`R-GOV-01`).
- **Presupuesto por historia.** Al cerrar una historia el sistema gana como
  máximo 0–1 antipatrón, 0–1 ADR y 0–N reglas. Más que eso significa que se
  está documentando en vez de normando.
- **IDs inmutables.** `AP-XX`, `ADR-XXX` y `R-XXX-NN` no se renumeran ni se
  reutilizan. Lo obsoleto se marca `reemplazado por…`; no se borra.
- **Camino de retiro.** Cada antipatrón declara qué prueba automatizada lo
  volvería innecesario. Cuando esa prueba existe, baja a nota histórica.
  `test-migrations.mjs` ya demuestra que ese camino funciona en BALAM.

## Índice de decisiones

| ADR | Decisión | Estado |
|---|---|---|
| `ADR-001` | Identidad técnica y folio comercial son campos separados | vigente |
| `ADR-002` | Lo pactado en la venta se congela en el documento | vigente |
| `ADR-003` | Una pregunta tiene una autoridad; las extensiones entran por una costura | vigente |
| `ADR-004` | Toda migración funcional relevante lleva verificación autocontenida | vigente |
| `ADR-005` | La autorización vive en RLS y en el perfil activo | vigente |
| `ADR-006` | Local-first: la cola da durabilidad, la transacción vive en SQL | vigente |
| `ADR-007` | Cero red en runtime y en el build normal | vigente |
| `ADR-008` | El artefacto generado no es fuente y se verifica al publicarse | vigente |
| `ADR-009` | El precio por talla es un mapa de excepciones dentro del artículo | vigente |
| `ADR-010` | El cambio es un documento autónomo con liquidación económica propia | vigente |
| `ADR-011` | La identidad de una talla no es el código que se edita | vigente |
| `ADR-012` | La sincronización entrante es un protocolo versionado | vigente |
| `ADR-013` | Referencia física: products.id, barcode y SKU separados | vigente |
