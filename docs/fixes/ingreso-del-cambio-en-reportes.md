# El dinero cobrado no cuadraba con el importe vendido

**Riesgo:** H-49
**Estado:** RESUELTO
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

En la pantalla de Reportes, dos cifras se leen juntas y no cuadraban:

- **«Dinero cobrado»** sumaba **todos** los pagos, incluidas las diferencias de
  cambios, que desde H-47 tienen su propio pago de tipo `cambio`.
- **«Ventas brutas»** sumaba el total de las **ventas**. Un cambio no es una
  venta, así que esas diferencias no aparecían.

El arnés lo midió antes de tocar nada:

    node test-report-revenue.mjs

**2 pasaron, 22 fallaron.** La comprobación 15 mostró el descuadre con números:
`cobrado=450 vendido=undefined`, sobre una venta de 350 y un cambio de 100. Los
100 estaban cobrados y no figuraban en ninguna parte del importe.

Con un cambio al mes no se nota. Con veinte, al cerrar el mes hay un hueco de
miles de pesos y la pregunta natural —«¿me falta dinero o falta un registro?»— no
tenía respuesta en pantalla.

## Causa raíz

Ninguna cifra estaba mal calculada. Faltaba una **decisión de negocio expresada
en el código**: qué es la diferencia de un cambio. Ingreso, sí; pedido, no. Y sin
esa distinción escrita en un solo lugar, cada pantalla la resolvía a su manera —o
no la resolvía.

## Diseño

**Decisión del dueño (30/07/2026).** La diferencia pagada **sí** suma al importe
vendido, porque es ingreso adicional por entregar un producto de mayor valor.
Pero **no** se contabiliza como pedido ni como venta nueva, porque proviene de una
operación que ya existía. Así el cobrado cuadra con el vendido sin alterar
artificialmente el número de pedidos, el ticket promedio ni las metas del equipo.
Y debe verse en un renglón propio.

**La aritmética va a una autoridad, no al reporte.** La suma de ventas está
escrita **seis veces** en `balam/*.jsx` —dashboard, apartados y cuatro puntos de
reportes—. Añadir el ingreso del cambio en una sola habría creado la séptima
divergencia (`AP-01`). Por eso nace `DATA.revenueSummary`, y el reporte la
consume.

**El ticket promedio se mide sobre ventas, no sobre el importe total.** Es la
consecuencia técnica menos obvia de la decisión: si el promedio usara el importe
—que ahora incluye los cambios—, un cambio lo inflaría sin que nadie hubiera
comprado de más. La autoridad devuelve `ticketProm` ya calculado sobre
`ventasSolas`, para que ninguna pantalla pueda equivocarse.

**Un cambio a la baja no aporta ingreso, ni positivo ni negativo.** Cuando el
cliente se lleva menos de lo que entrega, no entra dinero: pierde el sobrante
(Contrato § 4). Ese valor se informa por separado en `noAprovechado` y **nunca**
suma ni resta del importe. Está probado en las comprobaciones 16 a 18.

**La variación mensual mide lo mismo que el KPI.** Si el importe del mes incluye
los cambios pero su comparación con el mes anterior no, la flecha de tendencia
miente. El importe los incluye; el **conteo** sigue siendo de pedidos.

## Solución

`balam/data.jsx` — tres funciones nuevas:

| función | qué responde |
|---|---|
| `revenueSummary(pred)` | `ventasSolas`, `difCambios`, `importeVendido`, `noAprovechado`, `pedidos`, `ticketProm` |
| `exchangeRevenue(pred)` | cuánto dinero entró por diferencias de cambios |
| `exchangeUnusedValue(pred)` | cuánto valor perdieron los clientes |

`pred` recibe el documento completo. Ventas y cambios tienen ambos `fecha`, así
que un mismo filtro de periodo sirve para los dos.

`balam/reports.jsx` — el resumen consume la autoridad; `ticketProm` y `pedidos`
salen de ella; la fila de dinero pasa de cinco a seis tarjetas con **«Diferencias
cobradas por cambios»**; y `monthAgg` suma el ingreso del cambio al importe sin
tocar el conteo.

## Pruebas

`node test-report-revenue.mjs` — **24 pasaron, 0 fallaron**, desde 2/22.

Regresión completa en verde: comisión del excedente 30/30; modelo del cambio
28/28; commit del cambio 32/32; devoluciones 17/17; saldo por renglón 38/38;
plazo 38/38; comisiones 10/10; comisión efectiva 22/22; liquidaciones 10/10; cola
durable 115/115; concurrencia 9/9; contratos de módulo 38/38; coherencia de venta
17/17; trazabilidad de descuento 65/65; folio diario 60/60; migraciones 31/31;
reproducibilidad 8/8; smoke 15/15; navegación 15/15; E2E del cambio 37/37;
pantalla del cambio 45/45; roles 10/10; ticket 23/23. Guardián de UX intacto en
11/11.

Se ejecutó también el arnés de la pantalla de Préstamos, que es de otra sesión,
para comprobar que mi recompilación no rompía su trabajo: **112/112**.

Sin migraciones: H-49 no toca esquema, contrato, autoridades del dominio ni
reglas económicas. Lo único que cambia es dónde vive una aritmética que ya
existía y qué se muestra.

## Riesgo residual y pendientes

- El dashboard y la pantalla de apartados siguen sumando ventas por su cuenta.
  No las toqué: sus cifras —«ventas de hoy», «comprometido»— no son las que el
  dueño señaló como descuadradas, y cambiarlas habría movido números que nadie
  pidió mover. Migrar esas cinco sumas restantes a `revenueSummary` es trabajo
  con historia propia, y el camino ya está abierto.
- «Dinero cobrado» seguirá siendo menor que «Ventas brutas» cuando haya apartados
  con saldo pendiente. Eso ya lo explicaba «Saldos pendientes» y no es un
  descuadre.
- La utilidad estimada se calcula sobre el importe vendido, que ahora incluye los
  cambios. Es coherente —el excedente genera margen— pero es un número que se
  movió sin que se pidiera explícitamente.
- H-50 —los tres reportes que exige el Contrato § 7— sigue abierto, y es donde
  `noAprovechado` se mostrará.

## Referencias

`docs/04-contrato-del-cambio.md` § 4 y § 7 · `docs/fixes/comision-del-excedente.md`
(H-47) · `docs/architect/decisions/ADR-003`
