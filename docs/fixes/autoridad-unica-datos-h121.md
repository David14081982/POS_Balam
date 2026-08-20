# Una autoridad de datos por dominio

**Riesgo:** H-121
**Estado:** RESUELTO / PENDIENTE DE PUBLICACIÓN
**Fecha:** 19/08/2026
**Commit:** Pendiente de commit

## Resultado ejecutivo

Equipo David conservaba seis documentos comerciales operables que ya no
existían como ventas autoritativas en Supabase. No era una cola pendiente:
protocolo 2, época 2 y cola 0 estaban vigentes. `pullSales()` fusionaba la
ventana remota con toda la caché y los snapshots completos vacíos eran no-op;
por eso `DATA`/`localStorage` actuaban como segunda autoridad.

Antes de modificar la proyección se exportó un expediente forense inerte con
hashes. Después se comparó cada folio con Supabase, se capturaron huellas pre,
se ejecutó `STORE.rebootstrapFromCloud()` con el contrato H-77/H-116 y se
verificaron huellas post. El rebootstrap retiró los seis fantasmas de todos los
consumidores y conservó BG-260810-0011. El hash comercial remoto fue idéntico
antes y después: no se modificaron stock, ventas, pagos, movimientos,
devoluciones, cambios, préstamos, comisiones ni clientes remotos.

La corrección permanente separa cuatro roles:

1. Supabase confirma documentos y bajas.
2. La cola durable conserva únicamente intenciones offline no confirmadas.
3. `DATA`/`localStorage` son proyección reconstruible.
4. Telemetría, cursores y Realtime observan/invalidate; no crean autoridad.

## Expediente forense

Ruta fuera del almacenamiento operativo:

`C:\Users\david\Documents\BALAM-forense\H-121-20260819-equipo-david`

Archivos principales:

| Evidencia | SHA-256 |
|---|---|
| `01-pre-operational-snapshot.json` | `de008904076001e7ed5987b21df915c1e9cbe5c2726df9ce29f99c958b3d80a0` |
| `02c-folios-local-forensic-strict.json` | `711cd00bae16205cef9198379170e372f387ddf6b225ce87f653d931e5add9d9` |
| `03-store-recovery-pre-rebootstrap.json` | `f782c3e2571079323638450d70b539779208d7b5ff35eb24595021665ffa7998` |
| `04-supabase-pre-rebootstrap.json` | `b7ba16b6662aaa0b546d52fedbca593ddade382a958742c841722c4b025320eb` |
| `05-local-vs-supabase.json` | `30f8b8a0d9ac27c6313786121656a1d5d6d9f404f0ab2ce3ec7138ac8bdcb3c1` |
| `06-rebootstrap-result.json` | `228ae56c1856a84935323566803efdce51633315cb97b508394619a7f7b6d33d` |
| `07-post-operational-snapshot.json` | `91b4f87a839812b1c16284c7cb0717b20babad148b43dba68b42f604e6931ee7` |
| `08-supabase-post-rebootstrap.json` | `663664a072198aa8196c49fbde0384490c4cee3de8e6e3b3c20bfc6723e119aa` |
| `09-post-verification.json` | `48e3b97885e6c256da24a38c80172ed60000ee47371b5333432d87b5bd5f5ba7` |
| `10-qa-ui.json` | `3f48c57f48d6d9e074b62db9b99b50f0a9176cb1074ccf969dc610f0c5c40937` |
| `32-qa-release-candidate.json` | `21fb6995218d21fa39e1c7219637dadca39abc63e249751855fa99037e2d296c` |

Los manifiestos de etapas y `SHA256SUMS-stage*.txt` sellan todos los JSON, TXT
y PNG. Los archivos no se copiaron a ninguna colección comercial y no pueden
entrar al POS, sincronizarse ni afectar reportes.

## Comparación por folio

| Folio | Local | Supabase | Diferencia | Evidencia única local |
|---|---|---|---|---|
| BG-260812-0033 | Venta + cambio | Ausente | Sólo local | documento, renglones, recibo, comisión, cambio y stock proyectado |
| BG-260812-0031 | Venta + cambio | Ausente | Sólo local | documento, renglones, recibo, comisión, cambio y stock proyectado |
| BG-260812-0007 | Venta | Ausente | Sólo local | documento, renglón, recibo, cliente y comisión |
| BG-260812-0005 | Venta + cambio | Ausente | Sólo local | documento, renglón, recibo, comisión, cambio y stock proyectado |
| BG-260812-0004 | Venta + devolución | Ausente | Sólo local | documento, dos renglones, recibo, devolución, motivo y reverso proyectado |
| BG-260812-0002 | Venta | Sólo `sale_commit` huérfano | Parcial/no autoritativo | documento, renglón, recibo, cliente y comisión; el commit remoto no reconstruye una venta |

BG-260810-0011 sí existía como venta, pago y movimiento remotos y se usó como
control positivo. Ninguno de los seis fantasmas se reconstruyó en Supabase.

## Snapshot y rebootstrap

- Antes: seis fantasmas en Ventas; tres cambios fantasma; una devolución
  fantasma; cola 0/0/0; protocolo 2; época 2.
- Operación: rebootstrap completo desde Supabase con cada dominio obligado a
  devolver `ok=true`, `complete=true` y `applied=true`.
- Después: cero fantasmas en Ventas, Devoluciones, Cambios, historial,
  reportes, búsquedas y reimpresión; BG-260810-0011 conservado; cola 0/0/0.
- Hash remoto comercial pre/post:
  `8966d514d8cd41895f0f30d0db67c8257f2a960e4358b2fd1e5b9b96591acc4f`.
- Escrituras observadas: sólo RPC técnicas de permisos, estado de limpieza,
  reserva, heartbeat y consumo de órdenes/cuarentena. Cero escrituras
  comerciales inesperadas.

## Semántica de convergencia aplicada

| Tipo de pull | Regla |
|---|---|
| Snapshot completo | Remoto reemplaza la proyección, incluido vacío, sólo online, misma época, lectura completa y sin cola que proteja el dominio. |
| Ventana temporal | La ausencia retira únicamente identidades dentro del límite consultado; Ventas conserva documentos no-apartado anteriores al corte. |
| Incremental | La ausencia no borra; Realtime sólo invalida y necesita pull/tombstone/versionado. |

No existe una poda global genérica. `pullDomain()` devuelve resultado explícito
y `reconcileDomains()` sólo avanza el cursor tras aplicación completa y
persistida. El rebootstrap falla cerrado con
`REBOOTSTRAP_DOMAIN_INCOMPLETE:<dominio>`.

## Cinco P0

| P0 | Causa | Autoridad | Corrección | Regresión |
|---:|---|---|---|---|
| 1 | Snapshots vacíos se trataban como no-op | Snapshot remoto completo | Se aplica vacío en datos y configuración; no se auto-sube caché | `H121a`, `H121g` en `test-store-queue.mjs` |
| 2 | Cursor avanzaba con pull omitido/incompleto | Resultado completo y persistido | Contrato `ok/complete/applied/coverage`; error o cola dejan invalidación | `H121e` y fallo del ledger de movimientos |
| 3 | Dos mapas incompletos protegían sólo algunas tablas | Cola durable por tipo y efectos | Una matriz incluye stock, documentos, pagos, movimientos, clientes, vendedores, comisiones y reclasificaciones | `33c`, `H121f`, `H121h`, `H121i` |
| 4 | `commission_adjustments` no tenía pull | `pos.commission_adjustments` | Dominio remoto, JSONB con folios y reconciliación ligada a Sellers | `H121c/d` + `test-h69-commissions.mjs` |
| 5 | Periodo dependía de `balam_pos_periodo_v1` | Último cierre/corte remoto | La clave local se reconstruye o retira desde `liquidations` autoritativas | fixtures H-121 de `test-h69-commissions.mjs` |

La adopción H-62 de préstamos locales permanece como acción explícita, pero ya
no corre dentro de un pull: reconstruir caché nunca autoriza crear documentos
remotos. `_loanVersion` queda como metadato, no como segunda autoridad.

## Pruebas

- `node test-store-queue.mjs`: **186/186**; cobertura, vacío, cursores,
  efectos cruzados y captura offline durable.
- `node test-h69-commissions.mjs`: **95/95**; ajuste remoto, folios, periodo
  remoto y bloqueo cerrado de filas legadas sin identidad.
- `node test-loans-sync.mjs`: lectura y mutación A→B→A entre terminales.
- `node test-h77-live-sync.mjs`, `node test-h118-sync-activity-reconciliation.mjs`.
- `node test-h113-selective-cleanup.mjs`, `node test-h116-cleanup-fleet-risk.mjs`.
- `node test-returns.mjs`, `node test-exchange-commit.mjs`,
  `node test-sale-coherence.mjs`.
- `node test-module-contracts.mjs`, `node test-production-startup-regression.mjs`,
  `node test-smoke.mjs bundle`.
- BALAM QA real del candidato final: **25/25**, escritorio 1440×900 y móvil 390×844,
  cero fantasmas, cero errores de página y cero escrituras comerciales.
- `node build-offline.mjs` y `git diff --check`.

El E2E H-119 que requiere PostgreSQL local no arrancó porque el fixture del
puerto 55416 no estaba en ejecución; falló antes de preparar datos y no es una
regresión H-121. Su contrato estático H-113/H-116 sí pasó.

## Riesgo residual

- Una terminal que permanezca en un build anterior puede conservar caché vieja
  hasta actualizar y reconciliar/rebootstrap; protocolo y época mantienen el
  cerco existente.
- Ajustes de comisión históricos creados antes de guardar `folios` conservan
  totales autoritativos, pero no permiten reconstruir detalle por folio que
  nunca fue persistido remotamente.
- La evidencia local exportada es administrativa e inerte; su conservación o
  descarte posterior requiere una decisión explícita y nunca afecta operación.

## Puerta permanente

`ADR-014` y `R-SYNC-13`–`R-SYNC-15` hacen bloqueante esta revisión para BALAM
Maintainer/QA: ningún caché puede ser autoridad de un documento confirmado y
ningún cambio de convergencia se publica sin demostrar que conserva trabajo
offline legítimo.

## Referencias

`ADR-006` · `ADR-012` · `ADR-014` · H-62 · H-77 · H-113 · H-116 · H-118 · H-120
