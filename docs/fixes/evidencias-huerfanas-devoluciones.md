# Operación terminal para evidencias huérfanas de devoluciones

**Riesgo:** H-123
**Estado:** PARCIALMENTE RESUELTO — implementación desplegada; limpieza real pendiente
**Fecha:** 20/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

La limpieza selectiva detectaba dos `return_commits` sin una fila correspondiente
en `pos.returns`: `BG-260811-0015` y `BG-260812-0001`. La guarda H-120 impedía
limpiar Devoluciones, pero la interfaz no ofrecía una operación terminal para
retirar únicamente esas evidencias técnicas.

La prueba roja `test-h123-orphan-return-cleanup-e2e.mjs` confirmó que el grupo
seleccionable no existía. El preview remoto previo identificó exactamente los dos
folios y demostró ausencia de cabecera comercial, renglones, movimientos, pagos y
venta vigente asociados.

## Causa raíz

H-120 agregó detección y bloqueo cerrado, pero dejó incompleto el ciclo de vida:

- `test_data_cleanup_plan()` sólo exponía el detalle como una guarda de
  Devoluciones;
- `test_data_cleanup_payload()` no lo respaldaba como alcance autónomo;
- `execute_test_data_cleanup()` sólo podía retirar commits unidos a una
  devolución comercial seleccionada;
- la UI no tenía un dominio explícito para resolver la evidencia.

## Diseño

`orphan_return_evidence` es un dominio técnico, explícito y opt-in. Supabase
selecciona por `commit_id` y conserva también el `return_id` para colocar la
lápida antirresurrección. Antes de borrar, la ejecución toma el mismo advisory
lock que `commit_return`, vuelve a demostrar que el commit existe y continúa
sin cabecera comercial, y exige cardinalidad exacta.

El dominio tiene efecto cero sobre inventario y finanzas: no crea devoluciones,
`return_items`, pagos, movimientos ni documentos comerciales; tampoco recompone
ventas o comisiones. Un cambio del conjunto seleccionado invalida el `plan_hash`.
Si el administrador selecciona Devoluciones pero no el dominio huérfano, la
guarda H-120 permanece cerrada.

## Solución

- `20260820016300_pos_h123_orphan_return_cleanup.sql` extiende plan, respaldo,
  riesgo de flota y ejecución exacta; eleva el protocolo selectivo a 5 y el
  esquema a `20260820016300`.
- `20260820016400_pos_h123_orphan_return_cleanup_verification.sql` verifica el
  contrato dentro de `BEGIN/ROLLBACK`.
- `balam/settings.jsx` muestra el nuevo grupo, conteo, folio, fecha e identidad
  técnica, y explica explícitamente el efecto cero.
- `balam/store.jsx` anuncia el esquema y protocolo vigentes.
- Las regresiones H-113, H-116, H-119, H-120 y H-122 se actualizaron al contrato
  de ocho dominios/protocolo 5.

## Pruebas

- Prueba roja inicial: grupo ausente, 0/1.
- PostgreSQL 18 aislado: migraciones 163/164 aplicadas; verificación
  `H123_ORPHAN_RETURN_OK`.
- Fixture funcional transaccional: `H123_FUNCTIONAL_OK orphan=2
  valid_return=preserved stock=7 finance=preserved receipt=completed`.
- UI H-123: 15/15; flujo completo de preview, respaldo, confirmación y ejecución
  simulada; 320, 360, 390, 430, 768, 1024 y 1440 px sin overflow.
- H-113 UI 21/21; H-116 contrato 20/20 y UI 29/29; H-118 10/10;
  H-119 E2E real contra PostgreSQL aislado 37/37; H-122 UI 21/21.
- Cola local-first: 186/186. Migraciones: 31/31. Navegación: 15/15.
- Smoke del bundle productivo: 17/17. `node build-offline.mjs`: correcto.
- Supabase: dry-run exacto 163/164; ambas migraciones aplicadas y verificación
  remota correcta. La migración no elimina las evidencias reales.

## Despliegue

Las migraciones 163/164 se aplicaron antes del cliente. La publicación del
cliente y la ejecución exacta sobre los dos folios permanecen pendientes en este
momento; se documentarán con hashes e invariantes al terminar.

## Riesgo residual y pendientes

Hasta ejecutar el flujo autorizado, los dos commits reales continúan en
Supabase y la guarda permanece. No existe un efecto comercial conocido asociado;
la retirada real exige respaldo descargado, selección exacta, `plan_hash`
vigente y verificación posterior de dominios no relacionados.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-123--evidencias-huérfanas-de-devolución-sin-operación-terminal`
- Arquitectura: `docs/02-architecture.md`, «Limpieza selectiva y riesgo real de flota».
- Correcciones relacionadas: `consistencia-devoluciones-limpieza.md`,
  `claridad-dominios-limpieza.md`, `autoridad-unica-datos-h121.md`.
