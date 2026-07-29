# Commit transaccional del cambio (C5)

**Riesgo:** H-38
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** Pendiente de commit

Fase C5 del módulo de Cambios, gobernada por `docs/04-contrato-del-cambio.md` y
`ADR-010`. Entrega `pos.commit_exchange()` como **única autoridad transaccional**
del cambio. La interfaz (C6) y los reportes (C7) quedan fuera de alcance.

## Problema y reproducción

C4 dejó el modelo pero nada podía escribir en él de forma segura: un cambio mueve
inventario en dos sentidos, cobra dinero y consume saldo, y sin una frontera
transaccional un fallo parcial dejaría stock descuadrado o un documento a medias.

`node test-exchange-commit.mjs` contra el árbol previo a C5: **3 pasaron, 28
fallaron**.

## Causa raíz

Contrato ausente, no defecto. No existía ninguna función que confirmara o
revirtiera conjuntamente las nueve cosas que un cambio toca.

## Diseño

`pos.commit_exchange(p_commit_id, p_exchange, p_items, p_moves, p_payment)`
valida y confirma en una sola transacción, en este orden:

1. Perfil operativo (`is_active_admin` o `is_active_seller`).
2. Forma del payload y presencia de **las dos mitades**: sin `devuelto` y
   `entregado` no es un cambio.
3. Candado por `commit_id` e idempotencia por hash en `pos.exchange_commits`.
4. `for update` sobre la venta origen: serializa todos sus documentos.
5. **Plazo de posventa** (H-34): `return_expires_at` vencido → `exchange_window_closed`.
6. **Saldo por renglón** (H-35/H-37) vía `pos.sale_line_balance()`, que ya suma el
   suministro de cambios anteriores → `invalid_exchange_quantity`.
7. **Valoración en el servidor**: `pos.line_recognized_value()` para lo que
   entrega el cliente y `pos.list_price()` para lo que recibe. Ambas internas:
   un cliente manipulado no puede fijar el dinero.
8. **Validación del cobro antes de escribir nada** → `payment_required` /
   `payment_mismatch`.
9. Inventario: bloqueo estable de todos los productos, comprobación de
   existencias de lo entregado (`insufficient_stock`) y movimiento **neto** por
   `(producto, talla)`.
10. Cabecera, renglones con su precio congelado, movimientos y —sólo si hay
    diferencia— el pago con `tipo = 'cambio'` y el **folio propio del cambio**.

**El cambio nunca devuelve efectivo.** Si lo entregado vale menos, `diferencia`
queda en 0, el sobrante se registra en `valor_no_aprovechado` y no se emite
ningún pago. `base_comision = diferencia`: sólo el excedente genera comisión
(Contrato §7).

## Solución

| Archivo | Cambio |
|---|---|
| `…005700_pos_h38_commit_exchange.sql` | `pos.exchange_commits`, las autoridades internas de valoración y `pos.commit_exchange()`. |
| `…005900_…_payment_order.sql` | Corrección: el cobro se valida antes de la primera escritura. |
| `…006000_…_verification.sql` | Verificación autocontenida por la vía real. |
| `balam/data.jsx` | `recordExchange()`: ciclo local con las mismas compuertas, inventario, movimientos y pago; entrega el documento por el gateway. |
| `balam/store.jsx` | `pushExchange()` y la rama `exchange` de la cola, que llama al RPC. |
| `test-exchange-commit.mjs` | Arnés nuevo, 32 casos. |

## Pruebas

Reproducción previa **3/28**; después **32/32**. Regresión completa en verde:
modelo del cambio 28/28, saldo por renglón 38/38, devoluciones 17/17, coherencia
de venta 17/17, plazo 38/38, precio por talla 38/38 y E2E 19/19, trazabilidad
65/65, cola 115/115, migraciones 29/29, contratos 36/36, descuentos 43/43 sin
modificar, folio diario 60/60, folios 12/12, comisiones 10/10, comisión efectiva
22/22, liquidaciones 10/10, elegibilidad 10/10, avatares 13/13, concurrencia 9/9,
roles 10/10, build 8/8, SDK 4/4, entradas 8/8, smoke bundle 17/17, navegación
13/13, propagación de reset 21/21, filtros 18/18. Build offline correcto.

Un defecto local lo atrapó el arnés antes de desplegar: la compuerta de plazo
leía `plazo.estado` cuando el campo es `plazo.status`, así que no bloqueaba nada.

## Despliegue

Migraciones `005700`, `005900` y `006000` aplicadas y registradas en el proyecto
`Balam` el 28/07/2026.

### La verificación detectó una escritura parcial

El primer intento abortó:

```
ERROR: H-38: acepto un cobro que no cuadra con la diferencia:
       {"ok": false, "error": "exchange_id_conflict"}
```

`payment_required` y `payment_mismatch` retornaban **después** de insertar
cabecera, renglones y movimientos. Un `return` de PL/pgSQL no aborta la
transacción, de modo que un cobro mal formado dejaba el documento escrito a
medias y el siguiente intento chocaba con `exchange_id_conflict`. **Es
exactamente la escritura parcial que H-04 existe para impedir**, reintroducida
por una función nueva.

`005700` ya estaba registrada, así que no se reescribió (`R-DB-01`): se corrigió
hacia adelante con `005900`, generada desde el texto vigente y no retecleada
(`R-DB-03`). El diff contiene **exactamente los dos bloques previstos**. La
verificación se renumeró de `005800` a `006000` porque debe correr al final
(`R-DB-02`); `005800` nunca llegó a registrarse.

El arnés comprobaba que los códigos de error existieran, no **dónde** se emiten:
el síntoma y no la defensa (`AP-09`). Se endureció con el caso `25b`, que exige
que la validación del cobro preceda a la primera escritura, y la verificación
ahora comprueba que un cobro rechazado no deje ninguna fila.

### Salida de la verificación

```
NOTICE: H-38: valoracion interna · commit_exchange ejecutable por authenticated
NOTICE: H-38: cobro invalido rechazado sin escribir una sola fila
NOTICE: H-38: valoracion en el servidor · reconocido 350, entregado 450, diferencia 100
NOTICE: H-38: inventario en dos sentidos · M 5→6, G 5→4
NOTICE: H-38: cobro registrado con tipo=cambio y folio propio · venta origen sin contaminar
NOTICE: H-38: reintento idempotente y commit_mismatch correctos
NOTICE: H-38: el saldo impide consumir dos veces la misma unidad
NOTICE: H-38: sobrante 100 registrado como valor no aprovechado · cero efectivo devuelto
NOTICE: H-38: venta origen intacta · total 350, 0 pagos propios
NOTICE: H-38: el plazo de posventa bloquea el cambio (H-34)
NOTICE: H-38: verificacion completa · valoracion, plazo, saldo, inventario, cobro, idempotencia y limpieza
```

## Riesgo residual y pendientes

- **Sin interfaz (C6) el cambio no es alcanzable por el usuario.** `recordExchange`
  existe y funciona, pero ninguna pantalla lo invoca.
- El desglose de Reportes seguirá sin cuadrar mientras exista un pago de cambio,
  hasta **C7**.
- La comisión del segundo vendedor se registra como `base_comision` en el
  documento, pero **nadie la liquida todavía**: conectarla a comisiones y cierres
  pertenece a C7.
- `recordExchange` anticipa el cálculo con las autoridades locales para operar
  offline; la cifra que manda es la del commit. Si divergieran, gana el servidor
  y la operación quedaría en la cola con su diagnóstico.
- La concurrencia real entre dos terminales sobre la última pieza está cubierta
  por el bloqueo estable dentro de la transacción, pero **no se probó con dos
  sesiones simultáneas** como hizo H-01; se apoya en el mismo mecanismo ya
  verificado.

## Referencias

- Contrato: `docs/04-contrato-del-cambio.md`
- Decisión: `docs/architect/decisions/ADR-010-materializacion-del-cambio.md`
- Riesgo: `docs/03-known-risks.md` → H-38
- Fases previas: C1 `plazo-posventa.md`, C2 `saldo-por-renglon.md`, C4 `modelo-del-cambio.md`
