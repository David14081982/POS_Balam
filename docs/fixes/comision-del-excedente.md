# La comisión del excedente se calculaba, se atribuía y nunca se pagaba

**Riesgo:** H-47
**Estado:** RESUELTO en base de datos — pendiente de publicar el cliente
**Fecha:** 30/07/2026
**Commit:** `be84e3c`

## Problema y reproducción

Al registrar un cambio, el sistema calculaba la base de comisión —el excedente de
valor que el cliente paga de más— y la guardaba en `baseComision`
([data.jsx:1429](../../balam/data.jsx)). Desde H-42 guardaba también **a quién**
le correspondía, en `vendedor_id`.

Nadie la acreditaba. `recordExchange` no tocaba a los vendedores en ningún punto,
y la pantalla de liquidación paga exclusivamente lo que está en `comisionAcum`.

    node test-exchange-commission.mjs

Antes de la corrección: **8 pasaron, 21 fallaron**. Una expectativa del propio
arnés estaba mal calculada —esperaba 35 donde el neto da 30.17— y se corrigió
antes de implementar; de ahí que la primera ejecución reportara 7/22.

El dato estaba completo y correcto en la base. El pago nunca llegaba. Quien
atendía el cambio hacía una venta nueva, el sistema la registraba con su nombre,
y a fin de mes cobraba como si no la hubiera hecho.

## Causa raíz

Dos ausencias, una en cada extremo:

1. `recordExchange` no acreditaba nada.
2. `pos.commit_exchange` **no podía** acreditar: no tenía ningún parámetro para
   recibir efectos de vendedor. `commit_sale` sí lo tiene desde
   `20260725001900`; su función hermana nació sin él.

## Diseño

**Decisión del dueño (30/07/2026):** la comisión se acredita en el acto, igual
que en una venta, con una reversa preparada para cuando el cambio se cancele o se
modifique. Así quien vende ve su comisión al momento.

**Un cambio no es un pedido.** Se acredita `comisionAcum` y **nada más**: ni
`ventasMes` ni `ventasNum`. El excedente es ingreso, pero proviene de una
operación ya existente, así que no debe mover el conteo de ventas, el ticket
promedio ni las metas del equipo. Esa distinción está probada en los dos
extremos: en el arnés y en la verificación SQL.

**La evidencia se congela (ADR-002).** El documento guarda el **monto realmente
acreditado**, el criterio usado —neto o bruto— y el porcentaje vigente. Sin eso
la reversa tendría que recalcular con la configuración de hoy, y un cambio de
`commission.base` o del porcentaje de alguien entre el registro y la reversa
haría que se restara una cifra distinta de la que se sumó. Es `AP-06` —derivar lo
que debe ser evidencia— aplicado a dinero de una persona.

Nótese que la venta original **no** congela su porcentaje: `recordReturn`
recalcula con el vigente ([data.jsx:1544](../../balam/data.jsx)). Es una
debilidad heredada del camino de la venta, no de este; H-47 no la propaga.

**La reversa es una costura declarada, no un camino vivo.** Hoy no existe ninguna
forma de cancelar ni modificar un cambio: `pos.exchanges` no tenía columna de
estado y nada lo revertía. `reverseExchangeCommission` es el mecanismo listo para
cuando exista, y está probado —nueve comprobaciones— para que no sea código
muerto (ADR-003).

**La cola reintenta, así que el reenvío no puede pagar dos veces.** Se adoptó la
misma reconciliación que `commit_sale`: si la versión del vendedor ya avanzó uno
sobre la base leída y el valor final coincide, el efecto ya se aplicó y se deja
como está. No es una excepción por conflicto —`commit_sale` tampoco la lanza—,
es una reconciliación silenciosa.

## Solución

`balam/data.jsx`
- Cálculo del monto en `recordExchange`, con base neta o bruta según
  `commission.base`, y congelado en `comisionMonto` / `comisionBase` /
  `comisionPct`.
- Acreditación con `sellerEffects` y su `base_version`.
- `reverseExchangeCommission(id)`: resta el monto congelado, es idempotente
  mediante `comisionRevertida`, nunca deja el acumulado en negativo y avisa
  cuando el cambio no existe o ya estaba revertido.

`balam/store.jsx` — los cuatro campos viajan y se releen; `pushExchange`
transporta `seller_effects` y el despacho los pasa a `commit_exchange`.

`supabase/migrations/`
- `20260730006500` — cuatro columnas aditivas con valor por omisión, más un CHECK
  que sólo admite `neto` o `bruto`.
- `20260730006600` — `commit_exchange` con `p_seller_effects`. **Generada del
  texto vigente** (`20260729006300`) con 8 sustituciones verificadas una a una;
  el diff contra el original muestra exactamente 8 hunks (`AP-05`).
- `20260730006700` — verificación contra la base real.

## Pruebas

`node test-exchange-commission.mjs` — **30 pasaron, 0 fallaron**, desde una línea
base de 8/21.

Regresión completa en verde, con atención especial a las rutas de dinero y
sincronización que este cambio atraviesa: comisiones 10/10; comisión efectiva
22/22; liquidaciones 10/10; elegibilidad 10/10; cola durable 115/115;
concurrencia 9/9; trazabilidad de descuento 65/65; folio diario 60/60; coherencia
de venta 17/17; devoluciones 17/17; modelo del cambio 28/28; commit del cambio
32/32; saldo por renglón 38/38; plazo 38/38; contratos de módulo 38/38;
migraciones 31/31; E2E del cambio 37/37; pantalla del cambio 45/45; smoke 15/15;
navegación 15/15; roles 10/10; build 8/8. Guardián de UX en 11/11, sin cambios.

## Despliegue

Las tres migraciones se aplicaron a `Balam` el 30/07/2026, autorizadas por el
dueño al ser operación destructiva en producción. La verificación emitió sus
**ocho** avisos y no dejó filas.

Dos fallos de la verificación, ambos de la semilla y no de la función, corregidos
en el sitio porque `20260730006700` aún no estaba registrada (`R-DB-01`):

1. `La venta no tiene una reserva de inventario confirmada`. Una venta cobrada
   exige reserva (H-01, `20260725001800`) y mi semilla no la creaba. La
   verificación de H-42 había esquivado el disparador usando estado `Apartado`;
   aquí se siembra el estado real, porque nadie cambia mercancía de un apartado
   que todavía no salió de la tienda (`R-DEL-12`).
2. `column "origen_folio" does not exist` en la limpieza. `line_consumption` y
   `line_supply` son **vistas**, no tablas: se vacían solas al borrar las tablas
   de las que derivan. Las dos sentencias sobraban.

Ambos fallos ocurrieron **después** de que las siete comprobaciones de fondo
pasaran, y el bloque completo es una transacción, así que las ejecuciones
abortadas no dejaron residuo.

El `drop` es protector, no arriesgado, y el orden importa: mientras coexistan la
firma de cinco parámetros y la de seis, una llamada con cinco resulta
**ambigua** y PostgreSQL la rechaza. Retirar la antigua deja una sola candidata,
y como el sexto parámetro tiene valor por omisión, un cliente con el paquete
anterior sigue funcionando. Por eso el cliente no podía publicarse antes de
las migraciones (`R-DEL-03`), y por eso el orden fue base primero.

## Riesgo residual y pendientes

- La reversa no tiene ningún camino que la invoque, porque no existe cancelar ni
  modificar un cambio. Es una costura probada, no una función en uso.
- El IVA al 16% incluido se replica como criterio en `recordExchange` porque
  `recordSale` lo fija así en su propio cálculo. Unificar ambos en un solo
  ayudante queda pendiente (`AP-01`).
- La venta original sigue sin congelar su porcentaje de comisión: si cambia entre
  la venta y la devolución, la reversión de la venta difiere de lo acreditado.
  Debilidad heredada, fuera del alcance de H-47, digna de historia propia.
- H-48 —el descuadre entre cobrado y vendido— sigue abierto, y es el que hace
  visible este ingreso en los reportes. H-46 quedó ocupada por la historia de
  Préstamos de otra sesión (`9387e62`), así que esta corrección se renumeró a
  H-47 y el resto del plan de C7 se desplazó.

## Referencias

`docs/04-contrato-del-cambio.md` § 7 · `docs/architect/decisions/ADR-002`,
`ADR-003` · `docs/fixes/recorrido-del-cambio.md` ·
`supabase/migrations/20260725001900_pos_transactional_sale.sql` (patrón de
efectos de vendedor)
