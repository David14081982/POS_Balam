# Cobros de cambios y vendedores obsoletos después de limpiar

**Riesgo:** H-152
**Estado:** RESUELTO y certificado; publicación del cliente pendiente
**Fecha:** 09/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Reportes mostraba $890 cobrados, sin ventas ni cambios. Supabase conservaba dos
filas `tipo=cambio`: $790 del folio `BG-260901-0001` y $100 del folio
`BG-260908-0492`. Ambos cambios estaban en el respaldo sellado de la limpieza
confirmada `8d996563-96db-4537-9930-032e86de15bd`, y tenían lápidas de esa
misma limpieza. Sus folios propios eran distintos a los folios de venta origen.

Los nombres `qa-h148-27fe0e17-7773-444d-9b55-7832723a077b Admin/Seller`
procedían de la certificación H151. Se habían retirado de Supabase; la pantalla
abierta conservaba filas renderizadas con los datos anteriores.

Reproducciones: Reportes **4/7** antes del cambio de suscripción; proyección
selectiva **8/9** antes de consumir IDs de pagos; SQL **3/10** antes de corregir
la selección, respaldo y ejecución de pagos dependientes de cambios.

## Causa raíz

El plan no congelaba los pagos seleccionados. El respaldo y el borrado de
`sale_payments` sólo buscaban `sale_folios`, omitiendo el folio propio de cada
cambio. El adaptador local repetía esa omisión. El importe mostrado era la suma
correcta de dos registros que la limpieza había dejado indebidamente vivos.

`ReportsScreen` tampoco se suscribía a `datachange`, pese a que DATA ya emite
ese aviso al persistir snapshots remotos. La caché podía estar actualizada y
la tabla abierta seguir mostrando las filas antiguas hasta volver a renderizar.

## Diseño

Se conserva `sale_payments` como autoridad monetaria; no se ocultan importes
por ausencia de ventas ni se filtran nombres de pruebas. El plan identifica los
pagos por folio de venta seleccionado o por `tipo=cambio` y folio de cambio
seleccionado. Congela sus IDs y una huella de sus filas completas. Respaldo,
ejecución y proyección local consumen esos mismos IDs. Los eventos históricos
sin `payment_ids` conservan su comportamiento previo.

Reportes consume el aviso existente de DATA y mantiene la pestaña y los filtros
del usuario. No crea un segundo motor de reportes o sincronización.

## Solución

- Migraciones `19600/19700`: tres funciones existentes, generadas desde sus
  definiciones remotas con guarda MD5; selección, hash monetario, respaldo y
  ejecución coherentes. Mismas firmas, ACL y defensas. Verificación con rollback.
- `balam/data.jsx`: aplicación de los IDs exactos de pagos confirmados.
- `balam/reports.jsx`: actualización ante `datachange`, sin remontar pestañas.
- Certificador real: Reportes abierto en A/B/C debe retirar una fila de prueba
  después de borrarla en Supabase; no basta comprobar el arreglo en memoria.
- `supabase/REPARAR-PAGOS-LIMPIEZA-H152.sql`: reparación acotada de los dos
  residuos de la limpieza ya autorizada. No es un borrado general reutilizable.

## Reparación del dato existente

La autorización es la selección de Cambios en la limpieza confirmada del usuario,
incluidos sus pagos relacionados. El respaldo original y las lápidas prueban los
dos IDs exactos; el arreglo completa ese alcance y no selecciona otros documentos.

El script exige preproducción, época 8, respaldo original íntegro, limpieza
completada, dos filas por $890, identidad/folio/importe coincidentes y ausencia de
documentos vivos. Bajo los mismos locks de limpieza crea un respaldo compañero
antes de borrar. Si cualquier condición difiere, aborta entero. Repetirlo no crea
otro respaldo ni vuelve a borrar. No incrementa la época; el trigger existente
invalida el dominio de pagos.

Aplicado: **0 pagos / $0**, época 8, productos y vendedores idénticos. Respaldo
compañero `62bfa353-4b95-49c8-9036-9521a7632c95`, SHA-256
`dfab99c23aba9d2b73a66b447635a4f3f5e07f7a1c2004a38efee6238fb9267e`.
El respaldo original permanece intacto. Los dos vendedores citados no están en
Supabase. Evidencia sanitizada: `docs/fixes/evidence/h152-repair.json`.

## Pruebas

| Prueba | Resultado |
|---|---|
| `node test-h152-reports-refresh.mjs` | 9/9 en 1280 px y 9/9 en 390 px; Chrome y DATA reales, Supabase bloqueado |
| `test-h152-exchange-payment-cleanup.sql` en `h150_exact` | 10/10, ejecución completa e idempotencia, rollback |
| `node test-h152-cleanup-repair.mjs` | 5/5, alcance exacto, identidad, época, respaldo y repetición |
| Reparación real ensayada con rollback | 0 pagos, $0, un respaldo sellado, época 8 |
| Migración de verificación local y remota | selección, respaldo, huella, acceso denegado y fixtures revertidos |
| `node test-migrations.mjs` | 31/31 |
| `node test-report-revenue.mjs` | 24/24 |
| `node test-h90-payment-method-report.mjs` | 24/24 |
| `node test-h148-projection-durability.mjs` | 32/32 |
| `node test-h151-cleanup-propagation.mjs` | 12/12 |
| `node test-store-queue.mjs` | 186/186 |
| `node test-h90-payment-method-ticket-e2e.mjs` | 21/21 |
| `node test-h150-cleanup-quarantine-sql-ui.mjs` | 12/12 |
| `node test-build-reproducibility.mjs` | 8/8 |
| `node test-ui-navigation.mjs` | 15/15 |
| Guardián de certificado | 20 certificados falsos rechazados |

Matriz real completa A/B/C: **25/25**, **16/16 dominios**, finalizada
`2026-09-09T18:45:36.062Z`. Cero pendientes perdidos y divergencias finales;
fixtures retirados, 17 huellas comerciales intactas. Reportes abierto retira
el vendedor borrado en las tres sesiones y sus pagos coinciden con Supabase.
Certificado: `docs/fixes/evidence/h148-live-matrix.json`; guardián aprobado
contra el HTML final y el SHA-256 del certificador
`26add16bb07762a9108882450ba1f35eff416decdcf605c3eef151ec69d077df`.

QA visual: capturas de Reportes a 1280 y 390 px; cobros en $0 y sólo el
vendedor conservado después del pull confirmado. Sin errores de ejecución.
El adaptador selectivo persiste sin emitir por sí solo; el ensayo de pantalla
ejerce además el pull autoritativo que realiza STORE. La selección del adaptador
y la reacción de la pantalla se afirman por separado.

Revisión propia: diff de las tres funciones limitado a selección/huella y
consumo de IDs; firmas, ACL, locks y barreras anteriores preservados. Sin filtros
que oculten cobros o vendedores. La prueba SQL retiene una venta y tres pagos
ajenos por $155, incluidos pagos con el mismo folio pero otro tipo. Sus cambios
no tienen líneas de inventario para aislar la dependencia monetaria; la
regresión SQL/UI y la matriz real cubren existencias. El script de reparación
está separado de las migraciones y sólo acepta los dos IDs con linaje probado.

## Despliegue

Migraciones `20260909019600` y `20260909019700` aplicadas en
`telohdbvbvsfmwyriflz` antes del cliente. Comprobación remota de selección,
respaldo, hash y acceso denegado aprobada. `db push --linked --dry-run` final:
`Remote database is up to date`.

Cliente generado `2026-09-09-h152`; SHA-256 de `index.html`:
`38978740c0ba3295e4dab4e37dd03fdb90e686467af4b5f606059b1332f4f586`.
Publicación y comprobación del artefacto servido pendientes.

## Riesgo residual y pendientes

Los equipos deben recibir el cliente corregido para que una pantalla abierta
reaccione a los avisos de DATA. La certificación crea y retira fixtures exactos
en preproducción; su presencia temporal no representa ventas o personal real.
La reparación no elimina otros pagos históricos sin prueba de pertenencia.

## Referencias

- `docs/03-known-risks.md`, H-152.
- `docs/trazabilidad-financiera.md` y `docs/04-contrato-del-cambio.md`.
- `docs/fixes/propagacion-limpieza-equipos-h151.md`.
- `docs/fixes/limpieza-pendientes-cuarentena-h150.md`.
