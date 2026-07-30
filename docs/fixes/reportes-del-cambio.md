# Los cambios no tenían reportes explicables de posventa y dinero

**Riesgo:** H-51
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** `f45dba5`

## Problema y reproducción

El Contrato del Cambio § 7 y § 13 exige tres lecturas que no existían en
Reportes: venta cambiada con lo que salió y entró; comisión por vendedor
separada entre ventas y excedentes; y valor no aprovechado.

La evidencia ya estaba en `DATA.exchanges` y las autoridades económicas ya
calculaban ingreso y valor perdido, pero la única pantalla disponible mostraba
Resumen, Ventas y Devoluciones. El arnés se escribió antes de implementar:

    node test-exchange-reports.mjs

Línea base: **5 pasaron, 19 fallaron**.

## Causa raíz

No faltaban datos ni una regla económica. Faltaban dos proyecciones de lectura y
una superficie que las consumiera. Consultar una venta cambiada exigía revisar
la base; la comisión acumulada no explicaba su origen; y
`DATA.exchangeUnusedValue()` no tenía consumidor visible.

## Diseño

`DATA.exchangeReport(pred)` presenta el documento del cambio sin recalcularlo:
folio origen y propio, responsables, importes congelados y renglones separados
entre entregado y devuelto.

`DATA.sellerCommissionReport(pred)` agrupa la comisión congelada por vendedor y
separa ventas de cambios. Una venta con un solo vendedor es exacta. Las ventas
históricas con varios vendedores sólo congelaron el total, no el reparto
individual; se distribuyen conservando el total y la pantalla las marca
explícitamente como estimadas, sin aparentar precisión inexistente.

El valor no aprovechado consume directamente
`DATA.exchangeUnusedValue(pred)`. Las tres lecturas comparten el mismo filtro de
periodo, que recibe el documento completo.

La decisión del dueño fue conservar la opción A: la utilidad estimada sigue
calculándose sobre el importe vendido total, incluidas las diferencias de
cambios. No se modificaron esquema, contrato ni reglas económicas.

## Solución

- `balam/data.jsx`: proyecciones de historial y comisión por origen.
- `balam/reports.jsx`: pestaña Cambios con los tres reportes y contratos
  `data-testid`.
- `test-exchange-reports.mjs`: 24 comprobaciones conductuales con venta cobrada,
  vendedor elegible, inventario coherente y cambio real.
- Artefactos generados mediante `node build-offline.mjs`.

## Pruebas

`test-exchange-reports.mjs` **24/24**, desde 5/19; ingreso de reportes 24/24;
comisión del excedente 30/30; Préstamos 117/117; UX 11 interacciones y 2
validaciones; smoke del bundle 17/17; navegación 15/15; reproducibilidad 8/8;
contratos 38/38; pantalla del cambio 45/45; E2E del cambio 37/37; modelo 28/28;
commit del cambio 32/32; saldo 38/38; plazo 38/38; devoluciones 17/17; coherencia
17/17; comisiones 10/10; comisión efectiva 22/22; liquidaciones 10/10; cola
115/115; concurrencia 9/9; folio diario 60/60; trazabilidad 65/65; migraciones
31/31; roles 10/10; ticket 23/23; apartados 55/55.

## Despliegue

Sin migraciones. El commit `f45dba5` se publicó en `main`. GitHub Pages sirve
`index.html` idéntico byte a byte al artefacto del commit:

    SHA-256  BAB34C4DAD52A11720B8EC930C6F41448E9988F4AD8FC59DB1488FBA3C25823A
    bytes    8 727 125

La trampa de auditoría se comprobó contra la fuente servida:
`balam/data.jsx` coincide con el repositorio y contiene
`sellerCommissionReport`; `balam/reports.jsx` también coincide y contiene
`exchange-history-report`.

## Riesgo residual y pendientes

Las ventas históricas con varios vendedores no congelaron la comisión
individual de cada uno. El reporte conserva el total y marca el reparto como
estimado. Corregir esa evidencia hacia futuro requiere una historia propia,
porque cambia el documento de venta.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-51---los-cambios-no-tienen-reportes-explicables-de-posventa-y-dinero`
- `docs/04-contrato-del-cambio.md` § 4, § 7 y § 13
- `docs/fixes/comision-del-excedente.md`
- `docs/fixes/ingreso-del-cambio-en-reportes.md`
