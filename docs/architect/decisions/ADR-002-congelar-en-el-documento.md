# ADR-002 — Lo pactado en la venta se congela en el documento

**Estado:** vigente · **Historias:** H-03 (origen), H-32, H-34

## Contexto

Tres veces apareció el mismo problema con formas distintas. El ticket
reconstruía importes con la configuración vigente (H-03). El porcentaje de la
promoción no estaba guardado y la única salida era dividir descuento entre
precio, produciendo números que ningún administrador configuró —7.14 % con
artículos elegibles y no elegibles, 4.8 % con monto fijo, 15 % con dos
promociones acumuladas— (H-32). El plazo de devolución no existía, y
derivarlo de la configuración habría hecho que activarlo venciera
retroactivamente ventas ya emitidas (H-34).

## Decisión

Todo valor pactado con el cliente al vender viaja **dentro** del documento como
copia congelada, no como referencia. El desglose financiero, la evidencia de las
promociones aplicadas (`sale_items.promos`) y el plazo de posventa
(`sales.return_limit_days` / `return_expires_at`) son snapshots. Los valores
derivados de la fecha usan la misma fecha guardada en la venta, nunca una
segunda lectura del reloj.

## Trade-off

**Beneficio obtenido:** un ticket emitido sigue siendo explicable años después
aunque la promoción se edite o se borre, aunque la política de devoluciones
cambie y aunque el IVA cambie. Cambiar una configuración no altera el pasado.

**Costo aceptado:** más almacenamiento y más columnas por venta; datos
redundantes que pueden divergir de la configuración vigente sin que eso sea un
error; y una asimetría permanente entre documentos anteriores y posteriores a
cada cambio, que obliga a distinguir «sin dato» de «anterior al contrato». Las
ventas previas a H-32 nunca imprimirán porcentaje y las previas a H-34 nunca
vencen: es correcto por diseño, pero hay que explicarlo cada vez.

**Alternativa descartada:** un número de versión de esquema por venta que
permitiera reinterpretar documentos antiguos con reglas nuevas. Se descartó
porque reinterpretar es exactamente lo que no debe pasar: la ausencia del campo
ya es una distinción inequívoca y más barata.

## Cómo se revierte y qué se rompería

No se revierte sin romper la trazabilidad financiera y el compromiso comercial
con el cliente. Cualquier cambio exige un ADR nuevo que reemplace a éste.

## Referencias

`docs/H-03-coherencia-cobro.md` · `docs/trazabilidad-financiera.md` ·
`docs/fixes/trazabilidad-descuento-ticket.md` · `docs/fixes/plazo-posventa.md` ·
`AP-06`
