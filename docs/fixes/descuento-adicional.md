# Descuento adicional integrado al documento de venta

**Riesgo:** H-52
**Estado:** resuelto y verificado remotamente
**Fecha:** 30/07/2026
**Commit:** `420a4f9`

## Problema y evidencia

El sistema sólo podía representar promociones configuradas por renglón. El POS,
`recordSale()` y el ticket derivaban distintos fragmentos del total, y el
documento no podía congelar un segundo beneficio con origen, motivo, folio o
reparto. `test-additional-discount.mjs` falló inicialmente porque no existía
`DATA.saleQuote()`.

## Decisiones del dueño

- Cambios y Devoluciones reconocen el importe realmente pagado.
- La comisión usa el total posterior a ambos descuentos.
- El descuento de ticket se prorratea sobre el valor posterior a promociones;
  el último renglón elegible absorbe el residuo.
- No hay autorización secundaria.
- Varias aplicaciones sólo son válidas si todas son combinables.
- Una tarjeta física es de un uso y exige conexión.
- La cortesía total es un descuento que lleva el total a cero.
- El apartado congela el beneficio al crearse.
- El ticket enmascara el folio y muestra origen, beneficio y motivo resumido.

## Corrección

`DATA.saleQuote()` recibe la evidencia de `resolveLineDiscount()` y devuelve una
cotización completa: precio original, descuento configurado, base elegible,
aplicaciones adicionales, reparto por renglón, subtotal, IVA y total final.
POS, vista previa, cobro y `recordSale()` consumen esa estructura.

La venta conserva `descuento` con el significado de H-32 y añade un snapshot
separado. `STORE.pushSale()` transporta cabecera, aplicaciones y reparto dentro
de la operación durable existente. La costura SQL
`commit_sale_with_additional_discount()` delega inventario, pagos, cliente y
vendedores a `commit_sale()` y completa el snapshot dentro de la misma
transacción.

Los folios físicos viven en `physical_card_redemptions`. Al aplicarlos,
`claim_physical_card()` obtiene una reserva atómica vinculada al identificador
estable de la aplicación; vence a los 15 minutos si la venta se abandona. El
commit sólo consume esa reserva. La clave primaria y los candados
transaccionales impiden que dos terminales reserven o consuman el mismo folio.
La tabla no es escribible directamente por el navegador.

Configuración incorpora el catálogo “Descuentos adicionales y beneficios”, con
origen, tipo, valor, alcance, requisitos, máximos, combinación y estado.

## Compatibilidad

Las columnas son aditivas y anulables. Una venta histórica conserva ausencia de
evidencia y nunca se interpreta como si hubiera recibido un beneficio. No
cambian `descuento`, `promos`, `valor_regalado`, pagos ni el contrato de
cortesía existente.

## Pruebas

- Línea base: falta de `DATA.saleQuote()`.
- Autoridad y consumidores: `test-additional-discount.mjs`, 27/27.
- H-32: `test-discount-trace.mjs`, 65/65.
- Coherencia financiera: `test-sale-coherence.mjs`, 20/20.
- Devoluciones 17/17; plazo 38/38; modelo de cambio 28/28; commit de cambio
  32/32; E2E de cambio 37/37; apartados 55/55; comisiones 10/10.
- Cola 115/115; concurrencia 9/9; ticket 23/23; reportes 24/24; contratos
  38/38; migraciones 31/31; navegación 15/15; build reproducible 8/8.
- `build-offline.mjs` correcto. El smoke del bundle arrancó, recorrió 13
  comprobaciones sin error y el arnés no terminó dentro del límite; el smoke
  de desarrollo tampoco arrancó dentro de 30 segundos.

## Despliegue y riesgo residual

Las migraciones `006800` y `006900` se aplicaron al proyecto Supabase enlazado
el 30/07/2026. La verificación remota confirmó snapshot, validación, unicidad y
permisos, y revirtió sus datos de prueba. No se ejecutó el SQL localmente
porque el PostgreSQL local de Supabase no estaba levantado. La reserva
abandonada inmoviliza el folio durante un máximo de 15 minutos; es una
consecuencia intencional para privilegiar la unicidad.

El commit `420a4f9` se publicó en `main`. GitHub Pages sirve `index.html`
idéntico byte a byte al artefacto del commit:

    SHA-256  080FA2BA99304D6C73F893BCE8556226CCDF67B678DC630B14C48B187C104B33
    bytes    8 734 207
