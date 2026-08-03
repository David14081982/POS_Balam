# La pantalla Clientes no mostraba las compras de sus clientes

**Riesgo:** H-70
**Estado:** RESUELTO
**Fecha:** 03/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

**Precondiciones.** Una tienda con ventas reales ya sincronizadas y más de una
terminal, que es el caso de operación desde julio de 2026.

**Pasos.** Abrir Clientes en cualquier terminal que no haya sido la que cobró, o
en la misma después de recargar y esperar el pull de la nube.

**Resultado observado.** Todos los clientes con «0 compras», «$0» y «—» en última
visita, aunque sus ventas existieran y Reportes las contara. El cajón de un
cliente renombrado quedaba sin historial, y dos clientes homónimos compartían el
de ambos. Editar una ficha después del pull parecía guardar y el cambio se
deshacía al siguiente render.

**Resultado esperado.** Número de compras, total gastado, última visita e
historial derivados de las ventas reales del cliente, coherentes con Reportes y
actualizados sin cambiar de pantalla.

**Reproducción ejecutable.** `test-h70-clientes-ventas.mjs`, sobre el artefacto
distribuido (`index.html`). Antes del arreglo: **6 pasaron, 33 fallaron** —los 6
son la semilla, que demuestra que las autoridades de venta, cancelación,
devolución y cambio ya producían un estado de negocio correcto y que el defecto
estaba entero del lado de Clientes.

## Causa raíz

Tres defectos independientes, los tres en el consumo, ninguno en los datos.

1. **La pantalla leía una caché, no los documentos.** La tabla, los KPI y el
   cajón usaban `c.compras`, `c.total` y `c.ultima`. Esos tres campos sólo los
   escribe `recordSale` (`balam/data.jsx`), y sólo en la terminal que cobró.
   Ninguna otra terminal los recibe, y el pull los sobreescribe con la copia de
   la nube: los ceros eran fieles al campo y falsos respecto del negocio.

2. **El `useMemo` no tenía cómo enterarse del pull.** `applyRemote` vacía
   `DATA.clients` y mete objetos NUEVOS. El memo dependía de `[query, filter,
   refreshKey]` —tres estados de interfaz—, así que seguía devolviendo la lista
   anterior al pull, mientras los KPI, que se recalculaban en cada render, sí
   cambiaban. De ahí la contradicción visible entre encabezado y tabla.

3. **El historial buscaba por nombre.** `D.sales.filter(s => s.cliente ===
   c.nombre)` ignoraba `clienteId`: renombrar a alguien le borraba las compras y
   dos homónimos las mezclaban.

**Defecto secundario.** `saveEditClient` hacía `Object.assign(editC, …)` sobre el
objeto capturado al abrir el modal. Después de un pull ese objeto ya no pertenecía
a `DATA.clients` —había sido reemplazado por otro con el mismo id—, así que la
edición se escribía en un huérfano y desaparecía. Además `D.saveClients()` subía
el arreglo completo, pisando con la copia local a cualquier otro cliente que otra
terminal hubiera tocado.

## Diseño

**Autoridad única.** `DATA.clientSalesSummaries()` / `DATA.clientSalesSummary(c)`
(`balam/data.jsx`). La fórmula de pertenencia y de importe vive ahí y en ningún
otro sitio; `clients.jsx` la consume y no reimplementa nada.

**Pertenencia**, en este orden y sin excepción:

1. `venta.clienteId === cliente.id`. Es identidad: renombrar no quita compras y
   dos homónimos no las mezclan.
2. Sólo si la venta **no** trae `clienteId` —las anteriores a esa columna— se
   acepta el nombre. El nombre nunca desempata una venta que sí tiene identidad, y
   una venta cuyo `clienteId` apunta a un cliente borrado queda huérfana antes que
   atribuirse por parecido.

Si el nombre de una venta legada coincide con varios clientes el dato no alcanza
para decidir: se asigna al primero registrado con ese nombre, de modo que su
importe se cuente exactamente una vez y la columna siga cuadrando con el KPI.

**Qué cuenta** (contrato explícito):

| Documento | ¿Compra? | ¿Suma al gasto? | ¿Última visita? | ¿Historial? |
| --- | --- | --- | --- | --- |
| Pagada / completada | Sí | Total | Sí | Sí |
| Apartado | Sí | Total de la pieza, no el anticipo | Sí | Sí |
| Devuelta (total o parcial) | Sí, la visita ocurrió | Total menos lo reembolsado | Sí | Sí |
| Cancelada | No | No | No | Sí |
| Cortesía | No, no se cobró nada | No | No | Sí |
| Cambio | No es una compra más | Sólo la diferencia cobrada | No | Del folio de origen |

`gasto = Σ total de compras válidas − Σ devuelto + Σ diferencia de cambios`.

**Coherencia con Reportes.** Ambos leen los mismos documentos con la misma
aritmética. Reportes informa el importe **vendido** (bruto, con las devoluciones
aparte) y Clientes el gasto **neto** de cada persona; la identidad que las liga es
`Σ gasto + Σ devuelto = importeVendido`, y se verifica en la prueba.

**Señal de cambio de datos.** `bumpRevision()` en `balam/data.jsx`: un contador
monótono y un evento `datachange`, emitidos desde el único punto por el que pasa
toda escritura de dominio (`save()`, más `saveProducts()`, que no pasa por él).
Coalescido en un microtask: una venta escribe productos, movimientos, ventas,
pagos y cliente, y emite **un** aviso. `clients.jsx` lo consume con
`useDataRevision()`, que escucha `datachange` y `configchange` (fin de pull).

**Compatibilidad.** `compras`, `total` y `ultima` se conservan tal cual: se
siguen escribiendo y sincronizando, y `updateClient` no los toca. La pantalla
Clientes ya no depende de ellos. **No se migró ni se reescribió ninguna venta
histórica.**

## Solución

- **`balam/data.jsx`**
  - `bumpRevision()` + evento `datachange`, invocado desde `save()` y
    `saveProducts()`.
  - `clientSalesSummaries()` / `clientSalesSummary()`: la autoridad, con índice
    calculado una vez por revisión de los datos (no una vez por fila).
  - `updateClient(id, patch)`: localiza al cliente **vigente** por id, aplica sólo
    campos de ficha (`nombre`, `tel`, `email`, `direccion`, `talla`, `notas`,
    `nacimiento`), guarda y sube **un** registro vía `pushClient`.
- **`balam/clients.jsx`**
  - `useDataRevision()`; `rows`, KPI y cajón consumen la autoridad.
  - El cajón y el modal guardan el **id**, no el objeto: tras un pull se resuelve
    siempre contra `DATA.clients`.
  - El historial sale de `resumen.ventas` (por identidad).
  - `saveEditClient` delega en `D.updateClient`.
  - Contratos estables `data-testid` para la tabla, los KPI, el cajón y la
    edición (R-DEL-10).
- **`balam/store.jsx`**
  - `pushClient(c)`: mismo upsert y mismo control de versión, con una fila.
  - Op de upsert **acotada** (`rowIds`): la cola la reconstituye sólo con sus
    filas y la coalescencia no deja que descarte un alta de tabla completa
    pendiente. Una op de tabla completa sigue pudiendo pisar a cualquiera.

## Pruebas

```
node test-h70-clientes-ventas.mjs      39/39   (antes: 6 pasaron, 33 fallaron)
node test-store-queue.mjs             155/155  (+6 casos nuevos, sección 40)
```

Los 13 casos exigidos quedan cubiertos: venta por `clienteId` (1), venta legada
por nombre (2), renombrar sin perder ventas (3), cancelada fuera de métricas (4),
devolución restando del gasto (5), venta nueva que refresca la tabla sin tocar el
buscador (6), pull remoto que actualiza filas y KPI en el mismo montaje (7),
ida y vuelta de pantalla sin cambio de resultado (8), edición después del pull
sobre el cliente vigente y subiendo sólo ese registro (9), homónimos sin mezcla
(10), suma de la columna igual al KPI antes y después del pull (11), coherencia
con Reportes (12) y regresión (13).

**Regresión ejecutada** (39 suites):

```
smoke 15/15 · module-contracts 41/41 · screen-registry 12/12 · ui-navigation 15/15
production-startup 5/5 · sale-coherence 20/20 · report-revenue 24/24
returns 17/17 · return-deadline 38/38 · line-balance 38/38
cambio-e2e 37/37 · exchange-model 28/28 · exchange-commit 32/32
exchange-reports 24/24 · exchange-screen 45/45 · exchange-commission 30/30
h65-layaway-e2e OK · h65-layaway-liquidation OK · layaway-screen OK
h69-commissions 88/88 · h69-commission-settings 25/25 · h69-prueba-e2e 24/24
commission 10/10 · effective-commission 24/24 · liquidations 12/12
store-queue 155/155 · supabase-sdk 4/4 · loans-sync OK · loans-screen 117/117
h68-purga 53/53 · h68-boton 17/17 · operational-capabilities 40/40
role-access 15/15 · auth-permissions 18/18 · permissions-model 13/13
folio-diario 60/60 · folio-concurrency 12/12 · discounts 43/43
migrations 31/31 · build-reproducibility 8/8 · ux-metrics OK
filtros-inventario 18/18 · product-sizes 9/9 · h63-e2e 58/58
precio-talla-e2e 19/19 · variant-price 38/38 · h59-size-persistence 12/12
```

`test-loans-screen.mjs` falló una vez dentro de una tanda larga y pasó 117/117 en
dos corridas aisladas con estas mismas fuentes: su heurística de lector usa una
ventana de 50 ms por carácter y es sensible a la carga de la máquina, no a este
cambio.

## Riesgo residual y pendientes

- Una venta **legada sin `clienteId`** cuyo nombre coincide con varios clientes se
  atribuye al primero registrado con ese nombre. El dato no permite más; la
  alternativa —contarla en todos— inflaría el gasto y descuadraría el KPI. Las
  ventas nuevas siempre llevan identidad, así que el caso se extingue solo.
- Una venta cuyo `clienteId` apunta a un cliente **borrado** no aparece en ninguna
  ficha. Es deliberado: el historial de ventas se conserva y Reportes la sigue
  contando.
- El resumen se memoiza por revisión de los datos; una mutación de dominio que no
  pasara por `save()` no invalidaría la caché. Hoy no existe ninguna, y la clave
  incluye además el tamaño de los cuatro arreglos como red de seguridad.
- Deuda **preexistente y ajena**, verificada abortando igual en `HEAD`:
  `test-concurrency.mjs` y `test-reset-propaga.mjs` (8 fallos).

## Referencias

- Riesgo: `docs/03-known-risks.md#h-70---la-pantalla-clientes-no-derivaba-las-compras-de-las-ventas`
- Prueba: `test-h70-clientes-ventas.mjs`, `test-store-queue.mjs` (sección 40)
- Relacionado: `docs/trazabilidad-financiera.md`, `docs/fixes/reportes-del-cambio.md`
