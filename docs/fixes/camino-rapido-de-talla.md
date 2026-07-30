# El cambio de talla obligaba a buscar la prenda que el cliente traía en la mano

**Riesgo:** H-45
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El cambio de talla es el caso abrumadoramente más frecuente del módulo: misma
prenda, otra medida. Y hasta ahora costaba lo mismo que traer cualquier otro
artículo, porque el cajero tenía que **encontrar en el catálogo** la prenda que
el cliente acababa de dejar sobre el mostrador.

Ese coste era invisible para el instrumento. El escenario oficial siembra **un
solo producto**, así que el paso «clic CAMISA UX» no exigía buscar nada: la
prenda estaba siempre a la vista. La semilla no representaba un estado válido del
negocio en el eje que esta historia ataca (`R-DEL-12`).

Se añadió un escenario con catálogo real —61 artículos, con los rellenos
sembrados **primero** para que la prenda buscada quede fuera de las 24 primeras
tarjetas— y la medición apareció:

    node test-ux-metrics.mjs cambio-de-talla-catalogo-real

| escenario | catálogo | interacciones | validaciones |
|---|---|---|---|
| oficial | 1 artículo | 11 | 2 |
| catálogo real, antes de H-45 | 61 artículos | **12** | 2 |

La interacción extra era el paso 6: teclear en el escáner para filtrar el
catálogo. Y detrás del número había algo que el número no cuenta: elegir la
prenda a mano abre la puerta a elegir **otro modelo parecido**.

## Causa raíz

No había defecto. Había una ausencia: la pantalla sabía exactamente qué prenda
estaba recibiendo —está en el renglón, con su SKU y su talla— y no ofrecía
ninguna forma de decir «esta misma, en otra medida». El dato estaba y no se
usaba.

## Diseño

**Un atajo no puede ser una segunda autoridad.** La tentación era pintar las
tallas disponibles dentro del renglón, con su precio y sus existencias. Eso
habría duplicado lo que `ExchangeSizeModal` ya presenta, y una presentación
duplicada del mismo hecho es donde empiezan las divergencias: el precio por talla
de H-36 acabaría dibujado en dos sitios.

Por eso el botón **no trae lógica propia**. Hace una sola cosa,
`setPicking(r.p)`, que es exactamente lo que hace una tarjeta del catálogo. Talla,
precio vigente y existencias siguen saliendo de un único lugar.

**Se ofrecen todas las tallas, incluida la que se devuelve.** Parece un descuido
y no lo es: un cambio por defecto de fábrica es la misma talla, otra pieza. Filtrar
la talla devuelta habría roto ese caso por perseguir una pulcritud aparente.

**Se oculta si la prenda ya no está en el catálogo** (`st.on && r.p`). Una venta
antigua puede referirse a un artículo retirado; entonces no hay tallas que
ofrecer y el camino general por el catálogo sigue ahí.

**Abrirlo no compromete nada.** Es un atajo para elegir, no una elección: si el
cajero lo abre y lo cierra, no se agrega mercancía. Está probado.

### Alternativa considerada y descartada

Tallas en línea dentro del renglón, de un solo toque. Habría ahorrado una
interacción más, pero: duplicaba la presentación de precio y existencias; cargaba
el renglón con una cuarta decisión simultánea —cantidad, motivo, condición y
talla—, restando fuerza al botón guía de H-44; y su ahorro era una estimación,
no una medida. Queda como refinamiento posible **encima** de este, con las 11
interacciones de aquí como línea base. Al revés no funcionaría.

## Solución

`balam/returns.jsx` — en el renglón de la prenda marcada, un botón «Misma prenda,
otra talla» con la pista «Sin buscarla en el catálogo», que abre el selector de
tallas de ese mismo producto. Contrato estable nuevo: `cambio-misma-prenda`.

`test-ux-metrics.mjs` — escenario `cambio-de-talla-catalogo-real` con 61
artículos y la métrica del tamaño del catálogo en el informe.

## Pruebas

Guardián de `R-DEL-14`, en verde sin intervención manual:

    ══ GUARDIÁN · comparación contra la línea base ══════════════
      ✅ validaciones             base 2      ahora 2
      ✅ recorrido completo       base true   ahora true
      ✅ interacciones            base 12     ahora 11

      ✔ mejora real: −1 interacciones sin perder garantías

El recorrido pasó de ocho pasos hasta el cobro a siete, y el paso que desapareció
es el de buscar: el orden ahora es marcar la prenda → «misma prenda, otra talla»
→ elegir la medida.

Los otros dos escenarios no se movieron: oficial 11/2 y repetido 10/2, ambos con
código 0. El camino general por el catálogo sigue existiendo y sigue medido.

Cerrada la historia, la línea base del escenario se refijó a **11/2**
(`R-DEL-16`), de modo que un retroceso a 12 vuelve a romper el guardián.

Arneses: E2E del cambio **37/37**, con tres comprobaciones nuevas —el renglón
ofrece el atajo; abre el selector de la misma prenda con el precio de H-36;
abrirlo y cerrarlo no agrega mercancía—. Pantalla del cambio **45/45**, con tres
comprobaciones de que el atajo no reimplementa precio ni existencias y que se
oculta sin producto. Regresión completa en verde: devoluciones 17/17; plazo
38/38; saldo por renglón 38/38; modelo 28/28; commit del cambio 32/32; contratos
37/37; navegación 14/14; smoke 15/15; roles 10/10; precio por talla 38/38 y su
E2E 19/19; build 8/8; migraciones 31/31; apartados 55/55; ticket 23/23;
coherencia 17/17.

Sin migraciones: no toca esquema, contrato, autoridades ni reglas económicas.

## Riesgo residual y pendientes

- El catálogo sigue listando los primeros 24 artículos filtrados, sin paginación.
  El atajo lo esquiva para el caso de talla, no lo arregla.
- Las tallas en línea quedan como refinamiento posible, con línea base de 11.
- C7 sigue abierto: reportes, liquidación de la comisión del segundo vendedor y
  el desglose de cobrado que no cuadra con un pago de tipo cambio.
- Sigue pendiente la deuda de estandarización de diálogos (`window.confirm`
  fuera de esta pantalla).

## Referencias

`docs/04-contrato-del-cambio.md` · `docs/fixes/recorrido-del-cambio.md` ·
`docs/architect/playbooks/delivery.md` (`R-DEL-12`, `R-DEL-14`, `R-DEL-15`,
`R-DEL-16`) · `ux-baseline.json`
