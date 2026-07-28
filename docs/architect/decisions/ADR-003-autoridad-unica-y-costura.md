# ADR-003 — Una pregunta de negocio tiene una sola autoridad, y las extensiones entran por una costura declarada

**Estado:** vigente · **Historias:** H-35 (origen) · H-18, H-25, H-26, H-29
(mismo patrón en otras capas)

## Contexto

«¿Cuántas unidades siguen disponibles?» estaba respondida tres veces con la
misma fórmula copiada: la validación de `commit_return`, su cálculo de estado y
`DATA.returnedQty()`. Las tres leían `pos.return_items`, la tabla de una sola
clase de documento. Mientras las devoluciones fueran el único documento que
consume unidades, las tres coincidían y la duplicación era invisible.

## Decisión

La pregunta tiene una autoridad: `pos.sale_line_balance()` en la nube y
`DATA.saleLineBalance()` en el cliente. Los documentos que consumen unidades se
enumeran en un único punto de extensión —la vista `pos.line_consumption` y su
espejo local `consumptionSources()`—, no en cada consumidor.

## Trade-off

**Beneficio obtenido:** el módulo de Cambios entrará sin tocar `commit_return`
ni a ninguno de sus consumidores. El lugar donde se puede olvidar una clase de
documento pasó de tres a uno.

**Costo aceptado:** más acoplamiento —todos los consumidores dependen ahora de
una sola función y un error en ella los alcanza a todos— y una indirección que
hace la consulta menos obvia al leerla. Además, un objeto más que asegurar: la
vista necesitó su propia corrección de permisos (`AP-02`, `AP-03`), lo que
demuestra que centralizar también centraliza la superficie de ataque.

**Alternativa descartada:** enumerar las clases de documento en cada consumidor.
Se descartó porque el costo del olvido es doble consumo de la misma pieza
—doble reingreso de stock y doble efecto financiero— sin ninguna restricción en
la base que lo impida.

## Cómo se revierte y qué se rompería

Volver a consultar `return_items` directamente restaura el comportamiento actual
mientras no existan cambios; en cuanto exista un segundo documento, reintroduce
el defecto. Revertir exige un ADR nuevo que reemplace a éste.

## Referencias

`docs/fixes/saldo-por-renglon.md` ·
`supabase/migrations/20260728004700_pos_h35_line_balance.sql` · `AP-01`
