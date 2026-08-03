# Sistema de comisiones de vendedores

**Riesgo:** H-69
**Estado:** RESUELTO
**Fecha:** 02/08/2026
**Commit:** `54f7a9c`

## Problema y reproducción

Existían ventas asociadas a vendedores y la comisión aparecía en cero en todas
las pantallas. La auditoría previa lo reprodujo sobre el motor real del artefacto
publicado con cuatro perfiles y dieciséis casos: una venta de $1,160 con vendedor
asignado registraba `comision = 0`, y un perfil con `commissionOverridePct = 8`
registraba también `0`.

El porcentaje valía cero en los datos y **ninguna pantalla del producto podía
cambiarlo**:

- el alta en producción escribía `comision_pct: 0` fijo
  (`supabase/functions/admin-users/index.ts:63`);
- el alta local leía `Number(u.comisionPct) || 0` y el formulario nunca enviaba
  ese campo (`balam/data.jsx` ← `balam/settings.jsx`);
- `updateUser` sólo se invocaba con `{nombre, role, avatar, email, active}`;
- búsqueda exhaustiva de escrituras a `comisionPct`, `metaMes`,
  `commissionOverridePct` y `sellerLevelCode` fuera del mapeo de sincronización:
  ninguna.

El despliegue de H-31 ya lo dejaba registrado: «los tres perfiles conservan
`comision_pct = 0.00`».

## Causa raíz

Combinación de tres fallos, con un culpable principal:

1. **Configuración imposible.** El porcentaje nacía en cero por contrato de alta
   y no había interfaz para fijarlo. `0 × cualquier venta = 0`.
2. **Autoridad desconectada.** H-31 creó `DATA.resolveSellerCommission()` y dejó
   expresamente fuera de alcance conectarla. Cuatro copias de la fórmula leían
   `seller.comisionPct` en crudo: `recordSale`, `finalizarApartado`,
   `recordExchange` y `recordReturn`. Es `AP-01` con la autoridad ya escrita.
3. **Ajustes inertes.** `commission.basePct`, `commission.monthlyGoal` y
   `commission.bonus` se administraban en pantalla y no los leía nadie.

No eran la causa el cálculo, la persistencia, la RPC ni la sincronización.

### La operación bloqueada `COMMISSION_RPC_REQUIRED`

El trigger `pos.restrict_direct_commission_writes` (H-56, 30/07/2026) responde
`42501` cuando una sesión `authenticated` cambia `comision_acum`, `ventas_mes` o
`ventas_num`. El cliente enviaba siempre esas tres columnas dentro del upsert
completo de vendedores, así que cualquier divergencia entre el acumulado local y
el remoto bloqueaba el guardado de perfil. No causó las comisiones en cero —el
bloqueo es del 31/07 y los porcentajes estaban en cero desde el alta— pero habría
impedido que la corrección llegara a la nube.

## Diseño

**Política autorizada por el dueño (02/08/2026):** 3 % base sobre la venta neta
sin IVA y después de descuentos, 4 % al alcanzar la meta mensual, 5 % por encima
del 120 % de la meta. Los tramos son **marginales** —decisión explícita del
dueño— de modo que cada peso se paga a la tasa de su tramo y una venta cobrada
nunca se recalcula al cruzar un umbral. Meta inicial 0, es decir 3 % plano hasta
que el dueño fije metas.

**Una sola autoridad.** `DATA.resolveSellerCommission(seller)` deja de responder
sólo el porcentaje y responde la política completa: tasa base, tasas de meta y
excedente, umbral y meta del vendedor. Un porcentaje individual —personalizada o
nivel— desplaza la escalera completa por el mismo salto que la política de la
tienda define entre tramos, para que un trato individual no anule el incentivo
por meta. Un tramo superior nunca paga menos que el anterior.

**Evidencia congelada.** Cada venta guarda `comisiones[]`: `sellerId`, base,
porcentaje efectivo, importe, origen de la política, versión y desglose por
tramos. Las reversas parten de ahí y no del porcentaje vigente (`AP-06`). Una
venta anterior a H-69 reconstruye su desglose desde su propio snapshot
—`comision`, `comisionBase`, `vendedores`— y se declara `reconstruida`.

**Frontera de escritura.** El perfil viaja por una actualización acotada
(`profileUpdate`) que usa `update` y nunca `upsert`: un upsert rellenaría las
columnas ausentes con su valor por defecto y volvería a chocar con el trigger.
Las tres columnas financieras siguen siendo exclusivas de las RPC, y `updateUser`
las rechaza también en el cliente.

**Cierre de la operación bloqueada.** No se borró. Se determinó que quedó
obsoleta —su cuerpo se reconstruye desde `DATA.sellers` en cada intento, así que
nunca fue una captura histórica— y se **convierte** a `profileUpdate` con las
tres columnas retiradas, registrando la supersesión en la propia operación
(`supersededOp`, `supersededReason`, `supersededDiagnostic`). El perfil que
quería guardar llega íntegro.

**Reportes derivados.** `DATA.commissionLedger(pred)` recorre ventas, cambios,
devoluciones, cancelaciones y liquidaciones congeladas y devuelve generado,
revertido, liquidado y pendiente. Vendedores, Reportes y el XLSX consumen esa
única función. Un cierre de mes pone el pendiente en cero y **no** borra la
comisión generada del reporte. Si el saldo derivado y `comision_acum` difieren,
la pantalla lo muestra en vez de esconderlo.

**Ajuste histórico.** Los tickets emitidos no se reescriben (`ADR-002`). Lo no
pagado se reconoce en un documento aparte con vista previa folio a folio,
resumen final antes de confirmar, y RPC atómica idempotente por operación.

## Solución

- `balam/config.jsx`: escalera 3/4/5 y umbral 120 %.
- `balam/data.jsx`: autoridad de política, calculadora marginal por tramos, base
  comisionable, reparto entre vendedores, congelado en venta/apartado/cambio,
  reversas desde lo congelado, `reverseSaleCommission`, `commissionLedger`,
  vista previa y documento de ajuste histórico.
- `balam/store.jsx`: `profileUpdate` acotado, conversión auditada de la operación
  bloqueada, transporte de la evidencia congelada y RPC del ajuste.
- `balam/settings.jsx`: porcentaje, nivel y meta en el alta/edición, con el
  porcentaje efectivo y su origen resueltos por `DATA`.
- `balam/sellers.jsx`: pantalla sobre el ledger, detalle por identidad y no por
  nombre, y el panel de ajuste histórico.
- `balam/reports.jsx`, `balam/xlsx-io.jsx`: mismos números que Vendedores.
- `supabase/migrations/20260802011000` + `011100` + `011200`.

## Pruebas

Antes de la corrección, la auditoría sobre el motor real: venta normal con
vendedor asignado `comision = 0`; perfil con 8 % personalizada `comision = 0`;
`grep -rn "resolveSellerCommission" balam/ supabase/` → 1 resultado, su propia
definición.

Después:

- `node test-h69-commissions.mjs`: **88/88** (21 casos exigidos + compatibilidad).
- `node test-store-queue.mjs`: **148/148**, incluidas 37a–37h (el perfil no lleva
  las tres columnas), 38a–38d (la operación bloqueada se cierra y se aplica) y
  39a–39c (el ajuste viaja como RPC).
- `node test-effective-commission.mjs`: **24/24**. Las dos aserciones que
  vigilaban el no-alcance de H-31 se **invirtieron**: ahora exigen que ningún
  cálculo financiero lea `seller.comisionPct`.
- `node test-liquidations.mjs`: **12/12**. Dos aserciones obsoletas desde H-56
  —esperaban que el cliente empujara filas a `pos.liquidations`, hoy sólo-RPC—
  se corrigieron al contrato vigente; fallaban ya en `HEAD`.
- Regresión: contratos 41/41, comisiones 10/10, elegibilidad 10/10, comisión del
  cambio 30/30, coherencia de venta 20/20, devoluciones 17/17, cambio 32/32,
  reportes del cambio 24/24, descuentos 43/43, ingreso 24/24, migraciones 31/31,
  capacidades 40/40, permisos 13/13, roles 15/15, AUTH 18/18, navegación 15/15,
  registro 12/12, folio 60/60, filtros 18/18, H-63 58/58, avatares 13/13, admin
  21/21, apartados H-65 (e2e y liquidación) correctos, build 8/8, smoke 15/15,
  UX sin retroceso.

### Verificación contra la base real

`supabase db lint` sin hallazgos nuevos; `db push --dry-run` listó exactamente
las migraciones previstas. Aplicadas el 02/08/2026 (`20260802011000`,
`011100`, `011200`). Como el CLI no imprime `raise notice`, la evidencia va
aseverada dentro de las migraciones: **que no aborten es la prueba**. Quedó
demostrado en remoto que

- hay vendedores activos y ninguno resuelve 0 % por omisión;
- **Lupita Rivera y Mónica Duarte existen como vendedoras activas y ambas
  resuelven el 3 % de la tienda** (`20260802011200`, que exige las dos);
- la RPC de ajuste rechaza a quien no tiene la capacidad, acredita, es
  idempotente, detecta un payload distinto bajo la misma operación y valida la
  forma;
- `commit_sale_checked` y `commit_layaway_liquidation_checked` rechazan un
  desglose que no es arreglo;
- `record_exchange_commission_policy` congela importe, origen y versión;
- el trigger `sellers_restrict_direct_commission_writes` **sigue en pie**;
- `authenticated` no puede insertar ajustes sin pasar por la RPC;
- las semillas se retiraron (`H69_FIXTURE_LEAK` habría abortado);
  `inspect db table-stats` confirma `pos.commission_adjustments` en 0 filas.

Las tres funciones `*_checked` se generaron desde su **texto vigente** con
ediciones acotadas y diff revisado bloque a bloque (`R-DB-03`, `AP-05`); las
funciones grandes no se tocaron.

## Publicacion

Artefacto publicado en GitHub Pages y verificado byte a byte (`R-DEL-07`):

    sha256  370a3ee1e7bb1d65fb8934b341af33765f2736403963b15325f10ff2b95baab8
    bytes   8 824 948

El archivo servido por `https://david14081982.github.io/POS_Balam/index.html`
coincide exactamente con el `index.html` del commit `54f7a9c`. La comprobacion
funcional se hizo **cargando el paquete servido y preguntandole por ejecucion**,
no con `grep`: la escalera es 3/4/5 con umbral 120 %, un perfil sin decision
explicita resuelve el 3 % general, una venta de un alta nueva registra $30 sobre
$1,000 de base y congela su desglose por vendedor. Cero errores de pagina.

## Enmienda (03/08/2026) · la escalera era editable a medias

Al preguntar el dueño dónde se editan las tres tasas se detectó un hueco de la
entrega: sólo `commission.basePct` estaba en pantalla. El 4 %, el 5 % y el
umbral del 120 % existían como ajustes con valor por defecto y **ninguna pantalla
los exponía**, que es exactamente la forma del defecto que H-69 corrige.

- `Configuración → Vendedores → Comisiones` muestra ahora las cuatro tasas
  —base, meta, excedente y umbral— con una vista previa de la escalera resultante
  calculada por `DATA.resolveSellerCommission()`, no por la pantalla.
- `commission.monthlyGoal` deja de ser inerte: prellena la meta de un alta nueva.
- `commission.bonus` se conserva pero se declara en pantalla como informativo,
  porque la política vigente no paga bono automático. Un control que no hace nada
  y no lo dice es lo que originó esta historia.
- `test-h69-commission-settings.mjs` (16/16) recorre la pantalla real, navega por
  `data-testid` y comprueba que editar una tasa **cambia el importe cobrado**,
  no sólo que el campo existe.

## Riesgo residual y pendientes

1. **La posición en la escalera se deriva localmente.** `sellerPeriodBase()` suma
   la evidencia congelada del periodo en la terminal que cobra. Con dos
   terminales vendiendo a la vez y la misma persona cruzando un umbral en ese
   instante, cada una puede situar su venta en un tramo distinto. El importe de
   cada venta queda congelado y auditado, así que no hay doble pago ni pérdida;
   lo que puede variar es el tramo de una venta concreta en el borde. Fijarlo
   exige un secuenciador en el servidor y merece historia propia.
2. **La reversión de un cambio no tiene operación de negocio.** La reversa de
   comisión del cambio ya está conectada y probada, pero cancelar un cambio como
   documento sigue sin contrato funcional.
3. **La cancelación de ventas sigue sin operación.** `reverseSaleCommission()` es
   la autoridad de la parte de comisión y está probada; el reingreso de
   inventario y el reverso de cobros continúan fuera de alcance (H-56).
4. **`commission.bonus` sigue sin lector.** El bono no forma parte de la política
   autorizada y se deja como estaba.
5. **Deuda preexistente, ajena a H-69:** `test-concurrency.mjs` aborta con
   `TypeError` también en `HEAD`.
6. **El ajuste histórico no se aplicó.** Se entrega la vista previa; pagarlo es
   una decisión del dueño.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-69`.
- Autoridad anterior: `docs/fixes/autoridad-comision-efectiva.md` (H-31).
- Frontera de escritura: `supabase/migrations/20260730008200_pos_h56_commission_capabilities.sql`.
