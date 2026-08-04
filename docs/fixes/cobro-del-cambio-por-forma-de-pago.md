# El cobro de un cambio se clasifica por su forma de pago real

**Riesgo:** H-75
**Estado:** RESUELTO
**Fecha:** 03/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`docs/trazabilidad-financiera.md` § Pago mixto fija el contrato:

> Cada movimiento identifica por separado efectivo, tarjeta, transferencia y
> otro. La suma de componentes debe coincidir exactamente con el monto.

El cobro de la diferencia de un cambio no lo cumplía: **sólo reconocía el
efectivo**. Medido sobre el artefacto, con una diferencia de $1,000:

| Forma de pago | Antes | Esperado |
|---|---|---|
| Efectivo | `efectivo: 1000` ✅ | igual |
| **Tarjeta** | **`otro: 1000`** ❌ | `tarjeta: 1000` |
| **Transferencia** | **`otro: 1000`** ❌ | `transferencia: 1000` |
| **Mixto** (400 + 600) | **`otro: 1000`** ❌ | `efectivo: 400`, `tarjeta: 600` |

La suma siempre cuadraba con el monto, así que ninguna comprobación existente lo
delataba: el dinero estaba, pero **en la columna equivocada**. Un corte de caja
por forma de pago habría reportado de menos en Tarjeta y de más en un cajón sin
nombre, sin que nada avisara.

Reproducción: `node test-h75-cobro-del-cambio.mjs` → **10 pasaron, 4 fallaron**.

## Causa raíz

`balam/data.jsx` § `recordExchange`. El pago se armaba a mano con un ternario:

    efectivo: (metodoPago || 'Efectivo') === 'Efectivo' ? diferencia : 0,
    tarjeta: 0, transferencia: 0,
    otro: (metodoPago || 'Efectivo') === 'Efectivo' ? 0 : diferencia,

`tarjeta` y `transferencia` estaban cableadas a cero. La autoridad correcta ya
existía —`paymentParts(metodo, monto, detalle)`, la misma que usa cualquier otro
cobro del sistema— y el cambio no la consumía (`AP-01`, `R-DOM-01`).

Contribuyó un segundo eslabón: la pantalla del Cambio recibía del cobro el objeto
completo, con su `pagoDetalle` ya calculado, y **se quedaba sólo con el nombre del
método**, descartando el desglose. Por eso un pago mixto no tenía forma de
repartirse aunque la autoridad supiera hacerlo.

## Diseño

**Contrato.** El cobro de un cambio se clasifica igual que cualquier otro cobro:
por la autoridad única, con su desglose cuando existe.

**Un método sin columna propia sigue yendo a `otro`, pero por decisión
explícita.** Se le pasa el detalle `{ otro: monto }` en vez de caer ahí por
descarte, de modo que el destino queda declarado y la invariante se comprueba.
Esto conserva el comportamiento de métodos como `Depósito` o `Apartado` sin que
un método nuevo pueda romper el registro.

**Compatibilidad.** Los cobros ya registrados no se migran: un cambio anterior
conserva su clasificación. Un corte de caja sobre fechas pasadas seguirá
mostrando ese dinero en `otro`, y así debe ser (`ADR-002`).

**No alcance.** Las devoluciones siguen sin desglose por forma de pago —guardan
un solo `metodo`—; queda registrado y es una pregunta abierta para el reporte de
ingresos. Tampoco entra el reporte en sí (D-5).

## Solución

- `balam/data.jsx` § `recordExchange`: consume `paymentParts()`, acepta
  `pagoDetalle` y rechaza con `INVALID_PAYMENT` si el desglose no cuadra, en vez
  de registrar un cobro mal clasificado.
- `balam/returns.jsx` § `ExchangeDetail`: el `pagoDetalle` que ya calcula
  `CheckoutModal` viaja hasta el documento en vez de descartarse.
- Artefactos regenerados con `node build-offline.mjs`.

## Pruebas

    node test-h75-cobro-del-cambio.mjs   14/14   (previo 10 pasaron, 4 fallaron)

Cubre las cinco formas de pago —efectivo, tarjeta, transferencia, mixto y un
método sin columna—, la invariante `efectivo + tarjeta + transferencia + otro ==
monto` en todos los casos, que el cobro se marque como `tipo: 'cambio'`, y que
`recordExchange` respete el desglose que le envía la pantalla.

Regresión ejecutada, toda en verde:

    test-cambio-e2e 37/37 · test-exchange-model 28/28 · test-exchange-commit 32/32
    test-exchange-reports 24/24 · test-exchange-screen 45/45
    test-exchange-commission 30/30 · test-h73 29/29 · test-h74 25/25
    test-h72 16/16 · test-h71 29/29 · test-sale-coherence 20/20
    test-report-revenue 24/24 · test-store-queue 159/159 · test-liquidations 12/12
    test-smoke 15/15 · test-ui-navigation 15/15 · test-module-contracts 41/41
    test-ux-metrics sin retroceso

## Riesgo residual y pendientes

- **Los cobros de cambio anteriores a esta corrección conservan su
  clasificación**: su dinero sigue en `otro`. No se migran por diseño. Si el
  reporte de ingresos cubre fechas previas, esas cifras deben leerse con eso en
  mente.
- **Las devoluciones no tienen desglose por forma de pago.** Guardan un único
  `metodo` y su importe, así que el dinero que sale no puede repartirse entre
  columnas. Es la pregunta abierta número 2 del cuestionario de ingresos.
- El reporte de ingresos por día y forma de pago (D-5) sigue pendiente; esta
  corrección es su precondición.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-75
- Autoridad financiera: `docs/trazabilidad-financiera.md` ·
  `authorities/sales.md` § ¿Cuánto se cobró realmente por esta venta?
- Antipatrón: `AP-01` · Reglas: `R-DOM-01`, `R-DOM-05`, `R-DEL-05`, `R-DEL-11`,
  `R-CLI-06`
