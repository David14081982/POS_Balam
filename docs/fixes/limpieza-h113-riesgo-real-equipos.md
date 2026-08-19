# Riesgo real de equipos para limpieza H-113

**Riesgo:** H-116
**Estado:** RESUELTO — SERVIDOR Y CLIENTE PUBLICADOS
**Fecha:** 18/08/2026
**Commit:** `86011e7` (funcional); documentación final en commit posterior

## Problema y reproducción

El preview H-113 devolvía `cleanup_not_synchronized` si cualquier instalación
estaba offline, llevaba más de dos minutos sin heartbeat o tenía una época
distinta. También devolvía `client_schema_incompatible` para todo esquema
anterior a H-113. La lectura directa de `pos.test_data_cleanup_plan()` confirmó
que una computadora apagada con cola cero impedía el plan aunque no tuviera
nada que aportar.

## Causa raíz

La guarda usaba disponibilidad reciente y versión declarada como sustitutos de
riesgo. No cruzaba la cola proyectada con los dominios semánticos seleccionados,
ni distinguía una terminal cercable por H-77 de un cliente tan antiguo que
pudiera escribir sin obedecer `data_epoch`. Por eso mezclaba ausencia operativa,
actualización pendiente y conflicto real bajo dos bloqueos generales.

## Diseño

Supabase es la autoridad vigente mediante `system_manifest`, protocolo, época,
eventos, comandos, cuarentena y lápidas. La matriz es:

| Caso | Estado | ¿Bloquea? | Retorno seguro |
|---|---|---:|---|
| Compatible y en línea | `ready` | No | Continúa normalmente |
| Compatible y apagada | `compatible_offline` | No | Sin adaptación |
| Vieja cercable, cola sin conflicto | `update_on_return` | No | Actualiza/aplica evento o rebootstrap |
| Pendiente que intersecta | `attention` | Sí | Resolver o poner en cuarentena |
| Cola sin proyección suficiente | `attention` | Sí | Revisar antes de limpiar |
| Anterior al cerco H-77 | `unsafe_legacy` | Sí | Actualizar o retirar |
| Retirada administrativamente | `retired` | No | No vuelve a activarse por heartbeat |

Una operación pendiente conocida de un dominio ajeno no bloquea. Una ejecución
selectiva futura eleva época y protocolo en la misma transacción y emite evento
v3. El cliente consulta el manifiesto antes de `flushQueue()`; si no es
compatible no envía. En el retorno, poda identidades exactas o archiva la cola,
descarga la base autoritaria y adopta la época. Las lápidas rechazan la
resurrección posterior del mismo documento.

## Solución

- `20260818015300_pos_h116_cleanup_fleet_risk.sql` agrega la autoridad de riesgo,
  sustituye el preview público, cerca la ejecución futura, protege el retiro y
  permite retirar/reactivar desde administración.
- `20260818015400_pos_h116_cleanup_fleet_risk_verification.sql` prueba la matriz
  aislada y termina con rollback; no llama a la ejecución destructiva.
- `balam/store.jsx` adopta protocolos 2/3, vuelve a consultar el manifiesto tras
  un evento y expone el retiro administrativo.
- `balam/settings.jsx` muestra sólo listos, apagados no bloqueantes,
  actualización al volver y pendientes que requieren atención; protocolo,
  esquema y época quedan detrás de «Ver detalle».

## Auditoría solicitada

- No es necesario tener todas las terminales abiertas ni con heartbeat reciente.
- Bloquean sólo una operación intersectante, una cola cuyo alcance se desconoce
  o un cliente no cercable y no retirado.
- No bloquean una terminal compatible apagada, una vieja cercable sin conflicto,
  una pendiente demostrablemente ajena o una instalación retirada.
- La computadora vieja queda protegida al volver porque el manifiesto se evalúa
  antes de drenar, el evento v3 comunica identidades/época y el rebootstrap
  conserva la cola en cuarentena antes de adoptar la verdad central.
- `data_epoch` invalida la línea base; rebootstrap la reemplaza; cuarentena
  conserva trabajo dudoso sin reproducirlo; las lápidas evitan resurrección.

## Pruebas

- `node test-h116-cleanup-fleet-risk.mjs`: 20/20.
- PostgreSQL 18 temporal: migración y verificación H-116 completas,
  `H116_FUNCTIONAL_OK`, con rollback y sin datos reales.
- Casos obligatorios: apagada compatible; vieja sin cola; vieja con operación
  intersectante en «Caja 2»; pendiente ajena; retirada sin encender.
- `node test-h116-cleanup-fleet-risk-e2e.mjs`: 22/22 en 320, 360, 375, 390,
  430, 768, 1024, 1280 y 1440 px; sin overflow ni errores de navegador.
- Regresión: H-113 35/35 y UI 21/21; H-77 20/20; H-79 17/17; H-81 15/15;
  cola 176/176; migraciones 31/31; contratos de módulos 42/42.
- `node test-smoke.mjs bundle`: 17/17; build reproducible 8/8.

## Instalación remota

El dry-run propuso exclusivamente `20260818015300` y `20260818015400`. La
primera migración aditiva se instaló sin tocar filas comerciales. El primer
intento del verificador abortó porque su aserción del resumen esperaba una flota
vacía fuera de los seis fixtures; su transacción revirtió los fixtures. Se
corrigió para validar la contribución mínima de los casos identificados por
prefijo, se repitió en PostgreSQL 18 aislado con `H116_FUNCTIONAL_OK` y después
se aplicó remotamente. El dry-run final informó `Remote database is up to date`.
No se ejecutó `execute_test_data_cleanup`, Punto Cero ni otra RPC destructiva.

## Riesgo residual y pendientes

La limpieza real permanece fuera de alcance y requiere autorización separada.
El servidor y el cliente ya están publicados. El workflow de GitHub Pages para
`86011e7` terminó correctamente; la página pública y el blob Git de `index.html`
coinciden en 9,006,415 bytes y SHA-256
`11896105c98d3e8963786521bc0a5986ad4a951e868a6ce6450263e1094d5272`.
Un cliente realmente anterior al cerco H-77 continúa bloqueando salvo retiro
administrativo explícito. La limpieza real sigue requiriendo autorización
separada y no fue ejecutada durante H-116.

## Reconciliación del cierre — 19/08/2026

El diagnóstico que volvió a informar `client_schema_incompatible` no fue una
lectura del producto H-116: combinó `test-h113-selective-cleanup-e2e.mjs` con
el fixture histórico de cuatro incompatibles desde un checkout local en
`dc74757`. El arnés sirve el `index.html` local por `127.0.0.1`; no abrió Pages
ni verificó el blob H-116.
En ese momento `origin/main` ya estaba en `0984df2`, Supabase registraba
`20260818015300/15400` y Pages servía el blob H-116 exacto de 9,006,415 bytes,
SHA-256 `11896105c98d3e8963786521bc0a5986ad4a951e868a6ce6450263e1094d5272`.

La reproducción SQL A/B/C/D confirmó que la autoridad desplegada sí retira
`cleanup_not_synchronized` y `client_schema_incompatible`: una terminal antigua
cercable, posterior a H-77, apagada y con cola cero no bloquea; una antigua cercable con operación intersectante
bloquea; una antigua cercable con operación ajena aislable no bloquea y queda
`update_on_return`; un cliente anterior a H-77 no retirado bloquea como
`unsafe_legacy`. El cierre original no ejercitaba directamente los dos últimos
casos con esas precondiciones exactas; la regresión permanente ahora sí.

La corrección de cliente no cambia la autoridad ni relaja seguridad. Traduce
cada estado a una acción humana visible y explica también cuando sólo esta
computadora continúa sincronizando. Protocolo, esquema, época y códigos quedan
bajo «Ver detalle». Pruebas: contrato H-116 20/20; PostgreSQL 18 temporal
`H116_RECONCILIATION_A_B_C_D_OK` con rollback; UI H-116 26/26 en 320–1440 px;
H-113 35/35 y UI 21/21; H-77 20/20; H-79 17/17; H-81 15/15; cola 176/176;
migraciones 31/31; módulos 42/42; navegación 15/15; smoke bundle 17/17 y build
reproducible 8/8. No se ejecutó limpieza, heartbeat, retiro ni cambio de cola
real. Commit funcional: `4377378`. Publicación: Pages run `32231813811`
terminó en `success` y sirve el blob Git exacto
`e3dda27ae013c9e4a2e599a9bbecbc4c5f365191`: 9,006,567 bytes, SHA-256
`15d6a47288aeb02d06570adb8ee8705fe47fc37fde3b961537c19e4c2347177a`.
Ajuste de exactitud de la fixture A: Pendiente de commit.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-116--h-113-confunde-terminal-apagada-con-terminal-insegura`
- `docs/fixes/limpieza-selectiva-datos-prueba.md`
- `docs/architect/authorities/synchronization.md`
- `docs/architect/decisions/ADR-012-sincronizacion-en-vivo-coordinada.md`
