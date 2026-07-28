# Contrato del Cambio

**Autoridad funcional del módulo de Cambios.** Aprobado el 28/07/2026.

Este documento gobierna toda historia del módulo. Ninguna decisión funcional del
módulo puede tomarse fuera de aquí: si una historia necesita una regla que no
esté escrita en este archivo, se detiene y se pregunta, y la respuesta se añade
aquí antes de implementar.

Existe porque el diseño anterior del módulo —el plan «F1–F7» aprobado en
conversación— **se perdió por vivir fuera del repositorio**. Sólo sobrevivió lo
que las fases ya implementadas dejaron escrito al construirse.

---

## 1. Definición y frontera

Un **cambio** es una operación de posventa en la que el cliente entrega uno o
más artículos previamente comprados y recibe otros a cambio, **sin cancelar la
venta original**. Puede generar una diferencia económica a favor del negocio o
del cliente.

La frontera con la devolución es el destino de la mercancía:

- el cliente se lleva otra mercancía → **cambio**;
- el cliente sólo regresa mercancía → **devolución**.

## 2. Qué puede cambiarse

Sólo artículos que pertenezcan a **una venta válida con ticket existente**.

Sin restricción de dimensión: puede cambiarse **talla, color, modelo o el
artículo completo**. Puede combinarse: entregar camisa y pantalón y recibir una
chamarra. Puede ser **parcial**: comprar 5 piezas y cambiar sólo 2. Puede
recaer sobre **un artículo recibido en un cambio anterior**.

## 3. Valoración y diferencia económica

```
diferencia = Σ valor de los artículos recibidos − Σ valor reconocido de los entregados
```

Dos regímenes de precio conviven en el mismo documento, y **no deben
confundirse**:

| Lado | Precio que aplica |
|---|---|
| Artículos que el cliente **entrega** | El **valor con que se le vendieron**: evidencia congelada de la venta original |
| Artículos que el cliente **recibe** | El **precio vigente** al momento del cambio |

**Un artículo recibido en un cambio adquiere un valor histórico nuevo desde ese
momento.** Si más adelante vuelve a cambiarse, su valor reconocido es el precio
con que se entregó en aquel cambio — nunca el precio vigente ni el de la venta
original.

Esta separación es obligatoria. Usar el precio vigente en ambos lados le
cobraría al cliente un aumento de precio posterior a su compra, que él no
provocó. Desde H-36 el riesgo es real incluso dentro del mismo SKU, porque dos
tallas del mismo artículo pueden valer distinto.

## 4. La diferencia se cobra, nunca se devuelve

**Si el artículo nuevo cuesta más**, el cliente paga únicamente la diferencia.

**Si cuesta menos**, el cliente puede completar el monto llevando otros
artículos disponibles hasta consumir total o parcialmente el valor reconocido.
Si decide no llevar más, **el sobrante se pierde**: no se devuelve dinero y **no
se genera saldo a favor**.

**El módulo de Cambios no devuelve efectivo bajo ninguna circunstancia.** Si por
una situación excepcional el negocio decide regresar dinero —cliente conflictivo,
autorización especial—, esa operación se realiza mediante el **flujo de
Devoluciones ya existente**, no mediante un cambio.

El sobrante perdido es parte de la evidencia del documento: la diferencia se
registra con su signo, y cuando favorece al cliente y no se consume, queda
constancia de cuánto valor no se aprovechó.

## 5. Inventario y recepción

El inventario **reingresa** los artículos que el cliente entrega y **descuenta**
los que recibe. Son dos movimientos opuestos dentro de una misma operación.

**Un artículo que no está en óptimas condiciones no se recibe**, y sin recepción
no hay cambio válido. En consecuencia, toda pieza que entra reingresa como
vendible: el módulo no administra mercancía dañada.

## 6. Plazo de posventa

El derecho a cambiar está **sujeto al plazo de posventa de la venta original**.

Realizar un cambio **no reinicia ni extiende** ese plazo. Los artículos
entregados en el cambio **heredan el plazo restante de la venta original**.

## 7. Comisiones

- La comisión de la venta original **se mantiene** para el vendedor que la hizo.
- El vendedor que atiende el cambio genera comisión **únicamente sobre los
  artículos adicionales que el cliente agregue** durante la operación.
- Si sólo hay intercambio de mercancía y cobro de diferencia por ese mismo
  cambio, **no se genera comisión nueva sobre los artículos sustituidos**.
- Si finalmente se devuelve dinero al cliente por el flujo de Devoluciones, la
  comisión afectada es la del **vendedor de la venta original**, porque es esa
  venta la que se revierte. El vendedor del cambio conserva únicamente la
  comisión de los artículos adicionales que realmente vendió.

Toda esta información debe quedar clara en los reportes.

> **Pendiente de precisión** — dónde está exactamente la frontera entre
> «artículo sustituido» y «artículo adicional» cuando el cliente se lleva más
> piezas de las que entregó. Ver §12.

## 8. La venta original

La venta original **conserva intacta toda su evidencia financiera e histórica**:
renglones, precios, pagos y totales. Únicamente pueden actualizarse **estados
derivados** o referencias al documento de cambio, para consulta y trazabilidad.

En los reportes debe aparecer que la venta fue objeto de un cambio.

El cambio genera un **documento independiente** relacionado con esa venta.

## 9. Evidencia del documento de Cambio

Debe conservar al menos:

- venta de origen
- fecha
- usuario que atendió
- artículos entregados por el cliente, con su **valor reconocido**
- artículos recibidos por el cliente, con su **precio vigente aplicado**
- diferencia económica, con signo
- forma de pago, cuando hubo cobro
- observaciones

La evidencia se **congela** en el documento. Un cambio antiguo debe seguir
siendo explicable aunque después se editen precios o promociones.

**La sucursal no forma parte de este contrato.** El sistema no tiene hoy el
concepto de sucursal como entidad de dominio. Si en el futuro lo incorpora,
podrá añadirse sin modificar el comportamiento funcional del módulo.

## 10. Invariantes que nunca se rompen

1. Nunca devolver más unidades de las compradas.
2. Nunca consumir más saldo por renglón del disponible.
3. Nunca modificar la evidencia histórica de una venta cerrada.
4. Nunca alterar los precios históricos registrados.
5. Nunca generar diferencias económicas inconsistentes entre el valor reconocido
   de los artículos entregados y el de los artículos recibidos.

## 11. Fuera de alcance

- Devolución de efectivo desde el módulo de Cambios (§4).
- Saldo a favor o vale de compra.
- Mercancía dañada o no vendible (§5).
- Sucursal como entidad de dominio (§9).

## 12. Decisiones estructurales que la historia de implementación debe tomar

No son preguntas de negocio: el contrato ya las gobierna funcionalmente. Son
decisiones de diseño que quedan registradas para no olvidarse.

1. **Dónde viven los renglones entregados en un cambio** para que la autoridad
   de saldo por renglón los gobierne. §2 permite recambiar un artículo recibido
   en un cambio anterior, y §3 le asigna valor histórico propio; pero
   `pos.sale_line_balance()` está anclada hoy a `pos.sale_items`, y un artículo
   entregado en un cambio no es renglón de ninguna venta. Sin resolverlo, nada
   impediría consumir dos veces la misma pieza — el defecto que H-35 existe para
   prevenir.
2. **Frontera entre artículo sustituido y adicional** para el cálculo de
   comisión (§7).
3. **Cómo se registra el cobro de la diferencia** dentro de la trazabilidad
   financiera, cuya fuente de verdad de entradas de dinero es hoy
   `pos.sale_payments`.
4. **Qué estado derivado recibe una venta** que acumula devolución parcial y
   cambio a la vez, y su precedencia.
5. **Si el documento de cambio lleva folio visible** para el cliente. Si lo
   lleva, `ADR-001` obliga a separar identidad técnica de referencia comercial.
6. **Atomicidad**: el cambio mueve inventario en dos sentidos y puede cobrar.
   Necesita un commit transaccional propio al estilo de H-04 y reserva atómica
   de la pieza entregada al estilo de H-01, o se puede sobrevender.
7. **Congelar las promociones** aplicadas al artículo entregado, no sólo su
   precio. Sin eso se repite `AP-06`.
8. **Cortesías**: una venta de cortesía tiene total 0; el valor reconocido de lo
   entregado sería 0.

## 13. Estado del módulo y orden de trabajo

El plan original F1–F7 se perdió. Esta es la reconstrucción por dependencias
reales, no por su numeración anterior. **Se nombra C1–C7 para no confundirla con
las «Fases» de la auditoría antigua** que citan H-09 a H-22 en su campo
«Origen de auditoría», que son otra cosa.

| | Trabajo | Estado |
|---|---|---|
| **C1** | Plazo de posventa congelado en la venta | ✅ H-34 · `59a16c9` |
| **C2** | Autoridad del saldo por renglón y costura de extensión | ✅ H-35 · `c10920e` |
| **C3** | Este contrato | ✅ documento vigente |
| **C4** | Tablas de cambios, rama de `pos.line_consumption`, `DATA.exchanges` | pendiente |
| **C5** | Commit transaccional del cambio: doble movimiento de inventario y cobro | depende de C4 |
| **C6** | Interfaz del cambio y distinción del motivo de consumo en Devoluciones | depende de C5 |
| **C7** | Reportes: venta cambiada, comisión por vendedor, valor no aprovechado | depende de C5 |

H-36 (precio por talla) no pertenece al módulo, pero lo condiciona: es la razón
por la que §3 separa los dos regímenes de precio.

## Referencias

- Plazo de posventa: `docs/fixes/plazo-posventa.md` (H-34)
- Saldo por renglón y costura: `docs/fixes/saldo-por-renglon.md` (H-35)
- Precio por talla: `docs/fixes/precio-por-talla.md` (H-36)
- Decisiones: `docs/architect/decisions/ADR-001`, `ADR-002`, `ADR-003`, `ADR-009`
- Autoridades vigentes: `docs/architect/authorities/`
