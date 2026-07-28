# ADR-001 — Identidad técnica y folio comercial son campos separados

**Estado:** vigente · **Historias:** H-02 (origen), H-33 (corrección)

## Contexto

H-02 resolvió la unicidad multi-terminal del folio adosándole la representación
en base 36 de los 128 bits del `operation_id`. Funcionó: dos terminales offline
dejaron de generar `BG-1`. Pero el identificador técnico quedó expuesto dentro
del folio comercial y produjo valores de 29 caracteres como
`BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H`, que se partían en tres renglones en
Devoluciones y estiraban las columnas de Reportes.

## Decisión

Dos campos con responsabilidades separadas, y ninguno se deriva del otro.
`operation_id` es identidad técnica inmutable —reserva de stock, commit
idempotente, conflictos, cola— y no se muestra. `folio` es la referencia
comercial visible, con formato `{PREFIJO}-{AAMMDD}-{CONSECUTIVO}`. La unicidad
del folio la aporta su propia fuente, `pos.folio_counters`, mediante bloques
diarios que cada terminal consume sin red.

## Trade-off

**Beneficio obtenido:** el folio es legible, cabe en una línea del ticket y una
terminal offline emite un folio corto y definitivo sin esperar a la nube.

**Costo aceptado:** un objeto y un contrato más que mantener —el contador
atómico, la reserva de bloques y su reposición—, y un residuo que no desaparece:
dos terminales sin bloque que compartan código de tres caracteres (1 en 46 656)
pueden emitir la misma cadena. Ese residuo obligó a conservar `folio_conflict` y
a introducir `folio_aliases`, es decir, un mecanismo de reconciliación completo
para un caso rarísimo. Además, una terminal sin bloque emite folios de 18
caracteres, más largos que el formato limpio.

**Alternativa descartada:** seguir derivando la unicidad del `operation_id` y
recortar el folio sólo en la presentación. Se descartó porque el folio es la
referencia que el cliente y el mostrador usan para buscar, devolver y
reimprimir: un recorte visual habría dejado dos representaciones distintas del
mismo dato y no habría resuelto el problema real.

## Cómo se revierte y qué se rompería

No se revierte. Los folios ya impresos existen en tickets físicos y una venta
confirmada en la nube no se renombra nunca. Los folios anteriores a H-33
permanecen válidos, buscables y devolvibles, y no se migran.

## Referencias

`docs/fixes/folio-comercial-diario.md` · `docs/fixes/folios-multi-terminal.md` ·
`docs/02-architecture.md` § Identidad y folio de venta · `AP-07`
