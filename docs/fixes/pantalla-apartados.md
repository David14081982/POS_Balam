# Pantalla de apartados, abono con forma de pago y comprobante

**Riesgo:** H-40
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** `2e57fbe`

## Problema y reproducción

Un apartado vive abierto entre dos momentos —se registra en el Punto de venta con
un anticipo y se liquida cuando el saldo llega a cero—, pero el producto no tenía
ningún lugar donde administrar ese intermedio.

Reproducción sobre el bundle antes del cambio:

1. Registrar una venta con método `Apartado` y anticipo parcial.
2. Buscar los apartados abiertos: sólo aparecen como aviso en el panel
   (`balam/dashboard.jsx` § tarjeta «Apartados por completar», máximo 6) y en la
   campana. No hay listado completo, búsqueda, filtros ni totales.
3. Pulsar «Abonar»: se abren dos `window.prompt()` encadenados —monto y un menú
   numérico `1 = Efectivo · 2 = Tarjeta · 3 = Transferencia`—.
4. Confirmar: el abono se asienta y **no se emite ningún comprobante**. El cliente
   que entrega dinero se va sin papel.

Resultado esperado: pantalla propia con la cartera completa, sus indicadores,
captura de abono con el mismo lenguaje visual que el cobro del POS, comprobante
impreso de cada pago y salidas del reporte (impresión y Excel).

## Causa raíz

No es un defecto de dominio: `DATA.registrarPagoApartado` ya resolvía correctamente
el abono, la liquidación, el historial de pagos y el push a la nube
(`balam/data.jsx:1098`). Lo que faltaba era **superficie**.

Tres huecos concretos:

1. **Sin pantalla.** `NAV` de `balam/app.jsx` no tenía entrada para apartados; el
   único acceso era la tarjeta de aviso del panel, limitada a seis renglones y sin
   totales ni búsqueda.
2. **Captura por `prompt()`.** `balam/dashboard.jsx` capturaba monto y forma de pago
   con diálogos nativos del navegador: sin validación previa, sin `Mixto`, sin ver
   el saldo resultante y ajeno al idioma de interacción del producto —el modal de
   cobro con botones de método de `balam/pos-ticket.jsx:266-276`—.
3. **Sin comprobante.** `BalamTicket` sólo se monta en el éxito de venta
   (`balam/pos.jsx:242`). Un abono posterior no producía documento alguno, aunque
   el pago sí quedaba en `payments` con su tipo (`anticipo`, `abono`, `liquidacion`).

## Diseño

**La autoridad no se toca.** `DATA.registrarPagoApartado` sigue siendo la única
forma de asentar un abono: valida monto, forma de pago, historial, liquidación,
stock, comisión y sincronización. La pantalla es superficie de captura y consulta;
no recalcula saldo ni decide reglas. Las validaciones del modal son de captura
—evitar el intento imposible— y la autoridad las vuelve a aplicar al guardar.

**Idioma de interacción reutilizado** (`R-CLI-08`, `AP-10`). El recorrido previo del
flujo quedó documentado en el análisis de esta historia; la pantalla no inventa
lenguaje:

| Elemento | Se reutiliza de |
|---|---|
| Búsqueda por folio/cliente + `Segment` de filtros | `balam/returns.jsx` § `ReturnPicker` |
| Fila con folio, cliente, importe a la derecha y acción | `balam/returns.jsx` § `ReturnPicker` |
| Botonera de formas de pago con ícono | `balam/pos-ticket.jsx` § `CheckoutModal` |
| Modal de éxito con «Imprimir» + `print.auto` | `balam/pos.jsx` § `SuccessModal` |
| Comprobante térmico 80 mm en `#balam-ticket` | `balam/pos-ticket.jsx` § `BalamTicket` |
| Tarjetas de indicadores | `balam/reports.jsx` § `metricCard` |
| Listado impreso en ventana propia | `balam/inventory.jsx` § `printLabels` |
| Exportación `.xlsx` | `balam/xlsx-io.jsx` § `exportSales` |

**Por qué el listado se imprime en ventana propia.** La regla `@media print` de
`POS Balam.html:107-112` oculta todo el documento y deja visible únicamente
`#balam-ticket`, con `@page { size: 80mm auto }`. Un reporte tabular no cabe en ese
contrato y cambiar la regla global afectaría a la impresión de tickets de venta. El
producto ya resolvía esto en Inventario abriendo una ventana con su propio `@page`:
se reutiliza ese camino, sin tocar el CSS compartido ni la impresión de venta.

**Un solo formato de ticket, con costura** (`ADR-003`). El comprobante del abono no
es un documento nuevo: es `window.BalamTicket` —el ticket térmico del Punto de
venta— con un parámetro opcional `payment`. Sin él, el ticket de venta es
byte a byte el de siempre; con él, el mismo documento añade el acuse del pago
recibido y cambia lo que la cobranza exige:

- encabezado del acuse: concepto (`Anticipo` / `Abono` / `Liquidación de apartado`),
  importe recibido, forma de pago y fecha del pago;
- el detalle pasa de «Detalle de compra» a «Mercancía apartada», o «Mercancía
  entregada» cuando ya no hay saldo;
- bajo el total: **pagado a la fecha** y **saldo pendiente** —o `LIQUIDADO`—,
  visibles también después de liquidar, cuando la venta ya es `Pagado`;
- **historial de pagos al pie**, con fecha, concepto, forma de pago e importe de
  cada movimiento, el pago de este comprobante marcado y la suma total;
- se omite el bloque «Método de pago» de la venta, que en un acuse diría `Apartado`
  y contradiría la forma en que se recibió el dinero.

Definir un segundo formato habría dejado dos tickets que envejecen por separado:
un cambio en los datos del negocio, en el pie o en el desglose fiscal tendría que
aplicarse dos veces. Por eso la extensión entra por una costura y no por copia.

**Una sola forma de cobrar.** La captura por `prompt()` del panel se elimina; la
tarjeta de avisos y la campana llevan a la pantalla. Dos formas de registrar el mismo
abono es exactamente lo que `AP-10` señala como riesgo.

**Formas de pago admisibles.** El modal ofrece la intersección entre el catálogo
administrable `payment_method` de `CONFIG` y lo que la autoridad acepta —`Efectivo`,
`Tarjeta`, `Transferencia`, `Mixto` (`balam/data.jsx:1105`)—. `Apartado` y `Cortesía`
quedan fuera por construcción: no son formas de cobrar un saldo.

**Sin cambios de datos ni de esquema.** No hay migración, campo nuevo ni contrato de
sincronización distinto. Todo lo que la pantalla muestra ya estaba persistido:
`sale.saldo`, `sale.anticipo` y `payments`. El saldo sólo se deriva cuando falta, con
la misma fórmula que usa `DATA`, para ventas anteriores a que el campo existiera.

**Umbral de rezago.** El filtro «+30 días» es descriptivo, no normativo: ordena y
resalta, pero no bloquea ni vence nada. Un apartado no caduca en el producto.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/layaway.jsx` | **Nuevo.** `window.LayawayScreen`: cartera, KPIs, búsqueda, filtros, fila con detalle desplegable y acciones, modal de abono, modal de comprobante, reimpresión, listado impreso y fila plana de exportación. |
| `balam/pos-ticket.jsx` | `BalamTicket` acepta la costura `payment`: acuse del pago, estado de cobranza e historial de pagos al pie. Sin `payment` no cambia nada. |
| `balam/app.jsx` | Entrada `apartados` en `NAV` y `TITLES`; render de la pantalla; la campana lleva a `apartados` en vez de al panel. |
| `balam/dashboard.jsx` | Se elimina la captura por `window.prompt()`; «Abonar» y «Ver todos los apartados» navegan a la pantalla. |
| `balam/xlsx-io.jsx` | `exportLayaways(rows)` y su publicación en `window.XLSXIO`. |
| `POS Balam.html` | Carga de `balam/layaway.jsx` (tras `clients.jsx`). |
| `test-layaway-screen.mjs` | **Nuevo.** Arnés del recorrido completo sobre el bundle. |
| `test-module-contracts.mjs` | Orden público de módulos y global publicado. |
| `test-ui-navigation.mjs` | La pantalla entra en el recorrido de navegación. |
| `index.html`, `POS Balam (offline).html` | Regenerados con `node build-offline.mjs`. |

La pantalla es visible para todos los perfiles, como Devoluciones: cobrar un abono
es trabajo de mostrador, no de administración.

Cada renglón resuelve las tres cosas que se hacen con un apartado abierto sin salir
de la lista: **llamar** al cliente —mismo idioma del botón `tel:` de
`balam/clients.jsx:181`, visible sólo si el cliente tiene teléfono—, **reimprimir**
su comprobante con el último pago registrado, y **abonar**. Un cuarto control
despliega el detalle: la mercancía apartada con su importe y el historial de pagos
completo, para resolver una duda del cliente sin imprimir nada.

## Pruebas

```
node build-offline.mjs                 OK -> index.html (copia para deploy)
node test-layaway-screen.mjs           55/55 verificaciones
node test-module-contracts.mjs         37 pasaron, 0 fallaron
node test-smoke.mjs                    15 pasaron, 0 fallaron
node test-ui-navigation.mjs            14 pasaron, 0 fallaron
node test-folio-concurrency.mjs        12 pasaron, 0 fallaron
node test-discount-trace.mjs           65 pasaron, 0 fallaron
node test-store-queue.mjs             115 pasaron, 0 fallaron
node test-precio-talla-e2e.mjs         19 pasaron, 0 fallaron
node test-build-reproducibility.mjs     8 pasaron, 0 fallaron
node test-xlsx-security.mjs            17 pasaron, 0 fallaron
node test-returns.mjs                  17 pasaron, 0 fallaron
node test-sale-coherence.mjs           17 pasaron, 0 fallaron
node test-line-balance.mjs             38 pasaron, 0 fallaron
node test-role-access.mjs              10 pasaron, 0 fallaron
node test-liquidations.mjs             10 pasaron, 0 fallaron
node test-folio-diario.mjs             60 pasaron, 0 fallaron
```

`test-layaway-screen.mjs` corre contra `index.html` —el artefacto que se distribuye—
con Supabase interceptado. Cubre: el apartado nace con saldo y sin descontar stock;
el plazo de devolución queda congelado; la entrada existe en el menú lateral; los
cuatro KPIs; los tres filtros; el detalle desplegable con mercancía e historial; la
reimpresión sin cobrar y el desmontaje del ticket; el modal con saldo, formas de pago
y «Liquidar todo»; el bloqueo de un abono mayor al saldo; el abono parcial con
tarjeta y su desglose en `payments`; el comprobante —que es el ticket del negocio,
con importe, IVA y total, más acuse del pago, mercancía real, pagado, saldo e
historial al pie con el pago marcado y su total—; la liquidación con descuento de
inventario, arranque del plazo, tipo `liquidacion` y comprobante de entrega; la
salida de la cartera; y el listado impreso con encabezado, totales, escapado de HTML
y sin peticiones de red.

Las suites que ejercitan el ticket de venta —`test-smoke.mjs`,
`test-folio-concurrency.mjs`, `test-discount-trace.mjs`, `test-precio-talla-e2e.mjs`—
se ejecutaron después de abrir la costura `payment` para demostrar que el
comprobante de venta no cambió.

## Despliegue

- Artefactos regenerados con `node build-offline.mjs` antes del commit.
- Sin migraciones: la historia no toca el esquema, así que `R-DEL-03` no aplica.
- Publicado por el hook `post-commit` en `https://david14081982.github.io/POS_Balam/`.
- Artefacto servido verificado contra el `index.html` del commit `2e57fbe`:
  idéntico byte a byte, SHA-256
  `0904AD7D57A67F6F432A1FD33F4EF02F78C62B6EB8E3D2E3615A6967DBE9AED4`
  (mismo hash en `index.html` y en `POS Balam (offline).html`).

## Riesgo residual y pendientes

- **La pieza sigue sin reservarse.** Un apartado no descuenta inventario mientras
  tenga saldo (`docs/02-architecture.md` § reserva de inventario): la prenda puede
  venderse en piso y la liquidación quedaría pendiente de stock. La pantalla lo
  declara en pantalla y en el pie del listado impreso, pero **no lo resuelve**:
  reservar al apartar es una decisión de negocio con impacto en inventario y en el
  contrato remoto, fuera del alcance de esta historia.
- **No existe cancelación de apartado ni devolución de anticipo.** El estado
  `Cancelado` existe en el modelo pero ningún flujo lo produce.
- **El apartado no vence.** El filtro «+30 días» ordena la gestión, no la fuerza.
- **`pos.allowLayaway` sigue sin consumidores.** El interruptor de Configuración
  existe (`balam/settings.jsx:773`) pero nadie lo lee: el método `Apartado` aparece
  porque está en el catálogo `payment_method`. Apagarlo no lo oculta. Es un defecto
  previo, ajeno a esta historia y sin cambio aquí.
- **El botón «Imprimir» de Reportes imprime en blanco** por la misma regla
  `@media print` descrita arriba: fuera del Punto de venta no hay `#balam-ticket`
  montado. Detectado al diseñar esta historia; no se corrigió para no ampliar el
  alcance. La pantalla de Apartados no lo padece porque usa ventana propia.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-40
- Autoridad del abono: `balam/data.jsx` § `registrarPagoApartado`, `finalizarApartado`
- Plazo de posventa en apartados: `docs/fixes/plazo-posventa.md`
- Idioma de interacción: `docs/architect/playbooks/client.md` § `R-CLI-08`, `AP-10`
