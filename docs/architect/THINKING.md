---
capa: razonamiento
applies_to: [todo]
severity_max: blocking
no_alcance: "No prescribe pasos ni evidencia de cierre. Eso vive en WORKFLOW.md."
---

# Las once preguntas

Se hacen **antes** de diseñar, como preguntas, y se responden **al cerrar**, con
evidencia. No hay dos listas.

Reglas de uso, BLOCKING las tres:

- No se marcan casillas. Se responde en prosa.
- Una respuesta que no puede citar un archivo, una prueba o una decisión no es
  una respuesta.
- Una pregunta que no aplica se descarta **por escrito**, en una línea, con el
  motivo. Descartar es una decisión visible, no un silencio.

---

**FF-01 · ¿Esto es un defecto, o un contrato ausente?**
H-34 y H-35 fueron contratos ausentes, no errores. Confundirlos cambia todo el
trabajo: un defecto se arregla, un contrato se diseña.

**FF-02 · ¿Estoy modelando un concepto del negocio o la implementación actual?**
El folio modelaba el `operation_id` en vez de «referencia comercial» (H-33).
`returnedQty()` modelaba `return_items` en vez de «unidades consumidas» (H-35).
La pantalla Vendedores modelaba el arreglo `sellers` en vez de «vendedor
comercial elegible» (H-29). Tres defectos distintos, la misma causa: se modeló
lo que había, no lo que el negocio significa.

**FF-03 · ¿Cuál es la autoridad única de esta pregunta, y cuántas veces está
respondida hoy?**
→ `AUTHORITIES.md`. Tres copias de la misma fórmula fue el defecto de H-35, y
nadie lo veía porque las tres coincidían.

**FF-04 · ¿Estoy persistiendo algo derivable, o derivando algo que debía
congelarse?**
El porcentaje del ticket no se deriva (H-32). El plazo no se lee de la
configuración vigente (H-34). La fecha no se lee dos veces (H-33).

**FF-05 · ¿Qué contrato cambia, y quién lo consume hoy?**
Los consumidores se descubren, no se recuerdan: `AUTHORITIES.md` trae la
consulta que los localiza.

**FF-06 · ¿Qué ocurre cuando exista un segundo consumidor, un segundo documento
o una segunda terminal?**
Es la pregunta que produjo la costura de H-35 y el bloque de folios de H-33.

**FF-07 · ¿Cuál es el punto de extensión, y qué queda deliberadamente fuera de
él?**

**FF-08 · ¿Qué deja de ser modificable después de este cambio?**
Una migración aplicada, un folio impreso, una fila en producción y un artefacto
publicado ya no se reescriben. Sólo se corrigen hacia adelante.

**FF-09 · ¿Qué ve cada rol después del cambio?**
`anon` · `authenticated` sin perfil · vendedor · administrador activo ·
administrador inactivo · `service_role`.

**FF-10 · ¿Mi verificación comprueba la defensa real o el síntoma visible?**
La verificación de H-35 abortó porque comprobaba la defensa. Por eso el defecto
de permisos no llegó a producción.

**FF-11 · ¿Recorrí el flujo real de extremo a extremo, o sólo lo que el texto me
dejó ver?**
Se hace al principio, junto a FF-01 y FF-02; lleva el número 11 porque los
identificadores no se renumeran. `grep` encuentra consumidores de un dato; no
encuentra pantallas, estados ni transiciones. El formulario de producto captura
existencias por talla sin mencionar nunca `precio` —H-36, en análisis—, así que
era invisible para toda búsqueda del campo que se estaba cambiando. Ver
`playbooks/client.md` § `R-CLI-08`.

---

## La pregunta de aprendizaje

Al cerrar, además de las once, una más que no puede responderse con evidencia
previa y por eso obliga a pensar:

> **¿Este defecto debió haber sido prevenido por el sistema? Si sí, ¿qué le
> falta?**

De ahí sale —o no— un antipatrón nuevo. Es la única puerta del ciclo de
aprendizaje: un defecto importante se corrige dos veces, primero el código y
después el sistema.
