# Modelo del cambio de mercancía (C4)

**Riesgo:** H-37
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** Pendiente de commit

Fase C4 del módulo de Cambios, gobernada por `docs/04-contrato-del-cambio.md` y
`ADR-010`. Define el **modelo**; no implementa `pos.commit_exchange()` (C5) ni
la interfaz (C6), igual que H-35 preparó el terreno sin implementar cambios.

## Problema y reproducción

El Contrato del Cambio estaba aprobado pero el esquema no tenía dónde guardar un
cambio, y la autoridad del saldo no podía gobernar una pieza entregada en uno.

`node test-exchange-model.mjs` antes del cambio: **4 pasaron, 23 fallaron**. Los
4 que pasaban son el comportamiento de H-35 que no debía cambiar.

## Causa raíz

H-35 dejó preparada la costura del lado que **resta** —`pos.line_consumption` y
su espejo `consumptionSources()`, que ya declaraba un término `cambiada`—, pero
el lado que **suma** estaba fijo: el bloque `sold` de `pos.sale_line_balance()`
leía exclusivamente `pos.sale_items` del folio.

El contrato permite recambiar una pieza recibida en un cambio anterior (§2) y le
da valor histórico propio (§3). Esa pieza no es renglón de ninguna venta, así que
sin un lado que sume la autoridad no podía gobernarla: sería posible consumir dos
veces la misma unidad por caminos distintos, el defecto que H-35 existe para
prevenir.

## Diseño

```
vendida   = sale_items(folio)  ∪  line_supply(folio)
consumida = line_consumption(folio)   -- devoluciones ∪ cambios (lado devuelto)
```

Una cadena A→B→C queda anclada al folio de origen y sigue habiendo **una sola
autoridad** del saldo (`ADR-003`).

**Autoridad nueva:** `DATA.recognizedValue(folio, sku, talla)` responde «qué
valor histórico se le reconoce a la pieza que el cliente entrega», tanto para
piezas de la venta —su `precioBase` congelado— como para piezas entregadas en un
cambio anterior, donde manda el último cambio. **Nunca deriva del precio
vigente**: eso le cobraría al cliente una subida posterior a su compra. El precio
vigente sólo aplica a lo que recibe, y lo resuelve `DATA.listPrice()`.

**Ledger único:** el cobro de la diferencia entra en `pos.sale_payments` con el
folio **propio del cambio** y `tipo = 'cambio'`. Se verificó antes de decidir que
`sale_payments.folio` no tiene clave foránea y que la única atadura estructural
era el `check` de `tipo`, ampliado de forma aditiva.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/data.jsx` | Colección `exchanges` con su clave de `localStorage` y `saveExchanges()`; `supplySources()` como costura simétrica; `saleLineBalance()` suma el suministro; `recognizedValue()` como autoridad única; alta en `applyRemote`. |
| `balam/store.jsx` | Mapeador del dominio `exchanges` ↔ `pos.exchanges`. |
| `…005300_pos_h37_exchange_model.sql` | Tablas, RLS, vista `pos.line_supply`, `sale_line_balance()` extendida y `tipo` de pago ampliado. |
| `…005500_pos_h37_line_consumption_exchange.sql` | La rama de cambios que faltaba en `pos.line_consumption`. |
| `…005600_pos_h37_exchange_model_verification.sql` | Verificación autocontenida. |
| `test-exchange-model.mjs` | Arnés nuevo, 28 casos. |

## Pruebas

Reproducción previa **4/23**; después **28/28**. Regresión completa en verde:
saldo por renglón 38/38, devoluciones 17/17, coherencia de venta 17/17, plazo
38/38, precio por talla 38/38, trazabilidad 65/65, cola 115/115, migraciones
29/29, contratos 36/36, descuentos 43/43 sin modificar, folio diario 60/60,
folios 12/12, comisiones 10/10, comisión efectiva 22/22, liquidaciones 10/10,
elegibilidad 10/10, avatares 13/13, concurrencia 9/9, roles 10/10, build 8/8,
SDK 4/4, smoke bundle 17/17, navegación 13/13, precio por talla E2E 19/19,
propagación de reset 21/21, filtros 18/18. Build offline correcto.

## Despliegue

Migraciones aplicadas al proyecto `Balam` el 28/07/2026 y registradas:
`005300`, `005500` y `005600`.

### La verificación detectó un defecto real

El primer intento abortó:

```
ERROR: H-37: la pieza devuelta deberia quedar sin disponible (disponible=1)
```

`005300` creó la costura de **suministro** pero no añadió la rama de cambios a la
costura de **consumo**: `line_consumption` seguía leyendo sólo `return_items`, de
modo que los renglones `lado = 'devuelto'` no restaban nada. El espejo local no
lo reveló porque `consumptionSources()` ya traía esa rama desde H-35: **sólo
faltaba del lado SQL**.

`005300` ya estaba registrada, así que no se reescribió (`R-DB-01`): se corrigió
hacia adelante con `005500`, y la verificación se renumeró de `005400` a `005600`
porque debe correr al final (`R-DB-02`) — `005400` nunca llegó a registrarse.

El arnés comprobaba la rama de suministro pero no la de consumo: el síntoma y no
la defensa (`AP-09`). Se endureció con el caso `24b`, y la verificación ahora
exige además que `line_consumption` conserve su contención tras el
`create or replace`.

### Salida de la verificación

```
NOTICE: H-37: line_supply interna · solo service_role · security_invoker activo
NOTICE: H-37: line_consumption con rama de cambios y contencion intacta
NOTICE: H-37: 0 cambios registrados · el saldo es identico al de H-35
NOTICE: H-37: sale_payments admite tipo=cambio y los cuatro tipos previos siguen validos
NOTICE: H-37: la pieza entregada suministra el folio de origen y queda recambiable
NOTICE: H-37: commit_sale y commit_return intactas
NOTICE: H-37: verificacion completa · modelo, costura de suministro, ledger y limpieza
```

## Riesgo residual y pendientes

- El desglose de Reportes —anticipos y abonos— dejará de sumar el total cobrado
  en cuanto exista un pago de cambio. Corresponde a **C7**.
- `pos.sale_payments.folio` pasa a significar «folio del documento que originó el
  cobro», desambiguado por `tipo`. Documentado en la columna.
- Sin `pos.commit_exchange()` (C5) no hay atomicidad ni reserva de stock para la
  pieza entregada: hoy nada del producto escribe en estas tablas.
- La interfaz (C6) no existe: el modelo no es alcanzable por el usuario final.

## Referencias

- Contrato: `docs/04-contrato-del-cambio.md`
- Decisión: `docs/architect/decisions/ADR-010-materializacion-del-cambio.md`
- Riesgo: `docs/03-known-risks.md` → H-37
- Fases previas: `docs/fixes/plazo-posventa.md` (C1), `docs/fixes/saldo-por-renglon.md` (C2)
