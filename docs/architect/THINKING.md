---
capa: razonamiento
applies_to: [todo]
severity_max: blocking
no_alcance: "Define comprobaciones de razonamiento; las etapas y puertas de cierre viven en WORKFLOW.md."
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

## R-EVI-01

**BLOCKING · VERIFICACIÓN CRUZADA DE EVIDENCIA ANTES DE PROPONER, IMPLEMENTAR O VALIDAR CAMBIOS.**

Antes de presentar una propuesta, modificar o concluir, contrasta la documentación con código ejecutable, funciones reales, contratos de datos y restricciones efectivas del servidor. La documentación describe lo esperado; no demuestra lo implementado. Distingue hechos observados, contrato autorizado, supuestos y decisiones pendientes: una ambigüedad del negocio no autoriza inventar permisos ni decisiones del propietario.

Para cambios en operaciones, permisos, datos, inventario, ventas, comisiones o seguridad, registra en el expediente de la historia, con referencias concretas al código y alcance proporcional al riesgo:

1. La operación que realiza el usuario.
2. La pantalla o componente donde se origina.
3. La función que ejecuta el cliente.
4. La función, gateway o procedimiento que la recibe.
5. Los permisos y restricciones efectivos del servidor.
6. Los datos que consulta o modifica.
7. Otras operaciones que comparten capacidades o funciones.
8. El comportamiento que debe permanecer intacto.

Desarrolla así FF-05 (consumidores), FF-10 (defensa real) y FF-11 (flujo completo). Examina consecuencias directas e indirectas dentro del alcance: capacidades compartidas, callbacks, acciones automáticas y operaciones administrativas que puedan habilitarse indirectamente.

En cambios de capacidades, contrasta permisos antes/después con operaciones efectivamente habilitadas y retiradas, acciones financieras, administrativas o destructivas y efectos sobre cuentas activas, incluidas las de prueba. Cada concesión requiere una operación real y autorización del negocio; compartir categoría o documentación con otra pantalla nunca basta.

Deriva las expectativas del contrato funcional y evidencia independiente de la implementación propuesta. Comprueba que lo autorizado funciona y lo no autorizado sigue bloqueado; en permisos, que una pantalla no conceda accidentalmente operaciones de otra. Está prohibido considerar suficiente una prueba que sólo reproduzca un mapa o supuesto del autor sin verificar su correspondencia con el sistema real. Una prueba aprobada con expectativas incorrectas no valida el diseño.

Antes de declarar una propuesta técnicamente verificada o una historia resuelta, respalda el contraste documental, consumidores y restricciones del servidor, premisas y búsqueda de concesiones indebidas y efectos secundarios. Declara lo no verificado, los supuestos y decisiones pendientes; si falta una comprobación relevante, limita la conclusión y completa sólo esa comprobación. No sustituye las etapas de `WORKFLOW.md`, ni exige una auditoría general o suites adicionales: selecciona la evidencia que mejor detecte errores de concepto y privilegios dentro del alcance autorizado.

Antecedente y evidencia: [H-192](../fixes/verificacion-cruzada-evidencia-h192.md). Complementa `R-SEC-06/07` y `R-DEL-11`; no duplica sus matrices ni crea autorizaciones de cambios funcionales o despliegue.

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
→ `authorities/`. Tres copias de la misma fórmula fue el defecto de H-35, y
nadie lo veía porque las tres coincidían.

**FF-04 · ¿Estoy persistiendo algo derivable, o derivando algo que debía
congelarse?**
El porcentaje del ticket no se deriva (H-32). El plazo no se lee de la
configuración vigente (H-34). La fecha no se lee dos veces (H-33).

**FF-05 · ¿Qué contrato cambia, y quién lo consume hoy?**
Los consumidores se descubren, no se recuerdan: `authorities/` trae la
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
