# Descuentos exactos y autoridad financiera de ventas nuevas

**Riesgo:** H-186
**Estado:** PARCIALMENTE RESUELTO — corrección y prueba integral PASS; publicación y activación final pendientes
**Fecha:** 11/10/2026 UTC
**Commit:** Pendiente de commit

## Problema y reproducción

JOEL cuesta $1,250 y la promoción configurada ofrece 30%. El motor anterior
imponía un margen mínimo de 50% usando el costo registrado de $563:
$563 / (1 − 0.50) = $1,126. Por ello descontaba sólo **$124**, en lugar de
$375. La reproducción es exacta; no se encontró una venta histórica JOEL
con esa promoción que permita atribuir un cobro real de $1,126.

La reproducción inicial de promociones dio 1 aprobado y 9 fallos. También
se reprodujeron IVA de ticket calculado desde el original, pérdida de
centavos con varias unidades y aceptación SQL de subtotal, IVA y pagos
incongruentes. Las pruebas negativas fallaron antes de la corrección.

## Causa raíz y auditoría previa del costo

El piso estaba en PROMOS.applyStack. Caja y ticket reconstruían el desglose
desde el original, mientras saleQuote usaba el precio descontado. El unitario
redondeado perdía residuos y las RPC anteriores no recalculaban todo el
contrato desde datos autoritativos.

El costo se almacena en pos.products.costo, numeric(10,2). La trazabilidad de
las dos referencias JOEL actuales conserva $563 desde el upsert del
12/09/2026 20:28:42 UTC; hay un antecedente V1 del 30/08/2026 sin mapa que
pruebe la transferencia de identidad. DATA.hydrate también puede generar
Math.round(precio × 0.45), que produce $563 para $1,250: esa coincidencia no
demuestra el origen económico. Excel permite importar/exportar Costo; la
pantalla de Inventario no ofrece captura visible y H-36 ya señala la carencia.

**Alta técnica identificada; captura económica original, compra de origen y
validez comercial no demostradas.** No se borraron ni recalcularon costos.
No se creó un módulo de costos. Reportes de utilidad usan report.marginPct;
comisiones usan total bruto o neto de IVA. El piso afectaba ambos al alterar
el precio cobrado; ese uso restrictivo queda eliminado.

## Diseño y solución

- Promociones válidas de 0 a 100%, sin piso por costo/margen. Acumulación
  vigente: sumar porcentajes hasta 100%, aplicar después fijos sin bajar de
  cero. Adicionales según permisos y metadatos existentes. Sin reglas nuevas.
- Contrato V2: original → descuentos → base → IVA → total → pago → documento
  → ticket → reporte. Supabase recalcula y rechaza incongruencias antes de
  persistir. El original y la solicitud financiera se congelan por documento.
- Aritmética decimal HALF UP y hasta dos segmentos por línea conservan los
  centavos. Vista previa V1 respeta precios por talla. Un total cero no crea
  pagos ficticios; la devolución cero registra movimiento físico sin reembolso.
- Abonos, liquidaciones, devoluciones y cambios conservan el contrato del
  documento. Los históricos no se recotizan ni se convierten a V2 con un abono.
- Comisiones V2: desglose persistido, suma y efectos por vendedor coherentes,
  abonos congelados, liquidación validada y repetición idéntica al snapshot.
  La respuesta y el recibo idempotente reflejan las filas finales de SQL.
- La devolución conserva la comisión de la pieza cambiada y redondea la
  proporción decimal; la política histórica y H69 permanecen intactas.
- Se corrigieron únicamente soportes QA necesarios para journal, respaldo,
  cierre de navegadores y limpieza exacta. No se alteró el modelo de inventario.

Fuentes principales: balam/discounts.jsx, data.jsx, pos-ticket.jsx, returns.jsx,
store.jsx, config.jsx y settings.jsx. Los HTML y SW se regeneraron desde balam/.

### IVA incluido

Se conserva la tasa configurada de 16%: base = redondeo(total / 1.16), IVA =
total − base, después de descuentos. No se incorpora emisión de CFDI ni una
política fiscal nueva. Referencias: [LIVA, arts. 1 y 12](https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf)
y [SAT, art. 12](https://wwwmat.sat.gob.mx/articulo/67101/articulo-12).

| Descuento | Original | Descontado | Base | IVA | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30% | $1,250 | $375 | $754.31 | $120.69 | $875 |
| 50% | $1,250 | $625 | $538.79 | $86.21 | $625 |
| 60% | $1,250 | $750 | $431.03 | $68.97 | $500 |
| 100% | $1,250 | $1,250 | $0 | $0 | $0 |

## Pruebas y criterio de cierre autorizado

El propietario sustituyó expresamente la matriz de tres terminales por una
única prueba integral final y prohibió repetir suites ya aprobadas sin cambios
de código. El recorrido A/B/C se detuvo; **no se presenta como certificado**.

Se conservan, sin repetir en este cierre, 135/135 comprobaciones SQL (132
financieras y tres de instalación online), 31/31 de migraciones, 77/77 de
interfaz/tickets, promociones 10/10, descuentos 38/38, DATA financiero 20/20
y alcance de modelos 14/14. Los conteos tienen cobertura solapada y no se suman
como escenarios únicos. Catálogo remoto previo: 967/967 referencias, 1/1
promociones y 2,901/2,901 cotizaciones, cero discrepancias.

Migraciones 225, 226 y 227 aplicadas antes del cliente. La auditoría posterior
a 227 pasó 366/366: funciones y permisos exactos, 22 tablas, 978 costos y
21 ventas históricas preservados. La versión final 227 tiene SHA-256
45f8bd943bc18462fe695280f0e51be77af8e377924133f115be979e0f21114c.
Un candidato previo falló por autoverificación DML fuera del canal online;
su rollback fue verificado. La versión aplicada retiró sólo esa semilla,
conservando cuerpos financieros, permisos y bloqueo de escrituras directas.

### Prueba integral única final: PASS

La primera ejecución confirmó la venta y su ticket, pero falló en el arnés:
leyó response.sale en lugar de response.result.sale y redujo el manifiesto
que la limpieza espera con nombres A/B/C. Se corrigieron sólo esos dos
supuestos privados, manteniendo una sola terminal activa y sin modificar
aplicación ni SQL. Ese intento conserva FAIL; su limpieza retiró
17 filas y 1 actor QA, verificando
64 tablas y cero residuos. Se repitió únicamente la misma prueba, conforme
a la orden del propietario. No se repitieron las suites aprobadas.

Una terminal, una referencia y una promoción QA nuevas. Se ejecutó la UI real
de venta con 30%: resumen, caja, efectivo $875, confirmación Supabase, venta
Pagado/saldo cero, línea $875, base $754.31, IVA $120.69, pago persistido $875,
comisión 43.75 (bruto), saldo de vendedor, recibo idempotente, ticket,
reporte y reimpresión. Todo coincide con SQL. La única pieza vendida disminuyó
el stock QA en uno. No se usó un cliente comercial ni se cambió configuración.

Evidencia: [final-single-e2e.json](evidence/h186/final-single-e2e.json).
El artefacto probado tiene SHA-256
dcab70eff4fcd8ce5ec75346777b2c6db2e6b0d3c7d1779136443376cba68f3e
en ambos HTML. SW:
bb1c7dd43f762cba659b99932454c6fd65aba6f72b782798d866a15a8b99ea12.

### Limpieza y conservación

Recorrido detenido: 59 filas SQL y 1 identidad Auth QA
retiradas; finalizó 2026-10-11T04:35:56.852Z.
Prueba única: 17 filas SQL y 1 identidad Auth QA retiradas;
finalizó 2026-10-11T04:57:16.528Z. En ambos casos: respaldo original,
recibos y hashes exactos, 64 tablas protegidas, datos ajenos preservados y
**cero residuos nuevos POS/Auth**. No quedan procesos del recorrido detenido;
la prueba final acredita un contexto desconectado y cerrado, navegador y
servidor cerrados, journal sin fallos. Los contadores QA propios se conservan
monotónicos y no se reutilizan. **Datos comerciales afectados indebidamente: 0.**

Los intentos fallidos anteriores permanecen documentados en los JSON de
evidence/h186; sus resultados no se convierten en PASS. El séptimo se limpió
con 112 filas y un actor retirados, 64 tablas preservadas y cero residuos.

## Despliegue

Pendiente de commit, push y verificación Pages. Por orden del propietario,
el workflow manual H186 approved closure reutiliza los resultados aprobados,
exige la prueba única y sus limpiezas y verifica las fuentes sin cambios.
La normalización LF de Git se declara sólo para texto fuente; HTML/SW y
archivos servidos se comparan byte a byte. El commit técnico incluye [skip ci]
para no relanzar las baterías; el workflow ordinario sigue vigente para otros
cambios. La publicación manual queda ligada al SHA exacto de main.

Después de verificar Pages se activa min_financial_version=2 con la operación
acotada e idempotente y se comprueba el rechazo de una alta sin versión, con
cero escrituras comerciales y ROLLBACK. Hasta entonces el mínimo sigue en 1.

## Riesgo residual y pendientes

- Publicación y activación final pendientes en este corte.
- No se identificó la causa de tres timeouts de snapshot en recorridos
  anteriores concurrentes. Una lectura aislada terminó en 1,539.643 ms.
  No se declara reparado ese rendimiento ni se atribuye certificación A/B/C.
- Origen económico y validez comercial del costo: no demostrados; valores
  preservados. No limitan descuentos.
- Impresión física: NOT_TESTED. Se verificó el documento completo renderizado,
  no su salida en papel.

## Referencias

- H-186 en docs/03-known-risks.md; antecedentes H-11, H-32, H-36, H-52 y H-53.
- docs/04-contrato-del-cambio.md; política de comisión H69.
- local-financial-regressions.json, commission-snapshot-regression.json y
  commission-snapshot-failed-run.json en evidence/h186.
- Orden original y orden de cierre inmediato del propietario.
