# Claridad de dominios y proyecciones en la limpieza selectiva

**Riesgo:** H-122
**Estado:** RESUELTO
**Fecha:** 20/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

En Equipo David, Administración informaba cero elementos para Cambios y
Comisiones aunque la pantalla Cambios mostraba la venta `BG-260810-0011` por
$1,150 y Vendedores mostraba $57.50 de comisiones por liquidar. La misma
ambigüedad existía en los grupos Ventas y apartados, Préstamos,
Reclasificaciones y Clientes de prueba: la interfaz no distinguía el documento
borrable de una venta candidata o de una proyección calculada.

La reproducción real se hizo contra la sesión administrativa de producción en
modo de sólo lectura. Se bloquearon `report_sync_device`,
`consume_sync_commands`, `consume_sync_quarantine_decisions` y cualquier otra
RPC no incluida explícitamente en la lista de lectura. No se solicitó respaldo
ni se ejecutó limpieza.

Supabase y la proyección local coincidían:

- una venta confirmada: `BG-260810-0011`, pagada, por $1,150;
- cero documentos `exchanges`;
- cero `loan_documents`;
- cero `liquidations` y cero `commission_adjustments`;
- cero `reference_reclassifications`;
- ocho clientes remotos, pero cero clientes elegibles para limpieza;
- la comisión pendiente de $57.50 se deriva de la venta retenida.

Por tanto, los ceros eran correctos para los documentos seleccionables, pero
la presentación hacía parecer que el preview había omitido información.

## Causa raíz

La pantalla Cambios usa ventas elegibles como punto de entrada. Una venta
visible allí no prueba que exista un documento de cambio; el grupo de limpieza
Cambios cuenta y elimina `pos.exchanges`.

La pantalla de Vendedores calcula «Ventas del mes» y «Comisiones por liquidar»
desde ventas, cambios, ajustes y liquidaciones. El grupo Comisiones sólo cuenta
y elimina documentos de liquidación y ajuste; no representa el saldo derivado.

Además existía un defecto funcional persistente en servidor:
`pos.execute_test_data_cleanup()` recomputaba las proyecciones financieras de
vendedores después de cualquier limpieza. En consecuencia,
`pos.test_data_cleanup_plan()` exigía evidencia histórica de comisiones incluso
al seleccionar exclusivamente préstamos, reclasificaciones o clientes. Una
venta histórica con `comisiones = null` podía bloquear permanentemente esos
dominios ajenos o hacer peligrosa su ejecución.

## Diseño

Cada grupo comunica tres conceptos por separado:

1. el documento que selecciona y elimina;
2. el motivo por el que el conteo puede ser cero aunque exista información en
   otro consumidor;
3. la proyección derivada que se recalcularía al eliminar su fuente.

La recomputación de `comision_acum` sólo corresponde a selecciones de ventas,
devoluciones, cambios o comisiones. `ventas_mes` y `ventas_num` sólo se
recalculan si se seleccionan ventas. Préstamos, reclasificaciones y clientes no
pueden modificar esas proyecciones ni heredar sus guardas de evidencia.

No cambian el conjunto de documentos seleccionables, las dependencias, la
restauración de stock, la época, el protocolo ni las autorizaciones de H-113 y
H-116.

## Solución

- `balam/settings.jsx` explica el documento real de los siete grupos, muestra
  una razón específica cuando el conteo es cero y expone los folios exactos que
  sí selecciona Ventas. También aclara que Ventas del mes y Comisiones por
  liquidar son efectos derivados de ventas retenidas.
- `20260820016100_pos_h122_cleanup_domain_semantics.sql` introduce una función
  interna inmutable que clasifica si el plan afecta finanzas y acota con ella
  las guardas y recomputaciones existentes. La función no está expuesta a
  `anon` ni `authenticated`.
- `20260820016200_pos_h122_cleanup_domain_semantics_verification.sql` verifica
  estructura y la matriz de dominios dentro de `BEGIN/ROLLBACK`.
- El protocolo de cliente avanza a `schemaVersion 20260820016100`.

En el estado real auditado, para retirar `BG-260810-0011`, sus $1,150 y la
comisión derivada de $57.50, el grupo correcto es **Ventas y apartados**. El
preview autoritativo selecciona exactamente ese folio y anticipa restaurar una
pieza, de stock 1 a 2. Este trabajo no ejecutó esa limpieza.

## Pruebas

- Auditoría real pre/post de sólo lectura: 15 tablas comerciales leídas por
  páginas; SHA-256 comercial idéntico antes y después:
  `a3f4c49caf9d1459130ba9ffda3eb8b4a0d4ba21df3f18c62578f3ca55949a4c`.
- Supabase remoto: aplicó las migraciones 161/162 y emitió
  `H122_DOMAIN_SEMANTICS_OK unrelated=isolated financial_guard=preserved`;
  `db push --linked --dry-run` confirmó `Remote database is up to date`.
- PostgreSQL aislado: verificación estructural 161/162 correcta.
- Fixture funcional aislado: un préstamo se elimina sin tocar
  `comision_acum`, `ventas_mes` ni `ventas_num`; una selección de cambios sigue
  fallando cerrada sin evidencia de comisión.
- UI H-122: 21/21 en 320, 360, 375, 390, 430, 768, 1024, 1280 y 1440 px; cero
  llamadas destructivas.
- Contratos H-113 35/35, H-116 20/20, H-118 10/10.
- E2E H-113 21/21, H-116 29/29, H-117 65/65, H-119/H-120 37/37.
- Cola 186/186, comisiones H-69 95/95, préstamos 69/69, devoluciones 21/21,
  cambios 36/36 y coherencia de venta 20/20.
- Contratos de módulos 42/42, navegación 15/15, arranque productivo 5/5,
  smoke 15/15 y reproducibilidad 8/8.
- `node build-offline.mjs`: correcto.

## Riesgo residual y pendientes

La venta `BG-260810-0011` es autoritativa y permanece hasta que el administrador
autorice y ejecute explícitamente la limpieza de Ventas y apartados. No es un
residuo local ni un cambio confirmado.

Dos commits huérfanos de devolución (`BG-260811-0015` y `BG-260812-0001`)
siguen protegidos para revisión administrativa; H-122 no los reinterpreta ni
los descarta.

No existe otro defecto conocido en la semántica de los grupos auditados.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-122--la-limpieza-confunde-documentos-con-candidatos-y-saldos-derivados`
- Arquitectura: `docs/02-architecture.md`, «Limpieza selectiva y riesgo real de flota».
- Correcciones relacionadas: `limpieza-selectiva-datos-prueba.md`,
  `consistencia-devoluciones-limpieza.md`, `autoridad-unica-datos-h121.md`.
